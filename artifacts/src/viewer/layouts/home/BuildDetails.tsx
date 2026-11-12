import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';

import { BUILD_INFO } from '../../../shared/build-info';
import type { HubStatus } from '../../../shared/hub';
import { useTranslation } from '../../i18n';
import { ReleaseNotesDialog } from './ReleaseNotesDialog';
import { statusStyles as styles } from './status-styles';

export function BuildDetails({
  status,
  onReadingChange,
}: {
  status: HubStatus;
  onReadingChange?: (reading: boolean) => void;
}) {
  const { t } = useTranslation();
  const [reading, setReading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <section {...stylex.props(styles.build)} aria-label={t('release.build')}>
      {[
        { label: t('release.viewer'), version: BUILD_INFO.version, build: BUILD_INFO },
        { label: t('release.server'), version: status.version, build: status.build },
      ].map(({ label, version, build }) => (
        <div key={label} {...stylex.props(styles.buildGroup)}>
          <div {...stylex.props(styles.buildHeading)}>
            <span {...stylex.props(styles.term)}>{label}</span>
            <span>v{version}</span>
          </div>
          <div {...stylex.props(styles.buildIdentity)}>
            {build?.sha && build.sha !== 'unknown' && (
              <details {...stylex.props(styles.commit)}>
                <summary
                  aria-label={t('release.fullCommit')}
                  {...stylex.props(styles.commitToggle)}
                >
                  {build.sha.slice(0, 8)}
                </summary>
                <code {...stylex.props(styles.fullCommit)}>{build.sha}</code>
              </details>
            )}
            <span>{t(`release.state.${build?.state ?? 'unknown'}`)}</span>
          </div>
        </div>
      ))}
      <Button
        block
        ref={triggerRef}
        size="small"
        onClick={() => {
          setReading(true);
          onReadingChange?.(true);
        }}
      >
        {t('release.notes')}
      </Button>
      <ReleaseNotesDialog
        open={reading}
        triggerRef={triggerRef}
        onClose={() => setReading(false)}
        onExited={() => onReadingChange?.(false)}
      />
    </section>
  );
}
