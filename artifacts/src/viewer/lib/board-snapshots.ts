const CACHE = 'anjian-board-snapshots-v1';
const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 48;

export function canCacheBoardSnapshots() {
  try {
    return typeof caches !== 'undefined' && !!globalThis.crypto?.subtle;
  } catch {
    return false;
  }
}

async function openSnapshots(secret: string) {
  const raw = Uint8Array.from(secret.match(/../g) ?? [], (hex) => Number.parseInt(hex, 16));
  const [cache, hash, key] = await Promise.all([
    caches.open(CACHE),
    crypto.subtle.digest('SHA-256', raw),
    crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']),
  ]);
  const scope = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return { cache, key, prefix: new URL('/__anjian-snapshot/' + scope + '/', location.origin).href };
}

export async function loadBoardSnapshots(secret: string): Promise<Map<string, Blob>> {
  const result = new Map<string, Blob>();
  const { cache, key, prefix } = await openSnapshots(secret);
  const requests = (await cache.keys()).filter(({ url }) => url.startsWith(prefix));
  await Promise.all(
    requests.map(async (request) => {
      try {
        const entry = await cache.match(request);
        if (!entry) return;
        const iv = Uint8Array.from(atob(entry.headers.get('X-Anjian-IV') ?? ''), (byte) =>
          byte.charCodeAt(0),
        );
        const data = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv,
            additionalData: new TextEncoder().encode(request.url),
          },
          key,
          await entry.arrayBuffer(),
        );
        result.set(
          decodeURIComponent(request.url.slice(prefix.length)),
          new Blob([data], { type: 'image/png' }),
        );
      } catch {
        // An evicted or corrupt entry falls back to its live board.
      }
    }),
  );
  return result;
}

export async function saveBoardSnapshot(secret: string, id: string, image: Blob) {
  if (image.type !== 'image/png' || image.size > MAX_BYTES) return;
  const { cache, key, prefix } = await openSnapshots(secret);
  const url = prefix + encodeURIComponent(id);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(url),
    },
    key,
    await image.arrayBuffer(),
  );
  await cache.put(
    url,
    new Response(bytes, { headers: { 'X-Anjian-IV': btoa(String.fromCharCode(...iv)) } }),
  );
  const entries = await cache.keys();
  await Promise.all(
    entries.slice(0, Math.max(0, entries.length - MAX_ENTRIES)).map((entry) => cache.delete(entry)),
  );
}
