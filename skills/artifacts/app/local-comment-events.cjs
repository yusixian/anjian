'use strict';

const { nodeRuntime } = require('./anjian.cjs');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const isLoopback = (host) =>
  host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
const ARTIFACT = /^(?:artboard|document|slides|storyboard|whiteboard)\/[a-z0-9][a-z0-9-]*$/;
const CHANNEL = /^[a-f0-9-]{36}$/;
const hubProjectId = (dir) => createHash('sha256').update(dir).digest('hex').slice(0, 32);

function canonical(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function endpoint(home) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(home, 'server-info'), 'utf8'));
    const local = new URL(info.localUrl);
    if (
      info.publicOrigin ||
      !isLoopback(local.hostname) ||
      local.protocol !== 'http:' ||
      local.username ||
      local.password ||
      local.search ||
      local.hash
    )
      return null;
    const key = fs.readFileSync(path.join(home, 'key'), 'utf8').trim();
    if (!/^[a-f0-9]{48}$/.test(key)) return null;
    const credential = createHash('sha256')
      .update('anjian-comment-events:' + key)
      .digest('hex');
    return { info, credential, url: new URL('/api/local/comment-events', local) };
  } catch {
    return null;
  }
}

function running(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function createLocalCommentEvents(wake, env = process.env, entry) {
  const home = env.ANJIAN_SERVER_HOME || path.join(os.homedir(), '.anjian', 'server');
  const launcher = entry || path.join(__dirname, 'anjian.cjs');
  let projects = new Map();
  let changes = new Map();
  let reconcile = false;
  let connected = false;
  let closed = false;
  let request;
  let retry;
  let restarting;
  let failures = 0;
  let lastFullScan = 0;
  let updateScope;

  function restore() {
    // The CLI coordinates startup across watchers through its existing lock.
    if (closed || restarting || !fs.existsSync(entry || path.join(__dirname, 'cli.cjs'))) return;
    if (fs.existsSync(path.join(home, 'server-stopped'))) return;
    const hub = endpoint(home);
    if (!hub) return;
    const { info, url } = hub;
    if (running(info.pid)) return;
    const project = projects.values().next().value?.dir;
    if (!project) return;
    const host = url.hostname === '[::1]' ? '::1' : url.hostname;
    const child = spawn(
      nodeRuntime(),
      [
        launcher,
        'start',
        '--json',
        '--no-open',
        '--background',
        '--project-dir',
        project,
        '--host',
        host,
        '--port',
        url.port || '80',
        ...(typeof info.urlHost === 'string' ? ['--url-host', info.urlHost] : []),
      ],
      {
        env: { ...env, CODEX_THREAD_ID: '', CLAUDE_CODE_SESSION_ID: '' },
        stdio: 'ignore',
      },
    );
    restarting = child;
    const clear = () => {
      restarting = undefined;
    };
    child.once('error', clear);
    child.once('exit', clear);
    child.unref();
  }

  function reconnect() {
    if (closed || !projects.size || retry) return;
    retry = setTimeout(
      () => {
        retry = undefined;
        connect();
      },
      Math.min(15000, 750 * 2 ** Math.min(failures++, 5)),
    );
    retry.unref();
  }

  function connect() {
    if (closed || request || retry || !projects.size) return;
    const target = endpoint(home);
    if (!target) {
      reconnect();
      return;
    }
    const controlUrl = new URL(target.url);
    target.url.searchParams.set('scope', '1');
    const active = http.get(target.url, {
      agent: false,
      headers: { Authorization: 'Bearer ' + target.credential },
      timeout: 1500,
    });
    request = active;
    let upload;
    let applied;
    updateScope = () => {
      if (upload || !controlUrl.searchParams.has('channel')) return;
      const body = JSON.stringify(
        Array.from(projects, ([project, { artifacts }]) => ({
          project,
          artifacts: [...artifacts],
        })),
      );
      if (applied === body) return;
      upload = http.request(
        controlUrl,
        {
          method: 'PUT',
          agent: false,
          timeout: 1500,
          headers: {
            'Authorization': 'Bearer ' + target.credential,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.once('error', () => active.destroy());
          res.resume();
          res.once('end', () => {
            if (request !== active) return;
            upload = undefined;
            if (res.statusCode !== 204) {
              active.destroy();
              return;
            }
            applied = body;
            updateScope();
            // Reconcile edits saved between the local scope change and the Hub acknowledgment.
            if (!upload) {
              connected = true;
              failures = 0;
              reconcile = true;
              wake();
            }
          });
        },
      );
      upload.on('socket', (socket) => socket.unref());
      upload.once('error', () => active.destroy());
      upload.once('timeout', () => upload?.destroy());
      upload.end(body);
    };
    const disconnect = () => {
      if (request !== active) return;
      request = undefined;
      updateScope = undefined;
      upload?.destroy();
      connected = false;
      if (!closed) reconnect();
    };
    active.on('socket', (socket) => socket.unref());
    active.on('timeout', () => active.destroy());
    active.on('error', () => {
      restore();
      disconnect();
    });
    active.on('close', disconnect);
    active.on('response', (res) => {
      if (res.statusCode !== 200 || res.headers['content-type'] !== 'application/x-ndjson') {
        active.destroy();
        return;
      }
      active.setTimeout(0);
      res.setEncoding('utf8');
      let buffer = '';
      res.on('error', disconnect);
      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        if (buffer.length > 2048) {
          active.destroy();
          return;
        }
        let changed = false;
        for (const line of lines) {
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event?.ready === true) {
            if (typeof event.channel === 'string' && CHANNEL.test(event.channel)) {
              controlUrl.searchParams.set('channel', event.channel);
              updateScope();
              continue;
            }
            connected = true;
            failures = 0;
            reconcile = changed = true;
          } else if (
            connected &&
            typeof event?.artifact === 'string' &&
            ARTIFACT.test(event.artifact)
          ) {
            const source = projects.get(event.project);
            if (!source || (!source.artifacts.has('*') && !source.artifacts.has(event.artifact)))
              continue;
            const artifacts = changes.get(source.dir) ?? new Set();
            artifacts.add(event.artifact);
            changes.set(source.dir, artifacts);
            changed = true;
          }
        }
        if (changed) wake();
      });
    });
  }

  return {
    scope(sources) {
      for (const [id, source] of projects) {
        if (!sources.get(source.dir)?.size) projects.delete(id);
      }
      for (const [dir, artifacts] of sources) {
        if (!artifacts.size) continue;
        const known = [...projects.values()].find((source) => source.dir === dir);
        if (
          !known ||
          known.artifacts.size !== artifacts.size ||
          [...artifacts].some((a) => !known.artifacts.has(a))
        ) {
          projects.set(hubProjectId(canonical(dir)), { dir, artifacts: new Set(artifacts) });
          reconcile = true;
        }
      }
      connect();
      updateScope?.();
      const now = Date.now();
      const full = reconcile || !connected || now - lastFullScan >= 30_000;
      if (full) lastFullScan = now;
      const pending = changes;
      reconcile = false;
      changes = new Map();
      return full ? sources : pending;
    },
    close() {
      closed = true;
      clearTimeout(retry);
      request?.destroy();
    },
  };
}

module.exports = { createLocalCommentEvents };
