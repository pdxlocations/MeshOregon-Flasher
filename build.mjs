import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, splitting: true, format: 'esm', outdir: 'dist/assets', minify: true, sourcemap: false, target: 'es2022', legalComments: 'linked' });

const notices = [];
for (const dependency of ['esptool-js', 'fflate', 'spark-md5', 'pako', 'atob-lite']) {
  for (const file of ['LICENSE', 'LICENSE.md']) {
    try { notices.push(dependency + '\n' + await readFile(`node_modules/${dependency}/${file}`, 'utf8')); break; } catch {}
  }
}
await writeFile('dist/THIRD-PARTY-LICENSES.txt', notices.join('\n\n'));
