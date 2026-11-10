import crypto from 'node:crypto';
import type { ArtifactRef } from './artifacts';
import type { Principal } from './member-store';

interface Grant { principal: Principal; project: string; artifact: ArtifactRef; expiresAt: number }
const TTL = 30 * 60_000;
const RENEW = 5 * 60_000;

/** Opaque, artifact-scoped bearer paths work inside sandboxed frames without third-party cookies. */
export function createContentAccess(allowed: (principal: Principal, project: string) => boolean, now = Date.now) {
  const grants = new Map<string, Grant>();
  const current = new Map<string, string>();
  const keyOf = (grant: Omit<Grant, 'expiresAt'>) => JSON.stringify([
    grant.principal.id, grant.principal.sessionVersion, grant.project, grant.artifact.type, grant.artifact.id,
  ]);
  const prune = () => {
    for (const [token, grant] of grants) if (grant.expiresAt <= now()) {
      grants.delete(token);
      if (current.get(keyOf(grant)) === token) current.delete(keyOf(grant));
    }
  };
  return {
    issue(principal: Principal, project: string, artifact: ArtifactRef) {
      if (!allowed(principal, project)) throw new Error('Content access denied');
      prune();
      const key = keyOf({ principal, project, artifact });
      let token = current.get(key);
      let grant = token ? grants.get(token) : undefined;
      if (!grant || grant.expiresAt - now() <= RENEW) {
        if (grants.size >= 20_000) throw new Error('Too many content sessions');
        token = crypto.randomBytes(32).toString('base64url');
        grant = { principal: { ...principal }, project, artifact: { ...artifact }, expiresAt: now() + TTL };
        grants.set(token, grant);
        current.set(key, token);
      }
      return { contentBase: `/p/${token}/`, contentExpiresAt: grant.expiresAt };
    },
    resolve(token: string): Grant | null {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const grant = grants.get(token);
      if (!grant || grant.expiresAt <= now() || !allowed(grant.principal, grant.project)) return null;
      return { ...grant, principal: { ...grant.principal }, artifact: { ...grant.artifact } };
    },
  };
}
