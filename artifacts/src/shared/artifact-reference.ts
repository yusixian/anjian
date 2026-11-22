import { isArtifactAddress, isArtifactType } from './ids';
import { ARTIFACT_TYPES, type ArtifactType } from './types';

export interface ArtifactReference {
  focus?: { kind: 'board' | 'group'; id: string };
  label?: string;
  reviewGroups?: string[];
  target: string;
  type: ArtifactType;
}

const FOCUS_ID = /^[\w~-][\w.~-]{0,127}$/;
function containsControlCharacter(label: string): boolean {
  return [...label].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateArtifactReference(value: unknown): asserts value is ArtifactReference {
  if (!isRecord(value) || typeof value.type !== 'string' || !isArtifactType(value.type))
    throw new Error('<ref> type must be one of ' + ARTIFACT_TYPES.join(', '));
  if (
    typeof value.target !== 'string' ||
    /\s/.test(value.target) ||
    !isArtifactAddress(value.target)
  )
    throw new Error('<ref> target must be a stable artifact ID');
  if (
    value.label !== undefined &&
    (typeof value.label !== 'string' ||
      !value.label.trim() ||
      value.label.length > 160 ||
      containsControlCharacter(value.label))
  )
    throw new Error('<ref> label must contain 1–160 characters on one line');
  if (value.focus !== undefined) {
    if (value.type !== 'artboard') throw new Error('<ref> focus is only supported for artboards');
    const { focus } = value;
    if (
      !isRecord(focus) ||
      (focus.kind !== 'board' && focus.kind !== 'group') ||
      typeof focus.id !== 'string' ||
      !FOCUS_ID.test(focus.id) ||
      /\s/.test(focus.id)
    )
      throw new Error('<ref> board or group must be a URL-safe ID of up to 128 characters');
    if (Object.keys(focus).some((key) => key !== 'kind' && key !== 'id'))
      throw new Error('<ref> contains unsupported focus fields');
  }
  if (value.reviewGroups !== undefined) {
    const groups = value.reviewGroups;
    if (
      value.type !== 'artboard' ||
      value.focus !== undefined ||
      !Array.isArray(groups) ||
      !groups.length ||
      groups.length > 100 ||
      new Set(groups).size !== groups.length ||
      groups.some((id) => typeof id !== 'string' || !FOCUS_ID.test(id))
    )
      throw new Error('<ref> groups must be up to 100 distinct verify-group IDs on one artboard');
  }
  if (
    Object.keys(value).some(
      (key) => !['type', 'target', 'label', 'focus', 'reviewGroups'].includes(key),
    )
  )
    throw new Error('<ref> contains unsupported fields');
}
