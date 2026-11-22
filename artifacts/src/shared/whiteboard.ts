import { type AnchorSpec, type CommentsFile, isObject } from './comments';

export const WHITEBOARD_SCENE_FILE = 'scene.excalidraw';
export const MAX_WHITEBOARD_SCENE_BYTES = 16 * 1024 * 1024;

export interface WhiteboardElement extends Record<string, unknown> {
  id: string;
  type: string;
}

export interface WhiteboardScene {
  appState?: Record<string, unknown>;
  elements: WhiteboardElement[];
  files?: Record<string, unknown>;
  source?: string;
  type: 'excalidraw';
  version: 2;
}

export interface WhiteboardAnchor {
  elementIds: string[];
}

export type WhiteboardComments = CommentsFile<WhiteboardAnchor>;

export interface WhiteboardSnapshot {
  comments: WhiteboardComments;
  commentsWarning?: string;
  listening: boolean;
  revision: string;
  scene: WhiteboardScene;
  title: string;
}

const id = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100;

const record = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && !Array.isArray(value);

function safeLink(value: unknown) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value, 'https://anjian.invalid');
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

function validShape(element: Record<string, unknown>) {
  if (element.type === 'text' && typeof element.text !== 'string') return false;
  if (element.type !== 'line' && element.type !== 'arrow' && element.type !== 'freedraw')
    return true;
  return (
    Array.isArray(element.points) &&
    element.points.every(
      (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite),
    )
  );
}

export function parseWhiteboardScene(value: unknown): WhiteboardScene | null {
  if (
    !record(value) ||
    value.type !== 'excalidraw' ||
    value.version !== 2 ||
    !Array.isArray(value.elements)
  )
    return null;
  const ids = new Set<string>();
  for (const element of value.elements) {
    if (
      !record(element) ||
      !id(element.id) ||
      !id(element.type) ||
      ids.has(element.id) ||
      !safeLink(element.link) ||
      !validShape(element)
    )
      return null;
    ids.add(element.id);
  }
  if (value.appState !== undefined && !record(value.appState)) return null;
  if (value.files !== undefined && !record(value.files)) return null;
  if (value.source !== undefined && typeof value.source !== 'string') return null;
  return value as unknown as WhiteboardScene;
}

export const emptyWhiteboardScene = (): WhiteboardScene => ({
  type: 'excalidraw',
  version: 2,
  elements: [],
});

export const whiteboardAnchors: AnchorSpec<WhiteboardAnchor> = {
  read(value) {
    if (!record(value)) return null;
    const { elementIds } = value;
    return Array.isArray(elementIds) &&
      elementIds.length > 0 &&
      elementIds.length <= 100 &&
      elementIds.every(id) &&
      new Set(elementIds).size === elementIds.length
      ? { elementIds }
      : null;
  },
  same: (a, b) =>
    a.elementIds.length === b.elementIds.length &&
    a.elementIds.every((id) => b.elementIds.includes(id)),
  missing: 'a new whiteboard thread needs anchor.elementIds; dropped it',
};
