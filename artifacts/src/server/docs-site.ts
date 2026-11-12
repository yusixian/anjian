import fs from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';

import { MIME, send } from './http';
import { resolveInside } from './paths';

// Only the documentation export is public; workbench/API routes keep their auth gates.
export async function serveDocsSite(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  directory: string,
) {
  const route = url.pathname;
  if (route === '/' && url.searchParams.has('key')) return false;
  if (!(
    route === '/' ||
    /^\/(?:zh|en)(?:\/?$|\/(?:docs|use-cases)(?:\/|$)|\/index\.txt$|\/__next\.[\w.!$-]+\.txt$)/.test(
      route,
    ) ||
    route === '/docs' ||
    route.startsWith('/docs/') ||
    route === '/use-cases' ||
    route.startsWith('/use-cases/') ||
    route.startsWith('/_next/') ||
    route === '/api/search' ||
    route === '/anjian.svg' ||
    route === '/anjian-dark.svg' ||
    route === '/index.txt' ||
    /^\/__next\.[\w.!$-]+\.txt$/.test(route)
  ))
    return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return true;
  }
  let relative: string;
  try {
    relative = decodeURIComponent(route).replace(/^\//, '');
  } catch {
    send(res, 400, 'Bad request');
    return true;
  }
  const root = await fs.realpath(directory);
  const target = resolveInside(root, relative || 'index.html');
  let file: string | undefined;
  if (target) {
    const candidate = (await fs.stat(target).catch(() => null))?.isDirectory()
      ? path.join(target, 'index.html')
      : target;
    const real = await fs.realpath(candidate).catch(() => null);
    if (real?.startsWith(root + path.sep) && (await fs.stat(real)).isFile()) file = real;
  }
  const status = file ? 200 : 404;
  const body = file ? await fs.readFile(file) : Buffer.from('Not found');
  const type = file
    ? route === '/api/search'
      ? MIME['.json']!
      : (MIME[path.extname(file)] ?? 'application/octet-stream')
    : 'text/plain; charset=utf-8';
  send(res, status, req.method === 'HEAD' ? '' : body, {
    'Content-Type': type,
    'Content-Length': String(body.length),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': route.startsWith('/_next/static/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  return true;
}
