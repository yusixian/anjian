import { setImmediate } from 'node:timers/promises';

import { TREE_NAME } from '@haklex/rich-collab-loro';
import { LoroDoc, VersionVector, type JsonOp, type OpId, type TreeID } from 'loro-crdt';

import { RemoteTransferError } from './remote-transfer';

interface ChangesQuery {
  from?: string;
  to?: string;
  versions?: boolean;
}

interface Operation {
  id: string;
  container: string;
  type: string;
}

interface BlockEvidence {
  treeId: TreeID;
  blockId?: string;
  operations: Operation[];
}

const NODE_DATA = /^cid:(\d+@\d+):Map$/;
const ROOT_TREE = `cid:root-${TREE_NAME}:Tree`;

function sourceOf(message: string | null | undefined) {
  if (message === 'human') return 'human';
  if (message?.startsWith('agent:')) return 'agent';
  if (message?.startsWith('session ')) return 'session';
  return 'unknown';
}

function versionToken(lineage: TreeID, frontiers: OpId[]) {
  const heads = [...frontiers]
    .sort((a, b) => a.peer.localeCompare(b.peer) || a.counter - b.counter)
    .map(({ peer, counter }) => [peer, counter]);
  return `v1.${Buffer.from(JSON.stringify([lineage, heads])).toString('base64url')}`;
}

function parseVersion(doc: LoroDoc, lineage: TreeID, token: string): VersionVector {
  let parsed: unknown;
  try {
    if (!/^v1\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid version token');
    parsed = JSON.parse(Buffer.from(token.slice(3), 'base64url').toString('utf8'));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !/^\d+@\d+$/.test(parsed[0]) ||
      !Array.isArray(parsed[1]) ||
      !parsed[1].every(
        (item: unknown) =>
          Array.isArray(item) &&
          item.length === 2 &&
          typeof item[0] === 'string' &&
          /^\d{1,20}$/.test(item[0]) &&
          BigInt(item[0]) <= 18446744073709551615n &&
          Number.isInteger(item[1]) &&
          item[1] >= 0 &&
          item[1] <= 2147483647,
      )
    ) {
      throw new Error('Invalid version token');
    }
  } catch {
    throw new RemoteTransferError(
      400,
      'invalid_document_version',
      'Invalid document version token.',
    );
  }

  if (parsed[0] !== lineage)
    throw new RemoteTransferError(
      409,
      'unavailable_document_version',
      'Version belongs to a different document history.',
    );
  const heads: OpId[] = parsed[1].map(([peer, counter]: [OpId['peer'], number]) => ({
    peer,
    counter,
  }));
  const known = doc.oplogVersion();
  try {
    if (heads.every(({ peer, counter }) => counter < (known.get(peer) ?? 0))) {
      const version = doc.frontiersToVV(heads);
      try {
        if (versionToken(lineage, doc.vvToFrontiers(version)) === token) return version;
      } catch {
        // Older frontiers may be present in the version vector without a retained operation.
      }
      version.free();
    }
  } catch {
    // Loro rejects frontiers outside of the retained history.
  } finally {
    known.free();
  }
  throw new RemoteTransferError(
    409,
    'unavailable_document_version',
    'Version is unavailable in the retained document history.',
  );
}

function atOrBefore(first: VersionVector, second: VersionVector) {
  const order = first.compare(second);
  return order !== undefined && order <= 0;
}

function operationNode(doc: LoroDoc, op: JsonOp) {
  if (op.container === ROOT_TREE && 'target' in op.content) return op.content.target;
  let container = doc.getContainerById(op.container);
  while (container) {
    const node = NODE_DATA.exec(container.id)?.[1] as TreeID | undefined;
    if (node) return node;
    container = container.parent();
  }
  return undefined;
}

function blockAt(doc: LoroDoc, lineage: TreeID, target: TreeID | undefined) {
  if (!target || target === lineage) return undefined;
  const tree = doc.getTree(TREE_NAME);
  if (!tree.has(target) || tree.isNodeDeleted(target)) return undefined;
  let node = tree.getNodeByID(target);
  while (node) {
    const parent = node.parent();
    if (parent?.id === lineage) {
      const state = node.data.get('$') as { blockId?: unknown } | undefined;
      const blockId = state?.blockId;
      return { treeId: node.id, ...(typeof blockId === 'string' ? { blockId } : {}) };
    }
    node = parent;
  }
  return undefined;
}

