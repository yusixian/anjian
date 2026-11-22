import { machinePaths, readProjects } from '../server/machine';
import { ARTIFACT_LOCATOR_SOURCE } from '../shared/ids';
import { CliError, invocation, projectPaths } from './paths';
import { readText } from './process';
import { bindingFor, readConfig, request } from './remote-core';

const AGENT_ROUTE = new RegExp(
  `^/api/agent/(document|artboard|slides|storyboard|whiteboard)/(${ARTIFACT_LOCATOR_SOURCE})/(comments|check|changes|review)$`,
);

export const notRunning = (project: string) =>
  `No artifacts server is running for this project. Start it with \`${invocation()} start --project-dir ${project}\`, then run this again.`;

export interface ServerResponse {
  json: Record<string, any>;
  status: number;
}

const readUrl = (file: string) => {
  try {
    const { url, localUrl } = JSON.parse(readText(file) ?? '') as {
      url?: unknown;
      localUrl?: unknown;
    };
    return typeof localUrl === 'string' ? localUrl : typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
};

function serverUrl(project: string, projectInfo: string) {
  const machine = machinePaths();
  const machineUrl = readUrl(machine.info);
  if (machineUrl) {
    const registered = readProjects(machine.projects).some((entry) => entry.dir === project);
    return registered ? machineUrl : null;
  }
  return readUrl(projectInfo);
}

export function serverClient(projectDir: string) {
  const paths = projectPaths(projectDir);
  const linked = readConfig().bindings[paths.project];
  if (linked) {
    const { binding, credential } = bindingFor(paths.project);
    return {
      project: paths.project,
      async call(method: string, route: string, body?: unknown): Promise<ServerResponse> {
        const document = /^\/api\/document\/([\w-]+)\/feedback\/approvals$/.exec(route)?.[1];
        if (document && method === 'GET') {
          const result = await request(
            binding.origin,
            `/api/remote/projects/${encodeURIComponent(binding.projectId)}/feedback/approvals/${encodeURIComponent(document)}`,
            { method, token: credential.token },
          );
          return { status: result.status, json: result.json };
        }
        const match = AGENT_ROUTE.exec(route);
        if (!match) throw new CliError('This command cannot use the remote agent API');
        const remoteRoute = `/api/remote/projects/${encodeURIComponent(binding.projectId)}/agent/${match[1]}/${match[2]}/${match[3]}`;
        const result = await request(binding.origin, remoteRoute, {
          method,
          body,
          token: credential.token,
        });
        return { status: result.status, json: result.json };
      },
    };
  }
  const url = serverUrl(paths.project, paths.info);
  if (!url) throw new CliError(notRunning(paths.project));
  const base = new URL(url);
  const key = base.searchParams.get('key') ?? '';
  if (base.hostname === 'localhost') base.hostname = '127.0.0.1';
  return {
    project: paths.project,
    async call(method: string, route: string, body?: unknown): Promise<ServerResponse> {
      let res: Response;
      try {
        res = await fetch(`${base.origin}${route}?key=${encodeURIComponent(key)}`, {
          method,
          headers: {
            'X-Anjian-Project': encodeURIComponent(paths.project),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new CliError(notRunning(paths.project));
      }
      return {
        status: res.status,
        json: (await res.json().catch(() => ({}))) as Record<string, any>,
      };
    },
  };
}
