import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import http from 'node:http';
import { serveDownload } from '../server/downloads.mjs';
async function fixture(t) {
  mkdirSync('.cache/tests', { recursive: true });
  const dir = mkdtempSync(resolve('.cache/tests/download-'));
  const apk = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  writeFileSync(join(dir, '邻里集-安卓体验版-0.2.1.apk'), apk);
  writeFileSync(join(dir, '下载页面.html'), '<html>邻里集</html>');
  const qr = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
    'base64',
  );
  writeFileSync(join(dir, '微信小程序预览二维码.png'), qr);
  writeFileSync(join(dir, '微信工具登录二维码.png'), qr);
  const server = http.createServer((req, res) => {
    if (!serveDownload(req, res, new URL(req.url, 'http://localhost').pathname, dir)) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    for (const name of [
      '邻里集-安卓体验版-0.2.1.apk',
      '下载页面.html',
      '微信小程序预览二维码.png',
      '微信工具登录二维码.png',
    ])
      unlinkSync(join(dir, name));
    rmdirSync(dir);
  });
  return { base: 'http://127.0.0.1:' + server.address().port, apk, qr };
}
test('APK 下载返回完整字节及正确的附件 MIME', async (t) => {
  const c = await fixture(t);
  const r = await fetch(c.base + '/downloads/linliji-preview.apk');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), c.apk);
});
test('HEAD 只返回长度不发送安装包正文', async (t) => {
  const c = await fixture(t);
  const r = await fetch(c.base + '/downloads/linliji-preview.apk', { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-length'), String(c.apk.length));
  assert.equal((await r.arrayBuffer()).byteLength, 0);
});
test('下载页面可打开，未准备文件返回 404', async (t) => {
  const c = await fixture(t);
  const r = await fetch(c.base + '/download');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /邻里集/);
  assert.equal((await fetch(c.base + '/downloads/wechat-project.zip')).status, 404);
});
test('下载入口禁止写入和任意文件名访问', async (t) => {
  const c = await fixture(t);
  assert.equal(
    (await fetch(c.base + '/downloads/linliji-preview.apk', { method: 'POST' })).status,
    405,
  );
  assert.equal((await fetch(c.base + '/downloads/unknown.apk')).status, 404);
  assert.equal((await fetch(c.base + '/downloads/%2e%2e%2fserver%2findex.mjs')).status, 404);
});

test('小程序预览二维码完整返回，开发工具登录二维码不公开', async (t) => {
  const c = await fixture(t);
  const r = await fetch(c.base + '/downloads/wechat-preview.png');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('content-length'), String(c.qr.length));
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), c.qr);
  assert.equal((await fetch(c.base + '/downloads/微信工具登录二维码.png')).status, 404);
});
