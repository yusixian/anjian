import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import stylex from '@stylexjs/unplugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { buildInfo } from '../scripts/release/build-info.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const excalidrawFonts = path.join(path.dirname(require.resolve('@excalidraw/excalidraw')), 'fonts');
// The package also includes the GPL-licensed legacy Liberation Sans 1.05 binary.
const bundledFontFamilies = new Set([
  'Assistant',
  'Cascadia',
  'ComicShanns',
  'Excalifont',
  'Lilita',
  'Nunito',
  'Virgil',
  'Xiaolai',
]);

export default defineConfig({
  base: '/',
  define: { ANJIAN_BUILD_INFO: JSON.stringify(buildInfo()) },
  // Keep lazy preloads beside their chunk when Cloud serves a versioned directory.
  experimental: {
    renderBuiltUrl: (_filename, { hostType }) => ({ relative: hostType !== 'html' }),
  },
  plugins: [
    {
      name: 'anjian-excalidraw-fonts',
      generateBundle() {
        for (const file of fs.readdirSync(excalidrawFonts, { encoding: 'utf8', recursive: true })) {
          const parts = file.split(path.sep);
          if (!file.endsWith('.woff2') || !bundledFontFamilies.has(parts[0]!)) continue;
          this.emitFile({
            type: 'asset',
            fileName: `fonts/${parts.join('/')}`,
            source: fs.readFileSync(path.join(excalidrawFonts, file)),
          });
        }
      },
    },
    stylex.vite({
      useCSSLayers: true,
      // The shared CSS is loaded by every HTML entry; the default target may be main-only.
      cssInjectionTarget: (file) => file === 'index.css',
      unstable_moduleResolution: { type: 'commonJS', rootDir: root },
    }),
    react(),
  ],
  resolve: { alias: { 'loro-crdt': 'loro-crdt/base64' } },
  build: {
    outDir: fileURLToPath(new URL('dist/viewer', import.meta.url)),
    emptyOutDir: true,
    assetsDir: '',
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        preview: fileURLToPath(new URL('preview.html', import.meta.url)),
        share: fileURLToPath(new URL('share.html', import.meta.url)),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        // StyleX emits an intermediate index.css (with originalFileNames) that is later merged away; naming it too makes the survivor index2.css.
        assetFileNames: (asset) =>
          asset.names[0]?.endsWith('.css') && asset.originalFileNames.length === 0
            ? 'index.css'
            : '[name]-[hash][extname]',
      },
    },
  },
});
