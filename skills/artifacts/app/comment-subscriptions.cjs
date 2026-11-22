'use strict';

const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const ARTIFACT = /^(?:document|artboard|whiteboard|slides|storyboard|html)\/[a-z0-9][a-z0-9-]*$/;
const HOSTS = {
  codex: { env: 'CODEX_THREAD_ID', dir: 'codex-comment-watch' },
  claude: { env: 'CLAUDE_CODE_SESSION_ID', dir: 'claude-comment-watch' },
  pi: { dir: 'pi-comment-watch' },
  agy: { dir: 'agy-comment-watch' },
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function projectRoot(cwd) {
  const dir = fs.realpathSync(cwd);
  const chain = [];
  for (let current = dir; ; current = path.dirname(current)) {
    chain.push(current);
    if (fs.existsSync(path.join(current, '.git')) && (current !== os.homedir() || dir === current))
      return chain.find((item) => fs.existsSync(path.join(item, '.anjian/artifacts'))) || current;
    if (path.dirname(current) === current) return dir;
  }
}

function subscriptionFile(project, host, session) {
  return path.join(project, '.anjian/artifacts/.state', HOSTS[host].dir, `${session}.json`);
}

function aliveFile(project, host, session) {
  return path.join(project, '.anjian/artifacts/.state', HOSTS[host].dir, `${session}.alive`);
}

function beatFile(file, now = Date.now()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(now));
  } catch {
    // A missing heartbeat only makes the viewer say "tell the terminal"; never fail the watch.
  }
}

function forOpenedBeats(host, session, sources, update) {
  for (const [target, artifacts] of sources) {
    for (const artifact of artifacts) {
      if (!ARTIFACT.test(artifact)) continue;
      const dir = path.dirname(aliveFile(target, host, session));
      update(path.join(dir, 'opened', artifact, `${session}.alive`));
    }
  }
}

function beatOpenedSources(host, session, sources) {
  forOpenedBeats(host, session, sources, beatFile);
}

function clearOpenedSources(host, session, sources) {
  forOpenedBeats(host, session, sources, (file) => {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // A remaining heartbeat expires without further writes.
    }
  });
}

function beatSources(project, host, session, sources) {
  beatFile(aliveFile(project, host, session));
  beatOpenedSources(host, session, sources);
}

function sessionOf(host, env = process.env) {
  const session = env[HOSTS[host].env];
  return UUID.test(session || '') ? session : null;
}

function hostOf(env, explicit = true) {
  if (env.ANJIAN_FEEDBACK_SESSION) return null;
  const codex = sessionOf('codex', env);
  const claude = sessionOf('claude', env);
  if (!codex || !claude) return codex ? 'codex' : claude ? 'claude' : null;
  const choice = env.ANJIAN_COMMENT_HOST;
  if (choice === 'codex' || choice === 'claude') return choice;
  if (!explicit) return null;
  throw new Error('Set ANJIAN_COMMENT_HOST=codex or claude when both session IDs are present');
}

function clientCommentSession(env = process.env) {
  const selected = env.ANJIAN_FEEDBACK_SESSION;
  if (selected) {
    if (!/^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9][\w.:-]{0,94}$/.test(selected))
      throw new Error('Invalid ANJIAN_FEEDBACK_SESSION');
    return selected;
  }
  const host = hostOf(env);
  return host ? `${host}:${sessionOf(host, env)}` : null;
}

function subscriptions(project, host, session) {
  const file = readJson(subscriptionFile(project, host, session));
  return new Set(Array.isArray(file?.artifacts) ? file.artifacts : []);
}

function indexDir(host, session, env = process.env) {
  // A session can open projects served by different local Hubs.
  const home = path.resolve(os.homedir(), env.ANJIAN_RUNTIME_DIR || '.anjian');
  return path.join(home, 'comment-subscriptions', HOSTS[host].dir, session);
}

// Opened artifacts follow the session across watcher restarts. Only live watchers refresh heartbeats.
function registerOpened(project, artifact, env = process.env) {
  const host = hostOf(env);
  if (
    !host ||
    typeof project !== 'string' ||
    !path.isAbsolute(project) ||
    !ARTIFACT.test(artifact || '')
  )
    return;
  const dir = indexDir(host, sessionOf(host, env), env);
  const key = createHash('sha256')
    .update(JSON.stringify([project, artifact]))
    .digest('hex');
  const temp = path.join(dir, `.${randomUUID()}.tmp`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(temp, JSON.stringify({ project, artifact }), { mode: 0o600 });
    fs.renameSync(temp, path.join(dir, `${key}.json`));
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function subscriptionSources(project, host, session) {
  // Claude's Bash hook uses forward slashes for Windows drive paths.
  const local = path.normalize(project);
  const sources = new Map([[local, subscriptions(local, host, session)]]);
  const dir = indexDir(host, session);
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return sources;
  }
  for (const file of files) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const opened = readJson(path.join(dir, file));
    if (
      typeof opened?.project !== 'string' ||
      !path.isAbsolute(opened.project) ||
      !ARTIFACT.test(opened.artifact || '')
    )
      continue;
    let target;
    try {
      target = fs.realpathSync(opened.project);
    } catch {
      continue;
    }
    if (target !== opened.project) continue;
    if (!sources.has(target)) sources.set(target, new Set());
    sources.get(target).add(opened.artifact);
  }
  return sources;
}

// The launcher knows the real argv and cwd; hook text cannot safely reconstruct shell commands.
function register(args, env = process.env) {
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0
      ? args[index + 1]
      : args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  };
  const requested = option('--artifact');
  if (!requested && args[0] !== 'start') return;
  const host = hostOf(env, Boolean(requested));
  if (!host) return;
  const session = sessionOf(host, env);
  // Claude Code's SessionStart hook runs a bare start in every session; it must not subscribe them all.
  const artifact = requested || (host === 'codex' && args[0] === 'start' ? '*' : null);
  if (artifact !== '*' && !ARTIFACT.test(artifact || '')) return;
  const project = projectRoot(option('--project-dir') || process.cwd());
  const artifacts = subscriptions(project, host, session);
  artifacts.add(artifact);
  const file = subscriptionFile(project, host, session);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ artifacts: [...artifacts], updatedAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
}

module.exports = {
  aliveFile,
  beatOpenedSources,
  clearOpenedSources,
  beatSources,
  clientCommentSession,
  projectRoot,
  register,
  registerOpened,
  sessionOf,
  subscriptionFile,
  subscriptionSources,
  UUID,
};
