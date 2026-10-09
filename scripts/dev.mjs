import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const children = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit' }),
  spawn(
    process.execPath,
    ['../../node_modules/@dcloudio/vite-plugin-uni/bin/uni.js', '--host', '0.0.0.0'],
    { cwd: resolve('apps/client'), stdio: 'inherit' },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}
for (const child of children) {
  child.on('error', (e) => {
    console.error(e.message);
    stop(1);
  });
  child.on('exit', (code) => stop(code || 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
