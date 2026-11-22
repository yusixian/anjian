import './native-feedback.css';

import { Bot, X } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { FeedbackArtifactType } from '../../shared/feedback-artifact';
import { useTranslation } from '../i18n';
import { FeedbackPanel } from './FeedbackPanel';
import { FeedbackProvider } from './FeedbackProvider';
import { feedbackApi } from './localApi';

const Context = createContext<{
  open: () => void;
  focusThread: (element: HTMLElement | null) => void;
} | null>(null);

export function NativeFeedbackButton() {
  const context = useContext(Context);
  const { t } = useTranslation();
  if (!context) return null;
  return (
    <button
      aria-haspopup="dialog"
      aria-label={t('feedback.title')}
      className="native-feedback-button"
      title={t('feedback.title')}
      type="button"
      onClick={context.open}
    >
      <Bot aria-hidden="true" size={17} />
      <span>{t('feedback.title')}</span>
    </button>
  );
}

export function useNativeThreadFocus() {
  return useContext(Context)?.focusThread;
}

export function NativeFeedback<T>({
  type,
  id,
  children,
  locate,
}: {
  type: FeedbackArtifactType;
  id: string;
  children: ReactNode;
  locate: (snapshot: T, threadId: string) => boolean;
}) {
  const { t } = useTranslation();
  const artifact = type + '/' + id;
  const dialog = useRef<HTMLDialogElement>(null);
  const latestLocate = useRef(locate);
  useLayoutEffect(() => {
    latestLocate.current = locate;
  }, [locate]);
  const pending = useRef<AbortController | null>(null);
  const [visibility, setVisibility] = useState<'initial' | 'open' | 'closed'>('initial');
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const focusThread = useCallback(
    (element: HTMLElement | null) => {
      if (!element || !target || element.dataset.thread !== target) return;
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      setTarget('');
    },
    [target],
  );
  useEffect(() => () => pending.current?.abort(), []);

  async function openThread(threadId: string) {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setError('');
    try {
      const response = await fetch('/api/' + artifact, {
        cache: 'no-store',
        signal: request.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      const snapshot: T = await response.json();
      if (request.signal.aborted) return;
      if (!latestLocate.current(snapshot, threadId)) {
        setError('feedback.targetMissing');
        return;
      }
      dialog.current?.close();
      setTarget(threadId);
    } catch {
      if (!request.signal.aborted) setError('feedback.errors.network');
    }
  }

  return (
    <Context
      value={{
        open: () => {
          setVisibility('open');
          setError('');
          dialog.current?.showModal();
        },
        focusThread,
      }}
    >
      {children}
      <dialog
        aria-label={t('feedback.title')}
        className="native-feedback-dialog"
        ref={dialog}
        onClose={() => {
          setVisibility('closed');
          pending.current?.abort();
        }}
      >
        <button
          aria-label={t('common.close')}
          className="native-feedback-close"
          type="button"
          onClick={() => dialog.current?.close()}
        >
          <X aria-hidden="true" size={18} />
        </button>
        {error && (
          <p className="native-feedback-error" role="alert">
            {t(error)}
          </p>
        )}
        {visibility !== 'initial' && (
          <FeedbackProvider createApi={feedbackApi}>
            <FeedbackPanel
              artifact={artifact}
              polling={visibility === 'open'}
              onOpenThread={openThread}
            />
          </FeedbackProvider>
        )}
      </dialog>
    </Context>
  );
}
