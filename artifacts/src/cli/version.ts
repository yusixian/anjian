import { BUILD_INFO } from '../shared/build-info';
import type { CommandSpec } from './command';

export const versionCommand: CommandSpec = {
  name: 'version',
  summary: 'Show this CLI’s version and build identity (independent of the server)',
  options: {},
  run: async (_, emit) => {
    const { version, sha, state } = BUILD_INFO;
    emit({ type: 'cli-version', version, sha, state });
    return 0;
  },
  text: (value) =>
    value.type === 'cli-version'
      ? `Anjian CLI ${value.version}\nCommit: ${value.sha ?? 'unknown'} (${value.state})`
      : null,
};
