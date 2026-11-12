import { createContext, type ReactNode, useContext, useMemo } from 'react';

import type { createFeedbackApi } from './api';

type Factory = (artifact: string) => ReturnType<typeof createFeedbackApi>;
const Context = createContext<Factory | null>(null);

export function FeedbackProvider({
  createApi,
  children,
}: {
  createApi: Factory;
  children: ReactNode;
}) {
  return <Context value={createApi}>{children}</Context>;
}
export function useFeedbackEnabled() {
  return useContext(Context) !== null;
}
export function useOptionalFeedbackApi(artifact: string | null) {
  const factory = useContext(Context);
  return useMemo(() => (factory && artifact ? factory(artifact) : null), [factory, artifact]);
}
export function useFeedbackApi(artifact: string) {
  const api = useOptionalFeedbackApi(artifact);
  if (!api) throw new Error('Feedback requires an API provider');
  return api;
}
