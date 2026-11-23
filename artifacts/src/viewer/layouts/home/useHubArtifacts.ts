import { useCallback, useEffect, useRef, useState } from 'react';

import type { HubArtifactList } from '../../../shared/hub';

const FALLBACK_REFRESH_MS = 15000;
const INITIAL_WAIT_MS = 1500;

export function useHubArtifacts() {
  const [list, setList] = useState<HubArtifactList | null>(null);
  const [error, setError] = useState(false);
  const [live, setLive] = useState(false);
  const request = useRef<AbortController | null>(null);
  const hasDormantProjects = useRef(false);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch('/api/hub/artifacts', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as HubArtifactList;
      if (controller.signal.aborted) return;
      hasDormantProjects.current = next.projects.some((project) => project.dormant);
      setList(next);
      setError(false);
    } catch {
      if (!controller.signal.aborted) setError(true);
    }
  }, []);

  useEffect(() => {
    let connected = false;
    const events =
      typeof EventSource === 'undefined' ? null : new EventSource('/api/hub/library-events');
    const initial = setTimeout(() => void refresh(), events ? INITIAL_WAIT_MS : 0);
    if (events) {
      events.onopen = () => {
        clearTimeout(initial);
        connected = true;
        setLive(true);
        void refresh();
      };
      events.onmessage = () => void refresh();
      events.onerror = () => {
        connected = false;
        setLive(false);
      };
    }
    const timer = setInterval(() => {
      if (!connected || hasDormantProjects.current) void refresh();
    }, FALLBACK_REFRESH_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      events?.close();
      request.current?.abort();
    };
  }, [refresh]);

  const removeProject = useCallback(
    async (dir: string) => {
      const response = await fetch('/api/hub/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir }),
      });
      if (!response.ok) throw new Error(String(response.status));
      await refresh();
    },
    [refresh],
  );

  return { list, error, live, refresh, removeProject };
}
