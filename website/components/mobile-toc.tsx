'use client';
import { useTOCItems } from 'fumadocs-ui/components/toc';
import { ChevronDown } from 'lucide-react';
import { useRef } from 'react';

export function MobileTOC() {
  const items = useTOCItems();
  const details = useRef<HTMLDetailsElement>(null);
  return (
    <details
      className="mobile-toc"
      ref={details}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && details.current) {
          details.current.open = false;
          details.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>
        本页目录
        <ChevronDown />
      </summary>
      <nav aria-label="本页目录">
        {items.length ? (
          items.map((item) => (
            <a
              href={item.url}
              key={item.url}
              onClick={() => {
                if (details.current) details.current.open = false;
              }}
            >
              {item.title}
            </a>
          ))
        ) : (
          <p>暂无目录</p>
        )}
      </nav>
    </details>
  );
}
