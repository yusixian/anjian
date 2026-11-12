import type { BuildInfo } from '../../artifacts/src/shared/build-info';

export function buildInfo(directory?: string, git?: (args: string[]) => string): BuildInfo;
