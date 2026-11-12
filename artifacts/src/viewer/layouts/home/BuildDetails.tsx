import * as stylex from '@stylexjs/stylex';

import { BUILD_INFO, selectNotes } from '../../../shared/build-info';
import type { HubStatus } from '../../../shared/hub';
import { useTranslation } from '../../i18n';
import { statusStyles as styles } from './status-styles';

export function BuildDetails({ status }: { status: HubStatus }) {
  const { t, i18n } = useTranslation();
  const notes = selectNotes(BUILD_INFO, i18n.language);
  const identity = (sha: string | null | undefined, state: string | undefined) =>
    `${sha ?? 'unknown'} · ${t(`release.state.${state ?? 'unknown'}`)}`;
  return (
    <section {...stylex.props(styles.build)} aria-label={t('release.build')}>
      <dl {...stylex.props(styles.rows)}>
        <dt {...stylex.props(styles.term)}>{t('release.viewer')}</dt>
        <dd {...stylex.props(styles.value)}>v{BUILD_INFO.version}</dd>
        <dt {...stylex.props(styles.term)}>{t('release.commit')}</dt>
        <dd {...stylex.props(styles.value)}>{identity(BUILD_INFO.sha, BUILD_INFO.state)}</dd>
        <dt {...stylex.props(styles.term)}>{t('release.server')}</dt>
        <dd {...stylex.props(styles.value)}>v{status.version}</dd>
        <dt {...stylex.props(styles.term)}>{t('release.commit')}</dt>
        <dd {...stylex.props(styles.value)}>{identity(status.build?.sha, status.build?.state)}</dd>
      </dl>
      <details {...stylex.props(styles.notes)}>
        <summary {...stylex.props(styles.notesToggle)}>{t('release.notes')}</summary>
        <p {...stylex.props(styles.notice)}>
          {t('release.forBuild', { version: BUILD_INFO.version })}
        </p>
        {notes.fallback && (
          <p role="status">
            {t('release.fallback', { language: notes.language === 'zh' ? '中文' : 'English' })}
          </p>
        )}
        <div lang={notes.language ?? undefined} {...stylex.props(styles.notesText)}>
          {notes.text || t('release.unavailable')}
        </div>
      </details>
    </section>
  );
}
