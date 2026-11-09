import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef } from 'react';

import { useTranslation } from '../../i18n';
import { bulkStyles as styles } from './bulk-styles';

export interface DialogItem {
  key: string;
  title: string;
  type: string;
  project: string;
}

export function BulkDialog({
  items, kind, deployment, busy, done, onCancel, onConfirm,
}: {
  items: DialogItem[];
  kind: 'move' | 'purge';
  deployment: 'local' | 'self-hosted' | null;
  busy: boolean;
  done: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div {...stylex.props(styles.backdrop)}>
      <section
        aria-label={kind === 'purge' ? t('bulk.purgeTitle', { count: items.length }) : t('bulk.confirmTitle', { count: items.length })}
        aria-modal="true"
        role="dialog"
        ref={dialogRef}
        {...stylex.props(styles.dialog)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel(); }
          if (event.key !== 'Tab') return;
          const buttons = [...dialogRef.current!.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
          if (!buttons.length) { event.preventDefault(); return; }
          const first = buttons[0]!;
          const last = buttons.at(-1)!;
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
      >
        <h2 {...stylex.props(styles.dialogTitle)}>
          {kind === 'purge' ? t('bulk.purgeTitle', { count: items.length }) : t('bulk.confirmTitle', { count: items.length })}
        </h2>
        <p {...stylex.props(styles.dialogCopy)}>
          {kind === 'purge' ? t('bulk.purgeDescription') :
            deployment === 'local' ? t('bulk.localDescription') :
              deployment === 'self-hosted' ? t('bulk.remoteDescription') :
                t('bulk.genericDescription')}
        </p>
        <ul aria-label={t('bulk.confirmList')} {...stylex.props(styles.confirmList)}>
          {items.map((item) => (
            <li key={item.key} {...stylex.props(styles.confirmItem)}>
              <strong>{item.title}</strong>
              <span {...stylex.props(styles.trashMeta)}>{item.type} · {item.project}</span>
            </li>
          ))}
        </ul>
        {busy && <p aria-live="polite" {...stylex.props(styles.progress)}>{t('bulk.progress', { done, count: items.length })}</p>}
        <div {...stylex.props(styles.dialogActions)}>
          <Button className={stylex.props(styles.touchAction).className} ref={cancelRef} disabled={busy} onClick={onCancel}>{t('bulk.cancel')}</Button>
          <Button className={stylex.props(styles.touchAction).className} danger loading={busy} disabled={busy} onClick={onConfirm}>
            {kind === 'purge' ? t('bulk.purgeConfirm', { count: items.length }) : t('bulk.moveConfirm', { count: items.length })}
          </Button>
        </div>
      </section>
    </div>
  );
}
