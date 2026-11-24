import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { useMedia } from '../hooks/useMedia';
import { useTranslation } from '../i18n';
import { OpenDocumentBlockContext } from './ArtifactReferenceCard';
import type { DocumentBlockTarget } from './useDocumentBlockTarget';

const wide = '(min-width: 1101px)';
const styles = stylex.create({
  main: { marginInlineEnd: 'min(42vw, 640px)' },
  panel: {
    position: 'fixed',
    zIndex: 10,
    insetBlock: 0,
    insetInlineEnd: 0,
    width: 'min(42vw, 640px)',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: cssVar.colorBgContainer,
    borderInlineStart: '1px solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingBlock: 8,
    paddingInline: 12,
    color: cssVar.colorText,
    fontFamily: cssVar.fontFamily,
    fontSize: 13,
  },
  title: { minWidth: 0, flex: 1, overflowWrap: 'anywhere' },
  frame: { width: '100%', flex: 1, minHeight: 0, border: 0 },
});

function targetFromLocation(scrollY?: number): DocumentBlockTarget {
  return { blockId: new URLSearchParams(location.search).get('block'), scrollY };
}

export function DocumentReferenceNavigation({
  children,
}: {
  children: (target: DocumentBlockTarget) => ReactNode;
}) {
  const { t } = useTranslation();
  const desktop = useMedia(wide);
  const [target, setTarget] = useState(() => targetFromLocation());
  const [preview, setPreview] = useState<{ href: string; src: string; title: string } | null>(null);
  const trigger = useRef<HTMLAnchorElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const showPanel = desktop && preview !== null;

  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      const position = event.state?.anjianDocumentScroll;
      setTarget(targetFromLocation(typeof position === 'number' ? position : undefined));
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  useEffect(() => {
    if (showPanel) closeButton.current?.focus();
  }, [showPanel]);

  const close = () => {
    setPreview(null);
    trigger.current?.focus({ preventScroll: true });
  };

  const open = (href: string, title: string, anchor: HTMLAnchorElement) => {
    const destination = new URL(href);
    const blockId = destination.searchParams.get('block');
    if (!blockId) return false;
    const current = new URL(location.href);
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (
      destination.pathname === current.pathname ||
      (canonical && destination.pathname === new URL(canonical.href).pathname)
    ) {
      if (current.searchParams.get('block') !== blockId) {
        history.replaceState({ ...history.state, anjianDocumentScroll: window.scrollY }, '');
        current.searchParams.set('block', blockId);
        history.pushState({ ...history.state, anjianDocumentScroll: undefined }, '', current);
      }
      setTarget({ blockId });
      return true;
    }
    if (!desktop) return false;
    destination.pathname = '/preview' + destination.pathname;
    trigger.current = anchor;
    setPreview({ href, title, src: destination.href });
    return true;
  };

  return (
    <OpenDocumentBlockContext.Provider value={open}>
      <div {...stylex.props(showPanel && styles.main)}>{children(target)}</div>
      {showPanel && preview && (
        <aside
          {...stylex.props(styles.panel)}
          aria-label={t('reference.preview')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <div {...stylex.props(styles.bar)}>
            <strong {...stylex.props(styles.title)}>{preview.title}</strong>
            <a href={preview.href}>{t('reference.openDocument')}</a>
            <button ref={closeButton} type="button" onClick={close}>
              {t('common.close')}
            </button>
          </div>
          <iframe {...stylex.props(styles.frame)} src={preview.src} title={preview.title} />
        </aside>
      )}
    </OpenDocumentBlockContext.Provider>
  );
}
