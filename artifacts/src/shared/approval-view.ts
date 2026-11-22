interface Frontier {
  peer: string;
  counter: number;
}

export function approvalViewKey(frontiers: readonly Frontier[]): string {
  const tuples = frontiers.map(({ peer, counter }) => [peer, counter] as const);
  tuples.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return JSON.stringify(tuples);
}
