import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import {
  PREVIEW_SELECTION_TTL,
  type SelectionDelivery,
  type SelectionRecipient,
} from '../../shared/selection-send';
import type { CapturedPreviewSelection } from '../hooks/usePreviewSelection';
import { useTranslation } from '../i18n';

const styles = stylex.create({
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    color: cssVar.colorText,
    fontSize: 12,
  },
  button: {
    'font': 'inherit',
    'whiteSpace': 'nowrap',
    'color': cssVar.colorText,
    'backgroundColor': cssVar.colorFillTertiary,
    'border': 0,
    'borderRadius': 6,
    'minHeight': 36,
    'paddingInline': 10,
    'cursor': 'pointer',
    ':disabled': { color: cssVar.colorTextSecondary, cursor: 'default' },
  },
  select: { maxWidth: 108, minHeight: 32, font: 'inherit', color: cssVar.colorText },
  excerpt: {
    maxWidth: { 'default': 200, '@media (max-width: 640px)': 76 },
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  status: { color: cssVar.colorTextSecondary },
});

const hostName = { codex: 'Codex', claude: 'Claude Code' };

export function PreviewSelectionSend({
  endpoint,
  capture,
}: {
  endpoint: string;
  capture: CapturedPreviewSelection;
}) {
  const { t } = useTranslation();
  const [recipients, setRecipients] = useState<SelectionRecipient[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [status, setStatus] = useState<SelectionDelivery | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(
    () => capture.selection.capturedAt + PREVIEW_SELECTION_TTL <= Date.now(),
  );
  const target = recipients?.find(({ id }) => id === chosen);

  useEffect(() => {
    const wait = Math.max(0, capture.selection.capturedAt + PREVIEW_SELECTION_TTL - Date.now());
    const timer = window.setTimeout(() => setStale(true), wait);
    return () => window.clearTimeout(timer);
  }, [capture.selection.capturedAt]);

  useEffect(() => {
    if (status === 'delivered' || status === 'expired') return;
    const controller = new AbortController();
    const url = status === 'queued' ? `${endpoint}?request=${capture.id}` : endpoint;
    const refresh = async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: 'same-origin',
        });
        if (response.status === 404 && status === 'queued') setStatus('expired');
        if (!response.ok) return;
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (status === 'queued') setStatus(data.status);
        else {
          const next = data.recipients as SelectionRecipient[];
          setRecipients(next);
          if (next.length === 1) setChosen((current) => current || next[0]!.id);
        }
      } catch {
        // Keep an accepted send queued while the browser reconnects to the Hub.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, status === 'queued' ? 500 : 2_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [capture.id, endpoint, status]);

  async function send() {
    if (!target || stale || busy || status) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          id: capture.id,
          recipient: target.id,
          selection: capture.selection,
        }),
      });
      const data = await response.json();
      if (response.ok) setStatus(data.status);
      else if (data.code === 'selection_expired') setStale(true);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!recipients && !status) return null;
  const state =
    status ?? (stale ? 'stale' : error ? 'failed' : !recipients?.length ? 'noRecipient' : null);
  return (
    <div {...stylex.props(styles.actions)}>
      {!status && !stale && recipients && recipients.length > 0 && (
        <>
          <span {...stylex.props(styles.excerpt)} title={capture.selection.text}>
            {capture.selection.text}
          </span>
          {recipients.length > 1 || !target ? (
            <select
              aria-label={t('preview.selectionRecipient')}
              {...stylex.props(styles.select)}
              value={target?.id ?? ''}
              onChange={(event) => setChosen(event.target.value)}
            >
              <option value="">{t('preview.selectionRecipient')}</option>
              {recipients.map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {hostName[recipient.host]} · {recipient.label}
                </option>
              ))}
            </select>
          ) : (
            <span {...stylex.props(styles.status)}>
              {hostName[target.host]} · {target.label}
            </span>
          )}
          <button
            type="button"
            {...stylex.props(styles.button)}
            disabled={!target || busy}
            onClick={() => void send()}
          >
            {t('preview.selectionSend')}
          </button>
        </>
      )}
      {state && (
        <span role="status" {...stylex.props(styles.status)}>
          {t('preview.selectionDelivery.' + state)}
        </span>
      )}
    </div>
  );
}
