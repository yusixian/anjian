// Excalidraw and some haklex dependencies read Node globals at import time.
const globals = window as unknown as Record<string, unknown>;
globals.global ??= window;
globals.process ??= { env: {} };
globals.EXCALIDRAW_ASSET_PATH ??= new URL('.', import.meta.url).href;

export {};
