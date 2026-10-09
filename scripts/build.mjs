import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { publicOrigin } from '../server/runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const target = process.argv[2] || 'web';
if (!['web', 'android', 'wechat', 'all'].includes(target))
  throw Error('构建目标：web、android、wechat 或 all');
const uniCli = join(root, 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js');
mkdirSync(join(root, '.cache'), { recursive: true });
function build(platform, name, settings = {}) {
  const out = join(root, 'dist', name);
  const result = spawnSync(
    process.execPath,
    [
      uniCli,
      'build',
      ...(platform === 'mp-weixin' ? ['-p', 'mp-weixin'] : []),
      '--outDir',
      out,
      '--emptyOutDir',
    ],
    {
      cwd: join(root, 'apps/client'),
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_APP_MODE: 'production',
        VITE_APP_VERSION: version,
        VITE_SERVICE_CITY: '',
        VITE_CONFIGURABLE_SERVER: '0',
        VITE_API_BASE_URL: '/api',
        ...settings,
        TEMP: join(root, '.cache'),
        TMP: join(root, '.cache'),
      },
      windowsHide: true,
    },
  );
  if (result.status !== 0) throw Error(name + ' 构建失败');
  return out;
}
if (target === 'web' || target === 'all') build('h5', 'web');
if (target === 'android' || target === 'all')
  build('h5', 'android-web', { VITE_CONFIGURABLE_SERVER: '1', VITE_API_BASE_URL: '' });
if (target === 'wechat') {
  if (!/^wx[a-f0-9]{16}$/.test(process.env.WX_APPID || '')) throw Error('请设置你自己的 WX_APPID');
  const origin = publicOrigin(process.env.PUBLIC_ORIGIN);
  const out = build('mp-weixin', 'mp-weixin', { VITE_API_BASE_URL: origin + '/api' });
  const filename = join(out, 'project.config.json');
  const project = JSON.parse(readFileSync(filename, 'utf8'));
  project.appid = process.env.WX_APPID;
  project.projectname = '邻里集';
  project.setting = { ...project.setting, urlCheck: true };
  writeFileSync(filename, JSON.stringify(project, null, 2) + '\n');
}
