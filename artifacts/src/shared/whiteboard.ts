import { type AnchorSpec, type CommentsFile, isObject } from './comments';

export const WHITEBOARD_SCENE_FILE = 'scene.excalidraw';
export const WHITEBOARD_PAGES_FILE = 'pages.json';
export const WHITEBOARD_DEFAULT_PAGE = 'main';
export const MAX_WHITEBOARD_SCENE_BYTES = 16 * 1024 * 1024;
export const MAX_WHITEBOARD_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_WHITEBOARD_PAGES = 64;

export interface WhiteboardPage {
  id: string;
  title: string;
}

export function isWhiteboardPageId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

export function whiteboardPageFile(id: string) {
  return id === WHITEBOARD_DEFAULT_PAGE ? WHITEBOARD_SCENE_FILE : `pages/${id}.excalidraw`;
}

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
  page?: string;
}

export type WhiteboardComments = CommentsFile<WhiteboardAnchor>;

export interface WhiteboardSnapshot {
  comments: WhiteboardComments;
  commentsWarning?: string;
  listening: boolean;
  page: string;
  pages: WhiteboardPage[];
  revision: string;
  scene: WhiteboardScene;
  title: string;
}

const id = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100;

const record = (value: unknown): value is Record<string, unknown> =>
  isObject(value) && !Array.isArray(value);

export function parseWhiteboardPages(value: unknown): WhiteboardPage[] | null {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.pages) ||
    value.pages.length >= MAX_WHITEBOARD_PAGES
  )
    return null;
  const pages: WhiteboardPage[] = [];
  const ids = new Set([WHITEBOARD_DEFAULT_PAGE]);
  for (const page of value.pages) {
    if (
      !record(page) ||
      !isWhiteboardPageId(page.id) ||
      ids.has(page.id) ||
      typeof page.title !== 'string' ||
      !page.title.trim() ||
      page.title.length > 120
    )
      return null;
    ids.add(page.id);
    pages.push({ id: page.id, title: page.title.trim() });
  }
  return pages;
}

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
    const { elementIds, page } = value;
    return Array.isArray(elementIds) &&
      elementIds.length > 0 &&
      elementIds.length <= 100 &&
      elementIds.every(id) &&
      (page === undefined || isWhiteboardPageId(page)) &&
      new Set(elementIds).size === elementIds.length
      ? { elementIds, ...(page && page !== WHITEBOARD_DEFAULT_PAGE ? { page } : {}) }
      : null;
  },
  same: (a, b) =>
    (a.page ?? WHITEBOARD_DEFAULT_PAGE) === (b.page ?? WHITEBOARD_DEFAULT_PAGE) &&
    a.elementIds.length === b.elementIds.length &&
    a.elementIds.every((id) => b.elementIds.includes(id)),
  missing: 'a new whiteboard thread needs anchor.elementIds; dropped it',
};
