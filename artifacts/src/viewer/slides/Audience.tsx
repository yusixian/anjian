import { MonitorUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { SlideDeck } from '../../shared/slides';
import { useSlidesCopy } from './copy';
import { useSlideKeys } from './navigation';
import { FullscreenButton, Pagination, SlidePaper, Tool } from './SlideView';

export function Audience({
  deck,
  index,
  select,
  exit,
}: {
  deck: SlideDeck;
  index: number;
  select: (id: string) => void;
  exit: () => void;
}) {
  const c = useSlidesCopy();
  const slide = deck.slides[index]!;
  const next = deck.slides[index + 1];
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [presenterWindow, setPresenterWindow] = useState<Window | null>(null);
  const [blocked, setBlocked] = useState(false);
  const closeButtonRef = useRef<HTMLDivElement>(null);
  useEffect(() => closeButtonRef.current?.querySelector('button')?.focus(), []);
  useSlideKeys(deck, index, select, window, exit);
  useSlideKeys(deck, index, select, presenterWindow);
  useEffect(() => {
    if (!presenterWindow) return;
    const closed = () => setPresenterWindow(null);
    const end = () => presenterWindow.close();
    presenterWindow.addEventListener('pagehide', closed);
    window.addEventListener('pagehide', end);
    return () => {
      presenterWindow.removeEventListener('pagehide', closed);
      window.removeEventListener('pagehide', end);
      presenterWindow.close();
    };
  }, [presenterWindow]);
  function presenter() {
    if (presenterWindow && !presenterWindow.closed) {
      presenterWindow.focus();
      return;
    }
    const popup = window.open('', '_blank', 'popup,width=960,height=730');
    setBlocked(!popup);
    if (!popup) return;
    const doc = popup.document;
    doc.title = deck.title + ' · ' + c.presenter;
    doc.documentElement.lang = document.documentElement.lang;
    for (const sheet of document.querySelectorAll('style, link[rel="stylesheet"]')) {
      doc.head.appendChild(sheet.cloneNode(true));
    }
    setPresenterWindow(popup);
  }
  return (
    <div className="sd-root sd-audience sd-private-audience" ref={setRoot}>
      <div className="sd-stage">
        <SlidePaper deckTitle={deck.title} index={index} slide={slide} />
      </div>
      <div className="sd-controls" ref={closeButtonRef}>
        <Tool icon={X} label={c.exit} onClick={exit} />
        <Pagination deck={deck} index={index} select={select} />
        <FullscreenButton element={root} />
        <Tool icon={MonitorUp} label={c.presenter} onClick={presenter}>
          <span>{c.presenter}</span>
        </Tool>
      </div>
      {blocked && (
        <span className="sd-notice" role="alert">
          {c.blocked}
        </span>
      )}
      {presenterWindow &&
        createPortal(
          <div className="sd-root sd-presenter">
            <header className="sd-presenter-head">
              <h1>{deck.title}</h1>
              <Pagination deck={deck} index={index} select={select} />
            </header>
            <div className="sd-presenter-grid">
              <div>
                <SlidePaper deckTitle={deck.title} index={index} slide={slide} />
                <h2>{c.notes}</h2>
                <p className="sd-presenter-notes">{slide.notes || c.noNotes}</p>
              </div>
              <aside>
                <h2>{c.nextSlide}</h2>
                {next ? (
                  <SlidePaper deckTitle={deck.title} index={index + 1} slide={next} />
                ) : (
                  <p>{c.last}</p>
                )}
              </aside>
            </div>
          </div>,
          presenterWindow.document.body,
        )}
    </div>
  );
}
