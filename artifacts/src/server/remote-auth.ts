import crypto from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

import { send, sendJson } from './http';

const PAIRING_MS = 10 * 60_000;
const TOKEN_MS = 90 * 24 * 60 * 60_000;
const MAX_BODY = 8 * 1024;
const MAX_PENDING = 64;
const MAX_DEVICES = 1_000;
const MAX_STORE_BYTES = 512 * 1024;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export interface RemoteProject {
  id: string;
  name: string;
}

export interface RemoteDevice {
  id: string;
  name: string;
  projects: string[];
  expiresAt: number;
}

interface StoredDevice extends RemoteDevice {
  tokenHash: string;
  createdAt: number;
}

interface Pairing {
  deviceCode: string;
  userCode: string;
  name: string;
  expiresAt: number;
  state: 'pending' | 'approved' | 'denied';
  projects: string[];
  lastPollAt: number;
}

export interface RemoteAuthOptions {
  home: string;
  origin: string;
  isAdmin: (req: http.IncomingMessage, url: URL) => boolean;
  projects: () => RemoteProject[];
  now?: () => number;
}

const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const secret = (bytes: number) => crypto.randomBytes(bytes).toString('base64url');
const equal = (a: string, b: string) =>
  a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const esc = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const code = () => {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
};

const html = (res: http.ServerResponse, status: number, title: string, body: string) =>
  send(
    res,
    status,
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · 案间</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;color:#222;background:#faf9f6}main{background:#fff;border:1px solid #e5e3dd;border-radius:16px;padding:1.5rem;overflow-wrap:anywhere}code{font-size:.875em}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #517d9e;outline-offset:3px}@media(max-width:480px){body{margin:1rem auto}main{padding:1rem}}@media(prefers-color-scheme:dark){body{background:#171918;color:#eee}main{background:#212422;border-color:#424842}a{color:#a7c9eb}}h1{line-height:1.3}form{margin:1rem 0}fieldset{border:1px solid #aaa;border-radius:.5rem;padding:1rem}label{display:block;margin:.5rem 0}input[type=text]{font:inherit;padding:.5rem;max-width:100%;box-sizing:border-box}button{font:inherit;padding:.55rem .8rem;margin:.25rem .5rem .25rem 0;cursor:pointer}a{color:#175fa4}</style><main><h1>${esc(title)}</h1>${body}<p><a href="/devices">设备管理</a> · <a href="/">返回工作台</a></p></main></html>`,
    {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  );

async function bodyOf(req: http.IncomingMessage): Promise<Record<string, unknown> | null | 'too-large'> {
  const text = await new Promise<string | 'too-large'>((resolve) => {
    const parts: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      req.off('data', data);
      req.off('end', end);
      req.off('error', error);
      req.off('aborted', error);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.pause();
        cleanup();
        resolve('too-large');
      } else parts.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(parts).toString('utf8')); };
    const error = () => { cleanup(); resolve(''); };
    req.on('data', data);
    req.on('end', end);
    req.on('error', error);
    req.on('aborted', error);
  });
  if (text === 'too-large') return 'too-large';
  try {
    if (req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
      const form = new URLSearchParams(text);
      const projects = form.getAll('project');
      return { code: form.get('code'), id: form.get('id'), projects };
    }
    if (!req.headers['content-type']?.startsWith('application/json')) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readStore(file: string): StoredDevice[] {
  const home = path.dirname(file);
  try {
    const stat = fs.lstatSync(home);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid device store directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STORE_BYTES)
    throw new Error('Invalid device store');
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !('devices' in parsed)) throw new Error('Invalid device store');
  const devices = (parsed as { devices: unknown }).devices;
  if (!Array.isArray(devices) || devices.length > MAX_DEVICES || !devices.every((device) => {
    const d = device as Partial<StoredDevice>;
    return d && typeof d.id === 'string' && typeof d.name === 'string' &&
      Array.isArray(d.projects) && d.projects.every((p) => typeof p === 'string') &&
      typeof d.tokenHash === 'string' && /^[a-f0-9]{64}$/.test(d.tokenHash) &&
      Number.isFinite(d.createdAt) && Number.isFinite(d.expiresAt);
  })) throw new Error('Invalid device store');
  return devices as StoredDevice[];
}

function writeStore(file: string, devices: StoredDevice[]) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())
    throw new Error('Invalid device store directory');
  fs.chmodSync(dir, 0o700);
  try {
    const prior = fs.lstatSync(file);
    if (!prior.isFile() || prior.isSymbolicLink()) throw new Error('Invalid device store');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (devices.length > MAX_DEVICES) throw new Error('Too many devices');
  const tmp = `${file}.${process.pid}.${secret(6)}.tmp`;
  try {
    const data = `${JSON.stringify({ version: 1, devices }, null, 2)}\n`;
    if (Buffer.byteLength(data) > MAX_STORE_BYTES) throw new Error('Device store too large');
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* renamed or already removed */ }
  }
}

