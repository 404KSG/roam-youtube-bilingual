import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const folder of ['src', 'server', 'scripts', 'test', 'dist', '.']) {
  for (const name of await readdir(`${root}/${folder}`)) {
    if (/\.(mjs|js)$/.test(name)) execFileSync(process.execPath, ['--check', `${root}/${folder}/${name}`], { stdio: 'pipe' });
  }
}
console.log('所有 JavaScript 文件通过语法检查。');
