import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRight } from 'lucide-react';
import { createContext, use, useContext, useEffect, useState } from 'react';

import type { ArtifactReference } from '../../shared/artifact-reference';
import { TypeIcon } from '../components/TypeIcon';
import { useTranslation } from '../i18n';
import { DynamicHostContext } from './DynamicBlock';

export type ArtifactReferenceResolver = (
  reference: ArtifactReference,
  signal: AbortSignal,
) => Promise<Partial<Result> | null>;
export const LiveReferenceContext = createContext<ArtifactReferenceResolver | null>(null);
export const OpenDocumentBlockContext = createContext<
  ((href: string, title: string, trigger: HTMLAnchorElement) => boolean) | null
>(null);

const styles = stylex.create({
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingBlock: 12,
    paddingInline: 16,
    marginBlock: 8,
    border: '1px solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 8,
    color: cssVar.colorText,
    fontFamily: cssVar.fontFamily,
    textDecoration: 'none',
  },
  link: {
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillTertiary },
    outlineOffset: 2,
  },
  body: { display: 'grid', flexGrow: 1, gap: 2, minWidth: 0, overflowWrap: 'anywhere' },
  meta: { color: cssVar.colorTextSecondary, fontSize: 12 },
});

type Review = 'pending' | 'pass' | 'reject';
type ReviewSummary = Record<Review | 'unavailable', number>;
interface Result {
  blockMissing?: true;
  blockTitle?: string;
  choice?: string | null;
  href: string;
  review?: Review;
  reviewSummary?: ReviewSummary;
  title: string;
}

function readResult(
  value: Partial<Result>,
  path: string,
  kind: NonNullable<ArtifactReference['focus']>['kind'] | undefined,
  id: string | undefined,
  expectedGroups: number,
): Result | null {
  if (typeof value.href !== 'string' || typeof value.title !== 'string') return null;
  const url = new URL(value.href, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    url.pathname !== path ||
    value.href !== url.pathname + url.search ||
    url.searchParams.get('ref') !== '1'
  )
    return null;
  for (const [key, val] of url.searchParams) {
    if (key === 'page' || (key === 'ref' && val === '1') || (key === kind && val === id)) continue;
    return null;
  }
  const blockMissing = kind === 'block' && value.blockMissing === true;
  if (kind && url.searchParams.get(kind) !== (blockMissing ? null : id)) return null;
  const choice = value.choice;
  const review = value.review;
  const reviewSummary = value.reviewSummary;
  if (expectedGroups) {
    const counts = reviewSummary && [
      reviewSummary.pass,
      reviewSummary.reject,
      reviewSummary.pending,
      reviewSummary.unavailable,
    ];
    if (
      !counts ||
      counts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
      counts.reduce((sum, n) => sum + n, 0) !== expectedGroups
    )
      return null;
  }
  return {
    ...(blockMissing ? { blockMissing: true } : {}),
    ...(kind === 'block' && !blockMissing && typeof value.blockTitle === 'string'
      ? { blockTitle: value.blockTitle }
      : {}),
    href: url.href,
    title: value.title,
    ...(kind === 'group' && (choice === null || typeof choice === 'string') ? { choice } : {}),
    ...(expectedGroups ? { reviewSummary } : {}),
    review: review === 'pending' || review === 'pass' || review === 'reject' ? review : undefined,
  };
}

export function ArtifactReferenceCard({ reference }: { reference: ArtifactReference }) {
  const resolve = useContext(LiveReferenceContext);
  const openDocumentBlock = useContext(OpenDocumentBlockContext);
  const channel = use(DynamicHostContext)?.channel;
  const { t } = useTranslation();
  const { type, target, focus, label } = reference;
  const query = focus ? '?' + new URLSearchParams([[focus.kind, focus.id]]) : '';
  const path = '/' + type + '/' + encodeURIComponent(target);
  const groupsKey = reference.reviewGroups?.join(',') ?? '';
  const endpoint = path + query + (groupsKey ? '?groups=' + groupsKey : '');
  const [state, setState] = useState<{ endpoint: string; result: Result | null } | null>(null);
  const kind = focus?.kind;
  const id = focus?.id;

  useEffect(() => {
    if (!resolve) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    let request = 0;
    const load = async () => {
      const current = ++request;
      let result: Result | null = null;
      try {
        const reviewGroups = groupsKey ? groupsKey.split(',') : undefined;
        const value = await resolve(
          {
            type,
            target,
            ...(kind && id ? { focus: { kind, id } } : {}),
            ...(reviewGroups ? { reviewGroups } : {}),
          },
          controller.signal,
        );
        if (value) result = readResult(value, path, kind, id, reviewGroups?.length ?? 0);
      } catch {
        // Access failures and missing targets share the same presentation.
      }
      if (!controller.signal.aborted && current === request) setState({ endpoint, result });
    };
    void load();
    window.addEventListener('focus', load);
    window.addEventListener('pageshow', load);
    const unsubscribe = channel?.subscribe((event) => {
      if (event.type === 'refresh') void load();
    });
    return () => {
      controller.abort();
      window.removeEventListener('focus', load);
      window.removeEventListener('pageshow', load);
      unsubscribe?.();
    };
  }, [resolve, endpoint, path, kind, id, type, target, groupsKey, channel]);

  const resolved = resolve && state?.endpoint === endpoint ? state.result : null;
  const loading = resolve && state?.endpoint !== endpoint;
  const fallback = resolve ? 'reference.unavailable' : 'reference.static';
  const title =
    (resolved?.reviewSummary ? resolved.title : label || resolved?.title) ||
    t(loading ? 'common.loading' : fallback);
  const review = resolved?.review;
  const body = (
    <>
      <TypeIcon size={20} type={type} />
      <span {...stylex.props(styles.body)}>
        <strong>{title}</strong>
        <span {...stylex.props(styles.meta)}>
          {t('type.' + type)}
          {resolved?.blockMissing
            ? ' · ' + t('reference.blockMissing')
            : resolved &&
              kind === 'block' &&
              ' · ' + t('reference.blockTarget', { title: resolved.blockTitle || id })}
          {resolved?.choice !== undefined &&
            ' · ' +
              (resolved.choice === null
                ? t('reference.choicePending')
                : t('reference.choiceSelected', { title: resolved.choice }))}
          {resolved?.reviewSummary && ' · ' + t('reference.reviewSummary', resolved.reviewSummary)}
          {review &&
            ' · ' +
              t(
                review === 'pass'
                  ? 'verdict.passed'
                  : review === 'reject'
                    ? 'verdict.rejected'
                    : 'verdict.pending',
              )}
          {resolve &&
            label &&
            state?.endpoint === endpoint &&
            !resolved &&
            ' · ' + t('reference.unavailable')}
        </span>
      </span>
    </>
  );
  return resolved ? (
    <a
      {...stylex.props(styles.card, styles.link)}
      contentEditable={false}
      href={resolved.href}
      referrerPolicy="no-referrer"
      onClick={(event) => {
        if (
          kind !== 'block' ||
          resolved.blockMissing ||
          !openDocumentBlock ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        if (openDocumentBlock(resolved.href, title, event.currentTarget)) event.preventDefault();
      }}
    >
      {body}
      <ArrowUpRight aria-hidden="true" size={16} />
    </a>
  ) : (
    <div {...stylex.props(styles.card)} contentEditable={false}>
      {body}
    </div>
  );
}
