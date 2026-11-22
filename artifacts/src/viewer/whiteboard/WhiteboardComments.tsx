import { Crosshair, MessageSquarePlus } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';

import type { Thread } from '../../shared/comments';
import type { WhiteboardAnchor, WhiteboardComments as Comments } from '../../shared/whiteboard';
import { ThreadMessages } from '../comments/ThreadView';
import { useNativeThreadFocus } from '../feedback/NativeFeedback';
import { useTranslation } from '../i18n';
import type { WhiteboardCommentAction } from './useWhiteboard';

function CommentInput({
  label,
  busy,
  submit,
}: {
  label: string;
  busy: boolean;
  submit: (text: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (value && (await submit(value))) setText('');
  };
  return (
    <form className="anjian-whiteboard-compose" onSubmit={(event) => void send(event)}>
      <label htmlFor={id}>{label}</label>
      <textarea
        disabled={busy}
        id={id}
        maxLength={20000}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button disabled={busy || !text.trim()} type="submit">
        {t('common.send')}
      </button>
    </form>
  );
}

function WhiteboardThread({
  busy,
  locate,
  post,
  thread,
  missing,
}: {
  busy: boolean;
  locate: (ids: string[]) => boolean;
  post: (action: WhiteboardCommentAction) => Promise<boolean>;
  thread: Thread<WhiteboardAnchor>;
  missing: boolean;
}) {
  const { t } = useTranslation();
  const focusThread = useNativeThreadFocus();
  const [anchorMissing, setAnchorMissing] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const resolved = thread.status === 'resolved';
  const ids = thread.anchor.elementIds;
  return (
    <article
      className="anjian-whiteboard-thread"
      data-thread={thread.id}
      ref={focusThread}
      tabIndex={-1}
    >
      <div className="anjian-whiteboard-thread-bar">
        <button type="button" onClick={() => setAnchorMissing(!locate(ids))}>
          <Crosshair aria-hidden="true" size={15} />
          {t('whiteboard.locate', { count: ids.length })}
        </button>
        {resolved && <span>{t('common.resolved')}</span>}
      </div>
      {(missing || anchorMissing) && <p role="status">{t('whiteboard.anchorMissing')}</p>}
      <ThreadMessages thread={thread} />
      <div className="anjian-whiteboard-thread-bar">
        {!resolved && (
          <button
            aria-expanded={replyOpen}
            disabled={busy}
            type="button"
            onClick={() => setReplyOpen(!replyOpen)}
          >
            {t('whiteboard.reply')}
          </button>
        )}
        <button
          disabled={busy}
          type="button"
          onClick={() =>
            void post({
              op: 'status',
              status: resolved ? 'open' : 'resolved',
              threadId: thread.id,
            })
          }
        >
          {t(resolved ? 'common.reopen' : 'common.resolve')}
        </button>
      </div>
      {!resolved && replyOpen && (
        <CommentInput
          busy={busy}
          label={t('common.reply')}
          submit={async (text) => {
            const ok = await post({ op: 'reply', text, threadId: thread.id });
            if (ok) setReplyOpen(false);
            return ok;
          }}
        />
      )}
    </article>
  );
}

export function WhiteboardComments({
  busy,
  comments,
  locate,
  post,
  selected,
  missingThread,
}: {
  busy: boolean;
  comments: Comments;
  locate: (ids: string[]) => boolean;
  post: (action: WhiteboardCommentAction) => Promise<boolean>;
  selected: string[];
  missingThread: string | null;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<string[] | null>(null);
  return (
    <aside
      aria-label={t('chrome.comments')}
      className="anjian-whiteboard-comments"
      id="whiteboard-comments"
    >
      <h2>{t('chrome.comments')}</h2>
      {anchor ? (
        <section className="anjian-whiteboard-new-comment">
          <div className="anjian-whiteboard-thread-bar">
            <span>{t('whiteboard.selected', { count: anchor.length })}</span>
            <button disabled={busy} type="button" onClick={() => setAnchor(null)}>
              {t('common.cancel')}
            </button>
          </div>
          <CommentInput
            busy={busy}
            label={t('comments.addPlaceholder')}
            submit={async (text) => {
              const ok = await post({ op: 'create', elementIds: anchor, text });
              if (ok) setAnchor(null);
              return ok;
            }}
          />
        </section>
      ) : (
        <button
          disabled={busy || !selected.length || selected.length > 100}
          type="button"
          onClick={() => setAnchor(selected)}
        >
          <MessageSquarePlus aria-hidden="true" size={16} />
          {selected.length
            ? t('whiteboard.selected', { count: selected.length })
            : t('whiteboard.selectToComment')}
        </button>
      )}
      {comments.threads.length ? (
        comments.threads.map((thread) => (
          <WhiteboardThread
            busy={busy}
            key={thread.id}
            locate={locate}
            missing={missingThread === thread.id}
            post={post}
            thread={thread}
          />
        ))
      ) : (
        <p>{t('whiteboard.noComments')}</p>
      )}
    </aside>
  );
}
