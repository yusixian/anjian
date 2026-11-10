import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';

import { useHubStatus } from '../../hooks/useHubStatus';
import { useTranslation } from '../../i18n';
import { statusStyles as styles } from './status-styles';
import { StatusPanel } from './StatusPanel';

export function StatusPill({ onProjectsChanged }: { onProjectsChanged?: () => void }) {
  const { t } = useTranslation();
  const [account, setAccount] = useState<{ role: 'owner' | 'member'; login: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/account', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        // Standalone local servers have no member accounts.
        if (response.status === 404) return { role: 'owner' as const, login: 'Owner' };
        if (!response.ok) return null;
        return await response.json() as { role: 'owner' | 'member'; login: string };
      })
      .then((value) => { if (!controller.signal.aborted) setAccount(value); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!account) return null;
  if (account.role === 'owner') return <ServerStatusPill onProjectsChanged={onProjectsChanged} />;
  return (
    <div {...stylex.props(styles.anchor)}>
      <form onSubmit={(event) => {
        event.preventDefault();
        void fetch('/logout', { method: 'POST' }).then((response) => {
          if (response.ok) location.assign('/login?signedOut=1');
        });
      }}>
        <button type="submit" {...stylex.props(styles.pill)}>
          {account.login}<span {...stylex.props(styles.separator)}>·</span>{t('server.signOut')}
        </button>
      </form>
    </div>
  );
}

function ServerStatusPill({ onProjectsChanged }: { onProjectsChanged?: () => void }) {
  const { t } = useTranslation();
  const { status, offline, refresh } = useHubStatus();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const down = offline || !status;
  return (
    <div ref={anchor} {...stylex.props(styles.anchor)}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        type="button"
        {...stylex.props(styles.pill)}
        onClick={() => setOpen((value) => !value)}
      >
        <i {...stylex.props(styles.dot, !down && styles.dotLive, offline && styles.dotDown)} />
        {down ? (
          t('server.offline')
        ) : (
          <>
            v{status.version}
            <span {...stylex.props(styles.separator)}>·</span>
            {t(status.deployment === 'self-hosted' ? 'server.selfHosted' : 'server.runningLabel')}
          </>
        )}
      </button>
      {open && (
        <div aria-label={t('server.panelLabel')} role="dialog" {...stylex.props(styles.panel)}>
          {status ? (
            <StatusPanel
              status={status}
              onChanged={() => {
                void refresh();
                onProjectsChanged?.();
              }}
            />
          ) : (
            t('server.offline')
          )}
        </div>
      )}
    </div>
  );
}
