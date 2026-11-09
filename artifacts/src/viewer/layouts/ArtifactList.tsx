import { Button, Input, Segmented, Select, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Languages, Search, Trash2 } from 'lucide-react';
import { type MouseEvent, useEffect, useRef, useState } from 'react';

import type { HubArtifact, HubProjectStatus } from '../../shared/hub';
import { artifactSelectionKey, type TrashEntry, type TrashTarget } from '../../shared/trash';
import { ARTIFACT_TYPES, type ArtifactType } from '../../shared/types';
import { AnjianMark } from '../components/AnjianMark';
import { WarningsBadge } from '../components/WarningsBadge';
import { setViewerLanguage, useTranslation } from '../i18n';
import { type ArtifactSort, filterArtifacts } from '../lib/artifact-list';
import { ArtifactCard } from './home/ArtifactCard';
import { BulkDialog } from './home/BulkDialog';
import { selectionForVisible, rangeForVisible } from './home/bulk-trash';
import { bulkStyles } from './home/bulk-styles';
import { CommandPalette } from './home/CommandPalette';
import { homeArtifacts, type HomeSelection, type SearchScope } from './home/home-model';
import { styles } from './home/home-styles';
import { ProjectSidebar } from './home/ProjectSidebar';
import { StatusPill } from './home/StatusPill';
import { TrashView } from './home/TrashView';
import { useHubArtifacts } from './home/useHubArtifacts';
import { useTrash } from './home/useTrash';

const openArtifact = (artifact: HubArtifact, newTab: boolean) => {
  if (newTab) window.open(artifact.url, '_blank');
  else location.assign(artifact.url);
};

