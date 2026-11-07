import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const script = path.resolve(__dirname, '../../hooks/start-artifacts.cjs');
const launcher = path.resolve(__dirname, '../../skills/artifacts/app/anjian.cjs');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-session-'));
  dirs.push(dir);
  const project = path.join(dir, 'project');
  fs.mkdirSync(path.join(project, '.anjian/artifacts/document/plan'), {recursive:true});
  fs.writeFileSync(path.join(project, '.anjian/artifacts/document/plan/doc.xml'), '<doc><p>one</p></doc>');
  const env = {...process.env, ANJIAN_SERVER_HOME:path.join(dir, 'server'), ARTIFACTS_OPEN:'0'};
  const run = () => spawnSync(process.execPath,[script,project],{env,encoding:'utf8',timeout:10000});
  return {dir,project,env,run};
}
test('session hook does not start a server when none is running', () => {
  const {env,run} = fixture();
  expect(run().status).toBe(0);
  expect(fs.existsSync(env.ANJIAN_SERVER_HOME)).toBe(false);
});
test('session hook registers a project with an already running local server without cloud credentials', () => {
  const {dir,project,env,run} = fixture();
  const initial = path.join(dir,'initial'); fs.mkdirSync(initial);
  try {
    const started=spawnSync(process.execPath,[launcher,'start','--background','--project-dir',initial,'--no-open'],{env,encoding:'utf8',timeout:15000});
    expect(started.status, started.stderr).toBe(0);
    expect(run().status).toBe(0);
    const registry=JSON.parse(fs.readFileSync(path.join(env.ANJIAN_SERVER_HOME,'projects.json'),'utf8'));
    expect(registry.projects.map((p:{dir:string})=>p.dir)).toContain(fs.realpathSync(project));
  } finally {
    spawnSync(process.execPath,[launcher,'stop','--project-dir',initial],{env,timeout:10000});
  }
},30000);
