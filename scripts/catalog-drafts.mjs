import { createServer } from 'node:http';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateCatalog } from '../server/catalog.mjs';

const root = resolve(import.meta.dirname, '..');
const ui = join(root, 'apps/catalog-tool');
const draftPattern = /^商家资料-\d{8}T\d{9}Z-[a-f0-9]{8}\.json$/;
const arts = new Set([
  'tomato',
  'lettuce',
  'orange',
  'eggs',
  'corn',
  'carrot',
  'shirt',
  'bag',
  'blouse',
  'shoe',
  'cardigan',
  'cap',
  'aircon',
  'repair',
  'washer',
  'clean',
]);
const maxBytes = 2 * 1024 * 1024;
const canonical = (items) =>
  Array.isArray(items) && items.length === 0
    ? []
    : validateCatalog(items).map(({ kind, data, phone }) => {
        const { tag, demo, ...fields } = data;
        return { kind, ...fields, phone, phoneSharingConsent: true };
      });

// This tool only prepares local files. It never opens the application database.
export function createCatalogDraftServer({ directory = join(root, '私密配置/商家资料') } = {}) {
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true });
  let lastSaveTime = 0;
  const server = createServer(async (req, res) => {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      req.resume();
      return send(403, { error: '请从本机商家资料工具打开页面。' });
    }
    try {
      const path = new URL(req.url, origin).pathname;
      if (req.method === 'GET' && path === '/api/status') {
        return send(200, { tool: 'linliji-catalog-drafts', directory });
      }
      if (req.method === 'GET' && path === '/api/latest') {
        const files = readdirSync(directory)
          .filter((name) => draftPattern.test(name))
          .sort();
        const filename = files.at(-1);
        if (!filename) return send(200, { items: [], filename: null });
        return send(200, {
          filename,
          items: canonical(JSON.parse(readFileSync(join(directory, filename), 'utf8'))),
        });
      }
      if (req.method === 'POST' && path === '/api/drafts') {
        if (
          req.headers.origin !== origin ||
          !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')
        ) {
          req.resume();
          return send(403, { error: '保存请求必须来自本工具页面。' });
        }
        if (Number(req.headers['content-length'] || 0) > maxBytes) {
          req.resume();
          return send(413, { error: '资料超过 2 MB，请分批保存。' });
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > maxBytes) return send(413, { error: '资料超过 2 MB，请分批保存。' });
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, { error: '资料格式不正确，请检查后重新保存。' });
        }
        let items;
        try {
          items = canonical(body?.items);
        } catch (error) {
          return send(400, { error: error.message });
        }
        lastSaveTime = Math.max(Date.now(), lastSaveTime + 1);
        const stamp = new Date(lastSaveTime).toISOString().replace(/[-:.]/g, '');
        const filename = '商家资料-' + stamp + '-' + randomUUID().slice(0, 8) + '.json';
        const target = join(directory, filename);
        const temporary = target + '.tmp';
        try {
          writeFileSync(temporary, JSON.stringify(items, null, 2) + '\n', {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
          });
          renameSync(temporary, target);
        } catch (error) {
          try {
            unlinkSync(temporary);
          } catch {}
          throw error;
        }
        return send(201, { filename, path: target, count: items.length });
      }
      const files = {
        '/': [join(ui, 'index.html'), 'text/html; charset=utf-8'],
        '/app.js': [join(ui, 'app.js'), 'text/javascript; charset=utf-8'],
        '/style.css': [join(ui, 'style.css'), 'text/css; charset=utf-8'],
        '/icon.svg': [join(root, 'design/brand/linliji-icon.svg'), 'image/svg+xml'],
      };
      const art = /^\/art\/([a-z]+)\.png$/.exec(path);
      if (art && arts.has(art[1]))
        files[path] = [join(root, 'apps/client/src/static/art', art[1] + '.png'), 'image/png'];
      if (req.method === 'GET' && files[path]) {
        const [file, type] = files[path];
        const content = readFileSync(file);
        res.writeHead(200, { 'Content-Type': type });
        return res.end(content);
      }
      req.resume();
      send(404, { error: '页面不存在。' });
    } catch {
      send(500, { error: '无法读取或保存资料，请检查 E 盘可用空间和文件权限。' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const server = createCatalogDraftServer();
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? '8791 端口已被占用，请先检查已有商家资料工具。'
        : '商家资料工具启动失败：' + error.code,
    );
    process.exitCode = 1;
  });
  server.listen(8791, '127.0.0.1', () => console.log('商家资料工具：http://127.0.0.1:8791/'));
}
