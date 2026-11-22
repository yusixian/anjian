import { Pencil, Plus } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';

import {
  MAX_WHITEBOARD_PAGES,
  WHITEBOARD_DEFAULT_PAGE,
  type WhiteboardPage,
} from '../../shared/whiteboard';
import { useTranslation } from '../i18n';

export function WhiteboardPagePicker({
  page,
  pages,
  onPage,
  disabled = false,
  drafts,
  onSave,
}: {
  page: string;
  pages: readonly WhiteboardPage[];
  onPage: (id: string) => void;
  disabled?: boolean;
  drafts?: ReadonlyMap<string, unknown>;
  onSave?: (title: string, rename: boolean) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const pageTitleId = useId();
  const [mode, setMode] = useState<'add' | 'rename' | null>(null);
  const [title, setTitle] = useState('');
  const selected = pages.find(({ id }) => id === page);
  const edit = (next: 'add' | 'rename') => {
    setTitle(next === 'rename' ? (selected?.title ?? '') : '');
    setMode(next);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() && (await onSave?.(title.trim(), mode === 'rename'))) setMode(null);
  };
  return (
    <div className="anjian-whiteboard-pages">
      <label>
        {t('whiteboard.page')}
        <select
          disabled={disabled}
          value={page}
          onChange={(event) => onPage(event.currentTarget.value)}
        >
          {!selected && <option value={page}>{t('whiteboard.pageMissing')}</option>}
          {pages.map(({ id, title: pageTitle }) => {
            const label = id === WHITEBOARD_DEFAULT_PAGE ? t('whiteboard.pageMain') : pageTitle;
            return (
              <option key={id} value={id}>
                {drafts?.has(id) ? t('whiteboard.pageUnsaved', { title: label }) : label}
              </option>
            );
          })}
        </select>
      </label>
      {!selected && (
        <button disabled={disabled} type="button" onClick={() => onPage(WHITEBOARD_DEFAULT_PAGE)}>
          {t('whiteboard.goToMain')}
        </button>
      )}
      {onSave && !mode && (
        <>
          <button
            disabled={disabled || pages.length >= MAX_WHITEBOARD_PAGES}
            type="button"
            onClick={() => edit('add')}
          >
            <Plus aria-hidden="true" size={15} />
            {t('whiteboard.pageAdd')}
          </button>
          {selected && page !== WHITEBOARD_DEFAULT_PAGE && (
            <button disabled={disabled} type="button" onClick={() => edit('rename')}>
              <Pencil aria-hidden="true" size={15} />
              {t('whiteboard.pageRename')}
            </button>
          )}
        </>
      )}
      {onSave && mode && (
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor={pageTitleId}>{t('whiteboard.pageTitle')}</label>
          <input
            autoFocus
            required
            disabled={disabled}
            id={pageTitleId}
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button disabled={disabled || !title.trim()} type="submit">
            {t(mode === 'rename' ? 'whiteboard.save' : 'whiteboard.pageAdd')}
          </button>
          <button disabled={disabled} type="button" onClick={() => setMode(null)}>
            {t('common.cancel')}
          </button>
        </form>
      )}
    </div>
  );
}
