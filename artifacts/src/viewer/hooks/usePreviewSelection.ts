import { useEffect, useRef, useState } from 'react';

import {
  PREVIEW_SELECTION_SELECTOR,
  PREVIEW_SELECTION_TEXT,
  type PreviewSelection,
} from '../../shared/selection-send';
import type { FrameMessage } from './useSandboxFrame';

export interface CapturedPreviewSelection {
  id: string;
  selection: PreviewSelection;
}

export function usePreviewSelection() {
  const frame = useRef<{ channel: string; revision: number; url: string } | null>(null);
  const [capture, setCapture] = useState<CapturedPreviewSelection | null>(null);
  useEffect(() => {
    const clear = () => {
      if (document.hidden) setCapture(null);
    };
    document.addEventListener('visibilitychange', clear);
    return () => document.removeEventListener('visibilitychange', clear);
  }, []);

  return {
    capture,
    open(target: Window | null | undefined, loaded: string) {
      setCapture(null);
      const url = new URL(loaded, location.href);
      const revision = Number(url.searchParams.get('v'));
      if (!target || !Number.isFinite(revision)) {
        frame.current = null;
        return;
      }
      const channel = crypto.randomUUID();
      url.hash = '';
      frame.current = { channel, revision, url: url.href };
      target.postMessage({ type: 'anjian:watch-selection', channel }, '*');
    },
    receive(data: FrameMessage) {
      const source = frame.current;
      if (
        document.hidden ||
        data.type !== 'anjian:selection-text' ||
        !source ||
        data.channel !== source.channel
      )
        return;
      if (typeof data.url !== 'string' || data.url.split('#')[0] !== source.url) return;
      if (typeof data.text !== 'string' || typeof data.selector !== 'string') return;
      const text = data.text.trim().slice(0, PREVIEW_SELECTION_TEXT);
      const selector = data.selector.slice(0, PREVIEW_SELECTION_SELECTOR);
      const revision = source.revision;
      setCapture((previous) => {
        if (!text) return null;
        if (previous?.selection.text === text && previous.selection.selector === selector)
          return previous;
        return {
          id: crypto.randomUUID(),
          selection: { text, selector, revision, capturedAt: Date.now() },
        };
      });
    },
  };
}
