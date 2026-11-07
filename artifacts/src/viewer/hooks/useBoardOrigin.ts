import { useEffect, useState } from 'react';

import { type BoardOrigin, boardOrigin, boardProbeUrl } from '../lib/board-origin';

interface Options {
  boardOrigin?: string;
  boardPath?: string;
  boardPort?: number;
  contentBase: string;
}

export function useBoardOrigin({ contentBase, boardOrigin: configuredOrigin, boardPort, boardPath }: Options): BoardOrigin | null {
  const probeUrl = configuredOrigin
    ? new URL('/robots.txt', configuredOrigin).toString()
    : boardPort ? boardProbeUrl(location, boardPort) : null;
  const probing = !/^https?:\/\//.test(contentBase) && !!boardPath && !!probeUrl;
  const [reachable, setReachable] = useState<{ url: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!probing || !probeUrl) return;
    let cancelled = false;
    fetch(probeUrl, { mode: 'no-cors', cache: 'no-store' }).then(
      () => !cancelled && setReachable({ url: probeUrl, ok: true }),
      () => !cancelled && setReachable({ url: probeUrl, ok: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [probing, probeUrl]);

  if (probing && reachable?.url !== probeUrl) return null;
  return boardOrigin({
    location,
    contentBase,
    boardOrigin: configuredOrigin,
    boardPort,
    boardPath,
    reachable: reachable?.ok ?? false,
  });
}
