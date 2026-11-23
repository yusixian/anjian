import './slides.css';

import { ArrowDown, ArrowUp, MessageSquare, NotebookPen, Play, Plus, Save } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { mintArtifactId } from '../../shared/ids';
import {
  MAX_SLIDE_TEXT,
  MAX_SLIDE_TITLE,
  MAX_SLIDES,
  type Slide,
  SLIDE_DECK_FILE,
  type SlideDeckSnapshot,
} from '../../shared/slides';
import { CommentRecovery } from '../comments/CommentRecovery';
import { LibraryLink, LibraryNavigation } from '../components/LibraryNavigation';
import { ShareButton } from '../components/ShareButton';
import { NativeFeedback, NativeFeedbackButton } from '../feedback/NativeFeedback';
import { useArtifactSocket } from '../hooks/useArtifactSocket';
import { Audience } from './Audience';
import { useSlidesCopy } from './copy';
import { useSlideKeys, useSlidePage } from './navigation';
import { SlideComments } from './SlideComments';
import { Pagination, SlidePaper, Tool } from './SlideView';

function Workbench({
  id,
  sourceId,
  initial,
  url,
}: {
  id: string;
  sourceId: string;
  initial: SlideDeckSnapshot;
  url: string;
}) {
  const c = useSlidesCopy();
  const [base, setBase] = useState(initial);
  const [deck, setDeck] = useState(initial.deck);
  const [audience, setAudience] = useState(false);
  const [commentRevision, setCommentRevision] = useState(0);
  const [detail, setDetail] = useState<'notes' | 'comments'>('notes');
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<'conflict' | 'saveFailed' | ''>('');
  const [refresh, setRefresh] = useState(0);
  const { index, select } = useSlidePage(deck);
  const slide = deck.slides[index]!;
  const dirty = deck !== base.deck;
  const presentButtonRef = useRef<HTMLSpanElement>(null);
  const writingRef = useRef(false);
  const latestDeckRef = useRef(deck);
  const refreshDeck = () => setRefresh((current) => current + 1);
  useArtifactSocket((message) => {
    if (
      message.type === 'change' &&
      message.artifact === `slides/${sourceId}` &&
      (message.files.length === 0 || message.files.includes(SLIDE_DECK_FILE))
    )
      refreshDeck();
  }, refreshDeck);

  const receiveDeck = useEffectEvent((snapshot: SlideDeckSnapshot) => {
    if (writingRef.current || snapshot.revision === base.revision) return;
    if (dirty) {
      setIssue('conflict');
      return;
    }
    setBase(snapshot);
    setDeck(snapshot.deck);
    setIssue('');
  });
  useEffect(() => {
    if (!refresh || busy) return;
    const abort = new AbortController();
    async function update() {
      try {
        const res = await fetch(url, { cache: 'no-store', signal: abort.signal });
        if (!res.ok) return;
        const snapshot: SlideDeckSnapshot = await res.json();
        if (!abort.signal.aborted) receiveDeck(snapshot);
      } catch {
        // The next change or reconnect will retry the refresh.
      }
    }
    void update();
    return () => abort.abort();
  }, [busy, refresh, url]);

  useEffect(() => {
    latestDeckRef.current = deck;
  }, [deck]);
  // Audience owns its own key handler while the editor is hidden.
  useSlideKeys(deck, index, select, audience ? null : window);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const active = document.querySelector<HTMLElement>('.sd-thumb[aria-current="page"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [slide.id]);
  function updateSlide(field: 'title' | 'body' | 'notes', value: string) {
    setDeck({
      ...deck,
      slides: deck.slides.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    });
  }
  function add() {
    if (deck.slides.length >= MAX_SLIDES) return;
    const page: Slide = {
      id: 's-' + mintArtifactId().toLowerCase(),
      title: c.newSlide,
      body: '',
      notes: '',
    };
    const pages = [...deck.slides];
    pages.splice(index + 1, 0, page);
    setDeck({ ...deck, slides: pages });
    select(page.id);
  }
  function move(offset: number) {
    const pages = [...deck.slides];
    pages.splice(index, 1);
    pages.splice(index + offset, 0, slide);
    select(slide.id);
    setDeck({ ...deck, slides: pages });
  }
  async function save() {
    if (writingRef.current || !dirty || !deck.title.trim() || issue === 'conflict') return;
    writingRef.current = true;
    setBusy(true);
    setIssue('');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck, revision: base.revision }),
      });
      if (res.status === 409) {
        setIssue('conflict');
        return;
      }
      if (!res.ok) throw new Error(res.statusText);
      const data: SlideDeckSnapshot = await res.json();
      setBase(data);
      setDeck((current) => (current === deck ? data.deck : current));
    } catch {
      setIssue('saveFailed');
    } finally {
      writingRef.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (writingRef.current || !window.confirm(c.discard)) return;
    writingRef.current = true;
    setBusy(true);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.statusText);
      const data: SlideDeckSnapshot = await res.json();
      if (latestDeckRef.current !== deck) return;
      setBase(data);
      setDeck(data.deck);
      setIssue('');
    } catch {
      setIssue('conflict');
    } finally {
      writingRef.current = false;
      setBusy(false);
    }
  }
  if (audience)
    return (
      <Audience
        deck={deck}
        index={index}
        select={select}
        exit={() => {
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          setAudience(false);
          requestAnimationFrame(() => presentButtonRef.current?.querySelector('button')?.focus());
        }}
      />
    );
  const editor = (
    <div
      className="sd-root sd-editor"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          void save();
        }
      }}
    >
      <header className="sd-toolbar">
        <LibraryLink />
        <input
          required
          aria-label={c.deckTitle}
          className="sd-deck-title"
          maxLength={MAX_SLIDE_TITLE}
          value={deck.title}
          onChange={(e) => setDeck({ ...deck, title: e.target.value })}
        />
        <div className="sd-actions">
          <span className="sd-status" role="status">
            {busy ? c.saving : dirty ? c.dirty : c.saved}
          </span>
          <Tool
            disabled={busy || !dirty || !deck.title.trim() || issue === 'conflict'}
            icon={Save}
            label={c.save}
            onClick={() => void save()}
          >
            <span>{c.save}</span>
          </Tool>
          <NativeFeedbackButton />
          <CommentRecovery
            url={url + '/comments'}
            onRestore={() => setCommentRevision((value) => value + 1)}
          />
          <ShareButton id={id} type="slides" />
          <span ref={presentButtonRef}>
            <Tool primary icon={Play} label={c.present} onClick={() => setAudience(true)}>
              <span>{c.present}</span>
            </Tool>
          </span>
        </div>
      </header>
      {issue && (
        <div className="sd-notice" role="alert">
          {c[issue]}{' '}
          {issue === 'conflict' && (
            <button disabled={busy} type="button" onClick={() => void reload()}>
              {c.reload}
            </button>
          )}
        </div>
      )}
      <div className="sd-workspace">
        <aside aria-label={c.slides} className="sd-rail">
          <header>
            <h2>
              {c.slides} <span>{deck.slides.length}</span>
            </h2>
            <Tool
              disabled={deck.slides.length >= MAX_SLIDES}
              icon={Plus}
              label={c.add}
              onClick={add}
            />
          </header>
          <nav aria-label={c.slides}>
            {deck.slides.map((s, i) => (
              <button
                aria-current={s.id === slide.id ? 'page' : undefined}
                aria-label={String(i + 1) + ' · ' + (s.title || c.untitled)}
                className="sd-thumb"
                key={s.id}
                type="button"
                onClick={() => select(s.id)}
              >
                <span aria-hidden="true" className="sd-mini">
                  <b>{s.title || c.untitled}</b>
                  <span>{s.body}</span>
                </span>
                <span className="sd-caption">
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {s.title || c.untitled}
                </span>
              </button>
            ))}
          </nav>
        </aside>
        <main className="sd-desk">
          <div className="sd-sheet">
            <div className="sd-page-tools">
              <Pagination deck={deck} index={index} select={select} />
              <div>
                <Tool disabled={!index} icon={ArrowUp} label={c.earlier} onClick={() => move(-1)} />
                <Tool
                  disabled={index === deck.slides.length - 1}
                  icon={ArrowDown}
                  label={c.later}
                  onClick={() => move(1)}
                />
              </div>
            </div>
            <SlidePaper deckTitle={deck.title} edit={updateSlide} index={index} slide={slide} />
            <div className="sd-detail">
              <div className="sd-detail-tabs">
                <button
                  aria-pressed={detail === 'notes'}
                  type="button"
                  onClick={() => setDetail('notes')}
                >
                  <NotebookPen aria-hidden="true" size={16} />
                  {c.notes}
                </button>
                <button
                  aria-pressed={detail === 'comments'}
                  type="button"
                  onClick={(event) => {
                    if (detail === 'comments') return;
                    const panel = event.currentTarget.closest('.sd-detail');
                    setDetail('comments');
                    requestAnimationFrame(() => {
                      panel
                        ?.querySelector('.sd-thread, .sd-comments form')
                        ?.scrollIntoView({ block: 'nearest' });
                    });
                  }}
                >
                  <MessageSquare aria-hidden="true" size={16} />
                  {c.comments}
                </button>
              </div>
              {detail === 'notes' ? (
                <textarea
                  aria-label={c.notes}
                  className="sd-notes"
                  maxLength={MAX_SLIDE_TEXT}
                  placeholder={c.notesHint}
                  rows={3}
                  value={slide.notes}
                  onChange={(e) => updateSlide('notes', e.target.value)}
                />
              ) : (
                <SlideComments
                  exists={base.deck.slides.some((s) => s.id === slide.id)}
                  initial={base}
                  revision={commentRevision}
                  slideId={slide.id}
                  url={url}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
  return (
    <NativeFeedback<SlideDeckSnapshot>
      id={id}
      type="slides"
      locate={(snapshot, threadId) => {
        const slideId = snapshot.comments.threads.find((thread) => thread.id === threadId)?.anchor
          .slideId;
        if (
          !slideId ||
          !snapshot.deck.slides.some((item) => item.id === slideId) ||
          (dirty && !deck.slides.some((item) => item.id === slideId))
        )
          return false;
        if (!dirty && !writingRef.current) {
          setBase(snapshot);
          setDeck(snapshot.deck);
        }
        select(slideId);
        setDetail('comments');
        return true;
      }}
    >
      {editor}
    </NativeFeedback>
  );
}

function LoadDeck({ id, sourceId }: { id: string; sourceId: string }) {
  const c = useSlidesCopy();
  const url = '/api/slides/' + encodeURIComponent(id);
  const [data, setData] = useState<SlideDeckSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      setFailed(false);
      try {
        const res = await fetch(url, { cache: 'no-store', signal: abort.signal });
        if (!res.ok) throw new Error(res.statusText);
        const snapshot: SlideDeckSnapshot = await res.json();
        if (!abort.signal.aborted) setData(snapshot);
      } catch {
        if (!abort.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => abort.abort();
  }, [url, attempt]);
  if (data) return <Workbench id={id} initial={data} sourceId={sourceId} url={url} />;
  return (
    <main className="sd-root sd-loading">
      <LibraryLink />
      <p role={failed ? 'alert' : 'status'}>{failed ? c.loadFailed : c.load}</p>
      {failed && (
        <button type="button" onClick={() => setAttempt(attempt + 1)}>
          {c.retry}
        </button>
      )}
    </main>
  );
}
export function SlidesLayout({ id, sourceId }: { id: string; sourceId: string }) {
  return (
    <LibraryNavigation>
      <LoadDeck id={id} key={id} sourceId={sourceId} />
    </LibraryNavigation>
  );
}
