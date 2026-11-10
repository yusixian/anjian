// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';

import { installInspector } from '../src/inspector/runtime';

test('published inspector reads the DOM but rejects forged write commands', () => {
  document.body.innerHTML = '<section id="card" style="color: red"><button>Open</button></section>';
  const card = document.getElementById('card')!;
  const messages: Record<string, any>[] = [];
  const post = vi.spyOn(window.parent, 'postMessage').mockImplementation((message) => messages.push(message));
  const stop = installInspector(window, ['color'], 'crosshair', 'default', true);
  const send = (action: string, fields: Record<string, unknown> = {}) => {
    window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: {
      type: 'anjian:inspect', action, connection: 'public',
      session: messages.find((message) => message.type === 'anjian:inspect:tree')?.session,
      ...fields,
    } }));
  };
  try {
    send('enable');
    const tree = messages.find((message) => message.type === 'anjian:inspect:tree');
    expect(tree).toBeDefined();
    const id = tree!.nodes.find((node: { selector: string }) => node.selector === '#card').id;
    send('select', { id });
    expect(messages.at(-1)?.type).toBe('anjian:inspect:selection');
    send('describe', { request: 1, ids: [id] });
    expect(messages.at(-1)?.nodes[0]).toMatchObject({ id, html: expect.stringContaining('id="card"') });

    send('style', { id, property: 'color', value: 'blue' });
    send('reset');
    send('mode', { mode: 'comment' });
    expect(card.style.color).toBe('red');
    card.querySelector('button')!.click();
    expect(messages.at(-1)).toMatchObject({ type: 'anjian:inspect:selection', selection: { tag: 'button' } });
  } finally {
    stop();
    post.mockRestore();
    document.body.replaceChildren();
  }
});
