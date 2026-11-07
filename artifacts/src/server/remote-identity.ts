import type http from 'node:http';

// Request-local identity is set only after device authorization, never from client headers.
const identity = Symbol('remote-device');
type DeviceRequest = http.IncomingMessage & { [identity]?: string };
export function setRemoteDevice(req: http.IncomingMessage, id: string) {
  (req as DeviceRequest)[identity] = id;
}
export function remoteCommentCursor(req: http.IncomingMessage, fallback: string) {
  const id = (req as DeviceRequest)[identity];
  return id ? `device:${id}` : fallback;
}
