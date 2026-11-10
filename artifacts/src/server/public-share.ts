import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

import { computeLayout } from '../shared/geometry';
import type { CanvasSpec } from '../shared/types';
import { parseDocument } from './document-codec';
import { mimeOf, send } from './http';
import type { createShareStore, ShareRecord } from './share-store';
import { allowInlineScripts } from './viewer-page';

interface Options {
  store: ReturnType<typeof createShareStore>;
  origin: string;
  previewOrigin: string;
  viewerDir: string;
  runtimeDir?: string;
  registered: (project: string) => boolean;
}
const TOKEN = '[A-Za-z0-9_-]{43}';
const ROUTE = new RegExp(`^/s/(${TOKEN})(?:/(.*))?$`);
const unavailable = '<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>分享无法访问 · 案间</title><body style="font:15px system-ui;max-width:520px;padding:60px 24px;margin:auto;line-height:1.8"><h1>此分享暂时无法访问</h1><p>链接可能已失效，或分享者已关闭访问。</p><p>请联系分享者获取有效链接。</p></body></html>';
const baseHeaders = {
  'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
};
const revisionOf = (record: ShareRecord) => record.revision.replace(/^sha256:/, '');
const fileBase = (options: Options, record: ShareRecord) => `${options.previewOrigin}/s/${record.token}/r/${revisionOf(record)}/files/`;
const relativeFile = (value: string) => value.length > 0 && !/[\\\x00-\x1f\x7f]/.test(value) &&
  value.split('/').every((part) => part.length > 0 && !part.startsWith('.'));

/** Projection never returns disk paths, credentials, comments or editor history. */
function payload(options: Options, record: ShareRecord) {
  const result = { type: record.type, title: record.title, publishedAt: record.publishedAt,
    expiresAt: record.expiresAt, contentBase: fileBase(options, record) };
  if (record.type === 'document') {
    const file = options.store.file(record, 'doc.xml');
    if (!file) throw new Error('Missing document');
    return { ...result, state: parseDocument(fs.readFileSync(file, 'utf8')) };
  }
  if (record.type === 'artboard') {
    const file = options.store.file(record, 'canvas.json');
    if (!file) throw new Error('Missing canvas');
    const source = JSON.parse(fs.readFileSync(file, 'utf8')) as CanvasSpec;
    const boards = Object.fromEntries(Object.entries(source.boards).map(([id, board]) => {
      const resource = board.type === 'image' || board.type === 'video' ? board.src ?? board.file : board.file;
      if (!relativeFile(resource) || !resource.startsWith('pages/') || !options.store.file(record, resource)) throw new Error('Missing board');
      const encoded = resource.split('/').map(encodeURIComponent).join('/');
      return [id, { file: encoded, ...(board.type ? { type: board.type, src: encoded } : {}),
        page: board.page, x: board.x, y: board.y, w: board.w, h: board.h, title: board.title }];
    }));
    const canvas: CanvasSpec = { version: 1, title: record.title, pages: source.pages.map(({ id, name }) => ({ id, name })),
      activePage: source.activePage, boards, notes: source.notes,
      groups: Object.fromEntries(Object.entries(source.groups ?? {}).map(([id, group]) => [id, { title: group.title, boards: group.boards }])),
    };
    return { ...result, canvas, layout: computeLayout(canvas),
      versions: Object.fromEntries(Object.values(boards).map((board) => [board.file, record.publishedAt])), pending: [] };
  }
  return result;
}

