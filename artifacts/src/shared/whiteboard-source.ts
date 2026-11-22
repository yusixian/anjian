import {
  isWhiteboardPageId,
  parseWhiteboardPages,
  parseWhiteboardScene,
  WHITEBOARD_PAGES_FILE,
  WHITEBOARD_SCENE_FILE,
  whiteboardPageFile,
} from './whiteboard';

export function isWhiteboardSourceFile(name: string): boolean {
  if (name === WHITEBOARD_SCENE_FILE || name === WHITEBOARD_PAGES_FILE) return true;
  const page = /^pages\/([^/]+)\.excalidraw$/.exec(name);
  return page !== null && isWhiteboardPageId(page[1]);
}

export function declaredWhiteboardPageFiles(contents: Uint8Array | undefined): ReadonlySet<string> | null {
  if (!contents) return new Set();
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(contents);
    const pages = parseWhiteboardPages(JSON.parse(text));
    return pages && new Set(pages.map(({ id }) => whiteboardPageFile(id)));
  } catch {
    return null;
  }
}

/** Validate the attached pages without reading files outside the manifest. */
export function whiteboardSourceProblem(
  names: ReadonlySet<string>,
  readText: (name: string) => string,
): string | null {
  const scenes = [WHITEBOARD_SCENE_FILE];
  if (names.has(WHITEBOARD_PAGES_FILE)) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(readText(WHITEBOARD_PAGES_FILE));
    } catch {
      return `${WHITEBOARD_PAGES_FILE} must be valid UTF-8 JSON`;
    }
    const pages = parseWhiteboardPages(manifest);
    if (!pages) return `${WHITEBOARD_PAGES_FILE} is not a valid whiteboard page manifest`;
    scenes.push(...pages.map(({ id }) => whiteboardPageFile(id)));
  }
  const listed = new Set(scenes);
  for (const name of names) {
    if (name !== WHITEBOARD_PAGES_FILE && !listed.has(name))
      return `${name} is not listed in ${WHITEBOARD_PAGES_FILE}`;
  }
  for (const name of scenes) {
    if (!names.has(name)) return `${name} is required`;
    let scene: unknown;
    try {
      scene = JSON.parse(readText(name));
    } catch {
      return `${name} must be valid UTF-8 JSON`;
    }
    if (!parseWhiteboardScene(scene)) return `${name} is not a valid Excalidraw scene`;
  }
  return null;
}
