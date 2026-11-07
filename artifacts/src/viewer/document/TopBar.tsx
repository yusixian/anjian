import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

import { RailSwitch } from '../components/RailSwitch';
import { t } from '../i18n';
import { activityLabel, type AgentActivity } from './agentActivity';

const styles = stylex.create({
  bar: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    height: 52,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    paddingInline: 24,
    backgroundColor: cssVar.colorBgContainer,
    fontFamily: cssVar.fontFamily,
  },
  crumb: { color: cssVar.colorTextTertiary, fontSize: 12, whiteSpace: 'nowrap' },
  crumbId: { color: cssVar.colorText, fontWeight: 600 },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingBlock: 2,
    paddingInline: 10,
    borderRadius: 999,
    backgroundColor: cssVar.colorInfoBg,
    color: cssVar.colorInfoText,
    fontSize: 11,
    whiteSpace: 'nowrap',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  dot: { width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' },
  quiet: { backgroundColor: cssVar.colorFillTertiary, color: cssVar.colorTextSecondary },
  offline: { backgroundColor: cssVar.colorWarningBg, color: cssVar.colorWarningText },
  spacer: { flex: 1 },
  compact: { paddingInline: 16, gap: 10 },
  done: {
    paddingBlock: 4,
    paddingInline: 12,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: cssVar.colorText,
    color: cssVar.colorBgContainer,
    fontFamily: cssVar.fontFamily,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
});

interface Props {
  actions?: ReactNode;
  activity: AgentActivity;
  agent?: string;
  agentSection: string | null;
  compact?: boolean;
  history?: { available: boolean; open: boolean; toggle: () => void; close: () => void };
  id: string;
  offline: boolean;
  onDone?: () => void;
  openComments: number;
}

export function TopBar({
  id,
  activity,
  agentSection,
  offline,
  openComments,
  compact = false,
  onDone,
  actions,
  agent = 'Agent',
  history,
}: Props) {
  const label = activityLabel(activity, agent, agentSection);
  return (
    <header {...stylex.props(styles.bar, compact && styles.compact)}>
      {compact ? null : (
        <span {...stylex.props(styles.crumb)}>
          document / <span {...stylex.props(styles.crumbId)}>{id}</span>
        </span>
      )}
      {label ? (
        <span
          {...stylex.props(
            styles.pill,
            activity.kind === 'working' && styles.quiet,
            activity.kind === 'stale' && styles.offline,
          )}
        >
          {activity.kind === 'stale' ? null : <i {...stylex.props(styles.dot)} />}
          {label}
        </span>
      ) : null}
      {offline ? (
        <span {...stylex.props(styles.pill, styles.offline)}>{t('document.notSynced')}</span>
      ) : null}
      {history?.open ? (
        <span {...stylex.props(styles.pill, styles.quiet)}>
          <Lock aria-hidden="true" size={11} />
          {t('document.readOnlyHistory')}
        </span>
      ) : null}
      <span {...stylex.props(styles.spacer)} />
      {history ? (
        <RailSwitch
          available={history.available}
          comments={openComments}
          open={history.open}
          onComments={history.close}
          onHistory={history.toggle}
        />
      ) : null}
      {onDone ? (
        <button type="button" onClick={onDone} {...stylex.props(styles.done)}>
          {t('common.done')}
        </button>
      ) : compact ? null : (
        actions
      )}
    </header>
  );
}
