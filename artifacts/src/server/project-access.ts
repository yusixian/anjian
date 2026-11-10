import type http from 'node:http';
import path from 'node:path';

import type { createGitHubAuth } from './github-auth';
import type { createMemberStore, Principal } from './member-store';

interface Options {
  members: ReturnType<typeof createMemberStore>;
  github?: Pick<ReturnType<typeof createGitHubAuth>, 'principal'>;
  isOwner: (req: http.IncomingMessage, url: URL) => boolean;
  registered: (project: string) => boolean;
}

/** Resolve from trusted session/key checks, never from user-supplied identity headers. */
export function createProjectAccess({ members, github, isOwner, registered }: Options) {
  const principal = (req: http.IncomingMessage, url: URL): Principal | null =>
    isOwner(req, url)
      ? { id: 'owner', role: 'owner', sessionVersion: 0 }
      : github?.principal(req.headers.cookie) ?? null;
  const canAccess = (identity: Principal | null, project: string) => {
    if (!identity || !registered(project)) return false;
    if (identity.role === 'owner') return true;
    // Re-read membership for long-lived sockets and in-flight async operations.
    const current = identity.githubId === undefined ? null : members.principal(identity.githubId, identity.sessionVersion);
    return current?.id === identity.id && members.projectOwner(project) === identity.id;
  };
  return {
    principal,
    canAccess,
    authorized(req: http.IncomingMessage, project: string) {
      return canAccess(principal(req, new URL(req.url ?? '/', 'http://artifacts.local')), path.resolve(project));
    },
    visibleProjects(req: http.IncomingMessage, projects: string[]) {
      const identity = principal(req, new URL(req.url ?? '/', 'http://artifacts.local'));
      return projects.filter((project) => canAccess(identity, path.resolve(project)));
    },
  };
}
