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
      if (!id.startsWith('\0' + prefix) || (group !== 'fonts' && group !== 'sample')) return;
      const exports = await Promise.all(Object.entries(assets[group]).map(async ([name, relativePath]) => {
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
});
