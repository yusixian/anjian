import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/package.json'), 'utf8'));
const base = fs.realpathSync(fs.mkdtempSync('/tmp/anjian-issue6-package-'));
execFileSync('tar', ['-xzf', `/tmp/anjian-issue6-evidence/anjian-${version}.tgz`, '-C', base]);
const guard = path.join(base, 'guard.cjs');
fs.writeFileSync(
  guard,
  `
const deny = name => (...args) => { process.stderr.write('FORBIDDEN: '+name+'\\n'); throw new Error(name); };
for (const mod of ['node:fs','node:fs/promises']) {
 const fs = require(mod);
 for (const name of ['writeFile','writeFileSync','appendFile','appendFileSync','mkdir','mkdirSync','unlink','unlinkSync','rename','renameSync','rm','rmSync','chmod','chmodSync']) if(fs[name]) fs[name]=deny(name);
}
const cp=require('node:child_process');
for(const name of ['exec','execSync','execFile','execFileSync','fork']) cp[name]=deny(name);
const spawn=cp.spawn; cp.spawn=(file,args,opts)=>args?.[0]?.endsWith('/cli.cjs') ? spawn(file,args,opts) : deny('spawn')();
const spawnSync=cp.spawnSync; cp.spawnSync=(file,args,opts)=>file==='ps' ? spawnSync(file,args,opts) : deny('spawnSync')();
require('node:net').Server.prototype.listen=deny('listen');
require('node:net').Socket.prototype.connect=deny('connect');
global.fetch=deny('fetch');
`,
);
const results = [];
for (const [name, entry] of [
  ['direct', path.join(root, 'artifacts/dist/cli.cjs')],
  ['source-launcher', path.join(root, 'skills/artifacts/app/anjian.cjs')],
  ['package', path.join(base, 'package/bin/anjian.cjs')],
]) {
  const project = path.join(base, 'project-' + name);
  fs.mkdirSync(project);
  const state = path.join(project, 'private-state');
  const env = {
    PATH: '',
    HOME: project,
    ANJIAN_CLIENT_HOME: path.join(state, 'client'),
    ANJIAN_SERVER_HOME: path.join(state, 'server'),
    ANJIAN_RUNTIME_DIR: path.join(state, 'runtime'),
    XDG_CONFIG_HOME: path.join(state, 'config'),
    CODEX_THREAD_ID: '00000000-0000-4000-8000-000000000006',
    NODE_OPTIONS: '--require=' + guard,
  };
  const run = (args, ok = true) => {
    const r = spawnSync(process.execPath, [entry, ...args], {
      cwd: project,
      env,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(r.status, ok ? 0 : 1, `${name} ${args}: ${r.stderr} ${r.stdout}`);
    assert.equal(r.stderr, '');
    return r.stdout;
  };
  assert.match(run(['--help']), /skills get artifacts/);
  assert.match(run(['start', '--help', '--artifact', 'document/demo']), /Usage/);
  const list = JSON.parse(run(['skills', 'list', '--json']));
  let bytes = 0;
  for (const reference of ['SKILL.md', ...list.skills[0].references]) {
    const args = [
      'skills',
      'get',
      'artifacts',
      ...(reference === 'SKILL.md' ? [] : ['--reference', reference]),
    ];
    const data = JSON.parse(run([...args, '--json']));
    const markdown = run(args);
    assert.equal(markdown, data.content + '\n');
    assert.ok(
      data.content.includes(
        fs
          .readFileSync(path.join(root, 'skills/artifacts', reference), 'utf8')
          .replaceAll('node app/anjian.cjs', data.command),
      ),
    );
    bytes += Buffer.byteLength(markdown);
  }
  for (const reference of [
    '../remote.md',
    '/etc/passwd',
    'app/anjian.cjs',
    'toString',
    'missing.md',
  ])
    run(['skills', 'get', 'artifacts', '--reference', reference, '--json'], false);
  run(['skills', 'get', 'unknown', '--json'], false);
  const status = JSON.parse(run(['remote', 'status', '--json']));
  assert.equal(status.linked, false);
  assert.deepEqual(status.servers, []);
  assert.match(status.nextStep, /skills get artifacts --reference remote.md/);
  assert.deepEqual(fs.readdirSync(project), []);
  results.push({
    entry: name,
    documents: list.skills[0].references.length + 1,
    bytes,
    sideEffects: 0,
  });
}
console.info(JSON.stringify({ base, results }, null, 2));
