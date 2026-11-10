import type { Duplex } from 'node:stream';

const checks = new WeakMap<Duplex, () => boolean>();

export function socketAuthorized(socket: Duplex): boolean {
  if (socket.destroyed) return false;
  try {
    if (checks.get(socket)?.() !== false) return true;
  } catch { /* Unavailable membership metadata must fail closed. */ }
  socket.destroy();
  return false;
}

/** Check active streams as well as inbound/outbound messages after membership changes. */
export function guardSocket(socket: Duplex, allowed: () => boolean) {
  checks.set(socket, allowed);
  const timer = setInterval(() => socketAuthorized(socket), 1000);
  timer.unref();
  socket.once('close', () => { clearInterval(timer); checks.delete(socket); });
}
