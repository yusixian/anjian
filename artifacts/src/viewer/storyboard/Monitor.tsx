import { AudioLines, Clapperboard, Download, Film } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { StoryboardAsset, StoryboardClip, StoryboardJob } from '../../shared/storyboard';
import { useStoryboardCopy } from './copy';
import { assetUrl, fileName, isStill, timecode } from './timeline-utils';

interface RevisionJob {
  job: StoryboardJob;
  mediaRevision: string;
  revision: string;
}

function restoreJob(key: string, revision: string, mediaRevision: string): RevisionJob | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as RevisionJob | null;
    return value?.revision === revision &&
      value.mediaRevision === mediaRevision &&
      typeof value.job?.id === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}

function SourceMedia({
  asset,
  url,
  clip,
  onDuration,
}: {
  asset: StoryboardAsset;
  url: string;
  clip?: StoryboardClip;
  onDuration: (path: string, ms: number) => void;
}) {
  const c = useStoryboardCopy();
  const [failed, setFailed] = useState(false);
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const start = (clip?.trimMs ?? 0) / 1000;
  const end = clip ? start + clip.durationMs / 1000 : Infinity;
  const src = assetUrl(url, asset.path);
  useEffect(() => {
    if (mediaRef.current?.readyState) {
      mediaRef.current.pause();
      mediaRef.current.currentTime = start;
    }
  }, [clip?.id, start]);
  if (failed) return <span role="alert">{c.fileUnavailable}</span>;
  if (isStill(asset.path))
    return <img alt={fileName(asset.path, asset.name)} src={src} onError={() => setFailed(true)} />;
  const props = {
    'ref': mediaRef,
    src,
    'controls': true,
    'preload': 'metadata',
    'aria-label': fileName(asset.path, asset.name),
    'onError': () => setFailed(true),
    'onLoadedMetadata': () => {
      if (!mediaRef.current) return;
      const ms = Math.floor(mediaRef.current.duration * 1000);
      if (Number.isFinite(ms) && ms > 0) onDuration(asset.path, ms);
      mediaRef.current.currentTime = start;
    },
    'onPlay': () => {
      const node = mediaRef.current;
      if (node && (node.currentTime < start || node.currentTime >= end - 0.02))
        node.currentTime = start;
    },
    'onTimeUpdate': () => {
      const node = mediaRef.current;
      if (node && !node.paused && node.currentTime >= end) {
        node.pause();
        node.currentTime = end;
      }
    },
  };
  return asset.kind === 'audio' ? (
    <div className="sb-audio">
      <AudioLines size={56} />
      <audio {...props} />
    </div>
  ) : (
    <video {...props} playsInline />
  );
}

