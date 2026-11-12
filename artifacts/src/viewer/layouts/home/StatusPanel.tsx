import { Button, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { HubProjectStatus, HubStatus } from '../../../shared/hub';
import { useTranslation } from '../../i18n';
import { BuildDetails } from './BuildDetails';
import { ServerLog } from './ServerLog';
import { addressOf, formatUptime, hubAction } from './status-format';
import { statusStyles as styles } from './status-styles';

export function StatusPanel({
  status,
  onChanged,
  onReadingChange,
}: {
  status: HubStatus;
  onChanged: () => void;
  onReadingChange?: (reading: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [notice, setNotice] = useState<{ pid: number; text: string } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirmStop) cancelRef.current?.focus();
  }, [confirmStop]);
  useEffect(() => {
    if (showLog) logRef.current?.scrollIntoView({ block: 'nearest' });
  }, [showLog]);

  const run = (path: string, text: string, init?: RequestInit) =>
    hubAction(path, init)
      .then(() => {
        if (text) setNotice({ pid: status.pid, text });
        onChanged();
      })
      .catch((error: Error) => toast.error(t('common.requestFailed', { status: error.message })));

  const remove = (project: HubProjectStatus) =>
    void run('/api/hub/projects', '', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: project.dir }),
    });

  return (
    <>
      <div {...stylex.props(styles.panelBody)}>
        <dl {...stylex.props(styles.rows)}>
          <dt {...stylex.props(styles.term)}>{t('server.status')}</dt>
          <dd {...stylex.props(styles.value)}>
            {t('server.running', {
              time: formatUptime(Date.now() - status.startedAt, i18n.language),
            })}
          </dd>
          <dt {...stylex.props(styles.term)}>{t('server.address')}</dt>
          <dd {...stylex.props(styles.value)}>{addressOf(status.url)}</dd>
          <dt {...stylex.props(styles.term)}>{t('server.livePages')}</dt>
          <dd {...stylex.props(styles.value)}>{status.live.local}</dd>
        </dl>
        <BuildDetails status={status} onReadingChange={onReadingChange} />
        <h3 {...stylex.props(styles.section)}>
          {t('server.projects')} · {status.projects.length}
        </h3>
        {status.projects.map((project) => (
          <div key={project.dir} title={project.dir} {...stylex.props(styles.project)}>
            <span {...stylex.props(styles.projectName)}>{project.name}</span>
            <span {...stylex.props(styles.projectMeta)}>
              {project.dormant ? t('server.dormant') : t('server.active')} · {project.artifacts}
            </span>
            <Button
              aria-label={t('server.remove', { name: project.name })}
              icon={<X size={12} />}
              size="small"
              type="text"
              onClick={() => remove(project)}
            />
          </div>
        ))}
        {confirmStop && (
          <section aria-label={t('server.stopTitle')} {...stylex.props(styles.confirm)}>
            <strong>{t('server.stopTitle')}</strong>
            <p {...stylex.props(styles.confirmText)}>{t('server.stopDescription')}</p>
            <div {...stylex.props(styles.controls)}>
              <Button
                disabled={stopping}
                ref={cancelRef}
                size="small"
                onClick={() => {
                  setConfirmStop(false);
                  stopRef.current?.focus();
                }}
              >
                {t('server.cancel')}
              </Button>
              <Button
                danger
                loading={stopping}
                size="small"
                onClick={() => {
                  setStopping(true);
                  void run('/api/hub/stop', t('server.stopped')).finally(() => {
                    setStopping(false);
                    setConfirmStop(false);
                  });
                }}
              >
                {t('server.confirmStop')}
              </Button>
            </div>
          </section>
        )}
        {notice && notice.pid === status.pid && (
          <p role="status" {...stylex.props(styles.notice)}>
            {notice.text}
          </p>
        )}
        {showLog && (
          <div ref={logRef}>
            <ServerLog projects={status.projects} />
          </div>
        )}
        {status.authenticationRequired && (
          <Button
            block
            size="small"
            type="text"
            onClick={() => {
              void fetch('/logout', { method: 'POST' })
                .then((response) => {
                  if (!response.ok) throw new Error(String(response.status));
                  location.assign('/login?signedOut=1');
                })
                .catch((error: Error) =>
                  toast.error(t('common.requestFailed', { status: error.message })),
                );
            }}
          >
            {t('server.signOut')}
          </Button>
        )}
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button size="small" onClick={() => setShowLog((open) => !open)}>
          {showLog ? t('server.hideLog') : t('server.viewLog')}
        </Button>
        <div {...stylex.props(styles.controls)}>
          <Button size="small" onClick={() => void run('/api/hub/restart', t('server.restarting'))}>
            {t('server.restart')}
          </Button>
          <Button danger ref={stopRef} size="small" onClick={() => setConfirmStop(true)}>
            {t('server.stop')}
          </Button>
        </div>
      </div>
    </>
  );
}
