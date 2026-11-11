import { DropdownMenu, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, LogOut } from 'lucide-react';
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
        return (await response.json()) as { role: 'owner' | 'member'; login: string };
      })
      .then((value) => {
        if (!controller.signal.aborted) setAccount(value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!account) return null;
  if (account.role === 'owner') return <ServerStatusPill onProjectsChanged={onProjectsChanged} />;
  return (
    <div {...stylex.props(styles.anchor)}>
      <DropdownMenu
        placement="bottomRight"
        items={[
          {
            key: 'sign-out',
            label: t('server.signOut'),
            icon: LogOut,
            danger: true,
            onClick: () => {
              void fetch('/logout', { method: 'POST' })
                .then((response) => {
                  if (!response.ok) throw new Error(String(response.status));
                  location.assign('/login?signedOut=1');
                })
                .catch((error: Error) =>
                  toast.error(t('common.requestFailed', { status: error.message })),
                );
            },
          },
        ]}
      >
        <button type="button" {...stylex.props(styles.pill)}>
          {account.login}
          <ChevronDown aria-hidden="true" size={12} />
        </button>
      </DropdownMenu>
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
