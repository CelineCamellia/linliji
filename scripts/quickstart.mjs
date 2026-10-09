import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createApp } from '../server/index.mjs';
import { loadConfig } from '../server/runtime.mjs';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const local = join(root, '.local');
mkdirSync(local, { recursive: true, mode: 0o700 });
const filename = join(local, 'runtime.env');
if (!existsSync(filename)) {
  const settings = {
    APP_MODE: 'production',
    LOCAL_ONLY: '1',
    PUBLIC_ORIGIN: 'http://127.0.0.1:8788',
    REGISTRATION_MODE: 'open',
    OPERATOR_NAME: '本机管理员',
    SUPPORT_EMAIL: 'local@localhost.invalid',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: randomBytes(24).toString('base64url'),
  };
  writeFileSync(
    filename,
    Object.entries(settings)
      .map(([key, value]) => key + '=' + value)
      .join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
}
const env = parseEnv(readFileSync(filename, 'utf8'));
if (env.LOCAL_ONLY !== '1') throw Error('quickstart 仅用于本机；公网请按部署文档启动');
const config = loadConfig(env);
if (!existsSync('dist/web/index.html')) {
  const result = spawnSync(process.execPath, ['scripts/build.mjs', 'web'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
const app = createApp({
  dbPath: join(local, 'linliji.sqlite'),
  staticDir: resolve('dist/web'),
  config,
});
const port = Number(new URL(config.origin).port || 80);
app.server.requestTimeout = 20000;
app.server.headersTimeout = 10000;
app.server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? '端口已占用，请检查已有服务或修改 .local/runtime.env 中的端口'
      : error.message,
  );
  app.db.close();
  process.exitCode = 1;
});
app.server.listen(port, '127.0.0.1', () => {
  console.log(
    '居民页面：' +
      config.origin +
      '\n管理页面：' +
      config.origin +
      '/admin/\n管理员账号：admin\n管理员密码请查看 .local/runtime.env 的 ADMIN_PASSWORD。\n注册居民账号后发布，管理员审核后公开。按 Ctrl+C 停止。',
  );
});
const cleanup = setInterval(() => app.media.prune(), 3600000);
cleanup.unref();
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanup);
  app.server.close(() => {
    app.db.close();
    process.exit(0);
  });
  app.server.closeIdleConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
