import { PassThrough } from 'node:stream';
import { afterEach, expect, test, vi } from 'vitest';
import { guardSocket, socketAuthorized } from '../src/server/socket-access';

afterEach(() => vi.useRealTimers());

test('socket reads current authorization before accepting or sending a message', () => {
  const socket = new PassThrough();
  let allowed = true;
  guardSocket(socket, () => allowed);
  expect(socketAuthorized(socket)).toBe(true);
  allowed = false;
  expect(socketAuthorized(socket)).toBe(false);
  expect(socket.destroyed).toBe(true);
});

test('an idle socket is closed on revocation and its timer is cleaned up', async () => {
  vi.useFakeTimers();
  const socket = new PassThrough();
  let allowed = true;
  const closed = new Promise<void>((resolve) => socket.once('close', resolve));
  guardSocket(socket, () => allowed);
  allowed = false;
  await vi.advanceTimersByTimeAsync(1000);
  await closed;
  expect(socket.destroyed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('authorization storage errors terminate a live socket instead of preserving access', () => {
  const socket = new PassThrough();
  guardSocket(socket, () => { throw new Error('store unavailable'); });
  expect(socketAuthorized(socket)).toBe(false);
  expect(socket.destroyed).toBe(true);
});
