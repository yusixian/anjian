import { GitBranch, Info, Laptop, Package } from 'lucide-react';
import type { ReactNode } from 'react';

export function Environment({ locale = 'zh' }: { locale?: 'zh' | 'en' }) {
  return (
    <div className="environment">
      {[
        [Laptop, locale === 'zh' ? '运行环境' : 'Runtime', 'Node.js 22'],
        [Package, locale === 'zh' ? '包管理器' : 'Package manager', 'pnpm 10.28.2'],
        [
          GitBranch,
          locale === 'zh' ? '安装方式' : 'Installation',
          locale === 'zh' ? '源码构建' : 'Build from source',
        ],
      ].map(([Icon, label, value]) => {
        const Symbol = Icon as typeof Info;
        return (
          <div key={String(label)}>
            <Symbol />
            <span>
              <small>{String(label)}</small>
              <b>{String(value)}</b>
            </span>
          </div>
        );
      })}
    </div>
  );
}
export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="docs-notice">
      <Info />
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </aside>
  );
}
export function Steps({ children }: { children: ReactNode }) {
  return <div className="doc-steps">{children}</div>;
}
export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="doc-step">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
