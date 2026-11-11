import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import type { DiskReport } from '../../../server/storage/disk';
import { useTranslation } from '../../i18n';
import { deviceStyles as styles } from '../devices/device-styles';

const diskStyles = stylex.create({
  number: { fontSize: 28, fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginBlock: 12 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, marginBlock: 16 },
  value: { margin: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  meter: { width: '100%', height: 6, accentColor: 'currentColor' },
});
const gib = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GiB`;

export function ServerDisk() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<DiskReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(true);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running) return;
      running = true; setBusy(true);
      try {
        const response = await fetch('/api/storage/disk', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unavailable');
        const next = await response.json() as DiskReport;
        if (active) { setData(next); setFailed(false); }
      } catch { if (active) setFailed(true); }
      finally { running = false; if (active) setBusy(false); }
    };
    refresh.current = () => { void load(); };
    void load();
    const visible = () => { if (!document.hidden) void load(); };
    const timer = setInterval(visible, 60_000);
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return <section {...stylex.props(styles.preview)} aria-label={t('storage.disk.title')} aria-busy={busy}>
    <h2 {...stylex.props(styles.dialogTitle)}>{t('storage.disk.title')}</h2>
    <p {...stylex.props(styles.rowMeta)}>{t('storage.disk.help')}</p>
    {failed && <p role="alert" {...stylex.props(styles.error)}>{t('storage.disk.failed')}</p>}
    {!data && <p role="status" {...stylex.props(diskStyles.number)}>{busy ? t('common.loading') : '—'}</p>}
    {data?.volumes.map((disk, index) => {
      const ratio = disk.available / disk.total;
      const critical = ratio < .05 || disk.available < 1024 ** 3;
      const low = critical || ratio < .1 || disk.available < 5 * 1024 ** 3;
      return <div key={index}>
        {data.volumes.length > 1 && <h3>{t('storage.disk.volume', { number: index + 1 })}</h3>}
        <p {...stylex.props(diskStyles.number)}>{gib(disk.available)} <small>{t('storage.disk.available')}</small></p>
        <progress {...stylex.props(diskStyles.meter)} aria-label={t('storage.disk.used')} value={disk.used} max={disk.total} />
        <dl {...stylex.props(diskStyles.grid)}>
          <div><dt {...stylex.props(styles.rowMeta)}>{t('storage.disk.total')}</dt><dd {...stylex.props(diskStyles.value)}>{gib(disk.total)}</dd></div>
          <div><dt {...stylex.props(styles.rowMeta)}>{t('storage.disk.used')}</dt><dd {...stylex.props(diskStyles.value)}>{gib(disk.used)} · {Math.round(disk.used / disk.total * 100)}%</dd></div>
        </dl>
        {disk.reserved > 0 && <p {...stylex.props(styles.rowMeta)}>{t('storage.disk.reserved', { amount: gib(disk.reserved) })}</p>}
        {!failed && <p role={low ? 'status' : undefined} {...stylex.props(low ? styles.error : styles.rowMeta)}>{t(critical ? 'storage.disk.critical' : low ? 'storage.disk.low' : 'storage.disk.healthy')}</p>}
        {low && !failed && <p {...stylex.props(styles.rowMeta)}>{t('storage.disk.lowHelp')}</p>}
      </div>;
    })}
    {data && <p {...stylex.props(styles.rowMeta)}>{t(failed ? 'storage.disk.stale' : 'storage.disk.updated', { time: new Date(data.checkedAt).toLocaleString(i18n.language) })}</p>}
    <Button loading={busy} disabled={busy} onClick={() => refresh.current()}>{t(failed ? 'devices.retry' : 'storage.usage.refresh')}</Button>
    <p {...stylex.props(styles.note)}>{t('storage.disk.cacheHelp')}</p>
  </section>;
}
