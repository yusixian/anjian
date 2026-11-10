import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

import {
  $reconcileRoot,
  createLoroBinding,
  editAtVersion,
  TREE_NAME,
} from '@haklex/rich-collab-loro';
import { $getRoot, type SerializedEditorState } from 'lexical';
import { decodeImportBlobMeta, LoroDoc, type OpId } from 'loro-crdt';

import { DOCUMENT_FEATURES } from '../shared/document-features';
import { boxDrawingDiagrams, parseDocument, serializeDocument, stampBlockIds } from './document-codec';
import { createDocumentHeadlessEditor } from './document-headless';

export type DocumentOutcome =
  | { kind: 'idle' }
  | { kind: 'merged'; stats: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'failed'; message: string };

export type DocumentEvent =
  | { type: 'update'; bytes: Uint8Array }
  | { type: 'status'; outcome: DocumentOutcome; streaming: boolean; agentActiveAt: number }
  | { type: 'saved' };

export interface DocumentSessionOptions {
  file: string;
  log?: (line: string) => void;
  snapshotFile: string;
  snapshotIntervalMs?: number;
  writeDelayMs?: number;
}

export interface DocumentSession {
  agentActiveAt: () => number;
  close: () => Promise<void>;
  flush: () => Promise<void>;
  importUpdate: (bytes: Uint8Array, features?: readonly string[]) => void;
  lineage: () => string;
  onFileText: (text: string) => void;
  prepareRemoteText: (text: string) => PreparedRemoteDocument;
  readyForRemoteUpload: () => Promise<void>;
  outcome: () => DocumentOutcome;
  settled: () => Promise<void>;
  snapshot: () => Uint8Array;
  state: () => SerializedEditorState;
  streaming: () => boolean;
  subscribe: (listener: (event: DocumentEvent) => void) => () => void;
}

export interface PreparedRemoteDocument {
  xml: string;
  warnings: string[];
  /** Signed change in persisted document state, excluding doc.xml itself. */
  stateDeltaBytes: number;
  validate: () => void;
  stage: () => void;
  addStateFile: (file: string, data: string | Uint8Array) => void;
  abort: () => void;
  commit: () => void;
  finalize: () => void;
}

