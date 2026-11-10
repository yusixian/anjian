import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Eye } from 'lucide-react';
import type { SerializedEditorState } from 'lexical';

import { ANJIAN_MARK_BODY, ANJIAN_MARK_VIEWBOX } from '../../shared/brand';
import type { ArtifactType, CanvasLayout, CanvasSpec } from '../../shared/types';

const ArtboardView = lazy(() =>
  import('../layouts/ArtboardView').then(({ ArtboardView }) => ({ default: ArtboardView })),
);

const PublicDocument = lazy(() =>
  import('./PublicDocument').then(({ PublicDocument }) => ({ default: PublicDocument })),
);

interface SharePayload {
  type: ArtifactType;
  title: string;
  publishedAt: number;
  expiresAt: number | null;
  contentBase: string;
  revision?: string;
  canvas?: CanvasSpec | null;
  layout?: CanvasLayout | null;
  versions?: Record<string, number>;
  state?: SerializedEditorState;
}

const texts = {
  zh: {
    access: '只读', details: '分享信息', brand: '案间', readOnly: '公开分享 · 只读', published: '发布于', expires: '链接到期',
    loading: '正在加载分享…', unavailable: '此分享暂时无法访问', unavailableHelp: '链接可能已失效，或分享者已关闭访问。',
    retry: '重试', offline: '连接中断，内容可能已经更新。请重试。', noContent: '发布内容暂不可用。',
    snapshot: '这是一份发布快照；作者后续修改不会自动公开。',
  },
  en: {
    access: 'Read only', details: 'Share details', brand: 'Anjian', readOnly: 'Public share · Read only', published: 'Published', expires: 'Link expires',
    loading: 'Loading share…', unavailable: 'This share is unavailable', unavailableHelp: 'The link may have expired or been closed by its owner.',
    retry: 'Retry', offline: 'Connection interrupted. Content may have changed. Please retry.', noContent: 'Published content is unavailable.',
    snapshot: 'This is a published snapshot; later edits are not automatically public.',
  },
} as const;

function shareBase(pathname: string) {
  const match = /^\/s\/([A-Za-z0-9_-]{32,64})\/?$/.exec(pathname);
  return match ? `/s/${match[1]}` : null;
}

export function SharePage() {
  const base = shareBase(location.pathname);
  const lang = /^en(?:-|$)/i.test(navigator.language) ? 'en' : 'zh';
  const copy = texts[lang];
  const [data, setData] = useState<SharePayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'offline'>('loading');
  const seq = useRef(0);
  const hasData = useRef(false);
  const load = useCallback(async (background = false) => {
    if (!base) { setData(null); setState('unavailable'); return; }
    const id = ++seq.current;
    if (!background) setState('loading');
    try {
      const response = await fetch(`${location.origin}${base}/data`, { cache: 'no-store', credentials: 'omit' });
      if (response.status === 404 || response.status === 410) {
        if (id === seq.current) { hasData.current = false; setData(null); setState('unavailable'); }
        return;
      }
      if (!response.ok) throw new Error('Share unavailable');
      const next = await response.json() as SharePayload;
      if (id !== seq.current) return;
      if (!['artboard', 'document', 'html'].includes(next.type) || typeof next.title !== 'string' || typeof next.contentBase !== 'string') throw new Error('Invalid share data');
      hasData.current = true;
      setData((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
      setState('ready');
    } catch {
      if (id === seq.current) setState(hasData.current ? 'offline' : 'unavailable');
    }
  }, [base]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(true); }, 30_000);
    const onFocus = () => { void load(true); };
    addEventListener('focus', onFocus);
    return () => { clearInterval(timer); removeEventListener('focus', onFocus); seq.current++; };
  }, [load]);
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = data ? `${data.title} · ${copy.brand}` : `${copy.readOnly} · ${copy.brand}`;
  }, [copy, data, lang]);
  const date = (stamp: number) => new Date(stamp).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
  return (
    <div className={`share-page${data?.type === 'artboard' ? ' share-workbench' : ''}`}>
      <header className="share-header">
        <span className="share-brand"><svg aria-hidden="true" viewBox={ANJIAN_MARK_VIEWBOX} dangerouslySetInnerHTML={{ __html: ANJIAN_MARK_BODY }} /><span>{copy.brand}</span></span>
        {data && <h1 className="share-title" title={data.title}>{data.title}</h1>}
        {data ? <>
          <button className="share-access" type="button" popoverTarget="share-details" aria-label={copy.details}>
            <Eye size={14} aria-hidden="true" /><span>{copy.access}</span><ChevronDown size={12} aria-hidden="true" />
          </button>
          <div className="share-details" id="share-details" popover="auto">
            <strong>{data.title}</strong>
            <span className="share-readonly">{copy.readOnly}</span>
            <p>{copy.published} {date(data.publishedAt)}</p>
            {data.expiresAt && <p>{copy.expires} {date(data.expiresAt)}</p>}
            <p className="share-snapshot">{copy.snapshot}</p>
          </div>
        </> : <span className="share-readonly">{copy.readOnly}</span>}
      </header>
      {data && (state === 'ready' || state === 'offline') ? (
        <>
          {state === 'offline' && <div className="share-alert" role="alert">{copy.offline} <button type="button" onClick={() => void load()}>{copy.retry}</button></div>}
          <main className="share-main">
            {data.type === 'artboard' ? (
              <Suspense fallback={<div className="share-message">{copy.loading}</div>}>
                <div className="share-artboard">
                  <ArtboardView
                    readOnly
                    id="public-share"
                    artifact={null}
                    live={false}
                    loaded
                    canvas={data.canvas ?? null}
                    layout={data.layout ?? null}
                    versions={data.versions ?? {}}
                    warnings={[]}
                    pending={[]}
                    contentBase={data.contentBase}
                  />
                </div>
              </Suspense>
            ) : data.type === 'html' ? (
              <iframe className="share-html" title={data.title} src={`${data.contentBase}index.html`} sandbox="allow-scripts" referrerPolicy="no-referrer" />
            ) : data.state ? (
              <Suspense fallback={<div className="share-message">{copy.loading}</div>}><PublicDocument key={data.contentBase} contentBase={data.contentBase} state={data.state} /></Suspense>
            ) : <div className="share-message">{copy.noContent}</div>}
          </main>
        </>
      ) : <main className="share-message" role={state === 'loading' ? 'status' : 'alert'}>
        <div><h1>{state === 'loading' ? copy.loading : copy.unavailable}</h1>{state !== 'loading' && <><p>{copy.unavailableHelp}</p><button type="button" onClick={() => void load()}>{copy.retry}</button></>}</div>
      </main>}
    </div>
  );
}
