import path from 'node:path';

import type { ArtifactReference } from '../shared/artifact-reference';
import type { SerializedReferenceNode } from '../shared/artifact-reference-node';
import { resolveReferenceFocus } from '../shared/reference-focus';
import type { ArtifactType } from '../shared/types';
import { findTrashedArtifact } from './artifact-trash';
import { parseDocument } from './document-codec';
import type { ShareTarget } from './hub-share';
import { artifactsRootOf } from './machine';
import { readRemoteArtifactRevision } from './remote-transfer';
import { ShareStoreError } from './share-store';
import { readCanvas } from './state';

const MAX_CHOICES = 24;
const REVISION = /^sha256:[a-f0-9]{64}$/;

interface Choice {
  key: string;
  label: string;
  nested?: boolean;
  reason?: 'unavailable' | 'unsupported' | 'cycle';
  revision?: string;
  target?: ShareTarget;
  type: ArtifactType;
  wholeArtifact?: boolean;
}

type Resolve = (reference: ArtifactReference) => ShareTarget | null;
const revisionConflict = () =>
  new ShareStoreError(
    409,
    'reference_revision_changed',
    'Preview the current document and references again',
  );

function documentRefs(xml: string) {
  return parseDocument(xml).root.children.flatMap((node, index) =>
    node.type === 'artifact-reference'
      ? [{ key: String(index), reference: (node as SerializedReferenceNode).reference }]
      : [],
  );
}

function findTarget(parent: ShareTarget, reference: ArtifactReference, resolve: Resolve) {
  const { type, target } = reference;
  const artifact = resolve(reference);
  return artifact &&
    artifact.project === parent.project &&
    artifact.url === `/${type}/${target}` &&
    !findTrashedArtifact(parent.project, type, target, 'address')
    ? artifact
    : null;
}

function parentReferences(parent: ShareTarget) {
  const source = readRemoteArtifactRevision(parent.project, `document/${parent.id}`);
  return source?.document
    ? { revision: source.revision, references: documentRefs(source.document) }
    : null;
}

export function referencedDocuments(parent: ShareTarget, resolve: Resolve) {
  const targets = new Map<string, ShareTarget>();
  for (const { reference } of parentReferences(parent)?.references.slice(0, MAX_CHOICES) ?? []) {
    if (reference.type !== 'document' || parent.url === `/document/${reference.target}`) continue;
    const target = findTarget(parent, reference, resolve);
    if (target) targets.set(target.url, target);
  }
  return targets.values();
}

export function shareReferences(
  parent: ShareTarget,
  resolve: Resolve,
  selected?: ReadonlySet<string>,
) {
  const source = parentReferences(parent);
  if (!source) return null;
  const snapshots = new Map<string, { revision: string; nested: boolean } | null>();
  const choices = source.references.slice(0, MAX_CHOICES).flatMap<Choice>(({ key, reference }) => {
    if (selected && !selected.has(key)) return [];
    const { type, target, focus } = reference;
    const base = { key, type, label: reference.label ?? '' };
    if (type === 'document' && parent.url === `/document/${target}`)
      return [{ ...base, reason: 'cycle' }];
    if (type === 'storyboard') return [{ ...base, reason: 'unsupported' }];
    try {
      const artifact = findTarget(parent, reference, resolve);
      if (!artifact) return [{ ...base, reason: 'unavailable' }];
      base.label ||= artifact.title;
      if (focus) {
        const { canvas, layout } = readCanvas(
          path.join(artifactsRootOf(parent.project), type, artifact.id),
        );
        if (!canvas || !layout || !resolveReferenceFocus(canvas, layout, focus))
          return [{ ...base, reason: 'unavailable' }];
      }
      if (!snapshots.has(artifact.url)) {
        const snapshot = readRemoteArtifactRevision(parent.project, `${type}/${artifact.id}`);
        snapshots.set(
          artifact.url,
          snapshot
            ? {
                revision: snapshot.revision,
                nested: !!snapshot.document && documentRefs(snapshot.document).length > 0,
              }
            : null,
        );
      }
      const snapshot = snapshots.get(artifact.url);
      if (!snapshot) return [{ ...base, reason: 'unavailable' }];
      return [
        {
          ...base,
          revision: snapshot.revision,
          target: artifact,
          ...(focus ? { wholeArtifact: true } : {}),
          ...(snapshot.nested ? { nested: true } : {}),
        },
      ];
    } catch {
      return [{ ...base, reason: 'unavailable' }];
    }
  });
  return { revision: source.revision, choices, truncated: source.references.length > MAX_CHOICES };
}

export function parseShareReferenceSelection(raw: unknown) {
  if (raw === undefined) return null;
  const invalid = () =>
    new ShareStoreError(400, 'invalid_reference_selection', 'Invalid reference selection');
  if (!raw || typeof raw !== 'object') throw invalid();
  const { revision, choices } = raw as { revision: unknown; choices: unknown };
  if (
    typeof revision !== 'string' ||
    !REVISION.test(revision) ||
    !Array.isArray(choices) ||
    choices.length > MAX_CHOICES
  )
    throw invalid();
  const revisions = new Map<string, string>();
  for (const choice of choices) {
    if (
      !choice ||
      typeof choice !== 'object' ||
      typeof choice.key !== 'string' ||
      !/^(?:0|[1-9]\d{0,7})$/.test(choice.key) ||
      revisions.has(choice.key) ||
      typeof choice.revision !== 'string' ||
      !REVISION.test(choice.revision)
    )
      throw invalid();
    revisions.set(choice.key, choice.revision);
  }
  return { revision, revisions };
}

export function verifyShareReferences(
  parent: ShareTarget,
  resolve: Resolve,
  selection: NonNullable<ReturnType<typeof parseShareReferenceSelection>>,
) {
  const current = shareReferences(parent, resolve, new Set(selection.revisions.keys()));
  if (
    !current ||
    current.revision !== selection.revision ||
    current.choices.length !== selection.revisions.size
  )
    throw revisionConflict();
  return current.choices.map(({ key, target, revision }) => {
    if (!target || !revision || selection.revisions.get(key) !== revision) throw revisionConflict();
    return { key, artifact: target, title: target.title, expectedRevision: revision };
  });
}
