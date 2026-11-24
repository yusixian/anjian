import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { isObject } from '../shared/comments';

type RequestId = number | string;
type Task = {
  threadId: string;
  title: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  output: string;
  plan: string;
};

type PendingQuestion = {
  requestId: RequestId;
  threadId: string;
  questions: {
    id: string;
    header: string;
    question: string;
    options: { label: string; description: string }[];
  }[];
};

function requestId(value: unknown): value is RequestId {
  return typeof value === 'string' || Number.isSafeInteger(value);
}

function parseQuestions(input: unknown): PendingQuestion['questions'] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > 3) return null;
  const questions: PendingQuestion['questions'] = [];
  for (const item of input as unknown[]) {
    if (
      !isObject(item) ||
      typeof item.id !== 'string' ||
      typeof item.header !== 'string' ||
      typeof item.question !== 'string' ||
      questions.some(({ id }) => id === item.id)
    )
      return null;
    const options: PendingQuestion['questions'][number]['options'] = [];
    if (Array.isArray(item.options)) {
      for (const option of item.options as unknown[]) {
        if (
          !isObject(option) ||
          typeof option.label !== 'string' ||
          typeof option.description !== 'string'
        )
          return null;
        options.push({ label: option.label, description: option.description });
      }
    }
    questions.push({ id: item.id, header: item.header, question: item.question, options });
  }
  return questions;
}

/** Owns one App Server connection for a single trusted project directory. */
export function createCodexTaskSession(binary: string, cwd: string, changed: () => void) {
  const child = spawn(binary, ['app-server', '--listen', 'stdio://'], {
    cwd,
    env: Object.fromEntries(
      [
        'PATH',
        'HOME',
        'USERPROFILE',
        'CODEX_HOME',
        'TMPDIR',
        'TEMP',
        'TMP',
        'SystemRoot',
        'LANG',
      ].map((key) => [key, process.env[key]]),
    ),
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  const calls = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const tasks = new Map<string, Task>();
  const questions = new Map<RequestId, PendingQuestion>();
  const replies = new Map<RequestId, (status: boolean) => void>();
  let closed = false;
  let sequence = 0;

  function close() {
    if (closed) return;
    closed = true;
    lines.close();
    child.kill();
    for (const { reject } of calls.values()) reject(new Error('Codex App Server disconnected'));
    calls.clear();
    tasks.clear();
    questions.clear();
    for (const finish of replies.values()) finish(false);
    replies.clear();
    changed();
  }

  function send(message: object) {
    if (closed) throw new Error('Codex App Server disconnected');
    child.stdin.write(JSON.stringify(message) + '\n');
  }

  async function call(method: string, params: object) {
    if (closed) throw new Error('Codex App Server disconnected');
    const id = ++sequence;
    const timer = setTimeout(close, 15_000);
    try {
      return await new Promise<unknown>((resolve, reject) => {
        calls.set(id, { resolve, reject });
        send({ id, method, params });
      });
    } finally {
      clearTimeout(timer);
      calls.delete(id);
    }
  }

  child.once('error', close);
  child.once('close', close);
  child.stdin.on('error', close);
  lines.on('line', (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObject(message)) return;
    if (typeof message.method !== 'string') {
      if (typeof message.id !== 'number') return;
      const call = calls.get(message.id);
      if (message.error) call?.reject(new Error('Codex App Server rejected the request'));
      else call?.resolve(message.result);
      return;
    }

    const params = isObject(message.params) ? message.params : {};
    const threadId = typeof params.threadId === 'string' ? params.threadId : '';
    if (message.method === 'serverRequest/resolved' && requestId(params.requestId)) {
      if (
        questions.get(params.requestId)?.threadId === threadId &&
        questions.delete(params.requestId)
      ) {
        replies.get(params.requestId)?.(true);
        changed();
      }
      return;
    }
    const task = tasks.get(threadId);
    if (
      task?.status === 'running' &&
      message.method === 'item/completed' &&
      isObject(params.item) &&
      typeof params.item.text === 'string'
    ) {
      if (params.item.type === 'plan') task.plan = params.item.text.slice(0, 64_000);
      if (params.item.type === 'agentMessage') task.output = params.item.text.slice(0, 64_000);
      return;
    }
    if (
      task?.status === 'running' &&
      message.method === 'turn/completed' &&
      isObject(params.turn)
    ) {
      const status = params.turn.status;
      task.status = status === 'completed' || status === 'interrupted' ? status : 'failed';
      for (const [id, pending] of questions) {
        if (pending.threadId === threadId) {
          questions.delete(id);
          replies.get(id)?.(false);
        }
      }
      changed();
      return;
    }
    if (!requestId(message.id)) return;
    const parsed =
      message.method === 'item/tool/requestUserInput' && task?.status === 'running'
        ? parseQuestions(params.questions)
        : null;
    if (!parsed) {
      send({ id: message.id, error: { code: -32601, message: 'Unsupported Codex request' } });
      return;
    }
    questions.set(message.id, { requestId: message.id, threadId, questions: parsed });
    changed();
  });

  const ready = call('initialize', {
    clientInfo: { name: 'anjian', version: '1' },
    capabilities: { experimentalApi: true },
  }).then(() => send({ method: 'initialized' }));
  void ready.catch(close);

  return {
    close,
    get closed() {
      return closed;
    },
    pendingQuestions: () =>
      [...questions.values()].filter(({ requestId }) => !replies.has(requestId)),
    tasks: () => Array.from(tasks.values()).reverse(),
    async start(prompt: string) {
      await ready;
      const result = await call('thread/start', {
        cwd,
        sandbox: 'read-only',
        approvalPolicy: 'never',
      });
      if (
        !isObject(result) ||
        !isObject(result.thread) ||
        typeof result.thread.id !== 'string' ||
        typeof result.model !== 'string'
      )
        throw new Error('Codex App Server returned an invalid thread');
      const threadId = result.thread.id;
      if (tasks.size >= 30) {
        const finished = [...tasks.values()].find(({ status }) => status !== 'running');
        if (finished) tasks.delete(finished.threadId);
      }
      tasks.set(threadId, {
        threadId,
        title: prompt.slice(0, 160),
        status: 'running',
        output: '',
        plan: '',
      });
      try {
        await call('turn/start', {
          threadId,
          input: [{ type: 'text', text: prompt, text_elements: [] }],
          collaborationMode: {
            mode: 'plan',
            settings: { model: result.model, reasoning_effort: null, developer_instructions: null },
          },
        });
      } catch (error) {
        tasks.delete(threadId);
        throw error;
      }
      return threadId;
    },
    async answer(threadId: string, id: RequestId, answers: Record<string, string>) {
      const pending = questions.get(id);
      if (!pending || pending.threadId !== threadId || replies.has(id)) return false;
      if (pending.questions.some(({ id }) => !Object.hasOwn(answers, id) || !answers[id]?.trim()))
        return false;
      const timer = setTimeout(close, 15_000);
      try {
        return await new Promise<boolean>((resolve) => {
          replies.set(id, resolve);
          send({
            id,
            result: {
              answers: Object.fromEntries(
                pending.questions.map(({ id }) => [id, { answers: [answers[id]] }]),
              ),
            },
          });
        });
      } finally {
        clearTimeout(timer);
        replies.delete(id);
      }
    },
  };
}
