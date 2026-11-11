'use client';
import { useDocsLayout } from 'fumadocs-ui/layouts/docs';
import { Menu } from 'lucide-react';

export function DocsMobileNav() {
  const { slots } = useDocsLayout();
  return (
    <div className="docs-mobile-nav" id="nd-subnav">
      <slots.sidebar.trigger aria-label="打开文档导航">
        <Menu />
        文档导航
      </slots.sidebar.trigger>
    </div>
  );
}
