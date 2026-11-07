'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');


function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function serverHome(env) {
  return env.ANJIAN_SERVER_HOME || path.join(os.homedir(), '.anjian', 'server');
}

function registerWithRunningServer(project) {
  const info = readJson(path.join(serverHome(process.env), 'server-info'));
  if (!info || typeof info.url !== 'string') return Promise.resolve();
  let base;
  try {
    base = new URL(info.localUrl || info.url);
  } catch {
    return Promise.resolve();
  }
  const key = base.searchParams.get('key') || '';
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: base.hostname === 'localhost' ? '127.0.0.1' : base.hostname,
        port: base.port,
        method: 'POST',
        path: `/api/hub/projects?key=${encodeURIComponent(key)}`,
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', resolve);
    req.on('timeout', () => req.destroy());
    req.end(JSON.stringify({ dir: project }));
  });
}

function main() {
  const project = process.argv[2];
  if (!project) return;
  return registerWithRunningServer(project);
}

void main();