function stagedState(snapshotFile: string, snapshot: Uint8Array, activityFile?: string, activity?: string) {
  const planned: Array<{ file: string; data: string | Uint8Array }> = [{ file: snapshotFile, data: snapshot }];
  if (activityFile && activity !== undefined) planned.push({ file: activityFile, data: activity });
  const entries: Array<{ file: string; temp: string; backup?: string; installed?: boolean }> = [];
  // The source path is validated by remote-transfer. Check the state subtree without
  // rejecting platform-owned aliases such as macOS /var -> /private/var.
  const stateRoot = path.dirname(path.dirname(path.dirname(snapshotFile)));
  const checkPath = (file: string) => {
    let current = path.resolve(file);
    while (current !== path.dirname(stateRoot)) {
      try {
        const stat = fsSync.lstatSync(current);
        if (stat.isSymbolicLink()) throw new Error('Unsafe document state path');
        if (current !== file && !stat.isDirectory()) throw new Error('Unsafe document state path');
        if (current === file && !stat.isFile()) throw new Error('Unsafe document state path');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      current = path.dirname(current);
    }
  };
  const stageFile = (file: string, data: string | Uint8Array) => {
    checkPath(file);
    fsSync.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    checkPath(file);
    const name = `${file}.${crypto.randomUUID()}.tmp`;
    fsSync.writeFileSync(name, data, { flag: 'wx', mode: 0o600 });
    entries.push({ file, temp: name });
  };
  const abort = () => {
    for (const entry of [...entries].reverse()) {
      if (entry.installed) fsSync.rmSync(entry.file, { force: true });
      if (entry.backup && fsSync.existsSync(entry.backup)) fsSync.renameSync(entry.backup, entry.file);
      fsSync.rmSync(entry.temp, { force: true });
    }
    entries.length = 0;
  };
  return {
    addStateFile: (file: string, data: string | Uint8Array) => {
      if (entries.length || planned.some((entry) => entry.file === file)) throw new Error('Document state already staged');
      planned.push({ file, data });
    },
    stage: () => {
      try {
        for (const entry of planned) stageFile(entry.file, entry.data);
      } catch (error) {
        abort();
        throw error;
      }
    },
    abort,
    commit: () => {
      if (entries.length !== planned.length) throw new Error('Document state was not staged');
      for (const entry of entries) {
        if (fsSync.existsSync(entry.file)) {
          entry.backup = `${entry.file}.${crypto.randomUUID()}.before`;
          fsSync.renameSync(entry.file, entry.backup);
        }
        fsSync.renameSync(entry.temp, entry.file);
        entry.installed = true;
      }
    },
    finalize: () => {
      for (const entry of entries) if (entry.backup) {
        try { fsSync.rmSync(entry.backup, { force: true }); }
        catch { /* Retain the previous state for recovery if cleanup fails. */ }
      }
      entries.length = 0;
    },
  };
}

function snapshotSignature(file: string): string | null {
  try {
    const stat = fsSync.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** The first upload has no live session; prepare its initial collaboration state off disk. */
export function prepareNewRemoteDocument(text: string, snapshotFile: string): PreparedRemoteDocument {
  const document = new LoroDoc();
  document.setRecordTimestamp(true);
  const editor = createDocumentHeadlessEditor();
  const binding = createLoroBinding(editor, document);
  editor.update(() => $reconcileRoot(parseDocument(text).root as never), { discrete: true });
  const beforeStamp = editor.getEditorState().toJSON();
  const stamped = stampBlockIds(beforeStamp);
  if (stamped !== beforeStamp && JSON.stringify(stamped) !== JSON.stringify(beforeStamp))
    editor.update(() => $reconcileRoot(stamped.root as never), { discrete: true });
  document.commit();
  const xml = serializeDocument(editor.getEditorState().toJSON());
  const warnings = boxDrawingDiagrams(editor.getEditorState().toJSON()).map((id) =>
    `block ${id} draws a diagram with box-drawing characters; this document is rendered, not Markdown, so use <mermaid>`,
  );
  const snapshot = document.export({ mode: 'snapshot' });
  binding.dispose();
  const state = stagedState(snapshotFile, snapshot);
  return {
    xml, warnings, stateDeltaBytes: snapshot.byteLength,
    validate: () => {
      if (fsSync.existsSync(snapshotFile)) throw new Error('Document state appeared during upload');
    },
    ...state,
  };
}

const WRITTEN_LIMIT = 50;

export class OutdatedClient extends Error {}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

function lcsLength(a: string[], b: string[]) {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table[0]![0]!;
}

function blockStats(before: SerializedEditorState, after: SerializedEditorState) {
  const a = before.root.children.map((block) => JSON.stringify(block));
  const b = after.root.children.map((block) => JSON.stringify(block));
  const common = lcsLength(a, b);
  const added = b.length - common;
  const removed = a.length - common;
  const changed = Math.min(added, removed);
  return `+${added - changed} ~${changed} -${removed - changed} blocks`;
}

// An agent edits the copy it last read, which may be several autosaves old. Merging
// against the newest text would read every human change since as a deletion. It has seen
// at least its own previous write, so older copies are not candidates: from those, a
// block it replaced or removed would look like a human addition and survive the merge.
function closestBase(
  written: Map<string, unknown>,
  text: string,
  fallback: string,
  floor: string | null,
) {
  const keys = [...written.keys()];
  const from = floor === null ? -1 : keys.indexOf(floor);
  const wanted = new Set(text.split('\n').map((line) => line.trim()));
  let best = fallback;
  let bestScore = -1;
  for (const candidate of from >= 0 ? keys.slice(from) : keys) {
    const lines = candidate.split('\n').map((line) => line.trim());
    const shared = lines.filter((line) => wanted.has(line)).length;
    const score = shared - (lines.length - shared);
    if (score >= bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function headsAfter(base: OpId[], update: Uint8Array): OpId[] {
  const ends = [...decodeImportBlobMeta(update, false).partialEndVersionVector.toJSON()];
  return ends.length ? ends.map(([peer, end]) => ({ peer, counter: end - 1 })) : base;
}

async function lastAgentWrite(activityFile: string, file: string) {
  const recorded = Number(await readText(activityFile));
  if (recorded > 0) return recorded;
  try {
    return Math.round((await fs.stat(file)).mtimeMs);
  } catch {
    return Date.now();
  }
}

async function readText(file: string) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, data: string | Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

export async function createDocumentSession(
  options: DocumentSessionOptions,
): Promise<DocumentSession> {
  const { file, snapshotFile, log = () => undefined } = options;
  const writeDelayMs = options.writeDelayMs ?? 300;
  const listeners = new Set<(event: DocumentEvent) => void>();
  const emit = (event: DocumentEvent) => listeners.forEach((listener) => {
    try { listener(event); }
    catch (error) {
      try { log(`document event listener failed: ${messageOf(error)}`); }
      catch { /* Observer diagnostics must not abort a committed document edit. */ }
    }
  });

  const loro = new LoroDoc();
  loro.setRecordTimestamp(true);
  let persistedVersion: string | null = null;
  let persistedSnapshotSignature: string | null = null;
  try {
    loro.import(await fs.readFile(snapshotFile));
    persistedVersion = JSON.stringify(loro.oplogVersion().toJSON());
    persistedSnapshotSignature = snapshotSignature(snapshotFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(`snapshot unreadable, starting fresh: ${messageOf(err)}`);
      await fs.rename(snapshotFile, `${snapshotFile}.bak`).catch(() => undefined);
    }
  }

  const editor = createDocumentHeadlessEditor();
  const binding = createLoroBinding(editor, loro);
  loro.subscribeLocalUpdates((bytes) => emit({ type: 'update', bytes }));

  const written = new Map<string, ReturnType<LoroDoc['frontiers']>>();
  const remember = (text: string, frontiers = loro.frontiers()) => {
    written.delete(text);
    written.set(text, frontiers);
    if (written.size > WRITTEN_LIMIT) written.delete(written.keys().next().value!);
  };

  let outcome: DocumentOutcome = { kind: 'idle' };
  let streaming = 0;
  let lastGoodText: string | null = null;
  let lastAgentText: string | null = null;
  let lastFileText = (await readText(file)) ?? '';
  // doc.xml's mtime also moves on human autosaves, so it only stands in before the first recorded agent write.
  const activityFile = path.join(path.dirname(snapshotFile), 'agent-active');
  let agentActiveAt = await lastAgentWrite(activityFile, file);
  let activitySaved = Promise.resolve();
  const emitStatus = () =>
    emit({ type: 'status', outcome, streaming: streaming > 0, agentActiveAt });
  const setOutcome = (next: DocumentOutcome) => {
    outcome = next;
    emitStatus();
  };

  try {
    const initial = parseDocument(lastFileText);
    loro.setNextCommitMessage(`session ${new Date().toISOString()}`);
    editor.update(() => $reconcileRoot(initial.root as never), { discrete: true });
    loro.commit();
    lastGoodText = lastFileText;
    remember(lastFileText);
  } catch (err) {
    setOutcome({ kind: 'rejected', message: messageOf(err) });
  }

  let writeTimer: NodeJS.Timeout | undefined;
  let snapshotDirty = true;
  let snapshotWriting = Promise.resolve();
  let writing = Promise.resolve();
  let playing = Promise.resolve();
  let revision = 0;

  const prepareAgentEdit = (baseText: string, text: string, target: SerializedEditorState) => {
    const baseState = parseDocument(baseText);
    const stats = blockStats(baseState, target);
    const base = written.get(baseText) ?? loro.frontiers();
    const update = editAtVersion(
      loro,
      base,
      createDocumentHeadlessEditor,
      target as never,
      `agent: ${stats}`,
    );
    remember(text, headsAfter(base, update));
    return { stats, update };
  };

  const onFileText = (text: string) => {
    if (text === lastFileText) return;
    lastFileText = text;
    revision++;
    agentActiveAt = Date.now();
    const at = agentActiveAt;
    activitySaved = activitySaved
      .then(() => writeAtomic(activityFile, String(at)))
      .catch((err) => log(`agent activity not saved: ${messageOf(err)}`));
    let target: SerializedEditorState;
    try {
      target = parseDocument(text);
    } catch (err) {
      log(`agent edit rejected: ${messageOf(err)}`);
      setOutcome({ kind: 'rejected', message: messageOf(err) });
      return;
    }
    const fallback = lastGoodText ?? serializeDocument(editor.getEditorState().toJSON());
    const floor = lastAgentText;
    lastAgentText = text;
    const queued = streaming > 0;
    lastGoodText = text;
    streaming += 1;
    emitStatus();
    playing = playing.then(() => {
      try {
        // Autosaves pause during streaming, so queued file edits build on the preceding agent write.
        const baseText = queued ? fallback : closestBase(written, text, fallback, floor);
        const { stats, update } = prepareAgentEdit(baseText, text, target);
        binding.import(update);
        revision++;
        emit({ type: 'update', bytes: update });
        log(`agent edit merged: ${stats}`);
        streaming -= 1;
        setOutcome({ kind: 'merged', stats });
      } catch (err) {
        log(`agent edit failed: ${messageOf(err)}`);
        streaming -= 1;
        setOutcome({ kind: 'failed', message: messageOf(err) });
      } finally {
        scheduleWrite();
      }
    });
  };

  const saveSnapshot = async () => {
    if (!snapshotDirty) return snapshotWriting;
    const version = JSON.stringify(loro.oplogVersion().toJSON());
    snapshotDirty = false;
    if (version === persistedVersion && persistedSnapshotSignature !== null &&
        snapshotSignature(snapshotFile) === persistedSnapshotSignature) return snapshotWriting;
    const bytes = loro.export({ mode: 'snapshot' });
    const persist = async () => {
      await writeAtomic(snapshotFile, bytes);
      persistedVersion = version;
      persistedSnapshotSignature = snapshotSignature(snapshotFile);
    };
    snapshotWriting = snapshotWriting.then(persist, persist);
    try { await snapshotWriting; }
    catch (error) { snapshotDirty = true; throw error; }
  };

  const write = async () => {
    clearTimeout(writeTimer);
    writeTimer = undefined;
    if (outcome.kind === 'rejected' || streaming > 0) return;
    const onDisk = await readText(file);
    if (onDisk !== null && onDisk !== lastFileText) {
      onFileText(onDisk);
      return;
    }
    const current = editor.getEditorState().toJSON();
    const stamped = stampBlockIds(current);
    if (stamped !== current && JSON.stringify(stamped) !== JSON.stringify(current)) {
      editor.update(() => $reconcileRoot(stamped.root as never), { discrete: true });
    }
    const text = serializeDocument(editor.getEditorState().toJSON());
    if (text !== lastFileText) {
      // Narrows, not closes, the window where an agent write lands between our read and our rename.
      const beforeRename = await readText(file);
      if (beforeRename !== null && beforeRename !== lastFileText) {
        onFileText(beforeRename);
        return;
      }
      await writeAtomic(file, text);
      lastFileText = text;
      lastGoodText = text;
      remember(text);
      emit({ type: 'saved' });
    }
    snapshotDirty = true;
    await saveSnapshot();
  };

  const flush = (): Promise<void> => {
    const previous = writing;
    writing = playing.then(() => previous).then(write, write);
    return writing.then(() => (streaming > 0 || writeTimer ? flush() : undefined));
  };

  function scheduleWrite() {
    snapshotDirty = true;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(
      () => void flush().catch((err) => log(`autosave failed: ${messageOf(err)}`)),
      writeDelayMs,
    );
  }

  const snapshotTimer = setInterval(
    () => void saveSnapshot().catch((err) => log(messageOf(err))),
    options.snapshotIntervalMs ?? 5000,
  );
  snapshotTimer.unref();
  scheduleWrite();

  return {
    snapshot: () => loro.export({ mode: 'snapshot' }),
    state: () => editor.getEditorState().toJSON(),
    lineage: () => loro.getTree(TREE_NAME).roots()[0]?.id ?? '',
    importUpdate: (bytes, features = []) => {
      const undeclared = DOCUMENT_FEATURES.filter((feature) => !features.includes(feature));
      const types = undeclared.length
        ? editor.getEditorState().read(
            () =>
              new Set(
                $getRoot()
                  .getChildren()
                  .map((block) => block.getType()),
              ),
          )
        : new Set<string>();
      const missing = undeclared.filter((feature) => types.has(feature));
      // A viewer that cannot build these nodes reconciles them away and sends that deletion back.
      if (missing.length)
        throw new OutdatedClient(
          `this page cannot show <${missing.join('>, <')}> blocks; reload the page`,
        );
      const probe = loro.fork();
      probe.import(bytes);
      if (probe.getTree(TREE_NAME).roots().length > 1)
        throw new Error('update belongs to a different document; reload the page');
      binding.import(bytes);
      emit({ type: 'update', bytes });
      scheduleWrite();
    },
    onFileText,
    readyForRemoteUpload: async () => { await flush(); await activitySaved; await snapshotWriting; },
    prepareRemoteText: (text) => {
      if (streaming > 0 || outcome.kind === 'rejected') throw new Error('Document is not ready for upload');
      const target = parseDocument(text);
      const fallback = lastGoodText ?? serializeDocument(editor.getEditorState().toJSON());
      const baseText = closestBase(written, text, fallback, lastAgentText);
      const base = written.get(baseText) ?? loro.frontiers();
      const stats = blockStats(parseDocument(baseText), target);
      const update = editAtVersion(loro, base, createDocumentHeadlessEditor, target as never, `agent: ${stats}`);
      const candidate = loro.fork();
      const candidateEditor = createDocumentHeadlessEditor();
      const candidateBinding = createLoroBinding(candidateEditor, candidate);
      const from = candidate.oplogVersion();
      candidateBinding.import(update);
      const beforeStamp = candidateEditor.getEditorState().toJSON();
      const stamped = stampBlockIds(beforeStamp);
      if (stamped !== beforeStamp && JSON.stringify(stamped) !== JSON.stringify(beforeStamp))
        candidateEditor.update(() => $reconcileRoot(stamped.root as never), { discrete: true });
      const xml = serializeDocument(candidateEditor.getEditorState().toJSON());
      const warnings = boxDrawingDiagrams(candidateEditor.getEditorState().toJSON()).map((id) =>
        `block ${id} draws a diagram with box-drawing characters; this document is rendered, not Markdown, so use <mermaid>`,
      );
      const mergedUpdate = candidate.export({ mode: 'update', from });
      const candidateSnapshot = candidate.export({ mode: 'snapshot' });
      candidateBinding.dispose();
      const size = (file: string) => { try { return fsSync.statSync(file).size; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; } };
      const at = Date.now();
      const activity = String(at);
      const stateDeltaBytes = candidateSnapshot.byteLength - size(snapshotFile) +
        Buffer.byteLength(activity) - size(activityFile);
      const expectedRevision = revision;
      const expectedFrontiers = JSON.stringify(loro.frontiers());
      const state = stagedState(snapshotFile, candidateSnapshot, activityFile, activity);
      const validate = () => {
        if (revision !== expectedRevision || JSON.stringify(loro.frontiers()) !== expectedFrontiers ||
            streaming > 0 || outcome.kind === 'rejected') throw new Error('Document changed during upload');
      };
      return {
        xml, warnings, stateDeltaBytes, validate, stage: state.stage, addStateFile: state.addStateFile,
        abort: state.abort, finalize: state.finalize,
        commit: () => {
          validate();
          state.commit();
          binding.import(mergedUpdate);
          persistedVersion = JSON.stringify(loro.oplogVersion().toJSON());
          persistedSnapshotSignature = snapshotSignature(snapshotFile);
          revision++;
          lastFileText = xml;
          lastGoodText = text;
          lastAgentText = text;
          remember(text, headsAfter(base, update));
          remember(xml);
          agentActiveAt = at;
          clearTimeout(writeTimer);
          writeTimer = undefined;
          snapshotDirty = false;
          emit({ type: 'update', bytes: mergedUpdate });
          setOutcome({ kind: 'merged', stats });
          emit({ type: 'saved' });
        },
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    outcome: () => outcome,
    streaming: () => streaming > 0,
    agentActiveAt: () => agentActiveAt,
    settled: () => playing,
    flush,
    close: async () => {
      clearInterval(snapshotTimer);
      await flush();
      await saveSnapshot();
      await activitySaved;
      binding.dispose();
      listeners.clear();
    },
  };
}
