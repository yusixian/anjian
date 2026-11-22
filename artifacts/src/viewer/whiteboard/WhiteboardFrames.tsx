import { Link2 } from 'lucide-react';
import { useState } from 'react';

import type { WhiteboardScene } from '../../shared/whiteboard';
import { useTranslation } from '../i18n';
import { frameLink, whiteboardFrames } from './frames';

export function WhiteboardFrames({
  frame,
  onFrame,
  scene,
}: {
  frame: string | null;
  onFrame: (id: string | null) => void;
  scene: WhiteboardScene;
}) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<{ frame: string; copied: boolean } | null>(null);
  const frames = whiteboardFrames(scene);
  const exists = frame !== null && frames.some(({ id }) => id === frame);
  if (!frames.length && !frame) return null;
  const copy = async () => {
    if (!exists) return;
    try {
      await navigator.clipboard.writeText(frameLink(new URL(location.href), frame));
      setNotice({ frame, copied: true });
    } catch {
      setNotice({ frame, copied: false });
    }
  };
  return (
    <div className="anjian-whiteboard-frames">
      <label>
        {t('whiteboard.frame')}
        <select
          value={frame ?? ''}
          onChange={(event) => {
            setNotice(null);
            onFrame(event.currentTarget.value || null);
          }}
        >
          <option value="">{t('whiteboard.frameOverview')}</option>
          {frame && !exists && <option value={frame}>{t('whiteboard.frameUnavailable')}</option>}
          {frames.map(({ id, name }, index) => (
            <option key={id} value={id}>
              {typeof name === 'string' && name.trim()
                ? name
                : t('whiteboard.frameUntitled', { count: index + 1 })}
            </option>
          ))}
        </select>
      </label>
      {exists && (
        <button type="button" onClick={() => void copy()}>
          <Link2 aria-hidden="true" size={15} />
          {t('whiteboard.copyFrame')}
        </button>
      )}
      {frame && !exists && <span role="status">{t('whiteboard.frameMissing')}</span>}
      {notice && notice.frame === frame && (
        <span role="status">
          {notice.copied ? t('whiteboard.frameCopied') : t('whiteboard.frameCopyFailed')}
        </span>
      )}
      {notice && notice.frame === frame && !notice.copied && frame && (
        <input
          readOnly
          aria-label={t('whiteboard.frameLink')}
          value={frameLink(new URL(location.href), frame)}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}
