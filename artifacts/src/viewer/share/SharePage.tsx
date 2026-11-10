import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { SerializedEditorState } from 'lexical';

import { ANJIAN_MARK_BODY, ANJIAN_MARK_VIEWBOX } from '../../shared/brand';
import type { ArtifactType, CanvasLayout, CanvasSpec } from '../../shared/types';
import { Canvas } from '../components/Canvas';
import { fitView, zoomAround, type View } from '../lib/view';

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
    brand: '案间', readOnly: '公开分享 · 只读', published: '发布于', expires: '链接到期',
    loading: '正在加载分享…', unavailable: '此分享暂时无法访问', unavailableHelp: '链接可能已失效，或分享者已关闭访问。',
    retry: '重试', offline: '连接中断，内容可能已经更新。请重试。', noContent: '发布内容暂不可用。',
    page: '页面', fit: '适合屏幕', zoomIn: '放大', zoomOut: '缩小', expand: '展开画板', close: '关闭',
    snapshot: '这是一份发布快照；作者后续修改不会自动公开。',
  },
  en: {
    brand: 'Anjian', readOnly: 'Public share · Read only', published: 'Published', expires: 'Link expires',
    loading: 'Loading share…', unavailable: 'This share is unavailable', unavailableHelp: 'The link may have expired or been closed by its owner.',
    retry: 'Retry', offline: 'Connection interrupted. Content may have changed. Please retry.', noContent: 'Published content is unavailable.',
    page: 'Page', fit: 'Fit to screen', zoomIn: 'Zoom in', zoomOut: 'Zoom out', expand: 'Expand board', close: 'Close',
    snapshot: 'This is a published snapshot; later edits are not automatically public.',
  },
} as const;

function shareBase(pathname: string) {
  const match = /^\/s\/([A-Za-z0-9_-]{32,64})\/?$/.exec(pathname);
  return match ? `/s/${match[1]}` : null;
}

const none = new Set<string>();
const noRef = () => () => undefined;
const noLoad = () => undefined;