export function ArtifactList() {
  const { t, i18n } = useTranslation();
  const { list, error, refresh, removeProject } = useHubArtifacts();
  const trash = useTrash();
  const [selection, setSelection] = useState<HomeSelection>(() =>
    new URLSearchParams(location.search).get('view') === 'trash' ? 'trash' : 'recent',
  );
  const [scope, setScope] = useState<SearchScope>('project');
  const [type, setType] = useState<ArtifactType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ArtifactSort>('recent');
  const [palette, setPalette] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [confirmMove, setConfirmMove] = useState<TrashTarget[] | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveDone, setMoveDone] = useState(0);
  const [moved, setMoved] = useState<TrashEntry[]>([]);
  const [failedTargets, setFailedTargets] = useState<TrashTarget[]>([]);
  const [unconfirmedMove, setUnconfirmedMove] = useState(0);
  const [undoing, setUndoing] = useState(false);
  const [undoUnconfirmed, setUndoUnconfirmed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const searchRef = useRef<HTMLInputElement>(null);

  const artifacts = list?.artifacts ?? [];
  const projects: HubProjectStatus[] = (list?.projects ?? []).map((project) => ({
    ...project,
    artifacts: artifacts.filter((a) => a.project === project.dir).length,
  }));
  const selected = projects.find((project) => project.dir === selection) ?? null;
  const view: HomeSelection = selected ? selected.dir : 'recent';
  const everywhere = view === 'recent' || (scope === 'all' && query.trim() !== '');
  const base = homeArtifacts(artifacts, { selection: view, scope, query: '' });
  const items = filterArtifacts(
    homeArtifacts(artifacts, { selection: view, scope, query }),
    type,
    '',
    sort,
  );
  const nameOf = (dir: string) => projects.find((p) => p.dir === dir)?.name ?? dir;
  const picked = items.filter((artifact) => chosen.has(artifactSelectionKey(artifact)));
  const retryable = failedTargets.filter((target) => picked.some((artifact) => artifactSelectionKey(artifact) === artifactSelectionKey(target)));
  const allVisibleSelected = items.length > 0 && items.every((artifact) => chosen.has(artifactSelectionKey(artifact)));

  const clearChosen = (notify = false) => {
    if (notify && chosen.size) toast.info(t('bulk.selectionCleared'));
    setChosen(new Set());
    setAnchor(null);
    setFailedTargets([]);
  };
  const chooseView = (next: HomeSelection) => {
    if (next === selection) return;
    clearChosen(true);
    setSelecting(false);
    setConfirmMove(null);
    setSelection(next);
    const url = new URL(location.href);
    if (next === 'trash') url.searchParams.set('view', 'trash');
    else url.searchParams.delete('view');
    history.replaceState(null, '', url);
    if (next === 'trash') void trash.refresh().then((entries) => {
      const present = new Set(entries.map((entry) => `${entry.project}\n${entry.trashId}`));
      setMoved((prior) => prior.filter((entry) => present.has(`${entry.project}\n${entry.trashId}`)));
      setUnconfirmedMove(0);
      setUndoUnconfirmed(false);
    }).catch(() => undefined);
  };
  const toggleArtifact = (artifact: HubArtifact, event: MouseEvent<HTMLElement>) => {
    if (moving) return;
    const key = artifactSelectionKey(artifact);
    const extendingRange = event.shiftKey && !!anchor;
    setSelecting(true);
    setChosen((previous) => {
      if (extendingRange) return rangeForVisible(previous, items, anchor, key);
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!extendingRange) setAnchor(key);
  };

  const moveSelected = async (targets: TrashTarget[]) => {
    if (moving || targets.length === 0) return;
    setMoving(true);
    setMoveDone(0);
    try {
      const result = await trash.move(targets, setMoveDone);
      const failed = new Set(result.failed.map(artifactSelectionKey));
      setChosen(failed);
      setFailedTargets(result.failed);
      if (result.unconfirmed.length) setUnconfirmedMove((count) => count + result.unconfirmed.length);
      setMoved((prior) => {
        const byKey = new Map(prior.map((entry) => [`${entry.project}\n${entry.trashId}`, entry]));
        for (const entry of result.succeeded) byKey.set(`${entry.project}\n${entry.trashId}`, entry);
        return [...byKey.values()];
      });
      if (failed.size === 0) setSelecting(false);
      if (failed.size) toast.error(t('bulk.partialFailure', { count: failed.size }));
      if (result.unconfirmed.length) toast.error(t('bulk.unconfirmed', { count: result.unconfirmed.length }));
      void refresh();
      setConfirmMove(null);
    } catch (cause) {
      await trash.refresh().catch(() => undefined);
      toast.error(t('bulk.operationFailed', { error: (cause as Error).message }));
    } finally {
      setMoving(false);
    }
  };

  const undo = async () => {
    if (!moved.length || undoing || moving || undoUnconfirmed) return;
    setUndoing(true);
    const submitted = moved;
    try {
      const results = await trash.restore(submitted.map(({ project, trashId }) => ({ project, trashId })));
      const restored = new Set(results.filter((result) => result.ok).map((result) => result.key));
      const failed = submitted.filter((item) => !restored.has(`${item.project}\n${item.trashId}`));
      setMoved(failed);
      if (failed.length) toast.error(t('bulk.partialRestore', { count: failed.length }));
      else toast.success(t('bulk.undoComplete'));
      void refresh();
    } catch (cause) {
      try {
        const current = await trash.refresh();
        const stillInTrash = new Set(current.map((entry) => `${entry.project}\n${entry.trashId}`));
        setMoved(submitted.filter((entry) => stillInTrash.has(`${entry.project}\n${entry.trashId}`)));
        void refresh();
      } catch {
        setUndoUnconfirmed(true);
      }
      toast.error(t('bulk.operationFailed', { error: (cause as Error).message }));
    } finally {
      setUndoing(false);
    }
  };

  useEffect(() => {
    document.title = selection === 'trash' ? `${t('bulk.trash')} · 案间` : selected ? `${selected.name} · 案间` : '案间 · Anjian';
  }, [selected, selection, t]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
      } else if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !target.closest('input,textarea,[contenteditable="true"]')
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    addEventListener('keydown', shortcut);
    return () => {
      clearInterval(timer);
      removeEventListener('keydown', shortcut);
    };
  }, []);

  useEffect(() => {
    if (!selecting || confirmMove || palette || moving) return;
    const shortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelecting(false);
        setChosen(new Set());
        setAnchor(null);
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setChosen(selectionForVisible(new Set(), items, true));
      }
    };
    addEventListener('keydown', shortcuts);
    return () => removeEventListener('keydown', shortcuts);
  }, [selecting, confirmMove, palette, moving, items]);

  const remove = (project: HubProjectStatus) => {
    void removeProject(project.dir)
      .then(() => {
        if (selection === project.dir) chooseView('recent');
      })
      .catch(() => toast.error(t('home.removeFailed', { name: project.name })));
  };

  const tabs = (['all', ...ARTIFACT_TYPES] as const).map((value) => ({
    value,
    label: (
      <span {...stylex.props(styles.tabLabel)}>
        {t(`type.${value}`)}
        <span {...stylex.props(styles.tabCount)}>
          {value === 'all' ? base.length : base.filter((a) => a.type === value).length}
        </span>
      </span>
    ),
  }));
  const scopes: { value: SearchScope; label: string }[] = [
    { value: 'project', label: t('home.scopeProject') },
    { value: 'all', label: t('home.scopeAll') },
  ];
  const effectiveScope: SearchScope = view === 'recent' ? 'all' : scope;

  return (
    <div {...stylex.props(styles.library)}>
      <header {...stylex.props(styles.topbar)}>
        <div {...stylex.props(styles.breadcrumb)}>
          <AnjianMark size={20} />
          <strong {...stylex.props(styles.brand)}>案间</strong>
          <span {...stylex.props(styles.slash)}>/</span>
          <b {...stylex.props(styles.crumb)}>{selection === 'trash' ? t('bulk.trash') : selected?.name ?? t('home.recentAll')}</b>
        </div>
        <div {...stylex.props(styles.topbarEnd)}>
          <button
            aria-label={t('home.switchLanguage', { language: i18n.language === 'zh' ? 'English' : '中文' })}
            type="button"
            {...stylex.props(styles.languageButton)}
            onClick={() => void setViewerLanguage(i18n.language === 'zh' ? 'en' : 'zh')}
          >
            <Languages aria-hidden="true" size={14} />
            <span>{i18n.language === 'zh' ? '中文' : 'English'}</span>
          </button>
          <StatusPill onProjectsChanged={() => void refresh()} />
        </div>
      </header>
      <div {...stylex.props(styles.body)}>
        <ProjectSidebar
          projects={projects}
          selection={selection}
          total={artifacts.length}
          trashCount={trash.entries?.length ?? 0}
          onRemove={remove}
          onSelect={chooseView}
        />
        <main {...stylex.props(styles.main, selecting && bulkStyles.mobileSpace)}>
          <div {...stylex.props(styles.heading, bulkStyles.heading)}>
            <h1 {...stylex.props(styles.headingTitle)}>{selection === 'trash' ? t('bulk.trash') : selected?.name ?? t('home.recent')}</h1>
            <span {...stylex.props(styles.headingCount)}>
              {selection === 'trash' ? t('bulk.trashSubtitle') : list === null
                ? '…'
                : view === 'recent'
                  ? t('home.recentSubtitle')
                  : t('library.count', { count: base.length })}
            </span>
            {selection !== 'trash' && (
              <Button className={stylex.props(bulkStyles.touchAction).className} size="small" onClick={() => {
                setSelecting((current) => !current);
                clearChosen();
              }}>
                {selecting ? t('bulk.done') : t('bulk.select')}
              </Button>
            )}
          </div>
          {selection === 'trash' ? (
            <TrashView
              entries={trash.entries}
              error={trash.error}
              refresh={trash.refresh}
              restore={trash.restore}
              purge={trash.purge}
              onRestored={() => void refresh()}
              projectName={nameOf}
            />
          ) : (
          <>
          <div {...stylex.props(styles.toolbar)}>
            <Segmented<ArtifactType | 'all'>
              className={stylex.props(styles.tabs).className}
              options={tabs}
              size="small"
              styles={{ item: { height: 30, paddingInline: 8 } }}
              value={type}
              onChange={(next) => { if (next !== type) clearChosen(true); setType(next); }}
            />
            <div {...stylex.props(styles.tools)}>
              <div aria-label={t('home.scopeLabel')} role="group" {...stylex.props(styles.scope)}>
                {scopes.map((option) => (
                  <button
                    aria-pressed={effectiveScope === option.value}
                    disabled={view === 'recent' && option.value === 'project'}
                    key={option.value}
                    type="button"
                    {...stylex.props(
                      styles.scopeOption,
                      effectiveScope === option.value && styles.scopeOn,
                    )}
                    onClick={() => { if (option.value !== scope) clearChosen(true); setScope(option.value); }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <Input
                aria-label={t('library.searchLabel')}
                className={stylex.props(styles.search).className}
                placeholder={t('home.searchAll')}
                prefix={<Search size={16} />}
                ref={searchRef}
                suffix={<kbd {...stylex.props(styles.searchKey)}>/</kbd>}
                type="search"
                value={query}
                variant="filled"
                onChange={(event) => { if (event.target.value !== query) clearChosen(true); setQuery(event.target.value); }}
              />
              <Button
                aria-label={t('home.paletteLabel')}
                size="small"
                title={t('home.paletteLabel')}
                type="text"
                onClick={() => setPalette(true)}
              >
                <kbd {...stylex.props(styles.searchKey)}>⌘K</kbd>
              </Button>
              <label {...stylex.props(styles.srOnly)} htmlFor="artifact-sort">
                {t('library.sortLabel')}
              </label>
              <Select
                className={stylex.props(styles.sort).className}
                id="artifact-sort"
                value={sort}
                variant="filled"
                options={[
                  { label: t('library.sortRecent'), value: 'recent' },
                  { label: t('library.sortOldest'), value: 'oldest' },
                  { label: t('library.sortName'), value: 'name' },
                ]}
                onSelect={setSort}
              />
            </div>
          </div>
          {selecting && (
            <>
              <div role="toolbar" aria-label={t('bulk.selectionToolbar')} {...stylex.props(bulkStyles.bar)}>
                <strong {...stylex.props(bulkStyles.count)}>{t('bulk.selectedCount', { count: picked.length })}</strong>
                <Button className={stylex.props(bulkStyles.touchAction).className} size="small" type="text" disabled={items.length === 0 || moving} onClick={() =>
                  setChosen(selectionForVisible(chosen, items, !allVisibleSelected))
                }>
                  {allVisibleSelected ? t('bulk.clearVisible') : t('bulk.selectVisible', { count: items.length })}
                </Button>
                <span {...stylex.props(bulkStyles.spacer)} />
                <span {...stylex.props(bulkStyles.note)}>{t('bulk.currentResultsOnly')}</span>
                <Button className={stylex.props(bulkStyles.mobilePrimary).className} danger size="small" disabled={picked.length === 0 || moving} onClick={() =>
                  setConfirmMove(picked.map(({ project, type, id, url }) => ({ project, type, id, url })))
                }>
                  <Trash2 aria-hidden="true" size={14} />{t('bulk.move')}
                </Button>
              </div>
              <p {...stylex.props(bulkStyles.hint)}>{t('bulk.shortcutHint')}</p>
            </>
          )}
          {failedTargets.length > 0 && <div role="alert" {...stylex.props(bulkStyles.banner)}>
            <span {...stylex.props(bulkStyles.bannerCopy)}>{t('bulk.partialFailure', { count: failedTargets.length })}</span>
            <Button size="small" disabled={moving || retryable.length === 0} onClick={() =>
              setConfirmMove(retryable)
            }>{t('bulk.retryFailed')}</Button>
          </div>}
          {unconfirmedMove > 0 && <div role="alert" {...stylex.props(bulkStyles.banner)}>
            <span {...stylex.props(bulkStyles.bannerCopy)}>{t('bulk.unconfirmed', { count: unconfirmedMove })}</span>
            <Button size="small" onClick={() => chooseView('trash')}>{t('bulk.viewTrash')}</Button>
          </div>}
          {undoUnconfirmed && <div role="alert" {...stylex.props(bulkStyles.banner)}>
            <span {...stylex.props(bulkStyles.bannerCopy)}>{t('bulk.unconfirmed', { count: moved.length })}</span>
            <Button size="small" onClick={() => chooseView('trash')}>{t('bulk.viewTrash')}</Button>
          </div>}
          {moved.length > 0 && <div role="status" {...stylex.props(bulkStyles.banner)}>
            <span {...stylex.props(bulkStyles.bannerCopy)}>{t('bulk.movedCount', { count: moved.length })}</span>
            <Button size="small" loading={undoing} disabled={moving || undoing || undoUnconfirmed} onClick={() => void undo()}>{t('bulk.undo')}</Button>
            <Button size="small" type="text" onClick={() => chooseView('trash')}>{t('bulk.viewTrash')}</Button>
          </div>}
          {error && (
            <div {...stylex.props(styles.error)} role="alert">
              {t('library.loadFailed')}
              <Button size="small" type="text" onClick={() => void refresh()}>
                {t('common.retry')}
              </Button>
            </div>
          )}
          {list === null && !error && (
            <p {...stylex.props(styles.empty)} role="status">
              {t('library.loadingList')}
            </p>
          )}
          {list !== null && base.length === 0 && !query.trim() && (
            <div {...stylex.props(styles.empty)}>
              <div {...stylex.props(styles.emptyIcon)}>
                <AnjianMark size={28} />
              </div>
              <h2 {...stylex.props(styles.emptyTitle)}>
                {view === 'recent' ? t('home.emptyRecent') : t('library.emptyTitle')}
              </h2>
              <p {...stylex.props(styles.emptyBody)}>{t('library.emptyBody')}</p>
            </div>
          )}
          {list !== null && (base.length > 0 || query.trim()) && items.length === 0 && (
            <div {...stylex.props(styles.empty)}>
              <div {...stylex.props(styles.emptyIcon)}>
                <Search size={24} />
              </div>
              <h2 {...stylex.props(styles.emptyTitle)}>{t('library.noMatchTitle')}</h2>
              <p {...stylex.props(styles.emptyBody)}>{t('library.noMatchBody')}</p>
              <Button
                size="small"
                onClick={() => {
                  clearChosen(true);
                  setQuery('');
                  setType('all');
                }}
              >
                {t('common.clearFilter')}
              </Button>
            </div>
          )}
          <ul aria-label={t('library.listLabel')} {...stylex.props(styles.grid)}>
            {items.map((artifact) => (
              <li key={`${artifact.project}\n${artifact.url}`} {...stylex.props(styles.gridItem)}>
                <ArtifactCard
                  artifact={artifact}
                  now={now}
                  projectName={everywhere ? nameOf(artifact.project) : null}
                  selectionMode={selecting}
                  selected={chosen.has(artifactSelectionKey(artifact))}
                  onToggle={(event) => toggleArtifact(artifact, event)}
                />
              </li>
            ))}
          </ul>
          <footer {...stylex.props(styles.footer)}>
            <span {...stylex.props(styles.footerGroup)}>
              <AnjianMark size={16} />
              {t('library.footer')}
            </span>
            {selected && (
              <code {...stylex.props(styles.footerCode)}>{selected.dir}/.anjian/artifacts</code>
            )}
          </footer>
          </>
          )}
        </main>
      </div>
      {confirmMove && (
        <BulkDialog
          busy={moving}
          deployment={trash.deployment}
          done={moveDone}
          items={confirmMove.map((item) => {
            const found = artifacts.find((artifact) => artifactSelectionKey(artifact) === artifactSelectionKey(item));
            return { key: artifactSelectionKey(item), title: found?.title ?? item.id, type: t(`type.${item.type}`), project: nameOf(item.project) };
          })}
          kind="move"
          onCancel={() => setConfirmMove(null)}
          onConfirm={() => void moveSelected(confirmMove)}
        />
      )}
      {palette && (
        <CommandPalette
          artifacts={artifacts}
          projects={projects}
          onClose={() => setPalette(false)}
          onOpen={(artifact, newTab) => {
            setPalette(false);
            openArtifact(artifact, newTab);
          }}
        />
      )}
      <WarningsBadge warnings={list?.warnings ?? []} />
    </div>
  );
}
