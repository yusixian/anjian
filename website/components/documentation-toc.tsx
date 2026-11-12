'use client';

import { useItems } from 'fumadocs-ui/components/toc';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { useTreePath } from 'fumadocs-ui/contexts/tree';
import { TOCPopover, type TOCPopoverProps } from 'fumadocs-ui/layouts/docs/page/slots/toc';
import { useCallback, useId, useState } from 'react';

export function DocumentationTOCPopover(props: TOCPopoverProps) {
  const { locale } = useI18n();
  const items = useItems();
  const page = useTreePath().at(-1);
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const purpose = locale === 'zh' ? '目录' : 'Table of contents';
  const current = !open && items.find((item) => item.active);
  const label = current ? current.original.title : page?.name;
  const observeExpanded = useCallback((button: HTMLButtonElement | null) => {
    if (!button) return;
    // Fumadocs 16.18.4 keeps open state private. Observe its public button state
    // so naming follows every close path without taking over navigation.
    const update = () => setOpen(button.getAttribute('aria-expanded') === 'true');
    update();
    const observer = new MutationObserver(update);
    observer.observe(button, { attributes: true, attributeFilter: ['aria-expanded'] });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <span hidden id={labelId}>
        {purpose}
        {label ? (
          <>
            {locale === 'zh' ? '：' : ': '}
            {label}
          </>
        ) : null}
      </span>
      <TOCPopover
        {...props}
        trigger={{ ...props.trigger, 'ref': observeExpanded, 'aria-labelledby': labelId }}
      />
    </>
  );
}
