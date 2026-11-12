'use client';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { staticClient } from 'fumadocs-core/search/client/orama-static';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { useRef } from 'react';

function available(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    element !== document.body &&
    element !== document.documentElement &&
    !element.matches(':disabled, [aria-disabled="true"]') &&
    !element.closest('[inert]') &&
    element.checkVisibility({ checkVisibilityCSS: true }) &&
    element.getClientRects().length > 0
  );
}

export function SiteSearchDialog(props: SharedProps) {
  const { locale } = useI18n();
  const search = useDocsSearch({ client: staticClient({ locale }) });
  const originRef = useRef<Element | null>(null);
  const openingURLRef = useRef('');
  const selectedRef = useRef(false);

  return (
    <SearchDialog
      {...search}
      {...props}
      onSelect={() => {
        selectedRef.current = true;
      }}
    >
      <SearchDialogOverlay />
      <SearchDialogContent
        onCloseAutoFocus={(event) => {
          // Shared search entries are not Radix Triggers. Restore cancellation only;
          // result selection and route changes retain the native navigation behavior.
          event.preventDefault();
          if (selectedRef.current || location.href !== openingURLRef.current) return;
          const candidates = [
            originRef.current,
            ...document.querySelectorAll('[data-search], [data-search-full], .search-button'),
            ...document.querySelectorAll('a.brand, #nd-sidebar a[href], #nd-subnav a[href]'),
          ];
          for (const candidate of candidates) {
            if (!available(candidate)) continue;
            candidate.focus({ preventScroll: true });
            if (document.activeElement === candidate) break;
          }
        }}
        onOpenAutoFocus={() => {
          originRef.current = document.activeElement;
          openingURLRef.current = location.href;
          selectedRef.current = false;
        }}
      >
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
      </SearchDialogContent>
      <SearchDialogFooter />
    </SearchDialog>
  );
}
