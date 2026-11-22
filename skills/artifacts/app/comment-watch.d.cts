export type Sources = Map<string, Set<string>>;
export type FeedbackEvent = {
  type: 'anjian-comments' | 'anjian-choices';
  artifact: string;
  round?: string;
  withdrawn?: boolean;
};

export function createProjectPoll(
  name: string,
  session: string,
): (sources: Sources, changed: Sources) => { project: string; event: FeedbackEvent }[];

export function unreadCount(
  project: string,
  artifact: string,
  name: string,
  session: string,
): number | null;
