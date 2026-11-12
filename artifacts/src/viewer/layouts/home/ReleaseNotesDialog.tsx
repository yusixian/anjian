import {
  Button,
  ModalBackdrop,
  ModalDescription,
  ModalPopup,
  ModalPortal,
  ModalRoot,
  ModalTitle,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type RefObject, useRef } from 'react';

import { BUILD_INFO, selectNotes } from '../../../shared/build-info';
import { useTranslation } from '../../i18n';
import { statusStyles as styles } from './status-styles';

export function ReleaseNotesDialog({
  open,
  triggerRef,
  onClose,
  onExited,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onExited: () => void;
}) {
  const { t, i18n } = useTranslation();
  const notes = selectNotes(BUILD_INFO, i18n.language);
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <ModalRoot
      open={open}
      onExitComplete={onExited}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <ModalPortal>
        <ModalBackdrop />
        <ModalPopup
          finalFocus={triggerRef}
          initialFocus={closeRef}
          panelClassName={stylex.props(styles.readingPanel).className}
          width="min(680px, calc(100vw - 32px))"
        >
          <header {...stylex.props(styles.readingHeader)}>
            <ModalTitle {...stylex.props(styles.readingTitle)}>{t('release.notes')}</ModalTitle>
            <Button ref={closeRef} size="small" onClick={onClose}>
              {t('release.closeNotes')}
            </Button>
          </header>
          <div {...stylex.props(styles.readingBody)}>
            <ModalDescription {...stylex.props(styles.readingDescription)}>
              {t('release.forBuild', { version: BUILD_INFO.version })}
            </ModalDescription>
            {notes.fallback && (
              <p role="status" {...stylex.props(styles.readingFallback)}>
                {t('release.fallback', { language: notes.language === 'zh' ? '中文' : 'English' })}
              </p>
            )}
            <div lang={notes.language ?? undefined} {...stylex.props(styles.notesText)}>
              {notes.text || t('release.unavailable')}
            </div>
          </div>
        </ModalPopup>
      </ModalPortal>
    </ModalRoot>
  );
}
