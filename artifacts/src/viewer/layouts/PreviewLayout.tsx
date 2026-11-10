import { useCallback, useEffect, useState } from 'react';

import type { ArtifactType } from '../../shared/types';
import { useContentRefresh } from '../hooks/useContentRefresh';
import { type PreviewPayload, PreviewView } from './PreviewView';

function useJson<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useContentRefresh((data as { contentExpiresAt?: number } | null)?.contentExpiresAt, refresh);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal, credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error('Preview unavailable');
        return response.json() as Promise<T>;
      })
      .then((next) => { setData(next); setFailed(false); })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [url, revision]);
  return { data, failed };
}

export function PreviewLayout({ type, id }: { type: ArtifactType; id: string }) {
  const { data, failed } = useJson<PreviewPayload>(`/api/preview/${type}/${id}`);
  return <PreviewView data={data} failed={failed} id={id} type={type} />;
}