export function createRemoteAuth(options: RemoteAuthOptions) {
  const now = options.now ?? Date.now;
  const origin = new URL(options.origin).origin;
  const file = path.join(options.home, 'remote-devices.json');
  const pending = new Map<string, Pairing>();
  const attempts = new Map<string, { since: number; count: number }>();
  let devices = readStore(file);

  const prune = () => {
    const time = now();
    for (const [id, pairing] of pending) if (pairing.expiresAt <= time) pending.delete(id);
    for (const [ip, entry] of attempts) if (entry.since + 60_000 <= time) attempts.delete(ip);
  };
  const persist = (next: StoredDevice[]) => {
    const active = next.filter((item) => item.expiresAt > now());
    writeStore(file, active);
    devices = active;
  };
  const authenticate = (req: http.IncomingMessage): RemoteDevice | null => {
    if (req.headers.origin !== undefined) return null;
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string') return null;
    const match = TOKEN_PATTERN.exec(authorization);
    if (!match) return null;
    const hash = digest(match[1]!);
    const device = devices.find((item) => item.expiresAt > now() && equal(item.tokenHash, hash));
    return device ? { id: device.id, name: device.name, projects: [...device.projects], expiresAt: device.expiresAt } : null;
  };
  const admin = (req: http.IncomingMessage, url: URL) => options.isAdmin(req, url);
  const sameOriginPost = (req: http.IncomingMessage) => req.headers.origin === origin &&
    (req.headers['sec-fetch-site'] === undefined || req.headers['sec-fetch-site'] === 'same-origin');

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> => {
    const route = url.pathname;
    if (!['/connect', '/devices'].includes(route) && !route.startsWith('/api/remote/auth/')) return false;
    prune();
    if (route === '/api/remote/auth/device' && req.method === 'POST') {
      const remote = req.socket.remoteAddress ?? '';
      const window = attempts.get(remote) ?? { since: now(), count: 0 };
      if (window.since + 60_000 <= now()) { window.since = now(); window.count = 0; }
      attempts.set(remote, window);
      if (++window.count > 12 || pending.size >= MAX_PENDING) {
        res.setHeader('Retry-After', '2');
        sendJson(res, 429, { error: 'too many pending device requests' });
        return true;
      }
      if (req.headers.origin !== undefined) { sendJson(res, 403, { error: 'CLI request required' }); return true; }
      const body = await bodyOf(req);
      if (body === 'too-large') { res.setHeader('Connection', 'close'); sendJson(res, 413, { error: 'body too large' }); return true; }
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 100) { sendJson(res, 400, { error: 'name must be 1-100 characters' }); return true; }
      let userCode = code();
      while ([...pending.values()].some((pairing) => pairing.userCode === userCode)) userCode = code();
      const deviceCode = secret(32);
      pending.set(deviceCode, { deviceCode, userCode, name, expiresAt: now() + PAIRING_MS, state: 'pending', projects: [], lastPollAt: 0 });
      sendJson(res, 200, { deviceCode, userCode, verificationUri: `${origin}/connect`, expiresIn: PAIRING_MS / 1000, interval: 2 });
      return true;
    }
    if (route === '/api/remote/auth/token' && req.method === 'POST') {
      if (req.headers.origin !== undefined) { sendJson(res, 403, { error: 'CLI request required' }); return true; }
      const body = await bodyOf(req);
      if (body === 'too-large') { res.setHeader('Connection', 'close'); sendJson(res, 413, { error: 'body too large' }); return true; }
      const deviceCode = typeof body?.deviceCode === 'string' ? body.deviceCode : '';
      const pairing = pending.get(deviceCode);
      if (!pairing) { sendJson(res, 410, { status: 'expired' }); return true; }
      if (pairing.state === 'denied') { pending.delete(deviceCode); sendJson(res, 403, { status: 'denied' }); return true; }
      if (pairing.state === 'pending') {
        if (pairing.lastPollAt && now() - pairing.lastPollAt < 1_000) {
          res.setHeader('Retry-After', '2');
          sendJson(res, 429, { status: 'slow_down', interval: 2 });
        } else {
          pairing.lastPollAt = now();
          sendJson(res, 202, { status: 'pending' });
        }
        return true;
      }
      const token = secret(32);
      const device: StoredDevice = {
        id: secret(16), name: pairing.name, projects: pairing.projects,
        createdAt: now(), expiresAt: now() + TOKEN_MS, tokenHash: digest(token),
      };
      try { persist([...devices, device]); } catch { sendJson(res, 503, { error: 'credential storage unavailable' }); return true; }
      pending.delete(deviceCode);
      sendJson(res, 200, { token, device: { id: device.id, name: device.name, projects: device.projects }, expiresAt: device.expiresAt });
      return true;
    }
    if (route === '/api/remote/auth/session') {
      const device = authenticate(req);
      if (!device) { sendJson(res, 401, { error: 'invalid device token' }); return true; }
      if (req.method === 'GET') { sendJson(res, 200, { device }); return true; }
      if (req.method === 'DELETE') {
        try { persist(devices.filter((item) => item.id !== device.id)); }
        catch { sendJson(res, 503, { error: 'credential storage unavailable' }); return true; }
        sendJson(res, 200, { revoked: true });
        return true;
      }
      sendJson(res, 405, { error: 'method not allowed' });
      return true;
    }
    if (route === '/connect' && req.method === 'GET') {
      if (!admin(req, url)) {
        html(res, 403, '连接设备', '<p>请先通过带访问密钥的完整作品库链接打开案间，再返回本页批准设备。</p>');
        return true;
      }
      const entered = url.searchParams.get('code')?.trim().toUpperCase() ?? '';
      const pairing = [...pending.values()].find((entry) => entry.userCode === entered && entry.state === 'pending');
      const choices = options.projects();
      const fieldset = pairing ? `<p>设备：<strong>${esc(pairing.name)}</strong></p><fieldset><legend>允许访问的项目</legend>${choices.map((project) => `<label><input type="checkbox" name="project" value="${esc(project.id)}"> ${esc(project.name)}</label>`).join('')}</fieldset><button formaction="/api/remote/auth/approve">批准此设备</button><button formaction="/api/remote/auth/deny">拒绝</button>` : entered ? '<p>配对码无效或已过期。</p>' : '';
      html(res, 200, '连接设备', `<p>在本地 CLI 中运行 <code>anjian login ${esc(origin)}</code>，输入显示的配对码。批准后，本地设备仅能访问所选项目。</p><form method="get" action="/connect"><label>配对码 <input type="text" name="code" value="${esc(entered)}" required autocomplete="off" spellcheck="false"></label><button type="submit">查看设备</button></form>${pairing ? `<form method="post" action="/api/remote/auth/approve"><input type="hidden" name="code" value="${esc(pairing.userCode)}">${fieldset}</form>` : fieldset}`);
      return true;
    }
    if (route === '/devices' && req.method === 'GET') {
      if (!admin(req, url)) { html(res, 403, '设备管理', '<p>请先通过带访问密钥的完整作品库链接打开案间。</p>'); return true; }
      html(res, 200, '设备管理', `<p>这里可以撤销本地 CLI 设备的访问权限。</p><ul>${devices.filter((item) => item.expiresAt > now()).map((item) => `<li><strong>${esc(item.name)}</strong> · ${new Date(item.expiresAt).toLocaleDateString('zh-CN')} 到期 · ${item.projects.length} 个项目<form action="/api/remote/auth/revoke" method="post"><input type="hidden" name="id" value="${esc(item.id)}"><button type="submit">撤销</button></form></li>`).join('') || '<li>尚无授权设备。</li>'}</ul><p><a href="/connect">连接新设备</a></p>`);
      return true;
    }
    if (['/api/remote/auth/approve', '/api/remote/auth/deny', '/api/remote/auth/revoke'].includes(route) && req.method === 'POST') {
      if (!admin(req, url) || !sameOriginPost(req)) { send(res, 403, 'Forbidden'); return true; }
      const body = await bodyOf(req);
      if (body === 'too-large') { res.setHeader('Connection', 'close'); send(res, 413, 'Body too large'); return true; }
      if (!body) { send(res, 400, 'Invalid body'); return true; }
      if (route === '/api/remote/auth/revoke') {
        const id = typeof body.id === 'string' ? body.id : '';
        if (!ID_PATTERN.test(id)) { send(res, 400, 'Invalid device'); return true; }
        try { persist(devices.filter((item) => item.id !== id)); }
        catch { send(res, 503, 'Credential storage unavailable'); return true; }
        html(res, 200, '设备已撤销', '<p>设备凭证现在无法再访问案间。</p>');
        return true;
      }
      const userCode = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      const pairing = [...pending.values()].find((entry) => equal(entry.userCode, userCode));
      if (!pairing || pairing.state !== 'pending') { html(res, 410, '配对码无效', '<p>请重新运行本地 CLI 生成配对码。</p>'); return true; }
      if (route === '/api/remote/auth/deny') pairing.state = 'denied';
      else {
        const selected = Array.isArray(body.projects) ? body.projects : [];
        const available = new Set(options.projects().map((project) => project.id));
        if (selected.length === 0 || selected.length > available.size || !selected.every((id) => typeof id === 'string' && available.has(id)) || new Set(selected).size !== selected.length) {
          html(res, 400, '项目无效', '<p>请返回配对页面，至少选择一个有效项目。</p>');
          return true;
        }
        pairing.projects = selected as string[];
        pairing.state = 'approved';
      }
      html(res, 200, route.endsWith('deny') ? '已拒绝连接' : '设备已授权', '<p>可以返回本地终端继续使用。</p>');
      return true;
    }
    sendJson(res, 405, { error: 'method not allowed' });
    return true;
  };

  return { handle, authenticate, close: () => { pending.clear(); attempts.clear(); } };
}
