import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { createMemberStore, type Principal } from '../src/server/member-store';
import { createProjectAccess } from '../src/server/project-access';

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-project-access-'));
  homes.push(home);
  const members = createMemberStore(home, 1);
  const identities = new Map<string, Principal>();
  for (const id of [2, 3]) {
    const identity = { id, login: `user-${id}` };
    identities.set(`session-${id}`, members.accept(identity, members.invite(identity, 1024).token));
  }
  const projects = [path.join(home, 'legacy'), path.join(home, 'alice'), path.join(home, 'bob')];
  members.assignProject(projects[1]!, 'github:2');
  members.assignProject(projects[2]!, 'github:3');
  const access = createProjectAccess({ members, registered: (project) => projects.includes(project),
    isOwner: (_req, url) => url.searchParams.get('key') === 'owner-secret',
    github: { principal: (cookie) => identities.get(cookie ?? '') ?? null },
  });
  const request = (cookie?: string, url = '/') => ({ url, headers: { cookie } }) as http.IncomingMessage;
  return { members, projects, access, request, identities };
}

test('project access filters members while preserving Owner access to registered projects', () => {
  const { projects, access, request } = fixture();
  expect(access.visibleProjects(request('session-2'), projects)).toEqual([projects[1]]);
  expect(access.visibleProjects(request('session-3'), projects)).toEqual([projects[2]]);
  expect(access.visibleProjects(request(), projects)).toEqual([]);
  expect(access.visibleProjects(request(undefined, '/?key=owner-secret'), projects)).toEqual(projects);
  expect(access.authorized(request(undefined, '/?key=owner-secret'), '/not-registered')).toBe(false);
});

test('identity-looking headers and project query parameters never grant project authority', () => {
  const { projects, access, request } = fixture();
  const forged = request('session-2', '/?project=bob&role=owner');
  forged.headers['x-anjian-member'] = 'github:3';
  forged.headers['x-anjian-role'] = 'owner';
  forged.headers.referer = `https://anjian.example/?project=${projects[2]}`;
  expect(access.authorized(forged, projects[2]!)).toBe(false);
  expect(access.authorized(forged, projects[0]!)).toBe(false);
  expect(access.authorized(forged, projects[1]!)).toBe(true);
});

test('a cached request identity loses access after suspension and cannot revive with an old epoch', () => {
  const { members, projects, access, request, identities } = fixture();
  const identity = access.principal(request('session-2'), new URL('https://anjian.example'));
  expect(access.canAccess(identity, projects[1]!)).toBe(true);
  members.update('github:2', { status: 'suspended' });
  expect(access.canAccess(identity, projects[1]!)).toBe(false);
  members.update('github:2', { status: 'active' });
  expect(access.canAccess(identity, projects[1]!)).toBe(false);
  identities.set('session-new', members.principal(2)!);
  expect(access.authorized(request('session-new'), projects[1]!)).toBe(true);
});
