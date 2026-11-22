import { useCallback, useEffect, useRef, useState } from 'react';

import type { ThreadOp } from '../../shared/comments';
import type { SlideDeckSnapshot } from '../../shared/slides';
import { ThreadView } from '../comments/ThreadView';
import { Composer } from '../document/Composer';
import { useNativeThreadFocus } from '../feedback/NativeFeedback';
import { useSlidesCopy } from './copy';

type CommentsState = Pick<SlideDeckSnapshot, 'comments' | 'commentsWarning' | 'listening'>;
type CommentOp = ThreadOp | { op: 'create'; slideId: string; text: string };

export function SlideComments({
  url,
  slideId,
  initial,
  revision,
  exists,
}: {
  url: string;
  slideId: string;
  initial: CommentsState;
  revision: number;
  exists: boolean;
}) {
  const c = useSlidesCopy();
  const focusThread = useNativeThreadFocus();
  const [state, setState] = useState(initial);
  const [failed, setFailed] = useState(false);
  const sequenceRef = useRef(0);
  const writingRef = useRef(false);
  const refresh = useCallback(
    async (signal: AbortSignal) => {
      if (writingRef.current || document.hidden) return;
      const n = ++sequenceRef.current;
      try {
        const res = await fetch(url, { cache: 'no-store', signal });
        if (res.ok) {
          const data: CommentsState = await res.json();
          if (!signal.aborted && n === sequenceRef.current) setState(data);
        }
      } catch {
        /* Keep the last known threads until the next refresh. */
      }
    },
    [url],
  );
  useEffect(() => {
    const abort = new AbortController();
    const update = () => void refresh(abort.signal);
    update();
    const timer = window.setInterval(update, 8000);
    window.addEventListener('focus', update);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [refresh, revision]);
  async function send(op: CommentOp) {
    if (writingRef.current) return false;
    writingRef.current = true;
    ++sequenceRef.current;
    setFailed(false);
    try {
      const res = await fetch(url + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op),
      });
      if (!res.ok) throw new Error(res.statusText);
      setState(await res.json());
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      writingRef.current = false;
    }
  }
  const threads = state.comments.threads.filter((t) => t.anchor.slideId === slideId);
  return (
    <section aria-label={c.comments} className="sd-comments">
      <p className="sd-muted">{state.listening ? c.agentOn : c.agentOff}</p>
      {state.commentsWarning && <p role="alert">{state.commentsWarning}</p>}
      {failed && <p role="alert">{c.commentFailed}</p>}
      {!threads.length && <p className="sd-muted">{c.emptyComments}</p>}
      {threads.map((thread) => (
        <div
          className="sd-thread"
          data-thread={thread.id}
          key={thread.id}
          ref={focusThread}
          tabIndex={-1}
        >
          <ThreadView
            scrollHistory
            label={thread.status === 'resolved' ? c.resolved : c.comments}
            thread={thread}
            actions={{
              reply: (threadId, text) => send({ op: 'reply', threadId, text }),
              resolve: (threadId) => void send({ op: 'resolve', threadId }),
              reopen: (threadId) => void send({ op: 'reopen', threadId }),
              edit: (threadId, messageId, text) =>
                void send({ op: 'edit', threadId, messageId, text }),
              remove: (threadId, messageId) => void send({ op: 'delete', threadId, messageId }),
            }}
          />
        </div>
      ))}
      {exists ? (
        <Composer
          key={slideId}
          placeholder={c.commentHint}
          onSubmit={(text) => send({ op: 'create', slideId, text })}
        />
      ) : (
        <p>{c.saveFirst}</p>
      )}
    </section>
  );
}
