import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { FeedbackConnection, QuestionItem, QuestionMutation } from '../feedback/api';
import { useOptionalFeedbackApi } from '../feedback/FeedbackProvider';

interface QuestionStore {
  connections: FeedbackConnection[];
  failed: boolean;
  items: QuestionItem[];
  mutate: (mutation: QuestionMutation) => Promise<void>;
  refresh: () => Promise<void>;
  register: () => () => void;
}
const Context = createContext<QuestionStore | null>(null);

export function DocumentQuestions({
  artifact,
  children,
}: {
  artifact: string | null;
  children: ReactNode;
}) {
  const api = useOptionalFeedbackApi(artifact);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<QuestionItem[]>([]);
  const [connections, setConnections] = useState<FeedbackConnection[]>([]);
  const [failed, setFailed] = useState(false);
  const revision = useRef(0);
  const register = useCallback(() => {
    setCount((n) => n + 1);
    return () => setCount((n) => n - 1);
  }, []);
  const refresh = useCallback(async () => {
    if (!api) return;
    const request = ++revision.current;
    try {
      const snapshot = await api.questions();
      if (request !== revision.current) return;
      setItems(snapshot.items);
      setConnections(snapshot.connections);
      setFailed(false);
    } catch {
      if (request === revision.current) setFailed(true);
    }
  }, [api]);
  useEffect(() => {
    if (!api || !count) return;
    void refresh();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    window.addEventListener('focus', refresh);
    return () => {
      ++revision.current;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [api, count, refresh]);
  const mutate = async (mutation: QuestionMutation) => {
    if (!api) throw new Error('feedback unavailable');
    const { item } = await api.answerQuestion(mutation);
    ++revision.current;
    setItems((old) => [...old.filter((entry) => entry.id !== item.id), item]);
    setFailed(false);
  };
  return (
    <Context value={api ? { items, connections, failed, register, refresh, mutate } : null}>
      {children}
    </Context>
  );
}

export function useDocumentQuestions() {
  const store = useContext(Context);
  const register = store?.register;
  useEffect(() => register?.(), [register]);
  return store;
}
