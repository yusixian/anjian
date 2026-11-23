export interface VerificationRun {
  check: string;
  exitCode: number | null;
  finishedAt: string;
  id: string;
  output: string;
  sha256: string;
  startedAt: string;
  status: 'passed' | 'failed' | 'error';
  title: string;
}

export interface VerificationSnapshot {
  checks: { id: string; title: string }[];
  running: string | null;
  runs: Omit<VerificationRun, 'output'>[];
  writeFailed?: true;
}

export const VERIFICATION_RUN_ID = /^\d{13}-[a-f0-9-]{36}$/;
