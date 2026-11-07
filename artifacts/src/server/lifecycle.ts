import { portList } from './ports';

export interface ServerConfig {
  boardPorts: number[];
  boardOrigin?: string;
  publicOrigin?: string;
  host: string;
  openCmd: string | null;
  ports: number[];
  serverId: string | null;
  urlHost: string;
}

const SERVER_ID_ARG = '--artifacts-server-id=';
const PORT_ARG = '--port=';

function configuredOrigin(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP(S) origin without credentials, path or query`);
  }
  return url.origin;
}

export const isLoopback = (host: string) =>
  host === '127.0.0.1' || host === 'localhost' || host === '::1';

export function parseEnv(
  env: Record<string, string | undefined>,
  argv: string[] = [],
): ServerConfig {
  const host = env.ARTIFACTS_HOST || '127.0.0.1';
  const urlHost = env.ARTIFACTS_URL_HOST || (isLoopback(host) ? 'localhost' : host);
  const serverIdArg = argv.find((arg) => arg.startsWith(SERVER_ID_ARG));
  const portArg = argv.find((arg) => arg.startsWith(PORT_ARG));
  const port = portArg ? Number(portArg.slice(PORT_ARG.length)) : NaN;
  return {
    host,
    urlHost,
    ports: Number.isInteger(port) && port >= 0 && port < 65536 ? [port] : portList(env, 'main'),
    boardPorts: portList(env, 'board'),
    openCmd: env.ARTIFACTS_OPEN_CMD || null,
    serverId: serverIdArg ? serverIdArg.slice(SERVER_ID_ARG.length) : null,
    publicOrigin: configuredOrigin(env.ANJIAN_PUBLIC_ORIGIN, 'ANJIAN_PUBLIC_ORIGIN'),
    boardOrigin: configuredOrigin(env.ANJIAN_BOARD_ORIGIN, 'ANJIAN_BOARD_ORIGIN'),
  };
}

export function browserLauncher(
  platform: string,
  url: string,
): { bin: string; args: string[] } | null {
  if (platform === 'darwin') return { bin: 'open', args: [url] };
  if (platform === 'win32') return { bin: 'cmd', args: ['/c', 'start', '""', url] };
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd')
    return { bin: 'xdg-open', args: [url] };
  return null;
}

export function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
