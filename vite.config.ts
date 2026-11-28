import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

const assets = {
  fonts: {
    arabic: 'public/fonts/NotoNaskhArabic-Regular.ttf',
    latin: 'public/fonts/NotoSans-Regular.ttf',
  },
  sample: {
    template: 'fixtures/golden/template.pdf',
    roster: 'fixtures/golden/roster.csv',
  },
  'sample-clinic': {
    template: 'fixtures/m3/clinic-consent-mixed.pdf',
    roster: 'fixtures/m3/clinic-consent-roster.csv',
  },
  'sample-hr': {
    template: 'fixtures/m4/multi-page-hr-choices.pdf',
    roster: 'fixtures/m4/multi-page-hr-choices.csv',
  },
  'sample-badge': {
    template: 'fixtures/m2/landscape-badge.pdf',
    roster: 'fixtures/m2/badge-roster.csv',
  },
  'batch-diff-demo': {
    previous: 'fixtures/m27/previous-batch.zip',
    next: 'fixtures/m27/next-batch.zip',
  },
};

function bundledAssets(): Plugin {
  const prefix = 'virtual:arabiform/';
  return {
    name: 'arabiform-bundled-assets',
    resolveId(id) {
      if (id.startsWith(prefix)) return '\0' + id;
    },
    async load(id) {
      const group = id.slice(prefix.length + 1);
      if (!id.startsWith('\0' + prefix) || !Object.hasOwn(assets, group)) return;
      const exports = await Promise.all(Object.entries(assets[group as keyof typeof assets]).map(async ([name, relativePath]) => {
        const path = new URL(relativePath, import.meta.url);
        this.addWatchFile(fileURLToPath(path));
        const bytes = await readFile(path);
        return `export const ${name} = ${JSON.stringify(bytes.toString('base64'))};`;
      }));
      return exports.join('\n');
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), bundledAssets()],
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: {
        // Keep the local PDF intake engine identifiable when workbench features share its chunk.
        chunkFileNames: (chunk) => chunk.moduleIds.some((id) => id.endsWith('/src/core/pdf/template.ts'))
          ? 'assets/pdf-[hash].js'
          : 'assets/[name]-[hash].js',
      },
    },
  },
});
