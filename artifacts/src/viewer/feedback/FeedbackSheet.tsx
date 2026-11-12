import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import type { BoardThread } from '../../shared/board-comments';
import { BottomSheet } from '../components/BottomSheet';
import { Composer } from '../document/Composer';
import { useTranslation } from '../i18n';
import { FeedbackPanel } from './FeedbackPanel';

const styles = stylex.create({
  dock: {
    position: 'fixed',
    top: 52,
    left: 0,
    right: 0,
    height: 'calc(100dvh - 52px)',
    zIndex: 30,
    pointerEvents: 'none',
  },
  head: {
    padding: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  body: { padding: 16, fontSize: 13, lineHeight: 1.6 },
  button: {
    padding: 8,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: cssVar.colorFillQuaternary,
    color: cssVar.colorText,
    font: 'inherit',
    cursor: 'pointer',
  },
  message: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
});

export function FeedbackSheet({
  artifact,
  threads,
  onReply,
  onClose,
}: {
  artifact: string;
  threads: BoardThread[];
  onReply: (threadId: string, text: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [snap, setSnap] = useState(0.66);
  const [threadId, setThreadId] = useState<string | null>(null);
  const thread = threads.find((item) => item.id === threadId);
  return (
    <div data-chrome {...stylex.props(styles.dock)}>
      <BottomSheet
        snap={snap}
        snaps={[0.66, 1]}
        header={
          <div {...stylex.props(styles.head)}>
            <strong>{t('feedback.title')}</strong>
            <button type="button" {...stylex.props(styles.button)} onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        }
        onScrim={onClose}
        onSnap={setSnap}
      >
        <FeedbackPanel
          artifact={artifact}
          key={artifact}
          onOpenThread={(id) => {
            setThreadId(id);
            setSnap(1);
          }}
        />
        {thread && (
          <div data-thread={thread.id} {...stylex.props(styles.body)}>
            <strong>{t('feedback.originalThread')}</strong>
            {thread.messages
              .filter((message) => !message.deleted)
              .map((message) => (
                <p key={message.id} {...stylex.props(styles.message)}>
                  {message.text}
                </p>
              ))}
            <Composer
              key={thread.id}
              placeholder={t('feedback.reply')}
              onSubmit={async (text) => {
                try {
                  await onReply(thread.id, text);
                  return true;
                } catch {
                  return false;
                }
              }}
            />
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
