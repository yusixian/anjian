import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, Copy, ExternalLink, Share2 } from 'lucide-react';
import { type MouseEvent, type Ref, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ArtifactType } from '../../shared/types';
import { useTranslation } from '../i18n';

interface ShareRecord { expiresAt: number | null; publishedAt: number; url: string }
interface ShareReferenceChoice {
  key: string;
  label: string;
  nested?: boolean;
  reason?: 'unavailable' | 'unsupported' | 'cycle';
  revision?: string;
  type: ArtifactType;
  wholeArtifact?: boolean;
}
interface ShareReferencePreview { choices: ShareReferenceChoice[]; revision: string; truncated?: boolean }
interface ShareReferenceSelection { choices: { key: string; revision: string }[]; revision: string }
interface ShareResponse { referencePreview?: ShareReferencePreview; share: ShareRecord | null; title: string }
type Action = 'publish' | 'revoke' | 'rotate';
type Expiry = 1 | 7 | 30 | null;

const styles = stylex.create({
  trigger: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    minHeight: 34, paddingInline: 10, borderWidth: 0, borderRadius: 6,
    backgroundColor: { default: 'transparent', ':hover': cssVar.colorFillTertiary },
    color: cssVar.colorText, fontFamily: cssVar.fontFamily, fontSize: 13, cursor: 'pointer',
    '@media (max-width: 560px)': { minWidth: 44, minHeight: 44 },
  },
  triggerLabel: { '@media (max-width: 560px)': { display: 'none' } },
  cardTrigger: {
    position: 'absolute', zIndex: 2, top: 9, insetInlineEnd: 9, width: 32, height: 32,
    padding: 0, borderWidth: 1, borderStyle: 'solid', borderColor: cssVar.colorBorder,
    backgroundColor: cssVar.colorBgElevated,
    '@media (hover: none)': { width: 44, height: 44 },
  },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center',
    padding: 16, backgroundColor: 'rgba(0,0,0,.68)',
  },
  dialog: {
    width: 'min(100%, 560px)', maxHeight: 'min(760px, calc(100dvh - 32px))', overflowY: 'auto',
    boxSizing: 'border-box', padding: 24, borderWidth: 1, borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary, borderRadius: 12,
    backgroundColor: cssVar.colorBgElevated, color: cssVar.colorText,
    fontFamily: cssVar.fontFamily, fontSize: 13,
    '@media (max-width: 560px)': { padding: 18 },
  },
  title: { fontSize: 19, lineHeight: '26px', fontWeight: 600, margin: 0 },
  subtitle: { color: cssVar.colorTextSecondary, lineHeight: '20px', marginBlock: '5px 20px' },
  heading: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  badge: {
    flexShrink: 0, paddingBlock: 3, paddingInline: 8, borderWidth: 1, borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary, borderRadius: 6,
    color: cssVar.colorTextSecondary, fontSize: 11,
  },
  section: { paddingBlock: 16, borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: cssVar.colorBorderSecondary },
  label: { display: 'block', marginBottom: 9, fontWeight: 600 },
  option: {
    display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', marginBlock: 10,
    padding: 13, boxSizing: 'border-box', borderWidth: 1, borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary, borderRadius: 8, lineHeight: '19px',
  },
  references: { minInlineSize: 0, margin: 0, padding: 0, borderWidth: 0 },
  referenceLabel: { minInlineSize: 0, overflowWrap: 'anywhere' },
  selected: { borderColor: cssVar.colorText },
  radio: { margin: 2, accentColor: cssVar.colorText },
  small: { display: 'block', marginTop: 4, color: cssVar.colorTextSecondary, fontSize: 12, lineHeight: '18px' },
  select: {
    minHeight: 38, paddingInline: 10, borderWidth: 1, borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary, borderRadius: 6,
    backgroundColor: cssVar.colorFillTertiary, color: cssVar.colorText,
    fontFamily: cssVar.fontFamily, fontSize: 13,
  },
  link: {
    display: 'block', overflowWrap: 'anywhere', marginTop: 12, padding: 12, borderWidth: 1,
    borderStyle: 'solid', borderColor: cssVar.colorBorderSecondary, borderRadius: 6,
    backgroundColor: cssVar.colorFillTertiary, color: cssVar.colorTextSecondary, fontSize: 12,
  },
  warning: { color: cssVar.colorTextSecondary, fontSize: 12, lineHeight: '19px' },
  error: { color: cssVar.colorError, fontSize: 12, lineHeight: '19px' },
  actions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  spacer: { flex: 1 },
  button: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 36, paddingInline: 12, borderWidth: 1, borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary, borderRadius: 7,
    backgroundColor: cssVar.colorFillTertiary, color: cssVar.colorText,
    fontFamily: cssVar.fontFamily, fontSize: 13, fontWeight: 500, cursor: 'pointer',
    '@media (max-width: 560px)': { minHeight: 44 },
  },
  primary: { backgroundColor: cssVar.colorText, color: cssVar.colorBgElevated, borderColor: cssVar.colorText },
  danger: { color: cssVar.colorError },
});

