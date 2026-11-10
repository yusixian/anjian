import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';
import { expect, test } from 'vitest';

test('the standalone preview ships less than 180 KB gzip before loading a renderer', async () => {
  const directory = path.resolve('dist/viewer');
  const html = path.join(directory, 'preview.html');
  expect(existsSync(html), 'the published viewer must include its standalone preview shell').toBe(
    true,
  );
  const src = /<script[^>]+src="([^"]+)"/.exec(readFileSync(html, 'utf8'))![1]!;
  const { metafile } = await build({
    entryPoints: [path.join(directory, src.replace(/^\//, ''))],
    bundle: true,
    format: 'esm',
    write: false,
    metafile: true,
    plugins: [
      {
        name: 'initial-load-only',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            args.kind === 'dynamic-import' ? { path: args.path, external: true } : undefined,
          );
        },
      },
    ],
  });
  const bytes = Object.keys(metafile!.inputs).reduce(
    (total, file) => total + gzipSync(readFileSync(file)).length,
    0,
  );
  expect(
    bytes,
    'previews must not download the whole application to show a thumbnail',
  ).toBeLessThan(180_000);
});

test.each(['index', 'preview', 'share'])('%s entry loads generated StyleX rules', (entry) => {
  const directory = path.resolve('dist/viewer');
  const html = readFileSync(path.join(directory, `${entry}.html`), 'utf8');
  const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)];
  const css = stylesheets.map((match) => readFileSync(path.join(directory, match[1]!.replace(/^\//, '')), 'utf8')).join('\n');
  expect(css, 'standalone entries need StyleX layout rules as well as theme tokens').toMatch(/@layer priority\d+\s*\{/);
});
