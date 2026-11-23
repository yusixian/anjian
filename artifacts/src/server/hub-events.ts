import fs from 'node:fs';

import type { MachinePaths } from './machine';

type HubEvent =
  | {
      action: 'keep';
      reason: 'same-version' | 'older-cli' | 'local-build' | 'local-build-settings';
      pid: number;
    }
  | {
      action: 'replace';
      reason: 'unresponsive' | 'version-changed' | 'settings-changed' | 'browser';
      pid: number;
    }
  | { action: 'stop'; reason: 'cli' | 'browser'; pid: number };

export function recordHubEvent(paths: MachinePaths, event: HubEvent) {
  try {
    fs.appendFileSync(
      paths.events,
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
      {
        mode: 0o600,
      },
    );
  } catch (error) {
    console.error(
      JSON.stringify({ type: 'hub-event-error', code: (error as NodeJS.ErrnoException).code }),
    );
  }
}