async function listVersions(doc: LoroDoc, lineage: TreeID, floor: VersionVector) {
  const changes = [...doc.getAllChanges().values()]
    .flat()
    .sort((a, b) => a.lamport - b.lamport || a.peer.localeCompare(b.peer) || a.counter - b.counter);
  const prefix = new VersionVector(floor.toJSON());
  const earliest = versionToken(lineage, doc.vvToFrontiers(floor));
  const latest = versionToken(lineage, doc.oplogFrontiers());
  try {
    const versions = [];
    for (const change of changes) {
      const end = change.counter + change.length;
      if (end <= (prefix.get(change.peer) ?? 0)) continue;
      prefix.setEnd({ peer: change.peer, counter: end });
      versions.push({
        version: versionToken(lineage, doc.vvToFrontiers(prefix)),
        source: sourceOf(change.message),
        timestamp: change.timestamp || null,
      });
      if (versions.length % 200 === 0) await setImmediate();
    }
    return { versions: versions.reverse(), latest, earliest, shallow: doc.isShallow() };
  } finally {
    prefix.free();
  }
}

export async function documentChanges(snapshot: Uint8Array, query: ChangesQuery) {
  const doc = new LoroDoc();
  try {
    try {
      doc.import(snapshot);
    } catch {
      throw new RemoteTransferError(
        409,
        'unavailable_document_history',
        'Document history snapshot could not be read.',
      );
    }
    const roots = doc.getTree(TREE_NAME).roots();
    if (roots.length !== 1)
      throw new RemoteTransferError(
        409,
        'unavailable_document_history',
        'Document has no usable retained history.',
      );
    const lineage = roots[0]!.id;

    const floor = doc.shallowSinceVV();
    try {
      if (query.versions) return await listVersions(doc, lineage, floor);
      if (!query.from)
        throw new RemoteTransferError(
          400,
          'missing_document_version',
          'A starting document version is required.',
        );
      const from = parseVersion(doc, lineage, query.from);
      try {
        const to = query.to ? parseVersion(doc, lineage, query.to) : doc.oplogVersion();
        try {
          if (!atOrBefore(floor, from))
            throw new RemoteTransferError(
              409,
              'unavailable_document_version',
              'Starting version predates the retained document history.',
            );
          if (!atOrBefore(from, to))
            throw new RemoteTransferError(
              409,
              'unordered_document_versions',
              'Starting version must precede or equal the ending version.',
            );
          return {
            from: query.from,
            to: query.to ?? versionToken(lineage, doc.oplogFrontiers()),
            ...(await readChanges(doc, lineage, from, to)),
            shallow: doc.isShallow(),
          };
        } finally {
          to.free();
        }
      } finally {
        from.free();
      }
    } finally {
      floor.free();
    }
  } finally {
    doc.free();
  }
}

async function readChanges(doc: LoroDoc, lineage: TreeID, from: VersionVector, to: VersionVector) {
  const interval = doc
    .exportJsonUpdates(from, to, false)
    .changes.sort((a, b) => a.lamport - b.lamport || a.id.localeCompare(b.id));
  const prefix = new VersionVector(from.toJSON());
  try {
    const changes = [];
    let unknownChanges = 0;
    let humanOperations = 0;
    for (const change of interval) {
      const [counter, peer] = change.id.split('@') as [string, OpId['peer']];
      const original = doc.getChangeAt({ peer, counter: Number(counter) });
      const end = Math.min(original.counter + original.length, to.get(peer)!);
      const source = sourceOf(change.msg);
      if (source !== 'human') {
        if (source === 'unknown') unknownChanges++;
        prefix.setEnd({ peer, counter: end });
        continue;
      }
      doc.checkout(doc.vvToFrontiers(prefix));
      const blocks = new Map<TreeID, BlockEvidence>();
      const unlocated: Operation[] = [];
      for (const [index, op] of change.ops.entries()) {
        const before = blockAt(doc, lineage, operationNode(doc, op));
        // An exported text operation can span several counters.
        prefix.setEnd({ peer, counter: change.ops[index + 1]?.counter ?? end });
        doc.checkout(doc.vvToFrontiers(prefix));
        const after = blockAt(doc, lineage, operationNode(doc, op));
        const evidence: Operation = {
          id: `${op.counter}@${peer}`,
          container: op.container,
          type: op.content.type,
        };
        const affected =
          after && after.treeId !== before?.treeId ? [before, after] : [after ?? before];
        for (const block of affected) {
          if (!block) continue;
          const record = blocks.get(block.treeId) ?? { ...block, operations: [] };
          record.blockId ??= block.blockId;
          record.operations.push(evidence);
          blocks.set(block.treeId, record);
        }
        if (!before && !after) unlocated.push(evidence);
        if (++humanOperations % 200 === 0) await setImmediate();
      }
      prefix.setEnd({ peer, counter: end });
      changes.push({
        id: change.id,
        author: { source, peer },
        timestamp: change.timestamp || null,
        blocks: [...blocks.values()],
        unlocated,
      });
    }

    // Browser-created blocks get their XML IDs during the server's next autosave.
    doc.checkout(doc.vvToFrontiers(to));
    for (const change of changes) {
      for (const block of change.blocks)
        block.blockId ??= blockAt(doc, lineage, block.treeId)?.blockId;
    }
    return { empty: changes.length === 0, changes, unknownChanges };
  } finally {
    prefix.free();
  }
}
