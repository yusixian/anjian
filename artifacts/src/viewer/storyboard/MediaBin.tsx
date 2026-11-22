import { AudioLines, FileImage, Film, FolderOpen, Plus, Upload } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import type { StoryboardAsset } from '../../shared/storyboard';
import { useStoryboardCopy } from './copy';
import { assetUrl, fileName, isStill } from './timeline-utils';

export function MediaBin({
  url,
  assets,
  selected,
  onSelect,
  onAdd,
  onImport,
}: {
  url: string;
  assets: StoryboardAsset[];
  selected?: string;
  onSelect: (asset: StoryboardAsset) => void;
  onAdd: (asset: StoryboardAsset, duration?: number) => void;
  onImport: (asset: StoryboardAsset) => void;
}) {
  const c = useStoryboardCopy();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const addLatestRef = useRef(onAdd);
  const probingRef = useRef(false);
  const [pending, setPending] = useState('');
  useLayoutEffect(() => {
    addLatestRef.current = onAdd;
  }, [onAdd]);
  async function add(asset: StoryboardAsset) {
    if (probingRef.current) return;
    if (isStill(asset.path)) {
      onAdd(asset);
      return;
    }
    probingRef.current = true;
    setPending(asset.path);
    const media = document.createElement(asset.kind === 'audio' ? 'audio' : 'video');
    const ms = await new Promise<number | undefined>((resolve) => {
      const timer = window.setTimeout(() => resolve(undefined), 3000);
      media.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(
          Number.isFinite(media.duration) && media.duration > 0
            ? Math.floor(media.duration * 1000)
            : undefined,
        );
      };
      media.onerror = () => {
        clearTimeout(timer);
        resolve(undefined);
      };
      media.preload = 'metadata';
      media.src = assetUrl(url, asset.path);
    });
    media.onloadedmetadata = null;
    media.onerror = null;
    media.removeAttribute('src');
    media.load();
    probingRef.current = false;
    setPending('');
    addLatestRef.current(asset, ms);
  }
  async function upload(files: File[]) {
    if (uploadingRef.current || !files.length) return;
    uploadingRef.current = true;
    setBusy(true);
    setError('');
    const failures: string[] = [];
    for (const file of files) {
      try {
        const response = await fetch(url + '/assets?name=' + encodeURIComponent(file.name), {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(typeof data?.error === 'string' ? data.error : response.statusText);
        }
        const data: { asset: StoryboardAsset } = await response.json();
        onImport(data.asset);
      } catch (err) {
        failures.push(file.name + (err instanceof Error ? ' · ' + err.message : ''));
      }
    }
    setError(failures.join(' / '));
    uploadingRef.current = false;
    setBusy(false);
  }
  return (
    <aside aria-label={c.media} className="sb-media sb-panel">
      <header className="sb-panel-head">
        <h2>
          <FolderOpen size={17} />
          {c.media}
        </h2>
        <span aria-label={c.mediaCount} className="sb-count">
          {assets.length}
        </span>
      </header>
      <input
        hidden
        multiple
        accept=".png,.jpg,.jpeg,.mp4,.webm,.wav,.mp3,.m4a"
        ref={inputRef}
        type="file"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          void upload(files);
        }}
      />
      <button
        className="sb-import"
        disabled={busy}
        type="button"
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={16} />
        {busy ? c.importing : c.import}
      </button>
      {error && (
        <p className="sb-alert" role="alert">
          {c.importFailed} {error}
        </p>
      )}
      {!assets.length && <p className="sb-empty">{c.noMedia}</p>}
      <div className="sb-assets">
        {assets.map((asset) => {
          const Icon = asset.kind === 'audio' ? AudioLines : isStill(asset.path) ? FileImage : Film;
          return (
            <div className="sb-asset" data-selected={selected === asset.path} key={asset.path}>
              <button
                aria-pressed={selected === asset.path}
                className="sb-asset-select"
                title={fileName(asset.path, asset.name)}
                type="button"
                onClick={() => onSelect(asset)}
              >
                <span className="sb-asset-icon" data-kind={asset.kind}>
                  {isStill(asset.path) ? (
                    <img alt="" loading="lazy" src={assetUrl(url, asset.path)} />
                  ) : (
                    <Icon size={20} />
                  )}
                </span>
                <span className="sb-asset-info">
                  <strong>{fileName(asset.path, asset.name)}</strong>
                  <small>
                    {asset.path.split('.').pop()?.toUpperCase()} ·{' '}
                    {asset.bytes >= 1048576
                      ? (asset.bytes / 1048576).toFixed(1) + ' MB'
                      : Math.max(1, Math.round(asset.bytes / 1024)) + ' KB'}
                  </small>
                </span>
              </button>
              <button
                aria-label={c.addClip + ' · ' + fileName(asset.path, asset.name)}
                className="sb-icon"
                disabled={!!pending}
                title={c.addClip}
                type="button"
                onClick={() => void add(asset)}
              >
                <Plus size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
