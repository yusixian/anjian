import { useCallback, useEffect, useState } from 'react';

import {
  artifactSelectionKey,
  type TrashEntry,
  type TrashReference,
  type TrashResult,
  type TrashTarget,
  trashSelectionKey,
} from '../../../shared/trash';
import { chunks } from './bulk-trash';

interface TrashListing {
  entries: TrashEntry[];
  deployment?: 'local' | 'self-hosted';
  warnings?: string[];
}

async function trashRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

function lookupResult(results: TrashResult[], key: string) {
  return results.find((result) => result.key === key);
}

export interface MoveOutcome {
  succeeded: TrashEntry[];
  failed: TrashTarget[];
  unconfirmed: TrashTarget[];
  errors: string[];
}

export function useTrash() {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [deployment, setDeployment] = useState<'local' | 'self-hosted' | null>(null);

  const refresh = useCallback(async () => {
    try {
      const listing = await trashRequest<TrashListing>('/api/hub/trash');
      if (!Array.isArray(listing.entries)) throw new Error('Invalid trash response');
      if (listing.warnings?.length) throw new Error(listing.warnings.join('; '));
      setEntries(listing.entries);
      if (listing.deployment) setDeployment(listing.deployment);
      setError(false);
      return listing.entries;
    } catch (cause) {
      setError(true);
      throw cause;
    }
  }, []);

  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);

  const move = useCallback(async (items: TrashTarget[], onProgress?: (done: number) => void): Promise<MoveOutcome> => {
    const succeeded: TrashEntry[] = [];
    const failed: TrashTarget[] = [];
    const unconfirmed: TrashTarget[] = [];
    const errors: string[] = [];
    let done = 0;
    for (const batch of chunks(items)) {
      let results: TrashResult[] | null = null;
      try {
        const body = await trashRequest<{ results: TrashResult[] }>('/api/hub/trash', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: batch }),
        });
        if (!Array.isArray(body.results)) throw new Error('Invalid trash response');
        results = body.results;
      } catch (cause) {
        errors.push((cause as Error).message);
      }
      const unresolved: TrashTarget[] = [];
      for (const item of batch) {
        const result = results && lookupResult(results, artifactSelectionKey(item));
        if (result?.ok && result.entry) succeeded.push(result.entry);
        else if (result && !result.ok) {
          failed.push(item);
          errors.push(result.error ?? result.code ?? 'Move failed');
        } else unresolved.push(item);
      }
      if (unresolved.length) {
        // The request may have succeeded before the connection was lost. Read the server's
        // durable trash state before offering a retry, so a second click cannot create copies.
        try {
          const current = await refresh();
          for (const item of unresolved) {
            const found = current.find((entry) =>
              entry.project === item.project && entry.type === item.type &&
              entry.id === item.id && entry.url === item.url,
            );
            if (found) succeeded.push(found);
            else failed.push(item);
          }
        } catch {
          unconfirmed.push(...unresolved);
          errors.push('Move status could not be confirmed');
        }
      }
      done += batch.length;
      onProgress?.(done);
    }
    await refresh().catch(() => undefined);
    return { succeeded, failed, unconfirmed, errors };
  }, [refresh]);

  const mutateTrash = useCallback(async (action: 'restore' | 'purge', items: TrashReference[]) => {
    const results: TrashResult[] = [];
    for (const batch of chunks(items)) {
      const response = await trashRequest<{ results: TrashResult[] }>(`/api/hub/trash/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: batch }),
      });
      if (!Array.isArray(response.results)) throw new Error('Invalid trash response');
      for (const item of batch) {
        const result = lookupResult(response.results, trashSelectionKey(item));
        if (!result) throw new Error('Missing trash result');
        results.push(result);
      }
    }
    await refresh();
    return results;
  }, [refresh]);

  return {
    entries, error, deployment, refresh, move,
    restore: (items: TrashReference[]) => mutateTrash('restore', items),
    purge: (items: TrashReference[]) => mutateTrash('purge', items),
  };
}
