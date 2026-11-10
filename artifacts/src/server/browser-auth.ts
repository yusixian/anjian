import type http from 'node:http';
import { GitHubAuthError, type createGitHubAuth } from './github-auth';

import { ANJIAN_MARK_BODY, ANJIAN_MARK_VIEWBOX } from '../shared/brand';
import { type AccessPolicy, hostAllowed, originAllowed } from './access';
import { parseCookies, safeEqual, send } from './http';

const REMEMBER_SECONDS = 30 * 24 * 60 * 60;
const PAGE = /^\/(?:index\.html|devices|connect|(?:(?:preview|embed)\/)?(?:artboard|document|html)\/[\w-]+\/?)?$/;
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);

export function loginReturnTo(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20\x7f]/.test(value)) return '/';
  const url = new URL(value, 'http://anjian.local');
  if (url.origin !== 'http://anjian.local' || !PAGE.test(url.pathname)) return '/';
  url.searchParams.delete('key');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function browserCookie(name: string, token: string, secure: boolean, remember = false) {
  return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}${remember ? `; Max-Age=${REMEMBER_SECONDS}` : ''}`;
}

function loginPage(returnTo: string, error: string, remember: boolean, signedOut: boolean, github = false, invitation = '') {
  const pairing = returnTo.startsWith('/connect');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · 案间</title><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#0a0a0a;color:#ededed;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{height:48px;display:flex;align-items:center;gap:8px;padding:0 20px;border-bottom:1px solid #242424;background:#111;font-size:14px;font-weight:600}header svg{width:20px;height:20px}main{width:min(100% - 40px,420px);margin:clamp(48px,12vh,120px) auto 40px}h1{margin:0 0 12px;font-size:24px;font-weight:600;letter-spacing:-.5px}p{margin:0 0 24px;color:#a1a1a1;font-size:14px;line-height:1.7}label{display:block;font-size:14px}input[type=password]{display:block;width:100%;height:42px;margin-top:8px;border:1px solid #424242;border-radius:6px;background:#171717;color:#ededed;padding:0 12px;font:inherit}input:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid #aaa;outline-offset:3px}.remember{display:flex;align-items:center;gap:8px;margin:18px 0;color:#bbb;font-size:13px}input[type=checkbox]{width:16px;height:16px;margin:0;accent-color:#ddd}button{width:100%;height:40px;border:0;border-radius:6px;background:#ededed;color:#141414;font:600 14px system-ui;cursor:pointer}button:hover{background:#fff}.error{margin:12px 0;padding:10px 12px;border:1px solid #753b3b;border-radius:6px;color:#ffb4b4;background:#271717;font-size:13px;line-height:1.6}.notice{margin:12px 0 16px;color:#bbb;font-size:13px}details{margin-top:24px;padding-top:20px;border-top:1px solid #242424;color:#999;font-size:13px;line-height:1.7}summary{cursor:pointer;color:#bbb}details p{margin:12px 0 0;font-size:13px}footer{margin-top:24px;font-size:12px;color:#777;line-height:1.7}@media(max-width:480px){header{padding:0 16px}main{width:calc(100% - 32px);margin-top:48px}h1{font-size:22px}}
</style></head><body><header><svg viewBox="${ANJIAN_MARK_VIEWBOX}" aria-hidden="true">${ANJIAN_MARK_BODY}</svg>案间</header><main><h1>登录案间</h1><p>${pairing ? '先登录工作台，再确认设备可以访问哪些项目。登录后会继续本次设备授权。' : github ? '使用 GitHub 账号登录，继续查看作品和批注。' : '输入此服务器的访问密钥，继续查看作品和批注。'}</p>${signedOut ? '<div class="notice" role="status">已退出此浏览器的登录。</div>' : ''}${github ? `<form method="post" action="/auth/github">${invitation ? `<input type="hidden" name="invitation" value="${escape(invitation)}">` : ''}<input type="hidden" name="returnTo" value="${escape(returnTo)}"><label class="remember"><input type="checkbox" name="remember" value="yes"${remember ? ' checked' : ''}>记住此设备 30 天</label><button type="submit">使用 GitHub 登录</button></form><p class="notice">${invitation ? '请使用管理员邀请的 GitHub 账号登录，接受邀请后进入个人空间。' : '仅实例所有者和已获邀请的成员可以登录。'}</p>${error ? `<div class="error" role="alert">${escape(error)}</div>` : ''}<details><summary>使用管理员访问密钥</summary>` : ''}<form method="post" action="/login"><input type="hidden" name="returnTo" value="${escape(returnTo)}"><label for="access-key">访问密钥</label><input id="access-key" name="key" type="password" autocomplete="current-password" required maxlength="512" ${error ? 'aria-invalid="true" aria-describedby="login-error"' : ''}>${error ? `<div class="error" id="login-error" role="alert">${escape(error)}</div>` : ''}<label class="remember"><input type="checkbox" name="remember" value="yes"${remember ? ' checked' : ''}>记住此设备 30 天</label><button type="submit">${pairing ? '登录并继续授权' : '登录并继续'}</button></form><details><summary>在哪里找到访问密钥？</summary><p>使用部署时保存的访问密钥，或向服务器管理员索取。已有带密钥的完整访问链接，也可以直接打开它登录。</p><p>只有初始化或找回密钥需要管理员操作；日常访问无需打开终端。</p></details>${github ? '</details>' : ''}<footer>${github ? '' : '访问密钥拥有此服务器的管理权限，请勿公开分享。<br>'}公共或共用设备请勿勾选“记住此设备”。</footer></main></body></html>`;
}

