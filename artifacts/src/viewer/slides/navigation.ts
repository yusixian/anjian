import { useEffect, useState } from 'react';

import type { PublishedSlideDeck } from '../../shared/slides';

export function useSlidePage(deck: Pick<PublishedSlideDeck, 'slides'>) {
  const [selected, setSelected] = useState(() => new URL(location.href).searchParams.get('slide'));
  const index = Math.max(
    0,
    deck.slides.findIndex((slide) => slide.id === selected),
  );
  const slide = deck.slides[index]!;
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get('slide') === slide.id) return;
    url.searchParams.set('slide', slide.id);
    history.replaceState(history.state, '', url);
  }, [slide.id]);
  useEffect(() => {
    const read = () => setSelected(new URL(location.href).searchParams.get('slide'));
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  return { index, select: setSelected, slide };
}

export function useSlideKeys(
  deck: Pick<PublishedSlideDeck, 'slides'>,
  index: number,
  select: (id: string) => void,
  target: Window | null = window,
  exit?: () => void,
) {
  useEffect(() => {
    if (!target) return;
    function key(event: KeyboardEvent) {
      const element = event.target as HTMLElement | null;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey ||
        element?.closest?.(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [popover]',
        ) ||
        target?.document.querySelector('dialog[open], [aria-modal="true"]')
      )
        return;
      const directions: Record<string, number> = {
        ArrowLeft: index - 1,
        ArrowRight: index + 1,
        PageUp: index - 1,
        PageDown: index + 1,
        Home: 0,
        End: deck.slides.length - 1,
      };
      if (event.key === 'Escape' && exit) {
        event.preventDefault();
        exit();
        return;
      }
      const next = directions[event.key];
      if (next === undefined) return;
      event.preventDefault();
      if (deck.slides[next]) select(deck.slides[next].id);
    }
    target.addEventListener('keydown', key);
    return () => target.removeEventListener('keydown', key);
  }, [deck, index, select, target, exit]);
}
