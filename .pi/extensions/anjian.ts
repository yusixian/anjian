import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

import { watchPiFeedback } from '../artifact-feedback.ts';

const EXTREMELY_IMPORTANT_MARKER = '<EXTREMELY_IMPORTANT>';
const BOOTSTRAP_MARKER = 'anjian:using-anjian bootstrap for pi';

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(extensionDir, '../..');
const skillsDir = resolve(packageRoot, 'skills');
const bootstrapSkillPath = resolve(skillsDir, 'using-anjian', 'SKILL.md');

const launcher = resolve(skillsDir, 'artifacts', 'app', 'anjian.cjs');
const openedEntry = 'anjian-opened-artifact';
const artifactPattern = /^(?:document|artboard)\/[a-z0-9][a-z0-9-]*$/;
const run = promisify(execFile);

let cachedBootstrap: string | null | undefined;

export default function anjianPiExtension(pi: ExtensionAPI) {
  let injectBootstrap = true;
  type Delivery = { id: string; finish: (accepted: boolean) => void };
  type Scope = {
    id: string;
    watcher: ReturnType<typeof watchPiFeedback>;
    opened: Set<string>;
    delivery?: Delivery;
  };
  let current: Scope | null = null;

  const close = () => {
    const previous = current;
    current = null;
    previous?.watcher.close();
    previous?.delivery?.finish(false);
  };

  function followBranch(ctx: ExtensionContext) {
    close();
    const id = ctx.sessionManager.getSessionId();
    let warned = false;
    const watcher = watchPiFeedback({
      session: id,
      canDeliver: () => ctx.isIdle(),
      deliver: async (message) => {
        if (current !== scope || !ctx.model) throw new Error('Pi is not available for feedback.');
        await new Promise<void>((resolve, reject) => {
          const id = randomUUID();
          const timeout = setTimeout(() => finish(false), 15000);
          function finish(accepted: boolean) {
            clearTimeout(timeout);
            delete scope.delivery;
            if (accepted) resolve();
            else reject(new Error('Pi did not record the feedback notification.'));
          }
          scope.delivery = { id, finish };
          try {
            pi.sendMessage(
              {
                customType: 'anjian-artifact-feedback',
                content: message,
                display: true,
                details: { id },
              },
              { deliverAs: 'followUp', triggerTurn: true },
            );
          } catch {
            finish(false);
          }
        });
        warned = false;
      },
      onError: () => {
        if (warned || current !== scope) return;
        warned = true;
        ctx.ui.notify(
          'Anjian feedback is pending. Use the comment list command if Pi cannot resume.',
          'warning',
        );
      },
    });
    const scope: Scope = { id, watcher, opened: new Set() };
    current = scope;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'custom' || entry.customType !== openedEntry) continue;
      const { project, artifact } = (entry.data ?? {}) as { project?: unknown; artifact?: unknown };
      if (
        typeof project !== 'string' ||
        !isAbsolute(project) ||
        typeof artifact !== 'string' ||
        !artifactPattern.test(artifact)
      )
        continue;
      watcher.subscribe(project, artifact);
      scope.opened.add(JSON.stringify([project, artifact]));
    }
  }

  pi.on('session_start', (_event, ctx) => {
    injectBootstrap = true;
    followBranch(ctx);
  });
  pi.on('session_tree', (_event, ctx) => followBranch(ctx));
  pi.on('session_shutdown', close);
  pi.on('message_end', ({ message }) => {
    if (message.role !== 'custom' || message.customType !== 'anjian-artifact-feedback') return;
    const delivery = current?.delivery;
    const details = message.details as { id?: unknown } | undefined;
    if (delivery && delivery.id === details?.id) delivery.finish(true);
  });

  async function openArtifact(
    artifact: string,
    projectDir: string | undefined,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ) {
    if (!artifactPattern.test(artifact)) throw new Error('Use document/<id> or artboard/<id>.');
    const scope = current;
    if (!scope || scope.id !== ctx.sessionManager.getSessionId())
      throw new Error('The Pi session is no longer active.');
    const env = { ...process.env };
    delete env.CODEX_THREAD_ID;
    delete env.CLAUDE_CODE_SESSION_ID;
    const { stdout } = await run(
      process.execPath,
      [
        launcher,
        'start',
        '--artifact',
        artifact,
        '--project-dir',
        resolve(ctx.cwd, projectDir ?? '.'),
        '--json',
        '--background',
      ],
      { env, signal: signal ?? ctx.signal, timeout: 30000 },
    );
    const opened = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find(
        (event) =>
          event.type === 'server-started' &&
          typeof event.root === 'string' &&
          typeof event.link === 'string',
      );
    if (!opened) throw new Error('Anjian did not return an artifact link.');
    if (current !== scope || scope.id !== ctx.sessionManager.getSessionId())
      throw new Error('The Pi session changed before Anjian opened the artifact.');
    const project = dirname(dirname(opened.root));
    const key = JSON.stringify([project, artifact]);
    if (!scope.opened.has(key)) {
      pi.appendEntry(openedEntry, { project, artifact });
      scope.opened.add(key);
    }
    scope.watcher.subscribe(project, artifact);
    return opened.link as string;
  }

  pi.registerCommand('anjian-open', {
    description: 'Open a local Anjian document or artboard and receive its feedback in Pi',
    async handler(args, ctx) {
      const [artifact = '', ...directory] = args.trim().split(/\s+/);
      const link = await openArtifact(artifact, directory.join(' ') || undefined, ctx);
      ctx.ui.notify(link, 'info');
    },
  });

  pi.registerTool({
    name: 'anjian_open',
    label: 'Open Anjian artifact',
    promptSnippet: 'Open a local Anjian artifact and subscribe to its review feedback',
    description:
      'Open a local Anjian document or artboard and subscribe this Pi session to feedback.',
    parameters: {
      type: 'object',
      properties: {
        artifact: { type: 'string', description: 'document/<id> or artboard/<id>' },
        projectDir: {
          type: 'string',
          description: 'Project directory, defaults to the current working directory',
        },
      },
      required: ['artifact'],
      additionalProperties: false,
    } as unknown as Parameters<ExtensionAPI['registerTool']>[0]['parameters'],
    async execute(_call, args, signal, _update, ctx) {
      const { artifact, projectDir } = args as { artifact: string; projectDir?: string };
      const link = await openArtifact(artifact, projectDir, ctx, signal);
      return { content: [{ type: 'text', text: link }], details: { artifact } };
    },
  });

  pi.on('session_compact', async () => {
    injectBootstrap = true;
  });

  pi.on('agent_end', async () => {
    injectBootstrap = false;
  });

  pi.on('context', async (event) => {
    if (!injectBootstrap) return;
    if (event.messages.some(messageContainsBootstrap)) return;

    const bootstrap = getBootstrapContent();
    if (!bootstrap) return;

    const bootstrapMessage = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: bootstrap }],
      timestamp: Date.now(),
    };

    const insertAt = firstNonCompactionSummaryIndex(event.messages);
    return {
      messages: [
        ...event.messages.slice(0, insertAt),
        bootstrapMessage,
        ...event.messages.slice(insertAt),
      ],
    };
  });
}