export function Monitor({
  url,
  revision,
  dirty,
  asset,
  clip,
  duration,
  onDuration,
  save,
  canRender,
  readOnly,
  sourceVersion,
  mediaRevision,
}: {
  url: string;
  revision: string;
  dirty: boolean;
  asset?: StoryboardAsset;
  clip?: StoryboardClip;
  duration: number;
  onDuration: (path: string, ms: number) => void;
  save: () => Promise<string | null>;
  canRender: boolean;
  readOnly: boolean;
  sourceVersion: number;
  mediaRevision: string;
}) {
  const c = useStoryboardCopy();
  const storageKey = 'anjian.storyboard.render:' + url;
  const [render, setRender] = useState(() => restoreJob(storageKey, revision, mediaRevision));
  const [output, setOutput] = useState(readOnly || render?.job.status === 'ready');
  const lastSourceRef = useRef(sourceVersion);
  useEffect(() => {
    if (lastSourceRef.current !== sourceVersion) setOutput(false);
    lastSourceRef.current = sourceVersion;
  }, [sourceVersion]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [playbackError, setPlaybackError] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const lockRef = useRef(false);
  const job =
    render?.revision === revision && render.mediaRevision === mediaRevision && !dirty
      ? render.job
      : null;
  const running = job?.status === 'queued' || job?.status === 'running';
  const jobUrl = job && url + '/render/' + encodeURIComponent(job.id);

  useEffect(() => {
    try {
      if (render) sessionStorage.setItem(storageKey, JSON.stringify(render));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage may be disabled. */
    }
  }, [storageKey, render]);
  useEffect(() => {
    if (!running || !jobUrl) return;
    const abort = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const response = await fetch(jobUrl!, { cache: 'no-store', signal: abort.signal });
        if (!response.ok) {
          if (response.status === 404 && !abort.signal.aborted) setRender(null);
          throw new Error(response.statusText);
        }
        const update: StoryboardJob = await response.json();
        if (abort.signal.aborted) return;
        setPollFailed(false);
        setRender({ revision, mediaRevision, job: update });
        if (update.status === 'running' || update.status === 'queued')
          timer = window.setTimeout(poll, 800);
      } catch {
        if (!abort.signal.aborted) setPollFailed(true);
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [running, jobUrl, revision, mediaRevision, pollAttempt]);

  async function start() {
    if (lockRef.current) return;
    lockRef.current = true;
    setStarting(true);
    setPlaybackError(false);
    setError('');
    setPollFailed(false);
    try {
      const saved = dirty ? await save() : revision;
      if (!saved) return;
      setOutput(true);
      const res = await fetch(url + '/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: saved }),
      });
      if (!res.ok) {
        const details = await res.json().catch(() => null);
        throw new Error(typeof details?.error === 'string' ? details.error : res.statusText);
      }
      setRender({ revision: saved, mediaRevision, job: await res.json() });
    } catch (err) {
      setError(err instanceof Error ? err.message : c.renderFailed);
    } finally {
      lockRef.current = false;
      setStarting(false);
    }
  }
  const videoUrl = job?.status === 'ready' ? jobUrl + '/video' : null;
  const busy = starting || running;
  const notice = error
    ? c.renderFailed + ' ' + error
    : job?.status === 'failed'
      ? c.renderFailed + ' ' + (job.error ?? '')
      : '';
  return (
    <section aria-label={c.preview} className="sb-monitor sb-panel">
      <header className="sb-panel-head">
        <h2>
          <Film size={17} />
          {c.preview}
        </h2>
        <div className="sb-tabs">
          <button aria-pressed={!output} type="button" onClick={() => setOutput(false)}>
            {c.source}
          </button>
          <button aria-pressed={output} type="button" onClick={() => setOutput(true)}>
            {c.output}
          </button>
        </div>
      </header>
      <div className="sb-screen">
        <div className="sb-frame">
          {output && videoUrl ? (
            <video
              controls
              playsInline
              aria-label={c.output}
              key={videoUrl}
              src={videoUrl}
              onError={() => {
                setPlaybackError(true);
              }}
            />
          ) : !output && asset ? (
            <SourceMedia
              asset={asset}
              clip={clip}
              key={asset.path}
              url={url}
              onDuration={onDuration}
            />
          ) : (
            <div className="sb-screen-hint">
              <Clapperboard size={35} strokeWidth={1.25} />
              <span>
                {output
                  ? running
                    ? job.status === 'queued'
                      ? c.queued
                      : c.rendering
                    : c.renderFirst
                  : c.emptyMonitor}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="sb-monitor-foot">
        <span className="sb-timecode" title={c.durationLabel}>
          {timecode(output ? duration : (clip?.durationMs ?? 0))}
        </span>
        <span className="sb-monitor-name" title={asset && fileName(asset.path, asset.name)}>
          {output ? c.output : asset && fileName(asset.path, asset.name)}
        </span>
        {videoUrl && (
          <a download className="sb-button" href={videoUrl + '?download=1'}>
            <Download size={15} />
            {c.download}
          </a>
        )}
        <button
          className="sb-button sb-ink"
          disabled={busy || !canRender}
          type="button"
          onClick={() => void start()}
        >
          <Clapperboard size={15} />
          {busy ? c.rendering : dirty ? c.renderSaved : c.render}
        </button>
      </div>
      {playbackError && output && videoUrl && (
        <p className="sb-alert" role="alert">
          {c.fileUnavailable}
        </p>
      )}
      {notice && (
        <p className="sb-alert" role="alert">
          {notice}
        </p>
      )}
      {pollFailed && (
        <p className="sb-alert" role="alert">
          {c.pollFailed}{' '}
          <button
            type="button"
            onClick={() => (running ? setPollAttempt((n) => n + 1) : void start())}
          >
            {c.retry}
          </button>
        </p>
      )}
    </section>
  );
}
