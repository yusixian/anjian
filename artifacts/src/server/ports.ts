import type http from 'node:http';

import { listen } from './http';

export const MAIN_PORTS = [27419, 27420, 27421];
export const BOARD_PORTS = [27429, 27430, 27431];

export function portList(env: Record<string, string | undefined>, kind: 'main' | 'board') {
  const raw = kind === 'main' ? env.ANJIAN_ARTIFACTS_PORTS : env.ANJIAN_ARTIFACTS_BOARD_PORTS;
  const fallback = kind === 'main' ? MAIN_PORTS : BOARD_PORTS;
  if (!raw) return fallback;
  const ports = raw.split(',').map((part) => Number(part.trim()));
  return ports.length && ports.every((port) => Number.isInteger(port) && port >= 0 && port < 65536)
    ? ports
    : fallback;
}

export async function listenFirst(server: http.Server, host: string, ports: number[]) {
  for (const port of ports) {
    try {
      return await listen(server, host, port);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`Ports ${ports.join(', ')} are all in use; pick a free one with --port <n>`);
}
