import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';

import { useTranslation } from '../i18n';

// Only standalone workbench routes own a library; embedded viewers do not.
const LibraryContext = createContext(false);

export function LibraryNavigation({ children }: { children: ReactNode }) {
  return <LibraryContext.Provider value>{children}</LibraryContext.Provider>;
}

const styles = stylex.create({
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    flexShrink: 0,
    paddingInline: 10,
    borderRadius: 8,
    color: cssVar.colorText,
    backgroundColor: { default: 'transparent', ':hover': cssVar.colorFillTertiary },
    fontFamily: cssVar.fontFamily,
    fontSize: 13,
    fontWeight: 500,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    outlineOffset: 2,
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    minHeight: 48,
    paddingInline: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
  },
});

export function LibraryLink() {
  const available = useContext(LibraryContext);
  const { t } = useTranslation();
  if (!available) return null;
  return (
    <a href="/" aria-label={t('chrome.backToLibrary')} {...stylex.props(styles.link)}>
      <ArrowLeft aria-hidden="true" size={16} />
      {t('chrome.library')}
    </a>
  );
}

export function LibraryBar() {
  if (!useContext(LibraryContext)) return null;
  return (
    <header {...stylex.props(styles.bar)}>
      <LibraryLink />
    </header>
  );
}