export function createPublicShare(options: Options) {
  // Bounded in-memory abuse protection, separate from future persisted member quotas.
  const counters = new Map<string, { at: number; count: number }>();
  let global = { at: Date.now(), bytes: 0, count: 0 };
  const allowed = (token: string, bytes: number) => {
    const now = Date.now();
    if (now - global.at > 60_000) { global = { at: now, bytes: 0, count: 0 }; counters.clear(); }
    const counter = counters.get(token) ?? { at: now, count: 0 };
    if (global.count >= 3000 || counter.count >= 600 || bytes > 512 * 1024 * 1024 - global.bytes) return false;
    global.count++; global.bytes += bytes; counter.count++; counters.set(token, counter); return true;
  };
  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL, preview = false): Promise<boolean> => {
    if (!url.pathname.startsWith('/s/')) return false;
    for (const [name, value] of Object.entries(baseHeaders)) res.setHeader(name, value);
    const deny = () => send(res, 404, unavailable, { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
    const throttled = () => send(res, 429, '访问暂时受限，请稍后重试。', { 'Retry-After': '60', ...baseHeaders });
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'Read only', baseHeaders); return true; }
    const match = ROUTE.exec(url.pathname);
    if (!match || !allowed(match[1]!, 0)) { match ? throttled() : deny(); return true; }
    const record = options.store.find(match[1]!);
    if (!record || !options.registered(record.project)) { deny(); return true; }
    let rest: string;
    try { rest = decodeURIComponent(match[2] ?? ''); } catch { deny(); return true; }
    const prefix = `/s/${record.token}/`;
    const appBase = `${options.origin}${prefix}app/`;
    const contentBase = fileBase(options, record);
    const runtimeBase = `${options.previewOrigin}${prefix}r/${revisionOf(record)}/runtime/`;
    const publishedBase = `${options.previewOrigin}${prefix}r/`;
    const pageCsp = `default-src 'none'; script-src ${appBase} 'wasm-unsafe-eval'; style-src ${appBase} 'unsafe-inline'; img-src ${publishedBase} ${appBase} data: blob:; media-src ${publishedBase}; font-src ${publishedBase} ${appBase} data:; connect-src ${options.origin}${prefix}; frame-src ${publishedBase}; base-uri ${publishedBase}; form-action 'none'; frame-ancestors 'none'; object-src 'none'`;
    try {
      if (!preview && !rest) {
        let html = fs.readFileSync(path.join(options.viewerDir, 'share.html'), 'utf8');
        html = html.replace(/((?:src|href)=["'])\/(?!\/)/g, `$1${prefix}app/`);
        if (!allowed(record.token, req.method === 'HEAD' ? 0 : Buffer.byteLength(html))) { throttled(); return true; }
        send(res, 200, req.method === 'HEAD' ? '' : html, { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': allowInlineScripts(pageCsp, html) });
        return true;
      }
      if (!preview && rest === 'data') {
        const json = JSON.stringify(payload(options, record));
        if (!allowed(record.token, req.method === 'HEAD' ? 0 : Buffer.byteLength(json))) { throttled(); return true; }
        send(res, 200, req.method === 'HEAD' ? '' : json, { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8' }); return true;
      }
      let file: string | null = null;
      let csp = pageCsp;
      if (!preview && /^app\/[\w.-]+\.(?:js|css|woff2?|ttf|otf|svg|png|ico)$/.test(rest)) {
        const name = rest.slice(4);
        if (!name.startsWith('.')) file = path.join(options.viewerDir, name);
      } else if (preview && rest.startsWith(`r/${revisionOf(record)}/files/`)) {
        const relative = rest.slice(`r/${revisionOf(record)}/files/`.length);
        if (relativeFile(relative) && (record.type === 'html' || relative.startsWith(record.type === 'artboard' ? 'pages/' : 'assets/')))
          file = options.store.file(record, relative);
      } else if (preview && options.runtimeDir && rest.startsWith(`r/${revisionOf(record)}/runtime/`)) {
        const name = rest.slice(`r/${revisionOf(record)}/runtime/`.length);
        if (name === 'anjian-icons.js' || name === 'anjian-ui.js') file = path.join(options.runtimeDir, name);
      }
      if (!file || !fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) { deny(); return true; }
      const size = fs.statSync(file).size;
      if (!allowed(record.token, size)) { throttled(); return true; }
      if (preview) csp = `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${contentBase} ${runtimeBase}; style-src 'unsafe-inline' ${contentBase}; img-src ${contentBase} data: blob:; media-src ${contentBase} blob:; font-src ${contentBase} data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${options.origin}`;
      const headers = { ...baseHeaders, 'Content-Type': mimeOf(file), 'Content-Security-Policy': csp,
        ...(preview ? { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' } : {}) };
      if (req.method === 'HEAD') { send(res, 200, '', { ...headers, 'Content-Length': String(size) }); return true; }
      let data = fs.readFileSync(file);
      if (preview && path.extname(file).toLowerCase() === '.html') {
        let html = data.toString('utf8');
        const scripts = `<script defer src="${runtimeBase}anjian-icons.js"></script><script defer src="${runtimeBase}anjian-ui.js"></script>`;
        html = html.replace(/<head(?:\s[^>]*)?>/i, (tag) => `${tag}${scripts}`);
        data = Buffer.from(html);
      }
      const range = req.headers.range;
      if (range) {
        const part = /^bytes=(\d+)-(\d*)$/.exec(range);
        const start = part ? Number(part[1]) : NaN;
        const end = part?.[2] ? Math.min(Number(part[2]), data.length - 1) : data.length - 1;
        if (!Number.isSafeInteger(start) || start < 0 || start > end || start >= data.length) {
          send(res, 416, '', { ...headers, 'Content-Range': `bytes */${data.length}` }); return true;
        }
        send(res, 206, data.subarray(start, end + 1), { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${data.length}` });
      } else send(res, 200, data, { ...headers, 'Accept-Ranges': 'bytes' });
    } catch { deny(); }
    return true;
  };
}
