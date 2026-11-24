import { useEffect, useRef, useState } from 'react';

import { mintArtifactId } from '../../shared/ids';
import {
  isNarrationLocale,
  MAX_NARRATION_LINES,
  MAX_NARRATION_TERM,
  MAX_NARRATION_TERMS,
  MAX_NARRATION_TEXT,
  type NarrationLine,
  type NarrationScript,
  narrationSpeech,
} from '../../shared/storyboard-narration';
import { useStoryboardCopy } from './copy';

const EMPTY: NarrationScript = { lexicon: [], lines: [] };

interface Preview {
  file: File;
  line: NarrationLine;
  spoken: string;
  url: string;
}

export function NarrationPanel({
  available,
  script = EMPTY,
  url,
  onChange,
  onUse,
}: {
  available?: boolean;
  script?: NarrationScript;
  url: string;
  onChange: (script: NarrationScript) => void;
  onUse: (file: File) => Promise<boolean>;
}) {
  const c = useStoryboardCopy();
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState<'preview' | 'add'>();
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lockRef = useRef(false);
  const pendingRef = useRef<AbortController | null>(null);

  useEffect(() => () => URL.revokeObjectURL(preview?.url ?? ''), [preview]);
  useEffect(() => () => pendingRef.current?.abort(), []);

  async function generate(line: NarrationLine, spoken: string) {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy('preview');
    setError('');
    setPreview(undefined);
    const abort = new AbortController();
    pendingRef.current = abort;
    try {
      const response = await fetch(url + '/narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spoken, locale: line.locale }),
        signal: abort.signal,
      });
      if (!response.ok) throw new Error(c.narrationFailed);
      const blob = await response.blob();
      if (abort.signal.aborted) return;
      const file = new File([blob], 'narration-' + line.id + '.wav', { type: 'audio/wav' });
      setPreview({ file, line, spoken, url: URL.createObjectURL(file) });
    } catch {
      if (!abort.signal.aborted) setError(c.narrationFailed);
    } finally {
      pendingRef.current = null;
      lockRef.current = false;
      if (!abort.signal.aborted) setBusy(undefined);
    }
  }

  async function addPreview(file: File) {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy('add');
    setError('');
    try {
      if (!(await onUse(file))) setError(c.addFailed);
      setPreview(undefined);
    } catch {
      setError(c.importFailed);
    } finally {
      lockRef.current = false;
      setBusy(undefined);
    }
  }

  function updateLine(line: NarrationLine) {
    onChange({
      ...script,
      lines: script.lines.map((entry) => (entry.id === line.id ? line : entry)),
    });
  }

  function addLine() {
    onChange({
      ...script,
      lines: [
        ...script.lines,
        {
          hint: '',
          id: mintArtifactId().toLowerCase(),
          locale: c.narrationDefaultLocale === 'en-US' ? 'en-US' : 'zh-CN',
          text: '',
        },
      ],
    });
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="sb-button sb-narration-trigger"
        type="button"
        onClick={() => dialogRef.current?.showModal()}
      >
        {c.narration}
      </button>
      <dialog
        aria-label={c.narration}
        className="sb-narration sb-panel"
        ref={dialogRef}
        onClose={() => dialogRef.current?.querySelector('audio')?.pause()}
      >
        <header className="sb-panel-head">
          <h2>{c.narration}</h2>
          <button className="sb-button" type="button" onClick={() => dialogRef.current?.close()}>
            {c.narrationClose}
          </button>
        </header>
        <div className="sb-narration-body">
          {!available && <p className="sb-empty">{c.narrationUnavailable}</p>}
          <details className="sb-narration-lexicon">
            <summary>{c.narrationLexicon}</summary>
            {script.lexicon.map((entry, index) => (
              <fieldset className="sb-narration-fields" key={entry.id}>
                <legend>
                  {c.narrationTerm} {index + 1}
                </legend>
                <label className="sb-field">
                  <span>{c.narrationTerm}</span>
                  <input
                    maxLength={MAX_NARRATION_TERM}
                    value={entry.term}
                    onChange={(event) =>
                      onChange({
                        ...script,
                        lexicon: script.lexicon.map((item, i) =>
                          i === index ? { ...item, term: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                <label className="sb-field">
                  <span>{c.narrationSpoken}</span>
                  <input
                    maxLength={MAX_NARRATION_TERM}
                    value={entry.spoken}
                    onChange={(event) =>
                      onChange({
                        ...script,
                        lexicon: script.lexicon.map((item, i) =>
                          i === index ? { ...item, spoken: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="sb-button"
                  type="button"
                  onClick={() =>
                    onChange({
                      ...script,
                      lexicon: script.lexicon.filter((_, i) => i !== index),
                    })
                  }
                >
                  {c.narrationRemoveTerm}
                </button>
              </fieldset>
            ))}
            <button
              className="sb-button"
              disabled={script.lexicon.length >= MAX_NARRATION_TERMS}
              type="button"
              onClick={() =>
                onChange({
                  ...script,
                  lexicon: [
                    ...script.lexicon,
                    { id: mintArtifactId().toLowerCase(), term: '', spoken: '' },
                  ],
                })
              }
            >
              {c.narrationAddTerm}
            </button>
          </details>
          {script.lines.map((line, index) => {
            const spoken = narrationSpeech(line, script.lexicon);
            const current =
              preview?.line.id === line.id &&
              preview.line.locale === line.locale &&
              preview.spoken === spoken
                ? preview
                : undefined;
            return (
              <fieldset className="sb-narration-fields" key={line.id}>
                <legend>
                  {c.narrationLine} {index + 1}
                </legend>
                <label className="sb-field">
                  <span>{c.narrationText}</span>
                  <textarea
                    maxLength={MAX_NARRATION_TEXT}
                    rows={2}
                    value={line.text}
                    onChange={(event) => updateLine({ ...line, text: event.target.value })}
                  />
                </label>
                <label className="sb-field">
                  <span>{c.narrationHint}</span>
                  <textarea
                    maxLength={MAX_NARRATION_TEXT}
                    rows={2}
                    value={line.hint}
                    onChange={(event) => updateLine({ ...line, hint: event.target.value })}
                  />
                </label>
                <label className="sb-field">
                  <span>{c.narrationLanguage}</span>
                  <select
                    value={line.locale}
                    onChange={(event) => {
                      if (isNarrationLocale(event.target.value))
                        updateLine({ ...line, locale: event.target.value });
                    }}
                  >
                    <option value="zh-CN">{c.narrationChinese}</option>
                    <option value="en-US">{c.narrationEnglish}</option>
                  </select>
                </label>
                <div className="sb-narration-actions">
                  {available && (
                    <button
                      className="sb-button"
                      disabled={!!busy || !line.text.trim() || spoken.length > MAX_NARRATION_TEXT}
                      type="button"
                      onClick={() => void generate(line, spoken)}
                    >
                      {c.narrationPreview}
                    </button>
                  )}
                  <button
                    className="sb-button"
                    type="button"
                    onClick={() =>
                      onChange({
                        ...script,
                        lines: script.lines.filter((entry) => entry.id !== line.id),
                      })
                    }
                  >
                    {c.narrationRemoveLine}
                  </button>
                </div>
                {available && spoken.length > MAX_NARRATION_TEXT && (
                  <p className="sb-alert">{c.narrationTooLong}</p>
                )}
                {current && (
                  <>
                    <audio controls aria-label={c.narrationAudio} src={current.url} />
                    <button
                      className="sb-button"
                      disabled={!!busy}
                      type="button"
                      onClick={() => void addPreview(current.file)}
                    >
                      {c.narrationAddAudio}
                    </button>
                  </>
                )}
              </fieldset>
            );
          })}
          <button
            className="sb-button"
            disabled={script.lines.length >= MAX_NARRATION_LINES}
            type="button"
            onClick={addLine}
          >
            {c.narrationAddLine}
          </button>
          {busy && <p role="status">{busy === 'preview' ? c.narrationGenerating : c.importing}</p>}
          {error && (
            <p className="sb-alert" role="alert">
              {error}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
