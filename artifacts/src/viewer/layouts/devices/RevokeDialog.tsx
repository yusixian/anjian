import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef } from 'react';

import { useTranslation } from '../../i18n';
import { deviceStyles as styles } from './device-styles';

export function RevokeDialog({
  name, projects, busy, error, onCancel, onConfirm,
}: {
  name: string;
  projects: string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t, i18n } = useTranslation();
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
        aria-label={t('devices.revokeTitle')}
        aria-modal="true"
        ref={dialogRef}
        role="dialog"
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
        <h2 {...stylex.props(styles.dialogTitle)}>{t('devices.revokeTitle')}</h2>
        <p {...stylex.props(styles.dialogCopy)}>{t('devices.revokeImpact', { name, projects: projects.join(i18n.language === 'zh' ? '、' : ', ') })}</p>
        <p {...stylex.props(styles.dialogCopy)}>{t('devices.revokeReconnect')}</p>
        {error && <p role="alert" {...stylex.props(styles.error)}>{error}</p>}
        <div {...stylex.props(styles.dialogActions)}>
          <Button className={stylex.props(styles.button).className} disabled={busy} ref={cancelRef} onClick={onCancel}>{t('devices.cancel')}</Button>
          <Button className={stylex.props(styles.button).className} danger disabled={busy} loading={busy} onClick={onConfirm}>{t('devices.revokeConfirm')}</Button>
        </div>
      </section>
    </div>
  );
}
