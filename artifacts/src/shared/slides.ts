import { type AnchorSpec, type CommentsFile, isObject } from './comments';

export const SLIDE_DECK_FILE = 'deck.json';
export const MAX_SLIDE_DECK_BYTES = 2 * 1024 * 1024;
export const MAX_SLIDES = 150;
export const MAX_SLIDE_TITLE = 160;
export const MAX_SLIDE_TEXT = 12_000;

export interface Slide {
  body: string;
  id: string;
  notes: string;
  title: string;
}

export interface SlideDeck {
  slides: Slide[];
  title: string;
  version: 1;
}

export type PublishedSlideDeck = Omit<SlideDeck, 'slides'> & { slides: Omit<Slide, 'notes'>[] };

export interface SlideAnchor {
  slideId: string;
}

export type SlideComments = CommentsFile<SlideAnchor>;

export interface SlideDeckSnapshot {
  comments: SlideComments;
  commentsWarning?: string;
  deck: SlideDeck;
  listening: boolean;
  revision: string;
}

export function isSlideId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

export const slideAnchors: AnchorSpec<SlideAnchor> = {
  missing: 'Slide not found',
  read(value) {
    if (!isObject(value) || !isSlideId(value.slideId)) return null;
    return { slideId: value.slideId };
  },
  same: (a, b) => a.slideId === b.slideId,
};

const within = (value: unknown, length: number): value is string =>
  typeof value === 'string' && value.length <= length;

export function parseSlideDeck(value: unknown): SlideDeck | null {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    !within(value.title, MAX_SLIDE_TITLE) ||
    !value.title.trim() ||
    !Array.isArray(value.slides) ||
    value.slides.length < 1 ||
    value.slides.length > MAX_SLIDES
  )
    return null;
  const ids = new Set<string>();
  const slides: Slide[] = [];
  for (const entry of value.slides) {
    if (
      !isObject(entry) ||
      !isSlideId(entry.id) ||
      ids.has(entry.id) ||
      !within(entry.title, MAX_SLIDE_TITLE) ||
      !within(entry.body, MAX_SLIDE_TEXT) ||
      !within(entry.notes, MAX_SLIDE_TEXT)
    )
      return null;
    const { body, id, notes, title } = entry;
    ids.add(id);
    slides.push({ body, id, notes, title });
  }
  return { slides, title: value.title.trim(), version: 1 };
}

export function publishedSlideDeck(deck: SlideDeck): PublishedSlideDeck {
  return {
    ...deck,
    slides: deck.slides.map(({ body, id, title }) => ({ body, id, title })),
  };
}
