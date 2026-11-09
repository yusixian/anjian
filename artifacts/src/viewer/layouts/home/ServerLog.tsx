import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useId, useState } from 'react';

import type { HubProjectStatus } from '../../../shared/hub';
import { useTranslation } from '../../i18n';
import { statusStyles as styles } from './status-styles';

export function ServerLog({ projects }: { projects: HubProjectStatus[] }) {
  const { t } = useTranslation();
  const [project, setProject] = useState('');
  const filterId = useId();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLines(null);
    setFailed(false);
    const query = project ? `?project=${encodeURIComponent(project)}` : '';
    void fetch(`/api/hub/log${query}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{ lines?: string[] }>;
      })
      .then((body) => { if (!controller.signal.aborted) setLines(body.lines ?? []); })
      .catch(() => !controller.signal.aborted && setFailed(true));
    return () => controller.abort();
  }, [project, attempt]);

  return (
    <>
      <div {...stylex.props(styles.logToolbar)}>
        <label htmlFor={filterId} {...stylex.props(styles.logLabel)}>{t('server.logProject')}</label>
        <select
          id={filterId}
          aria-label={t('server.logFilter')}
          value={project}
          {...stylex.props(styles.logFilter)}
          onChange={(event) => setProject(event.target.value)}
        >
          <option value="">{t('server.logAll')}</option>
          {projects.map((entry) => (
            <option key={entry.dir} value={entry.dir}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      {failed ? (
        <div role="alert" {...stylex.props(styles.logMessage)}>
          <p>{t('server.logFailed')}</p>
          <Button size="small" onClick={() => setAttempt((value) => value + 1)}>{t('server.logRetry')}</Button>
        </div>
      ) : lines?.length ? (
        <pre aria-label={t('server.viewLog')} tabIndex={0} {...stylex.props(styles.log)}>{lines.join('\n')}</pre>
      ) : (
        <div role="status" {...stylex.props(styles.logMessage)}>{t(lines === null ? 'server.logLoading' : 'server.logEmpty')}</div>
      )}
    </>
  );
}
