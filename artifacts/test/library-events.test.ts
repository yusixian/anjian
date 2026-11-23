import { EventEmitter } from 'node:events';
import type http from 'node:http';

import { expect, test, vi } from 'vitest';

import { createLibraryEvents } from '../src/server/library-events';

test('coalesces edits and sends updates only to members with access', () => {
  vi.useFakeTimers();
  const access = new Map([
    ['member-one', ['project-one']],
    ['member-two', ['project-two']],
  ]);
  const cookie = (req: http.IncomingMessage) => req.headers.cookie ?? '';
  const events = createLibraryEvents(
    (req) => access.get(cookie(req)) ?? [],
    (req) => access.has(cookie(req)),
  );
  const subscribe = (member: string) => {
    const req = { headers: { cookie: member } } as http.IncomingMessage;
    const stream = Object.assign(new EventEmitter(), {
      writeHead: vi.fn(),
      write: vi.fn(() => true),
      end: vi.fn(),
    });
    events.subscribe(
      req,
      stream as unknown as http.ServerResponse,
      new URL('https://anjian.example'),
    );
    stream.write.mockClear();
    return stream;
  };
  try {
    const first = subscribe('member-one');
    const second = subscribe('member-two');
    for (let edit = 0; edit < 8; edit++) {
      events.changed('project-one');
      vi.advanceTimersByTime(160);
    }
    vi.advanceTimersByTime(300);
    expect(first.write.mock.calls).toEqual([['data: changed\n\n']]);
    expect(second.write).not.toHaveBeenCalled();

    access.delete('member-one');
    first.write.mockClear();
    events.changed('project-one');
    vi.advanceTimersByTime(300);
    expect(first.end).toHaveBeenCalled();
    expect(first.write).not.toHaveBeenCalled();
  } finally {
    events.close();
    vi.useRealTimers();
  }
});