function Artboard({ data, copy }: { data: SharePayload; copy: typeof texts.zh | typeof texts.en }) {
  const canvas = data.canvas;
  const layout = data.layout;
  const [page, setPage] = useState(() => canvas?.activePage ?? canvas?.pages[0]?.id ?? '');
  const [viewport, setViewport] = useState({ width: innerWidth, height: Math.max(1, innerHeight - 112) });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const current = stage.current;
    if (!current) return;
    const observer = new ResizeObserver(() => setViewport({ width: current.clientWidth, height: current.clientHeight }));
    observer.observe(current);
    return () => observer.disconnect();
  }, []);
  const bounds = layout?.pages[page]?.bounds;
  const fit = useCallback(() => {
    if (bounds) setView(fitView(bounds, viewport, { top: 24, right: 24, bottom: 24, left: 24 }));
  }, [bounds, viewport]);
  useEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    if (canvas && !canvas.pages.some((entry) => entry.id === page))
      setPage(canvas.activePage ?? canvas.pages[0]?.id ?? '');
  }, [canvas, page]);
  useEffect(() => {
    if (!expanded) return;
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setExpanded(null); }
      if (event.key === 'Tab') { event.preventDefault(); close.current?.focus(); }
    };
    addEventListener('keydown', onKey);
    return () => { removeEventListener('keydown', onKey); returnFocus.current?.focus(); };
  }, [expanded]);
  if (!canvas || !layout || !bounds) return <div className="share-message">{copy.noContent}</div>;
  const boards = Object.entries(canvas.boards).filter(([, spec]) => spec.page === page);
  const selected = expanded ? canvas.boards[expanded] : null;
  const selectedFile = selected && (selected.type === 'image' || selected.type === 'video' ? selected.src : selected.file);
  const url = selectedFile ? `${data.contentBase}${selectedFile}` : null;
  return (
    <>
      <div className="share-artboard-toolbar">
        <label>{copy.page}
          <select aria-label={copy.page} value={page} onChange={(event) => setPage(event.target.value)}>
            {canvas.pages.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <div className="share-zoom">
          <button type="button" aria-label={copy.zoomOut} onClick={() => setView((old) => zoomAround(old, 0.8, viewport.width / 2, viewport.height / 2))}>−</button>
          <span aria-label={`${Math.round(view.k * 100)}%`}>{Math.round(view.k * 100)}%</span>
          <button type="button" aria-label={copy.zoomIn} onClick={() => setView((old) => zoomAround(old, 1.25, viewport.width / 2, viewport.height / 2))}>+</button>
          <button type="button" onClick={fit}>{copy.fit}</button>
        </div>
      </div>
      <div
        ref={stage}
        className="share-canvas"
        onWheel={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.ctrlKey || event.metaKey) setView((old) => zoomAround(old, Math.exp(-event.deltaY * 0.008), event.clientX - rect.left, event.clientY - rect.top));
          else setView((old) => ({ ...old, x: old.x - event.deltaX, y: old.y - event.deltaY }));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const dx = event.clientX - drag.current.x;
          const dy = event.clientY - drag.current.y;
          drag.current = { x: event.clientX, y: event.clientY };
          setView((old) => ({ ...old, x: old.x + dx, y: old.y + dy }));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <Canvas
          boards={boards}
          notes={Object.entries(canvas.notes ?? {}).filter(([, note]) => note.page === page)}
          view={view}
          contentBase={data.contentBase}
          versions={data.versions ?? {}}
          pending={none}
          playing={none}
          replays={{}}
          inspecting={false}
          frameRef={noRef}
          frameLoaded={noLoad}
          boardSandbox="allow-scripts"
        />
      </div>
      <div className="share-board-list" aria-label={copy.expand}>
        {boards.map(([id, board]) => (
          <button key={id} type="button" onClick={(event) => { returnFocus.current = event.currentTarget; setExpanded(id); }} aria-label={`${copy.expand}：${board.title ?? id}`}>
            {board.title ?? id}
          </button>
        ))}
      </div>
      {selected && url && (
        <div className="share-expanded" role="dialog" aria-modal="true" aria-label={selected.title ?? expanded ?? copy.expand}>
          <div className="share-expanded-head"><strong>{selected.title ?? expanded}</strong><button ref={close} type="button" onClick={() => setExpanded(null)}>{copy.close}</button></div>
          <div className="share-expanded-body">
            {selected.type === 'image' ? <img src={url} alt={selected.title ?? expanded ?? ''} /> : selected.type === 'video' ? <video controls src={url} /> : <iframe title={selected.title ?? expanded ?? ''} sandbox="allow-scripts" referrerPolicy="no-referrer" src={url} style={{ width: selected.w, height: selected.h }} />}
          </div>
        </div>
      )}
    </>
  );
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
    <div className="share-page">
      <header className="share-header">
        <span className="share-brand"><svg aria-hidden="true" viewBox={ANJIAN_MARK_VIEWBOX} dangerouslySetInnerHTML={{ __html: ANJIAN_MARK_BODY }} />{copy.brand}</span>
        <span className="share-readonly">{copy.readOnly}</span>
      </header>
      {data && (state === 'ready' || state === 'offline') ? (
        <>
          <div className="share-info"><div><strong>{data.title}</strong><small>{copy.published} {date(data.publishedAt)}{data.expiresAt ? ` · ${copy.expires} ${date(data.expiresAt)}` : ''}</small></div><span>{copy.readOnly}</span></div>
          {state === 'offline' && <div className="share-alert" role="alert">{copy.offline} <button type="button" onClick={() => void load()}>{copy.retry}</button></div>}
          <main className="share-main">
            {data.type === 'artboard' ? <Artboard data={data} copy={copy} /> : data.type === 'html' ? (
              <iframe className="share-html" title={data.title} src={`${data.contentBase}index.html`} sandbox="allow-scripts" referrerPolicy="no-referrer" />
            ) : data.state ? (
              <Suspense fallback={<div className="share-message">{copy.loading}</div>}><PublicDocument key={data.contentBase} contentBase={data.contentBase} state={data.state} /></Suspense>
            ) : <div className="share-message">{copy.noContent}</div>}
          </main>
          <footer className="share-footer">{copy.snapshot}</footer>
        </>
      ) : <main className="share-message" role={state === 'loading' ? 'status' : 'alert'}>
        <div><h1>{state === 'loading' ? copy.loading : copy.unavailable}</h1>{state !== 'loading' && <><p>{copy.unavailableHelp}</p><button type="button" onClick={() => void load()}>{copy.retry}</button></>}</div>
      </main>}
    </div>
  );
}
