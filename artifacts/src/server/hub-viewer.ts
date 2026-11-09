import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

import { browserCookie } from './browser-auth';
import { parseCookies, safeEqual, send, sendFile } from './http';
import { resolveInside } from './paths';
import { viewerCsp } from './routes/viewer';
import { allowInlineScripts } from './viewer-page';

/** Workbench pages and assets must remain available before any project is registered. */
export async function serveHubViewer(req: http.IncomingMessage, res: http.ServerResponse, options: {
  viewerDir: string; pathname: string; shell: boolean; boardOrigin?: string;
  cookieName: string; token: string; key: string | null; secure: boolean; loopback: boolean;
}) {
  const csp = viewerCsp(options.boardOrigin ? [options.boardOrigin] : []);
  if (options.shell) {
    if (!options.loopback && options.key !== null && safeEqual(options.key, options.token) &&
        !safeEqual(parseCookies(req.headers.cookie)[options.cookieName] ?? '', options.token))
      res.setHeader('Set-Cookie', browserCookie(options.cookieName, options.token, options.secure));
    const html = await fs.promises.readFile(path.join(options.viewerDir, 'index.html'), 'utf8');
    send(res, 200, html, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': allowInlineScripts(csp, html),
      'X-Robots-Tag': 'noindex, nofollow',
    });
  } else {
    const file = resolveInside(options.viewerDir, options.pathname.slice(1));
    if (!file) send(res, 404, 'Not found');
    else sendFile(res, file, { 'Content-Security-Policy': csp });
  }
}
