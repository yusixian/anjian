import { describe, expect, test } from 'vitest';

import { injectRuntime } from '../src/server/inject';

describe('injectRuntime', () => {
  test('an icon-only HTML page keeps its own theme without loading Lobe UI', () => {
    const out = injectRuntime('<head></head><anjian-icon name="copy"></anjian-icon>', {
      uiRuntimeUrl: '/runtime/anjian-ui.js',
    });
    expect(out).toContain('src="/runtime/anjian-icons.js"');
    expect(out).not.toContain('src="/runtime/anjian-ui.js"');
  });

  test('artboard icons get their standalone runtime without loading the UI theme', () => {
    const out = injectRuntime('<head></head><anjian-icon name="message-square"></anjian-icon>', {
      inspector: true,
      uiRuntimeUrl: '/runtime/anjian-ui.js',
    });
    expect(out).toContain('/runtime/anjian-icons.js');
    expect(out).not.toContain('src="/runtime/anjian-ui.js"');
  });

  test('UI pages load icons before the UI runtime, including for dynamically created controls', () => {
    const out = injectRuntime('<meta name="anjian-ui" content="1">', {
      uiRuntimeUrl: '/runtime/anjian-ui.js',
    });
    expect(out.indexOf('src="/runtime/anjian-icons.js"')).toBeGreaterThan(-1);
    expect(out.indexOf('anjian-icons.js')).toBeLessThan(out.indexOf('anjian-ui.js'));
  });

  test("puts the runtime script first inside <head>, before the page's own scripts", () => {
    const out = injectRuntime('<!doctype html><html><HEAD><script>page()</script></HEAD></html>');
    const runtime = out.indexOf('anjian:snapshot');
    expect(runtime).toBeGreaterThan(out.indexOf('<HEAD>'));
    expect(runtime).toBeLessThan(out.indexOf('page()'));
  });

  test('injects the UI runtime for custom elements when a runtime URL is given', () => {
    const url = '/c/token/runtime/anjian-ui.js';
    const out = injectRuntime(
      '<html><head></head><body><anjian-button>Go</anjian-button></body></html>',
      {
        uiRuntimeUrl: url,
      },
    );
    expect(out).toContain(`<script defer src="${url}"></script>`);
    expect(out.indexOf('anjian:snapshot')).toBeLessThan(out.indexOf('anjian-ui.js'));
  });

  test('injects the UI runtime for a meta opt-in and not for plain pages', () => {
    const url = '/c/token/runtime/anjian-ui.js';
    expect(injectRuntime('<meta name="anjian-ui" content="1">', { uiRuntimeUrl: url })).toContain(
      'anjian-ui.js',
    );
    expect(injectRuntime('<p>plain</p>', { uiRuntimeUrl: url })).not.toContain('anjian-ui.js');
    expect(injectRuntime('<anjian-button>Go</anjian-button>')).not.toContain('anjian-ui.js');
  });

  test('keeps line numbers when the UI runtime is injected too', () => {
    const page =
      '<!doctype html>\n<html>\n<head>\n<title>x</title>\n</head>\n<body>\n<anjian-button>Go</anjian-button>\n</body>\n</html>';
    const out = injectRuntime(page, { uiRuntimeUrl: '/c/token/runtime/anjian-ui.js' });
    expect(out.split('\n')).toHaveLength(page.split('\n').length);
    expect(out.split('\n')[6]).toBe('<anjian-button>Go</anjian-button>');
  });

  test('keeps every line of the page on its original line number', () => {
    const page =
      '<!doctype html>\n<html>\n<head>\n<title>x</title>\n</head>\n<body>\n<script>boom()</script>\n</body>\n</html>';
    const out = injectRuntime(page);
    expect(out.split('\n')).toHaveLength(page.split('\n').length);
    expect(out.split('\n')[6]).toBe('<script>boom()</script>');
  });

  test('the injected script is valid JavaScript', () => {
    const out = injectRuntime('<p>x</p>');
    const code = out.slice('<script>'.length, out.indexOf('</script>'));
    expect(() => new Function(code)).not.toThrow();
  });

  test('artboard inspection keeps original HTML line numbers and produces valid JavaScript', () => {
    const page =
      '<!doctype html>\n<html>\n<head></head>\n<body>\n<p>Original line</p>\n</body></html>';
    const html = injectRuntime(page, { inspector: true });
    expect(html.split('\n')[4]).toBe('<p>Original line</p>');
    const code = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
    expect(() => new Function(code)).not.toThrow();
  });

  test('without <head>, the script goes after the doctype and <html> so the page stays in standards mode', () => {
    expect(
      injectRuntime('<!DOCTYPE html><meta charset=utf-8><title>x</title><p>y').startsWith(
        '<!DOCTYPE html><script>',
      ),
    ).toBe(true);
    expect(
      injectRuntime('<!doctype html>\n<html lang="en"><body>z').startsWith(
        '<!doctype html>\n<html lang="en"><script>',
      ),
    ).toBe(true);
  });

  test('an embedded page gets a transparent, theme-following base style before its own styles', () => {
    const out = injectRuntime('<head><style>body{margin:4px}</style></head>', { embedded: true });
    const base = out.indexOf('color-scheme:light dark');
    expect(base).toBeGreaterThan(-1);
    expect(out).toContain('background:transparent');
    expect(base).toBeLessThan(out.indexOf('body{margin:4px}'));
    expect(injectRuntime('<head></head>')).not.toContain('color-scheme');
  });

  describe('in a dynamic block', () => {
    function run(hash: string) {
      const listeners: Record<string, (event?: unknown) => void> = {};
      const posted: unknown[] = [];
      const dispatched: CustomEvent[] = [];
      let observe: () => void = () => {};
      const env = {
        window: {} as Record<string, unknown>,
        location: { hash },
        parent: { postMessage: (message: unknown) => posted.push(message) },
        addEventListener: (type: string, fn: (event?: unknown) => void) => (listeners[type] = fn),
        document: {
          documentElement: { offsetHeight: 412 },
          dispatchEvent: (event: CustomEvent) => dispatched.push(event),
        },
        CustomEvent: class {
          constructor(
            public type: string,
            public init?: unknown,
          ) {}
        },
        ResizeObserver: class {
          constructor(fn: () => void) {
            observe = fn;
          }
          observe() {}
        },
      };
      const out = injectRuntime('<p>x</p>');
      const code = out.slice('<script>'.length, out.indexOf('</script>'));
      new Function(...Object.keys(env), code)(...Object.values(env));
      return { env, listeners, posted, dispatched, resize: () => observe() };
    }

    test('props in the URL hash are on window.anjianProps before page scripts run', () => {
      const { env } = run(`#anjian-props=${encodeURIComponent('{"radius":8}')}`);
      expect(env.window.anjianProps).toEqual({ radius: 8 });
    });

    test('a page without props gets an empty object', () => {
      expect(run('').env.window.anjianProps).toEqual({});
    });

    test('new props in the hash update window.anjianProps and fire anjian-props', () => {
      const { env, listeners, dispatched } = run('');
      env.location.hash = `#anjian-props=${encodeURIComponent('{"radius":4}')}`;
      listeners.hashchange!();
      expect(env.window.anjianProps).toEqual({ radius: 4 });
      expect(dispatched.map((event) => event.type)).toEqual(['anjian-props']);
    });

    test('the content height is posted to the parent when it changes', () => {
      const { posted, resize, env } = run('');
      resize();
      resize();
      env.document.documentElement.offsetHeight = 500;
      resize();
      expect(posted).toEqual([
        { type: 'anjian:height', height: 412 },
        { type: 'anjian:height', height: 500 },
      ]);
    });
  });

  test('prepends the script to a page without <head>', () => {
    const out = injectRuntime('<p>hello</p>');
    expect(out.startsWith('<script>')).toBe(true);
    expect(out.endsWith('<p>hello</p>')).toBe(true);
  });
});
