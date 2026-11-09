import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { FileText, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { TrashEntry, TrashReference } from '../../../shared/trash';
import { trashSelectionKey } from '../../../shared/trash';
import { useTranslation } from '../../i18n';
import { BulkDialog } from './BulkDialog';
import { bulkStyles as styles } from './bulk-styles';

export function TrashView({
  entries, error, refresh, restore, purge, onRestored, projectName,
}: {
  entries: TrashEntry[] | null;
  error: boolean;
  refresh: () => Promise<unknown>;
  restore: (items: TrashReference[]) => Promise<{ key: string; ok: boolean; error?: string }[]>;
  purge: (items: TrashReference[]) => Promise<{ key: string; ok: boolean; error?: string }[]>;
  onRestored: () => void;
  projectName: (project: string) => string;
}) {
  const { t } = useTranslation();
  const [pendingPurge, setPendingPurge] = useState<TrashEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [unconfirmed, setUnconfirmed] = useState<Set<string>>(new Set());

  const reload = async () => {
    await refresh();
    setUnconfirmed(new Set());
  };

  const perform = async (kind: 'restore' | 'purge', entry: TrashEntry) => {
    setBusy(true);
    try {
      const result = (await (kind === 'restore' ? restore : purge)([entry]))
        .find((item) => item.key === trashSelectionKey(entry));
      if (!result?.ok) throw new Error(result?.error ?? t('bulk.unknownResult'));
      setNotice(t(kind === 'restore' ? 'bulk.restored' : 'bulk.purged', { title: entry.title }));
      if (kind === 'restore') onRestored();
    } catch (cause) {
      // A lost response can follow a successful write. Keep the row blocked
      // until a fresh listing establishes whether it is still present.
      try {
        const current = await refresh() as TrashEntry[];
        if (current.some((item) => trashSelectionKey(item) === trashSelectionKey(entry))) {
          setNotice(t('bulk.operationFailed', { error: (cause as Error).message }));
        } else {
          setNotice(t('bulk.unconfirmed', { count: 1 }));
          if (kind === 'restore') onRestored();
        }
      } catch {
        setUnconfirmed((prior) => new Set(prior).add(trashSelectionKey(entry)));
        setNotice(t('bulk.unconfirmed', { count: 1 }));
      }
    } finally {
      setBusy(false);
      setPendingPurge(null);
    }
  };

  return (
    <>
      <p {...stylex.props(styles.hint)}>{t('bulk.trashDescription')}</p>
      {notice && <div role="status" {...stylex.props(styles.banner)}>{notice}</div>}
      {error && <div role="alert" {...stylex.props(styles.banner)}>{t('bulk.loadFailed')}<Button onClick={() => void reload().catch(() => undefined)}>{t('bulk.retry')}</Button></div>}
      {entries === null && !error && <p role="status">{t('bulk.loading')}</p>}
      {entries?.length === 0 && !error && <p role="status">{t('bulk.emptyTrash')}</p>}
      <ul aria-label={t('bulk.trash')} {...stylex.props(styles.trashList)}>
        {entries?.map((entry) => (
          <li key={trashSelectionKey(entry)} {...stylex.props(styles.trashRow)}>
            {entry.type === 'document' ? <FileText aria-hidden="true" size={16} /> : <Trash2 aria-hidden="true" size={16} />}
            <span {...stylex.props(styles.trashName)}>
              {entry.title}
              <small {...stylex.props(styles.trashMeta)}>{t(`type.${entry.type}`)} · {projectName(entry.project)}</small>
            </span>
            <span {...stylex.props(styles.trashExpiry)}>
              {t('bulk.expiresIn', { days: Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 86400_000)) })}
            </span>
            <Button className={stylex.props(styles.touchAction).className} disabled={busy || error || unconfirmed.has(trashSelectionKey(entry))} size="small" onClick={() => void perform('restore', entry)}>{t('bulk.restore')}</Button>
            <Button className={stylex.props(styles.touchAction).className} danger disabled={busy || error || unconfirmed.has(trashSelectionKey(entry))} size="small" type="text" onClick={() => setPendingPurge(entry)}>{t('bulk.purge')}</Button>
          </li>
        ))}
      </ul>
      {pendingPurge && (
        <BulkDialog
          busy={busy}
          deployment={null}
          done={0}
          items={[{ key: trashSelectionKey(pendingPurge), title: pendingPurge.title, type: t(`type.${pendingPurge.type}`), project: projectName(pendingPurge.project) }]}
          kind="purge"
          onCancel={() => setPendingPurge(null)}
          onConfirm={() => void perform('purge', pendingPurge)}
        />
      )}
    </>
  );
}
