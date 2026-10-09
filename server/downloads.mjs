import { existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, join } from 'node:path';
const files = new Map([
  ['/download', ['下载页面.html', 'text/html; charset=utf-8', false]],
  ['/download/', ['下载页面.html', 'text/html; charset=utf-8', false]],
  [
    '/downloads/linliji-preview.apk',
    ['邻里集-安卓体验版-0.2.1.apk', 'application/vnd.android.package-archive', true],
  ],
  ['/downloads/wechat-project.zip', ['邻里集-微信小程序导入包.zip', 'application/zip', true]],
  ['/downloads/wechat-preview.png', ['微信小程序预览二维码.png', 'image/png', false]],
  [
    '/downloads/package-info.json',
    ['安卓安装包信息.json', 'application/json; charset=utf-8', false],
  ],
]);
export function serveDownload(req, res, path, dir = resolve('下载')) {
  const entry = files.get(path);
  if (!entry) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return true;
  }
  const file = join(dir, entry[0]);
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('文件正在准备，请稍后再试');
    return true;
  }
  const headers = {
    'Content-Type': entry[1],
    'Content-Length': statSync(file).size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  };
  if (entry[2])
    headers['Content-Disposition'] = 'attachment; filename="' + path.split('/').pop() + '"';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  return true;
}
