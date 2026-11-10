import fs from 'node:fs/promises';
import fsSync from 'node:fs';
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
import type { CommentAdmission } from './document-comments';
import { createPreparedStateFiles } from './storage/prepared-files';

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
  stateRoot?: string;
  log?: (line: string) => void;
  snapshotFile: string;
  snapshotIntervalMs?: number;
  writeDelayMs?: number;
}

export interface DocumentSession {
  agentActiveAt: () => number;
  close: (admit?: CommentAdmission) => Promise<void>;
  flush: (admit?: CommentAdmission) => Promise<void>;
  quiesce: (admit?: CommentAdmission) => Promise<() => void>;
  importUpdate: (bytes: Uint8Array, features?: readonly string[]) => void;
  saveUpdate: (bytes: Uint8Array, features?: readonly string[], admit?: CommentAdmission) => void;
  lineage: () => string;
  onFileText: (text: string) => void;
  prepareRemoteText: (text: string) => PreparedRemoteDocument;
  readyForRemoteUpload: (admit?: CommentAdmission) => Promise<void>;
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
export function prepareNewRemoteDocument(text: string, snapshotFile: string, stateRoot = path.dirname(snapshotFile)): PreparedRemoteDocument {
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
  const state = createPreparedStateFiles(stateRoot, [{ file: snapshotFile, data: snapshot }]);
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
export class DocumentPersistenceError extends Error {}

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
  const versionKey = () => JSON.stringify([...loro.oplogVersion().toJSON()].sort(([a], [b]) => a.localeCompare(b)));
  let persistedVersion: string | null = null;
  let persistedSnapshotSignature: string | null = null;
  try {
    loro.import(await fs.readFile(snapshotFile));
    persistedVersion = versionKey();
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
  let activityDirty = false;
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
  let snapshotTimer: NodeJS.Timeout | undefined;
  let paused = false;
  let pausedWrite = false;
  let disposed = false;
  let snapshotDirty = true;
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
    activityDirty = true;
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

  const persistDocument = (xml: string | null, snapshot: Uint8Array, admit?: CommentAdmission) => {
    const size = (target: string) => {
      try { return fsSync.statSync(target).size; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
    };
    const stateFiles: Array<{ file: string; data: string | Uint8Array }> = [
      { file: snapshotFile, data: snapshot },
      ...(activityDirty ? [{ file: activityFile, data: String(agentActiveAt) }] : []),
    ];
    const delta = (xml === null ? 0 : Buffer.byteLength(xml) - size(file)) +
      stateFiles.reduce((sum, entry) => sum + Buffer.byteLength(entry.data) - size(entry.file), 0);
    admit?.(delta);
    const content = createPreparedStateFiles(path.dirname(file), xml === null ? [] : [{ file, data: xml }]);
    const state = createPreparedStateFiles(options.stateRoot ?? path.dirname(snapshotFile), stateFiles);
    try {
      content.stage(); state.stage();
      content.commit(); state.commit();
    } catch (error) {
      const errors: unknown[] = [error];
      for (const transaction of [state, content]) {
        try { transaction.abort(); } catch (rollback) { errors.push(rollback); }
      }
      throw new DocumentPersistenceError('Document could not be saved. Please retry.', { cause: errors.length > 1 ? new AggregateError(errors, 'Document save rollback failed') : error });
    }
    activityDirty = false;
    return () => { content.finalize(); state.finalize(); };
  };

  const write = async (admit?: CommentAdmission) => {
    clearTimeout(writeTimer);
    writeTimer = undefined;
    if (streaming > 0) return;
    if (outcome.kind === 'rejected') {
      // Preserve recoverable collaborative edits without overwriting invalid
      // externally supplied XML or acknowledging that source as saved.
      const version = versionKey();
      if (activityDirty || version !== persistedVersion || persistedSnapshotSignature === null ||
          snapshotSignature(snapshotFile) !== persistedSnapshotSignature) {
        const finalize = persistDocument(null, loro.export({ mode: 'snapshot' }), admit);
        persistedVersion = version;
        persistedSnapshotSignature = snapshotSignature(snapshotFile);
        finalize();
      }
      snapshotDirty = false;
      return;
    }
    let onDisk: string | null;
    try { onDisk = fsSync.readFileSync(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      onDisk = null;
    }
    if (onDisk !== null && onDisk !== lastFileText) {
      onFileText(onDisk);
      return;
    }
    const current = editor.getEditorState().toJSON();
    const stamped = stampBlockIds(current);
    if (stamped !== current && JSON.stringify(stamped) !== JSON.stringify(current))
      editor.update(() => $reconcileRoot(stamped.root as never), { discrete: true });
    const text = serializeDocument(editor.getEditorState().toJSON());
    const version = versionKey();
    const changed = text !== lastFileText;
    if (!activityDirty && !changed && version === persistedVersion && persistedSnapshotSignature !== null &&
        snapshotSignature(snapshotFile) === persistedSnapshotSignature) {
      snapshotDirty = false;
      return;
    }
    // No asynchronous gap between capturing the matching XML/snapshot pair and
    // installing it. A failure keeps both disk files and the saved acknowledgement unchanged.
    snapshotDirty = true;
    const finalize = persistDocument(text, loro.export({ mode: 'snapshot' }), admit);
    persistedVersion = version;
    persistedSnapshotSignature = snapshotSignature(snapshotFile);
    lastFileText = text;
    lastGoodText = text;
    remember(text);
    snapshotDirty = false;
    finalize();
    if (changed) emit({ type: 'saved' });
  };

  const flush = (admit?: CommentAdmission): Promise<void> => {
    const previous = writing;
    writing = playing.then(() => previous).then(() => write(admit), () => write(admit));
    return writing.then(() => (streaming > 0 || writeTimer ? flush(admit) : undefined));
  };

  function scheduleWrite() {
    snapshotDirty = true;
    clearTimeout(writeTimer);
    if (paused) { pausedWrite = true; writeTimer = undefined; return; }
    writeTimer = setTimeout(
      () => void flush().catch((err) => log(`autosave failed: ${messageOf(err)}`)),
      writeDelayMs,
    );
  }

  const startSnapshotTimer = () => {
    snapshotTimer = setInterval(
      () => void flush().catch((err) => log(messageOf(err))),
      options.snapshotIntervalMs ?? 5000,
    );
    snapshotTimer.unref();
  };
  const resume = () => {
    if (!paused || disposed) return;
    paused = false;
    startSnapshotTimer();
    if (pausedWrite) { pausedWrite = false; scheduleWrite(); }
  };
  startSnapshotTimer();
  scheduleWrite();

  const validateUpdate = (bytes: Uint8Array, features: readonly string[]) => {
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
  };

  return {
    snapshot: () => loro.export({ mode: 'snapshot' }),
    state: () => editor.getEditorState().toJSON(),
    lineage: () => loro.getTree(TREE_NAME).roots()[0]?.id ?? '',
    importUpdate: (bytes, features = []) => {
      validateUpdate(bytes, features);
      binding.import(bytes);
      emit({ type: 'update', bytes });
      scheduleWrite();
    },
    saveUpdate: (bytes, features = [], admit) => {
      if (streaming > 0 || outcome.kind === 'rejected' || writeTimer || snapshotDirty)
        throw new Error('Document is not ready to save; retry after flushing');
      validateUpdate(bytes, features);
      if (fsSync.readFileSync(file, 'utf8') !== lastFileText)
        throw new Error('Document source changed; retry after flushing');
      const candidate = loro.fork();
      const candidateEditor = createDocumentHeadlessEditor();
      const candidateBinding = createLoroBinding(candidateEditor, candidate);
      let xml: string;
      let snapshot: Uint8Array;
      let update: Uint8Array;
      try {
        const from = candidate.oplogVersion();
        candidateBinding.import(bytes);
        const before = candidateEditor.getEditorState().toJSON();
        const stamped = stampBlockIds(before);
        if (JSON.stringify(stamped) !== JSON.stringify(before))
          candidateEditor.update(() => $reconcileRoot(stamped.root as never), { discrete: true });
        xml = serializeDocument(candidateEditor.getEditorState().toJSON());
        snapshot = candidate.export({ mode: 'snapshot' });
        update = candidate.export({ mode: 'update', from });
      } finally { candidateBinding.dispose(); }
      const finalize = persistDocument(xml, snapshot, admit);
      binding.import(update);
      revision++;
      persistedVersion = versionKey();
      persistedSnapshotSignature = snapshotSignature(snapshotFile);
      lastFileText = xml;
      lastGoodText = xml;
      remember(xml);
      snapshotDirty = false;
      finalize();
      emit({ type: 'update', bytes: update });
      emit({ type: 'saved' });
    },
    onFileText,
    readyForRemoteUpload: async admit => { await flush(admit); },
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
      const state = createPreparedStateFiles(options.stateRoot ?? path.dirname(snapshotFile), [
        { file: snapshotFile, data: candidateSnapshot }, { file: activityFile, data: activity },
      ]);
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
          persistedVersion = versionKey();
          persistedSnapshotSignature = snapshotSignature(snapshotFile);
          revision++;
          lastFileText = xml;
          lastGoodText = text;
          lastAgentText = text;
          remember(text, headsAfter(base, update));
          remember(xml);
          agentActiveAt = at;
          activityDirty = false;
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
    quiesce: async admit => {
      if (paused || disposed) throw new Error('Document session is already paused or closed');
      paused = true;
      clearTimeout(writeTimer);
      writeTimer = undefined;
      clearInterval(snapshotTimer);
      snapshotTimer = undefined;
      try {
        await flush(admit);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          resume();
        };
      } catch (error) {
        pausedWrite = true;
        resume();
        throw error;
      }
    },
    close: async admit => {
      clearInterval(snapshotTimer);
      await flush(admit);
      binding.dispose();
      listeners.clear();
      disposed = true;
    },
  };
}
