import { GitBranch,Info, Laptop, Package } from 'lucide-react';
import type { ReactNode } from 'react';

export function Environment() {
  return (
    <div className="environment">
      {[
        [Laptop, '运行环境', 'Node.js 22'],
        [Package, '包管理器', 'pnpm 10.28.2'],
        [GitBranch, '安装方式', '源码构建'],
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
