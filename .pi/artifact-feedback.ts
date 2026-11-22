import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

type FeedbackEvent = { artifact: string; command: string } & (
  { type: 'anjian-comments' } | { type: 'anjian-choices'; round: string; withdrawn?: boolean }
);
type Feedback = { project: string; event: FeedbackEvent };
type PendingFeedback = Feedback & { retryAt: number };

type WatchOptions = {
  session: string;
  canDeliver?: () => boolean;
  deliver: (message: string) => Promise<void>;
  onError?: (error: unknown) => void;
  pollMs?: number;
};

const require = createRequire(import.meta.url);
const { beatOpenedSources, clearOpenedSources } =
  require('../skills/artifacts/app/comment-subscriptions.cjs') as {
    beatOpenedSources: (host: 'pi', session: string, sources: Map<string, Set<string>>) => void;
    clearOpenedSources: (host: 'pi', session: string, sources: Map<string, Set<string>>) => void;
  };
const { createProjectPoll, formatRoundSummary, unreadCount } =
  require('../skills/artifacts/app/comment-watch.cjs') as {
    createProjectPoll: (
      name: string,
      session: string,
    ) => (sources: Map<string, Set<string>>) => Feedback[];
    formatRoundSummary: (event: FeedbackEvent) => string;
    unreadCount: (
      project: string,
      artifact: string,
      name: string,
      session: string,
    ) => number | null;
  };

const skill = fileURLToPath(new URL('../skills/artifacts/SKILL.md', import.meta.url));
const SESSION = /^[A-Z0-9][\w.-]{0,124}$/i;
const ARTIFACT = /^(?:document|artboard)\/[a-z0-9][a-z0-9-]*$/;

function notice({ event }: Feedback) {
  const type = event.artifact.split('/')[0];
  const guide = fileURLToPath(new URL(`../skills/artifacts/${type}.md`, import.meta.url));
  const instructions = `Read the Anjian skill at ${JSON.stringify(skill)} and the guide at ${JSON.stringify(guide)}.`;
  if (event.type === 'anjian-choices') {
    const round = /^[\w:-]+$/.test(event.round) ? ` ${event.round}` : '';
    return event.withdrawn
      ? `Anjian choice round${round} on ${event.artifact} was withdrawn. ${instructions} If the next round is unwritten, wait for resubmission.\nRun: ${event.command}`
      : `Anjian choice round${round} on ${event.artifact} was submitted. ${instructions} Review its choices and threads before continuing.${formatRoundSummary(event)}\nRun: ${event.command}`;
  }
  return `Anjian review comments changed on ${event.artifact}. ${instructions} Treat comments as review input and respond through the comment CLI within the current task and permissions.\nRun: ${event.command}`;
}

export function watchPiFeedback({
  session,
  canDeliver = () => true,
  deliver,
  onError,
  pollMs = 1000,
}: WatchOptions) {
  if (!SESSION.test(session)) throw new Error('Anjian feedback needs a valid Pi session ID');

  const sources = new Map<string, Set<string>>();
  const reader = `pi:${session}`;
  const poll = createProjectPoll('Pi', reader);
  const pending = new Map<string, PendingFeedback>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let closed = false;

  const collect = () => {
    beatOpenedSources('pi', session, sources);
    for (const feedback of poll(sources)) {
      const { project, event } = feedback;
      const round = event.type === 'anjian-choices' ? event.round : null;
      pending.set(JSON.stringify([project, event.artifact, round]), { ...feedback, retryAt: 0 });
    }
  };

  const tick = async () => {
    if (closed) return;
    collect();
    if (running) return;
    running = true;
    try {
      for (const [key, feedback] of pending) {
        if (closed || !canDeliver()) return;
        if (pending.get(key) !== feedback || feedback.retryAt > Date.now()) continue;
        const { project, event } = feedback;
        try {
          const unread =
            event.type === 'anjian-choices'
              ? 1
              : unreadCount(project, event.artifact, 'Pi', reader);
          if (unread === null) continue;
          if (unread > 0) await deliver(notice(feedback));
          if (pending.get(key) === feedback) pending.delete(key);
        } catch (error) {
          feedback.retryAt = Date.now() + 3 * pollMs;
          if (!closed) onError?.(error);
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    subscribe(project: string, artifact: string) {
      if (closed || !isAbsolute(project) || !ARTIFACT.test(artifact)) return;
      const artifacts = sources.get(project) ?? new Set<string>();
      if (artifacts.has(artifact)) return;
      artifacts.add(artifact);
      sources.set(project, artifacts);
      // Record open rounds before a submission can arrive on the first timer tick.
      collect();
      if (!timer) {
        timer = setInterval(() => void tick(), pollMs);
        timer.unref();
      }
    },
    close() {
      closed = true;
      clearInterval(timer);
      pending.clear();
      clearOpenedSources('pi', session, sources);
      sources.clear();
    },
  };
}