interface BrowserAuthOptions {
  github?: ReturnType<typeof createGitHubAuth>;
  cookieName: string;
  token: string;
  origin: string;
  loopback: boolean;
  policy: AccessPolicy;
  authorized: (req: http.IncomingMessage, url: URL) => boolean;
}

export function createBrowserAuth(options: BrowserAuthOptions) {
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com/login/oauth/authorize; base-uri 'none'; frame-ancestors 'none'",
  };
  // Chrome sends Origin: null for native POST forms under no-referrer.
  // Keep same-origin referrers on the form page so strict origin checks work.
  const pageHeaders = { ...headers, 'Referrer-Policy': 'same-origin', 'Content-Type': 'text/html; charset=utf-8' };
  const redirect = (res: http.ServerResponse, location: string) => send(res, 303, '', { ...headers, Location: location });
  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> => {
    const { pathname } = url;
    const endpoint = ['/login', '/logout', '/api/browser-session', '/auth/github', '/auth/github/callback'].includes(pathname);
    const navigation = req.method === 'GET' && PAGE.test(pathname);
    if (!endpoint && !navigation) return false;
    if (!hostAllowed(options.policy, req.headers.host) || !originAllowed(options.policy, req.headers.origin)) {
      send(res, 403, 'Forbidden', headers);
      return true;
    }
    const secure = options.origin.startsWith('https:') && req.headers.host?.toLowerCase() === new URL(options.origin).host.toLowerCase();
    const returnTo = loginReturnTo(url.searchParams.get('returnTo'));
    const github = options.github;
    if (pathname.startsWith('/auth/github') && (!github || req.headers.host?.toLowerCase() !== new URL(options.origin).host.toLowerCase())) {
      send(res, 404, 'Not found', headers);
      return true;
    }
    if (pathname === '/auth/github/callback' && req.method === 'GET') {
      try {
        const session = await github!.callback(req, url);
        res.setHeader('Set-Cookie', session.cookies);
        redirect(res, loginReturnTo(session.returnTo));
      } catch (error) {
        res.setHeader('Set-Cookie', github!.clearStateCookie());
        const message = error instanceof GitHubAuthError ? error.message : 'GitHub 登录暂不可用，请稍后重试。';
        send(res, 401, loginPage(loginReturnTo(error instanceof GitHubAuthError ? error.returnTo ?? null : null), message, false, false, true, error instanceof GitHubAuthError ? error.invitation : undefined), pageHeaders);
      }
      return true;
    }
    if (pathname === '/api/browser-session' && req.method === 'GET') {
      send(res, 200, JSON.stringify({ authenticated: options.authorized(req, url), required: !options.loopback }), { ...headers, 'Content-Type': 'application/json' });
      return true;
    }
    if (pathname === '/login' && req.method === 'GET') {
      const invitation = url.searchParams.get('invite') ?? '';
      if (invitation && (!github || !/^[A-Za-z0-9_-]{43}$/.test(invitation))) {
        send(res, 400, '邀请链接无效。', headers); return true;
      }
      if (!invitation && options.authorized(req, url)) {
        if (!options.loopback && safeEqual(url.searchParams.get('key') ?? '', options.token) && !safeEqual(parseCookies(req.headers.cookie)[options.cookieName] ?? '', options.token))
          res.setHeader('Set-Cookie', browserCookie(options.cookieName, options.token, secure));
        redirect(res, returnTo);
      }
      else send(res, 200, loginPage(returnTo, '', false, url.searchParams.get('signedOut') === '1', Boolean(github), invitation), pageHeaders);
      return true;
    }
    if ((pathname === '/login' || pathname === '/logout' || pathname === '/auth/github') && req.method === 'POST') {
      // Login also changes browser authority: reject cross-origin forms before reading their body.
      const expectedOrigin = secure ? options.origin : `http://${req.headers.host}`;
      if (req.headers.origin !== expectedOrigin || req.headers['sec-fetch-site'] === 'cross-site' || req.headers['sec-fetch-site'] === 'same-site') {
        send(res, 403, 'Forbidden origin', headers);
        return true;
      }
      if (pathname === '/logout') {
        res.setHeader('Set-Cookie', [`${browserCookie(options.cookieName, '', secure)}; Max-Age=0`, ...(github?.clearCookie() ?? [])]);
        redirect(res, '/login?signedOut=1');
        return true;
      }
      if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') {
        send(res, 415, 'Unsupported media type', headers);
        return true;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) {
          send(res, 413, 'Request too large', headers);
          return true;
        }
        chunks.push(Buffer.from(chunk));
      }
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const destination = loginReturnTo(form.get('returnTo'));
      const remember = form.get('remember') === 'yes';
      if (pathname === '/auth/github') {
        const invitation = form.get('invitation') || undefined;
        if (invitation && !/^[A-Za-z0-9_-]{43}$/.test(invitation)) {
          send(res, 400, '邀请链接无效。', headers); return true;
        }
        const flow = github!.start(destination, remember, invitation);
        res.setHeader('Set-Cookie', flow.cookie);
        redirect(res, flow.location);
        return true;
      }
      const key = form.get('key')?.trim() ?? '';
      if (!key || key.length > 512 || !safeEqual(key, options.token)) {
        send(res, 401, loginPage(destination, '访问密钥不正确，请检查后重试。', remember, false, Boolean(github)), pageHeaders);
        return true;
      }
      res.setHeader('Set-Cookie', browserCookie(options.cookieName, options.token, secure, remember));
      redirect(res, destination);
      return true;
    }
    if (endpoint) {
      send(res, 405, 'Method not allowed', headers);
      return true;
    }
    if (!options.loopback && !options.authorized(req, url)) {
      redirect(res, `/login?returnTo=${encodeURIComponent(loginReturnTo(url.pathname + url.search))}`);
      return true;
    }
    return false;
  };
}