async function getShare(type: ArtifactType, id: string, project?: string): Promise<ShareResponse> {
  const query = new URLSearchParams({ type, id });
  if (project) query.set('project', project);
  const response =
    type === 'document'
      ? await fetch('/api/hub/share', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ type, id, project, action: 'preview' }),
        })
      : await fetch(`/api/hub/share?${query}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<ShareResponse>;
}

class ShareQuotaError extends Error {}

async function changeShare(type: ArtifactType, id: string, action: Action, expiry: Expiry | undefined, project?: string, referenceSelection?: ShareReferenceSelection): Promise<ShareResponse> {
  const response = await fetch('/api/hub/share', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ type, id, project, action, expiresInDays: expiry, referenceSelection }),
  });
  if (!response.ok) {
    if (response.status === 413) {
      const failure = await response.json().catch(() => null);
      if (failure?.code === 'storage_quota_exceeded') throw new ShareQuotaError();
    }
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<ShareResponse>;
}

export function ShareButton({ type, id, project, card = false }: {
  type: ArtifactType; id: string; project?: string; card?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ShareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [expiry, setExpiry] = useState<Expiry>(7);
  const [selectedReferences, setSelectedReferences] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<'revoke' | 'rotate' | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const requestId = useRef(0);
  const inFlight = useRef(false);
  const referencePreview = type === 'document' ? data?.referencePreview : undefined;

  const load = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const next = await getShare(type, id, project);
      if (request === requestId.current) { setData(next); setSelectedReferences(new Set()); setUncertain(false); }
    } catch {
      if (request === requestId.current) { setUncertain(true); setError(t('share.loadFailed')); }
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [type, id, project, t]);

  useEffect(() => {
    if (open) void load();
    return () => { requestId.current++; };
  }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => (confirm ? cancelRef.current : dialogRef.current)?.focus());
    return () => { cancelAnimationFrame(frame); previous?.focus(); };
  }, [open, confirm]);

  const close = () => { if (!busy) { setOpen(false); setConfirm(null); setCopied(false); triggerRef.current?.focus(); } };
  const act = async (action: Action) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const referenceSelection = action === 'publish' && referencePreview ? {
        revision: referencePreview.revision,
        choices: referencePreview.choices.flatMap(({ key, revision, reason }) =>
          revision && !reason && selectedReferences.has(key) ? [{ key, revision }] : []),
      } : undefined;
      const next = await changeShare(type, id, action, action === 'publish' && data?.share ? undefined : expiry, project, referenceSelection);
      setData({ ...next, referencePreview });
      if (action === 'revoke') setSelectedReferences(new Set());
      setUncertain(false);
      setConfirm(null);
    } catch (failure) {
      // The server may have committed a change before its response was lost.
      // Re-read status before offering the action again.
      try {
        const next = await getShare(type, id, project);
        const referencesChanged = referencePreview?.revision !== next.referencePreview?.revision ||
          referencePreview?.choices.some(({ key, revision }) => selectedReferences.has(key) &&
            !next.referencePreview?.choices.some((choice) => choice.key === key && choice.revision === revision && !choice.reason));
        if (referencesChanged) setSelectedReferences(new Set());
        setData(next);
        setUncertain(false);
        setConfirm(null);
        const message = failure instanceof ShareQuotaError ? 'share.quotaExceeded'
          : referencesChanged ? 'share.referencesChanged' : 'share.actionUnconfirmed';
        setError(t(message));
      } catch {
        setUncertain(true);
        setError(t('share.actionUnknown'));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!data?.share) return;
    try { await navigator.clipboard.writeText(new URL(data.share.url, location.origin).href); setCopied(true); }
    catch { setError(t('share.copyFailed')); }
  };
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setData(null);
    setError('');
    setLoading(true);
    setOpen(true);
  };
  const share = data?.share;
  const absoluteUrl = share ? new URL(share.url, location.origin).href : '';
  const format = (value: number) => new Date(value).toLocaleString(i18n.language);
  const button = (label: string, onClick: () => void, kind: 'plain' | 'primary' | 'danger' = 'plain', disabled = false, reference?: Ref<HTMLButtonElement>) => (
    <button ref={reference} disabled={disabled || busy} type="button" {...stylex.props(styles.button, kind === 'primary' && styles.primary, kind === 'danger' && styles.danger)} onClick={onClick}>{label}</button>
  );

  return <>
    <button
      ref={triggerRef} aria-label={t('share.trigger')} title={t('share.trigger')} type="button"
      {...stylex.props(styles.trigger, card && styles.cardTrigger)} onClick={click}
    >
      <Share2 aria-hidden="true" size={16} />{card ? null : <span {...stylex.props(styles.triggerLabel)}>{t('share.trigger')}</span>}
    </button>
    {open && createPortal(
      <div {...stylex.props(styles.overlay)}>
        <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('share.title')}
          {...stylex.props(styles.dialog)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) { event.stopPropagation(); close(); }
            if (event.key !== 'Tab') return;
            const items = [...dialogRef.current!.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input[type=checkbox]:not(:disabled),a[href]')];
            if (!items.length) { event.preventDefault(); return; }
            if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === dialogRef.current)) { event.preventDefault(); items.at(-1)!.focus(); }
            else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]!.focus(); }
          }}>
          <div {...stylex.props(styles.heading)}><h2 {...stylex.props(styles.title)}>{t('share.title')}</h2><span {...stylex.props(styles.badge)}>{t(share ? 'share.public' : 'share.private')}</span></div>
          <p {...stylex.props(styles.subtitle)}>{data?.title ?? t('share.subtitle')}</p>
          {loading && <p role="status">{t('share.loading')}</p>}
          {error && <p role="alert" {...stylex.props(styles.error)}>{error}</p>}
          {!data && <div {...stylex.props(styles.actions)}>
            {button(t('share.close'), close, 'plain', false, cancelRef)}
            {!loading && button(t('share.retry'), () => void load())}
          </div>}
          {data && uncertain && !loading && button(t('share.retry'), () => void load())}
          {data && confirm ? <>
            <div {...stylex.props(styles.section)}><h3>{t(confirm === 'revoke' ? 'share.revokeConfirmTitle' : 'share.rotateConfirmTitle')}</h3>
              <p {...stylex.props(styles.warning)}>{t(confirm === 'revoke' ? 'share.revokeImpact' : 'share.rotateImpact')}</p></div>
            <div {...stylex.props(styles.actions)}>
              {button(t('share.cancel'), () => setConfirm(null), 'plain', false, cancelRef)}
              {button(t(confirm === 'revoke' ? 'share.revoke' : 'share.rotate'), () => void act(confirm), 'danger', uncertain || loading)}
            </div>
          </> : data && <>
            <div {...stylex.props(styles.section)}>
              <b {...stylex.props(styles.label)}>{t('share.access')}</b>
              <div {...stylex.props(styles.option, !share && styles.selected)}>
                <input aria-label={t('share.private')} checked={!share} readOnly tabIndex={-1} type="radio" {...stylex.props(styles.radio)} />
                <span><strong>{t('share.private')}</strong><small {...stylex.props(styles.small)}>{t('share.privateHelp')}</small></span>
              </div>
              <div {...stylex.props(styles.option, share && styles.selected)}>
                <input aria-label={t('share.public')} checked={!!share} readOnly tabIndex={-1} type="radio" {...stylex.props(styles.radio)} />
                <span><strong>{t('share.public')}</strong><small {...stylex.props(styles.small)}>{t('share.publicHelp')}</small></span>
              </div>
            </div>
            <div {...stylex.props(styles.section)}>
              <b {...stylex.props(styles.label)}>{t('share.contents')}</b>
              <p {...stylex.props(styles.warning)}>{t(referencePreview?.choices.length ? 'share.documentSnapshotHelp' : 'share.snapshotHelp')}</p>
              {referencePreview && (referencePreview.choices.length > 0 || referencePreview.truncated) && (
                <fieldset disabled={busy || loading || uncertain} aria-describedby={`${fieldId}-references`} {...stylex.props(styles.references)}>
                  <legend {...stylex.props(styles.label)}>{t('share.references')}</legend>
                  <p id={`${fieldId}-references`} {...stylex.props(styles.warning)}>{t('share.referencesHelp')}</p>
                  {referencePreview.choices.map(({ key, label, type: referenceType, revision, reason, wholeArtifact, nested }, index) => {
                    const checked = selectedReferences.has(key) && !!revision && !reason;
                    const nameId = `${fieldId}-reference-${index}`;
                    const descriptionId = `${nameId}-description`;
                    return <label key={key} {...stylex.props(styles.option, checked && styles.selected)}>
                      <input type="checkbox" checked={checked} disabled={!!reason || !revision}
                        aria-labelledby={nameId} aria-describedby={descriptionId}
                        {...stylex.props(styles.radio)}
                        onChange={(event) => {
                          const include = event.target.checked;
                          setSelectedReferences((current) => {
                            const next = new Set(current);
                            if (include) next.add(key);
                            else next.delete(key);
                            return next;
                          });
                        }} />
                      <span {...stylex.props(styles.referenceLabel)}>
                        <strong id={nameId}>{label || `${t(`type.${referenceType}`)} ${index + 1}`}</strong>
                        <small id={descriptionId} {...stylex.props(styles.small)}>
                          {t(`type.${referenceType}`)}
                          {reason || !revision ? <><br />{t(`share.referenceReasons.${reason ?? 'unavailable'}`)}</> : <>
                            {wholeArtifact && <><br />{t('share.wholeArtboard')}</>}
                            {nested && <><br />{t('share.nestedReferences')}</>}
                          </>}
                        </small>
                      </span>
                    </label>;
                  })}
                  {referencePreview.truncated && <p {...stylex.props(styles.warning)}>{t('share.referencesTruncated')}</p>}
                </fieldset>
              )}
              {share ? <>
                <span {...stylex.props(styles.link)}>{absoluteUrl}</span>
                <p {...stylex.props(styles.warning)}>{t('share.publishedAt', { date: format(share.publishedAt) })}<br />
                  {share.expiresAt ? t('share.expiresAt', { date: format(share.expiresAt) }) : t('share.noExpiry')}</p>
                <div {...stylex.props(styles.actions)}>
                  <button type="button" disabled={busy} {...stylex.props(styles.button, styles.primary)} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{t(copied ? 'share.copied' : 'share.copy')}</button>
                  <a href={absoluteUrl} rel="noopener noreferrer" target="_blank" {...stylex.props(styles.button)}><ExternalLink size={14} />{t('share.preview')}</a>
                </div>
              </> : <>
                <label htmlFor={`${fieldId}-expiry`} {...stylex.props(styles.label)}>{t('share.validFor')}</label>
                <select id={`${fieldId}-expiry`} value={expiry ?? 'never'} {...stylex.props(styles.select)} onChange={(event) => setExpiry(event.target.value === 'never' ? null : Number(event.target.value) as Expiry)}>
                  <option value={1}>{t('share.oneDay')}</option><option value={7}>{t('share.sevenDays')}</option>
                  <option value={30}>{t('share.thirtyDays')}</option><option value="never">{t('share.never')}</option>
                </select>
              </>}
            </div>
            <p {...stylex.props(styles.warning)}>{t('share.copyWarning')}</p>
            <div {...stylex.props(styles.actions)}>
              {button(t('share.close'), close, 'plain', false, cancelRef)}
              <span {...stylex.props(styles.spacer)} />
              {share ? <>
                {button(t('share.rotate'), () => setConfirm('rotate'), 'plain', uncertain || loading)}
                {button(t('share.revoke'), () => setConfirm('revoke'), 'danger', uncertain || loading)}
                {button(t('share.update'), () => void act('publish'), 'primary', uncertain || loading)}
              </> : button(t('share.create'), () => void act('publish'), 'primary', uncertain || loading)}
            </div>
          </>}
        </section>
      </div>, document.body)}
  </>;
}
