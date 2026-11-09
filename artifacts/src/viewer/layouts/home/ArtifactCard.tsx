import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRight, Check, Folder } from 'lucide-react';
import { type MouseEvent, useState } from 'react';

import type { HubArtifact } from '../../../shared/hub';
import { THUMBNAIL_PATH } from '../../../shared/thumbnail';
import { ArtifactThumbnail } from '../../components/ArtifactThumbnail';
import { TypeIcon } from '../../components/TypeIcon';
import { useTranslation } from '../../i18n';
import { relativeUpdatedAt } from '../../lib/artifact-list';

const styles = stylex.create({
  card: {
    'display': 'block',
    'position': 'relative',
    'height': 196,
    'boxSizing': 'border-box',
    'borderWidth': 1,
    'borderStyle': 'solid',
    'borderColor': cssVar.colorBorderSecondary,
    'borderRadius': 8,
    'overflow': 'hidden',
    'backgroundColor': cssVar.colorBgContainer,
    'color': 'inherit',
    'textDecoration': 'none',
    'transitionProperty': 'border-color',
    'transitionDuration': '120ms',
    ':hover': { borderColor: cssVar.colorTextTertiary },
    ':focus-visible': {
      outlineWidth: 2,
      outlineStyle: 'solid',
      outlineColor: cssVar.colorPrimary,
      outlineOffset: 3,
    },
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0s' },
  },
  chosen: { outlineWidth: 2, outlineStyle: 'solid', outlineColor: cssVar.colorText },
  surface: {
    display: 'block', width: '100%', height: '100%', padding: 0, borderWidth: 0,
    backgroundColor: 'transparent', color: 'inherit', textAlign: 'start',
    textDecoration: 'none', cursor: 'pointer',
  },
  checkbox: {
    'position': 'absolute', 'zIndex': 1, 'top': 9, 'insetInlineStart': 9,
    'width': 26, 'height': 26, 'padding': 0,
    'display': 'flex', 'alignItems': 'center', 'justifyContent': 'center',
    'borderWidth': 1, 'borderStyle': 'solid', 'borderColor': cssVar.colorBorder,
    'borderRadius': 6, 'backgroundColor': cssVar.colorBgElevated,
    'color': cssVar.colorText,
    'cursor': 'pointer',
    'opacity': { default: 0, ':focus-visible': 1 },
    ':focus-visible': { outlineWidth: 2, outlineStyle: 'solid', outlineColor: cssVar.colorPrimary },
    '@media (hover: none)': { opacity: 1 },
  },
  checkboxShown: { opacity: 1 },
  checkboxSelected: { backgroundColor: cssVar.colorText, color: cssVar.colorBgContainer },
  cardHovered: { ':hover': { borderColor: cssVar.colorTextTertiary } },
  info: { paddingBlock: 8, paddingInline: 12 },
  title: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 13,
    lineHeight: '18px',
    fontWeight: 550,
  },
  titleText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  icon: { flexShrink: 0, color: cssVar.colorTextSecondary },
  meta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 3,
    fontSize: 11,
    lineHeight: '16px',
    color: cssVar.colorTextSecondary,
  },
  group: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 },
  project: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  time: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
});

export function ArtifactCard({
  artifact,
  projectName,
  now,
  selectionMode = false,
  selected = false,
  onToggle,
}: {
  artifact: HubArtifact;
  projectName: string | null;
  now: number;
  selectionMode?: boolean;
  selected?: boolean;
  onToggle?: (event: MouseEvent<HTMLElement>) => void;
}) {
  const { t, i18n } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const updated = new Date(artifact.updatedAt);
  const content = (
    <>
      <ArtifactThumbnail
        src={`/api/thumbnail${artifact.url}.svg?v=${artifact.updatedAt}&d=${THUMBNAIL_PATH}`}
        type={artifact.type}
      />
      <div {...stylex.props(styles.info)}>
        <div {...stylex.props(styles.title)}>
          <span title={artifact.title} {...stylex.props(styles.titleText)}>
            {artifact.title}
          </span>
          <ArrowUpRight aria-hidden="true" size={13} {...stylex.props(styles.icon)} />
        </div>
        <div {...stylex.props(styles.meta)}>
          <span {...stylex.props(styles.group)}>
            <TypeIcon size={12} type={artifact.type} />
            {projectName === null ? (
              t(`type.${artifact.type}`)
            ) : (
              <>
                <Folder aria-hidden="true" size={11} />
                <span title={artifact.project} {...stylex.props(styles.project)}>
                  {projectName}
                </span>
              </>
            )}
          </span>
          <time
            dateTime={updated.toISOString()}
            title={updated.toLocaleString(i18n.language)}
            {...stylex.props(styles.time)}
          >
            {relativeUpdatedAt(artifact.updatedAt, now)}
          </time>
        </div>
      </div>
    </>
  );
  return (
    <div
      {...stylex.props(styles.card, selected && styles.chosen, styles.cardHovered)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false);
      }}
    >
      {selectionMode ? (
        <button
          aria-label={t('bulk.toggleArtifact', { title: artifact.title })}
          aria-pressed={selected}
          type="button"
          {...stylex.props(styles.surface)}
          onClick={onToggle}
        >
          {content}
        </button>
      ) : (
        <a aria-label={t('library.open', { title: artifact.title })} href={artifact.url} {...stylex.props(styles.surface)}>
          {content}
        </a>
      )}
      {onToggle && (
        <button
          aria-label={t('bulk.selectArtifact', { title: artifact.title })}
          aria-pressed={selected}
          type="button"
          {...stylex.props(
            styles.checkbox,
            (selectionMode || hovered) && styles.checkboxShown,
            selected && styles.checkboxSelected,
          )}
          onClick={onToggle}
        >
          {selected && <Check aria-hidden="true" size={16} />}
        </button>
      )}
    </div>
  );
}
