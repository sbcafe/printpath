// Single self-contained HTML (JS + CSS inlined) that opens offline from file:// on desktop or phone.
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { renameSync, existsSync } from 'node:fs';

const csp: Plugin = {
  name: 'printpath-csp',
  transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />',
    `<meta charset="utf-8" />\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; worker-src blob:; connect-src 'none'" />`),
};
const rename: Plugin = {
  name: 'printpath-rename',
  closeBundle() { if (existsSync('dist-single/index.html')) renameSync('dist-single/index.html', 'dist-single/printpath.html'); },
};

export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), csp, rename],
  build: { outDir: 'dist-single', target: 'es2020', chunkSizeWarningLimit: 3000, emptyOutDir: true },
});
