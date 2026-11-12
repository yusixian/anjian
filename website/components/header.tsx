'use client';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { Github, Menu, Moon, Search, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useRef } from 'react';

import { BrandLogo } from './brand';

const links = [
  { href: '/docs', label: '使用指南' },
  { href: '/docs/self-hosting', label: '自托管' },
  { href: '/use-cases', label: '使用案例' },
  { href: '/docs/updates', label: '更新说明' },
];
export function Header() {
  const path = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const { setOpenSearch } = useSearchContext();
  const menu = useRef<HTMLDetailsElement>(null);
  function themeToggle() {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }
  const active = path.startsWith('/use-cases')
    ? '/use-cases'
    : path.startsWith('/docs/self-hosting')
      ? '/docs/self-hosting'
      : '/docs';
  if (path === '/docs' || path.startsWith('/docs/')) return null;
  return (
    <header className="site-header">
      <Link aria-label="案间文档首页" className="brand" href="/">
        <BrandLogo />
        案间
      </Link>
      <nav aria-label="主导航" className="site-nav">
        {links.map((link) => (
          <Link
            aria-current={active === link.href ? 'page' : undefined}
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="header-end">
        <a className="workbench-link" href="/library">
          进入工作台
        </a>
        <button aria-label="搜索文档" className="search-button" onClick={() => setOpenSearch(true)}>
          <Search />
          <span>搜索文档</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          aria-label="切换深浅主题"
          className="icon-button desktop-theme"
          onClick={themeToggle}
        >
          <Sun className="light-logo" />
          <Moon className="dark-logo" />
        </button>
        <a
          aria-label="GitHub 仓库"
          className="icon-button desktop-github"
          href="https://github.com/yusixian/anjian"
        >
          <Github />
        </a>
        <details
          className="mobile-menu"
          ref={menu}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && menu.current) {
              menu.current.open = false;
              menu.current.querySelector('summary')?.focus();
            }
          }}
        >
          <summary aria-label="打开导航菜单" className="icon-button">
            <Menu />
          </summary>
          <nav aria-label="手机导航">
            {links.map((link) => (
              <Link
                href={link.href}
                key={link.href}
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                }}
              >
                {link.label}
              </Link>
            ))}
            <button onClick={themeToggle}>切换深浅主题</button>
            <a href="https://github.com/yusixian/anjian">GitHub 仓库</a>
          </nav>
        </details>
      </div>
    </header>
  );
}
