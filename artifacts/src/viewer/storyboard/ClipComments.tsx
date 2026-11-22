import { useEffect, useRef, useState } from 'react';

import type { ThreadOp } from '../../shared/comments';
import type { StoryboardSnapshot } from '../../shared/storyboard';
import { ThreadView } from '../comments/ThreadView';
import { Composer } from '../document/Composer';
import { useNativeThreadFocus } from '../feedback/NativeFeedback';
import { useStoryboardCopy } from './copy';

type CommentsState = Pick<StoryboardSnapshot, 'comments' | 'commentsWarning' | 'listening'>;

export function ClipComments({
  url,
  initial,
  clipId,
  saved,
}: {
  url: string;
  initial: CommentsState;
  clipId: string;
  saved: boolean;
}) {
  const c = useStoryboardCopy();
  const focusThread = useNativeThreadFocus();
  const [state, setState] = useState(initial);
  const [error, setError] = useState(false);
  const writingRef = useRef(false);
  const sequenceRef = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    async function refresh() {
      if (document.hidden || writingRef.current) return;
      const n = ++sequenceRef.current;
      try {
        const response = await fetch(url, { cache: 'no-store', signal: abort.signal });
        if (!response.ok) return;
        const data: CommentsState = await response.json();
        if (!abort.signal.aborted && n === sequenceRef.current) setState(data);
      } catch {
        /* Retry on focus or on the next refresh. */
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 8000);
    window.addEventListener('focus', refresh);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [url]);

  async function send(op: ThreadOp | { op: 'create'; clipId: string; text: string }) {
    if (writingRef.current) return false;
    writingRef.current = true;
    ++sequenceRef.current;
    setError(false);
    try {
      const response = await fetch(url + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op),
      });
      if (!response.ok) throw new Error(response.statusText);
      setState(await response.json());
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      writingRef.current = false;
    }
  }

  const threads = state.comments.threads.filter((thread) => thread.anchor.clipId === clipId);
  return (
    <section aria-label={c.comments} className="sb-comments">
      <p className="sb-dim">{state.listening ? c.agentOn : c.agentOff}</p>
      {state.commentsWarning && <p role="alert">{state.commentsWarning}</p>}
      {error && <p role="alert">{c.commentFailed}</p>}
      {!threads.length && <p>{c.noComments}</p>}
      {threads.map((thread) => (
        <div data-thread={thread.id} key={thread.id} ref={focusThread} tabIndex={-1}>
          <ThreadView
            label={thread.status === 'resolved' ? c.resolved : c.comments}
            thread={thread}
            actions={{
              edit: (threadId, messageId, text) =>
                void send({ op: 'edit', threadId, messageId, text }),
              remove: (threadId, messageId) => void send({ op: 'delete', threadId, messageId }),
              reply: (threadId, text) => send({ op: 'reply', threadId, text }),
              reopen: (threadId) => void send({ op: 'reopen', threadId }),
              resolve: (threadId) => void send({ op: 'resolve', threadId }),
            }}
          />
        </div>
      ))}
      {saved ? (
        <Composer
          key={clipId}
          placeholder={c.commentHint}
          onSubmit={(text) => send({ op: 'create', clipId, text })}
        />
      ) : (
        <p>{c.saveFirst}</p>
      )}
    </section>
  );
}
