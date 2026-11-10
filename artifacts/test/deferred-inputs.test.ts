import { expect, test } from 'vitest';
import { createDeferredInputs } from '../src/server/deferred-inputs';

test('coalesces external notifications and resumes once', () => {
  const gate = createDeferredInputs(); const seen: string[] = [];
  const resume = gate.pause();
  gate.run('timer', () => seen.push('stale'));
  gate.run('timer', () => seen.push('latest'));
  gate.run('socket', () => seen.push('closed'));
  expect(seen).toEqual([]);
  resume(); resume();
  expect(seen).toEqual(['latest', 'closed']);
  gate.run('next', () => seen.push('live'));
  expect(seen.at(-1)).toBe('live');
});

test('one replay failure does not retain the pause or discard other notifications', () => {
  const gate = createDeferredInputs(); let cleaned = false;
  const resume = gate.pause();
  expect(() => gate.pause()).toThrow('already paused');
  gate.run('bad', () => { throw new Error('bad'); });
  gate.run('cleanup', () => { cleaned = true; });
  expect(resume).toThrow('Deferred project inputs failed');
  expect(cleaned).toBe(true); expect(gate.paused).toBe(false);
  expect(() => gate.pause()()).not.toThrow();
});
