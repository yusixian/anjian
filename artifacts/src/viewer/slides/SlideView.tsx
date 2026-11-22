import { ChevronLeft, ChevronRight, type LucideIcon, Maximize, Minimize } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { MAX_SLIDE_TEXT, MAX_SLIDE_TITLE, type Slide, type SlideDeck } from '../../shared/slides';
import { useSlidesCopy } from './copy';
import { useSlideKeys, useSlidePage } from './navigation';

export type VisibleSlide = Pick<Slide, 'id' | 'title' | 'body'>;
export type VisibleDeck = Pick<SlideDeck, 'title'> & { slides: VisibleSlide[] };

export function Tool({
  icon: Icon,
  label,
  children,
  onClick,
  disabled,
  primary,
}: {
  icon: LucideIcon;
  label: string;
  children?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className={primary ? 'sd-tool sd-primary' : 'sd-tool'}
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      <Icon aria-hidden="true" size={17} strokeWidth={1.7} />
      {children}
    </button>
  );
}

export function Pagination({
  deck,
  index,
  select,
}: {
  deck: VisibleDeck;
  index: number;
  select: (id: string) => void;
}) {
  const c = useSlidesCopy();
  return (
    <div className="sd-pagination">
      <Tool
        disabled={index === 0}
        icon={ChevronLeft}
        label={c.previous}
        onClick={() => select(deck.slides[index - 1]!.id)}
      />
      <span aria-label={c.page} aria-live="polite">
        {index + 1} / {deck.slides.length}
      </span>
      <Tool
        disabled={index + 1 >= deck.slides.length}
        icon={ChevronRight}
        label={c.next}
        onClick={() => select(deck.slides[index + 1]!.id)}
      />
    </div>
  );
}

export function FullscreenButton({ element }: { element: HTMLElement | null }) {
  const c = useSlidesCopy();
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const change = () => setFull(Boolean(document.fullscreenElement));
    change();
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  if (!element?.requestFullscreen) return null;
  return (
    <>
      <Tool
        icon={full ? Minimize : Maximize}
        label={full ? c.leaveFullscreen : c.fullscreen}
        onClick={() => {
          setFailed(false);
          void (full ? document.exitFullscreen() : element.requestFullscreen()).catch(() =>
            setFailed(true),
          );
        }}
      />
      {failed && <span role="alert">{c.exitFailed}</span>}
    </>
  );
}

export function SlidePaper({
  slide,
  deckTitle,
  index,
  edit,
}: {
  slide: VisibleSlide;
  deckTitle: string;
  index: number;
  edit?: (field: 'title' | 'body', value: string) => void;
}) {
  const c = useSlidesCopy();
  return (
    <article aria-label={slide.title || c.untitled} className="sd-paper">
      <header>
        <span>{deckTitle || c.untitled}</span>
        <span>{String(index + 1).padStart(2, '0')}</span>
      </header>
      <div className="sd-content">
        {edit ? (
          <>
            <textarea
              aria-label={c.title}
              className="sd-slide-title"
              maxLength={MAX_SLIDE_TITLE}
              placeholder={c.title}
              rows={1}
              value={slide.title}
              onChange={(e) => edit('title', e.target.value)}
            />
            <textarea
              aria-label={c.body}
              className="sd-slide-body"
              maxLength={MAX_SLIDE_TEXT}
              placeholder={c.body}
              rows={3}
              value={slide.body}
              onChange={(e) => edit('body', e.target.value)}
            />
          </>
        ) : (
          <>
            <h2 className="sd-slide-title">{slide.title || c.untitled}</h2>
            <p className="sd-slide-body">{slide.body}</p>
          </>
        )}
      </div>
    </article>
  );
}

export function PublishedSlides({ deck }: { deck: VisibleDeck }) {
  const { index, slide, select } = useSlidePage(deck);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useSlideKeys(deck, index, select);
  return (
    <div className="sd-root sd-audience" ref={setElement}>
      <div className="sd-stage">
        <SlidePaper deckTitle={deck.title} index={index} slide={slide} />
      </div>
      <div className="sd-controls">
        <Pagination deck={deck} index={index} select={select} />
        <FullscreenButton element={element} />
      </div>
    </div>
  );
}