function getBootstrapContent(): string | null {
  if (cachedBootstrap !== undefined) return cachedBootstrap;

  try {
    const skillContent = readFileSync(bootstrapSkillPath, 'utf8');
    const body = stripFrontmatter(skillContent);
    cachedBootstrap = `${EXTREMELY_IMPORTANT_MARKER}
${BOOTSTRAP_MARKER}

You have Anjian.

The using-anjian skill content is included below and is already loaded for this Pi session. Follow it now. Do not try to load using-anjian again.

${body}

${piToolMapping()}
</EXTREMELY_IMPORTANT>`;
    return cachedBootstrap;
  } catch {
    cachedBootstrap = null;
    return null;
  }
}

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match ? match[1] : content).trim();
}

function piToolMapping(): string {
  return `## Pi tool mapping

Pi has native skills but does not expose Claude Code's \`Skill\` tool. When a Anjian instruction says to invoke a skill, use Pi's native skill system instead: load the relevant \`SKILL.md\` with \`read\` when the skill applies, or let a human invoke \`/skill:name\` explicitly.

Pi's built-in coding tools are lowercase: \`read\`, \`write\`, \`edit\`, \`bash\`, plus optional \`grep\`, \`find\`, and \`ls\`. Use those for the corresponding actions: read a file, create or edit files, run shell commands, search file contents, find files by name, and list directories.

Pi does not ship a standard subagent tool. If a subagent tool such as \`subagent\` from \`pi-subagents\` is available, use it for Anjian subagent workflows. If no subagent tool is available, do the work in this session or explain the missing capability instead of inventing \`Task\` calls.

Pi does not ship a standard task-list tool. If an installed todo/task tool is available, use it. Otherwise track work in plan files or a repo-local \`TODO.md\` when task tracking is needed. Treat older \`TodoWrite\` references as this task-tracking action.`;
}

function messageContainsBootstrap(message: unknown): boolean {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content.includes(BOOTSTRAP_MARKER);
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    return (
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string' &&
      (part as { text: string }).text.includes(BOOTSTRAP_MARKER)
    );
  });
}

function firstNonCompactionSummaryIndex(messages: unknown[]): number {
  let index = 0;
  while ((messages[index] as { role?: unknown } | undefined)?.role === 'compactionSummary') {
    index += 1;
  }
  return index;
}
