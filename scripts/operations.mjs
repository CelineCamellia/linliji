import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync, mkdirSync } from 'node:fs';
import { resolve, join, sep, dirname } from 'node:path';
import { createMediaStore } from '../server/media.mjs';
import { openDatabase } from '../server/db.mjs';
import { moderate } from '../server/moderation.mjs';
import { validateCatalog, importCatalog } from '../server/catalog.mjs';

const root = resolve(import.meta.dirname, '..');
const ui = join(root, 'apps/operations');
const draftPattern = /^商家资料-\d{8}T\d{9}Z-[a-f0-9]{8}\.json$/;
const statuses = new Set(['pending', 'available', 'rejected', 'withdrawn', 'reserved']);
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const reasonText = (value) => {
  if (typeof value !== 'string' || value.trim().length < 2 || value.length > 300)
    fail(400, '请填写 2–300 字处理说明。');
  return value.trim();
};
async function body(req) {
  if (Number(req.headers['content-length'] || 0) > 8192) {
    req.resume();
    fail(413, '提交内容过长。');
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) fail(413, '提交内容过长。');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error();
    return value;
  } catch {
    fail(400, '提交格式不正确。');
  }
}

export function createOperationsServer({
  dbPath = join(root, 'server/production-data/linliji.sqlite'),
  draftDirectory = join(root, '私密配置/商家资料'),
  database,
  origin,
  mediaStore,
} = {}) {
  dbPath = resolve(dbPath);
  draftDirectory = resolve(draftDirectory);
  // Read before opening for writes: refuse sample data and unknown databases unchanged.
  if (!database && existsSync(dbPath)) {
    const existing = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const meta = existing
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'")
        .get();
      if (
        !meta ||
        existing.prepare("SELECT value FROM app_meta WHERE key='mode'").get()?.value !==
          'production'
      )
        throw Error('请选择独立的运营数据库，不能使用旧演示库或其他数据库。');
    } finally {
      existing.close();
    }
  }
  const db = database || openDatabase(dbPath, { seedDemo: false });
  const media = mediaStore || createMediaStore(db, join(dirname(dbPath), 'uploads'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS report_resolutions(report_id TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,reason TEXT NOT NULL,created TEXT NOT NULL)',
  );
  mkdirSync(draftDirectory, { recursive: true });

  function preview(filename) {
    if (typeof filename !== 'string' || !draftPattern.test(filename))
      fail(400, '请选择资料工具保存的文件。');
    const path = join(draftDirectory, filename);
    if (!existsSync(path)) fail(404, '该资料文件已不存在，请重新选择。');
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 2 * 1024 * 1024 ||
      !realpathSync(path).startsWith(realpathSync(draftDirectory) + sep)
    )
      fail(400, '资料文件不可读取或超过 2 MB。');
    const bytes = readFileSync(path);
    let items, validated;
    try {
      items = JSON.parse(bytes.toString('utf8'));
      validated = validateCatalog(items);
    } catch (error) {
      fail(
        400,
        error.message === 'Unexpected end of JSON input' ? '资料文件不完整。' : error.message,
      );
    }
    const normalized = validated.map(({ kind, data, phone }) => {
      const { tag, demo, ...fields } = data;
      return { kind, ...fields, phone, phoneSharingConsent: true };
    });
    const duplicates = validated
      .filter(({ kind, data }) =>
        db
          .prepare(
            'SELECT id FROM ' + (kind === 'product' ? 'products' : 'services') + ' WHERE id=?',
          )
          .get(data.id),
      )
      .map((item) => item.data.title);
    return {
      filename,
      hash: createHash('sha256').update(bytes).digest('hex'),
      count: normalized.length,
      items: normalized,
      duplicates,
    };
  }
  function listing(id) {
    const row = db.prepare('SELECT id,data,status FROM listings WHERE id=?').get(id);
    if (!row) fail(404, '物品已删除或不存在。');
    return {
      ...JSON.parse(row.data),
      id: row.id,
      status: row.status,
      history: db
        .prepare(
          'SELECT decision,reason,created FROM moderation WHERE listing_id=? ORDER BY rowid DESC LIMIT 30',
        )
        .all(id),
    };
  }
  const server = createServer(async (req, res) => {
    const address =
      (typeof origin === 'function' ? origin() : origin) ||
      'http://127.0.0.1:' + server.address().port;
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
      req.headers.host !== new URL(address).host ||
      (req.headers.origin && req.headers.origin !== address)
    ) {
      req.resume();
      return send(403, { error: '请从本机管理页面进行操作。' });
    }
    try {
      const url = new URL(req.url, address),
        path = url.pathname;
      if (req.method === 'GET' && /^\/api\/photos\/[a-f0-9-]{36}$/.test(path))
        return media.serve(req, res, path.split('/').pop(), { admin: true });
      if (req.method === 'GET' && path === '/api/status') {
        const counts = db
          .prepare(
            "SELECT (SELECT count(*) FROM listings WHERE status='pending') pending,(SELECT count(*) FROM listings WHERE status='available') available,(SELECT count(*) FROM reports WHERE status='open') reports,(SELECT count(*) FROM products)+(SELECT count(*) FROM services) catalog",
          )
          .get();
        return send(200, {
          tool: 'linliji-operations',
          database: dbPath,
          draftDirectory,
          scope: '本机运营资料',
          counts,
        });
      }
      if (req.method === 'GET' && path === '/api/drafts') {
        const files = readdirSync(draftDirectory)
          .filter(
            (name) =>
              draftPattern.test(name) &&
              lstatSync(join(draftDirectory, name)).isFile() &&
              !lstatSync(join(draftDirectory, name)).isSymbolicLink(),
          )
          .sort()
          .reverse();
        return send(200, { files });
      }
      if (req.method === 'GET' && path === '/api/drafts/preview')
        return send(200, preview(url.searchParams.get('filename')));
      if (req.method === 'GET' && path === '/api/listings') {
        const status = url.searchParams.get('status') || 'pending';
        if (!statuses.has(status)) fail(400, '未知的物品状态。');
        const page = Number(url.searchParams.get('page') || '1');
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail(400, '页码不正确。');
        const kind = url.searchParams.get('kind') || '';
        if (kind && !['sale', 'service', 'exchange'].includes(kind)) fail(400, '未知的发布类型。');
        const where =
            'status=?' + (kind ? " AND COALESCE(json_extract(data,'$.kind'),'sale')=?" : ''),
          args = kind ? [status, kind] : [status];
        const total = db.prepare('SELECT count(*) n FROM listings WHERE ' + where).get(...args).n;
        const items = db
          .prepare(
            'SELECT id,data,status FROM listings WHERE ' +
              where +
              ' ORDER BY rowid DESC LIMIT 20 OFFSET ?',
          )
          .all(...args, (page - 1) * 20)
          .map((row) => ({ ...JSON.parse(row.data), id: row.id, status: row.status }));
        return send(200, { items, total, page, pageSize: 20 });
      }
      const detail = /^\/api\/listings\/([a-zA-Z0-9_-]{1,100})$/.exec(path);
      if (req.method === 'GET' && detail) return send(200, listing(detail[1]));
      if (req.method === 'GET' && path === '/api/reports') {
        const status = url.searchParams.get('status') || 'open';
        if (!['open', 'closed'].includes(status)) fail(400, '未知的举报状态。');
        const page = Number(url.searchParams.get('page') || '1');
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail(400, '页码不正确。');
        const total = db.prepare('SELECT count(*) n FROM reports WHERE status=?').get(status).n;
        const items = db
          .prepare(
            'SELECT r.id,r.listing_id,r.reason,r.status,r.created,l.data,l.status listing_status,x.reason resolution,x.created resolved_at FROM reports r LEFT JOIN listings l ON l.id=r.listing_id LEFT JOIN report_resolutions x ON x.report_id=r.id WHERE r.status=? ORDER BY r.rowid DESC LIMIT 20 OFFSET ?',
          )
          .all(status, (page - 1) * 20)
          .map(({ data, ...row }) => ({ ...row, listing: data ? JSON.parse(data) : null }));
        return send(200, { items, total, page, pageSize: 20 });
      }
      if (req.method === 'POST') {
        if (
          req.headers.origin !== address ||
          !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')
        ) {
          req.resume();
          return send(403, { error: '操作必须从本管理页面提交。' });
        }
        const data = await body(req);
        if (path === '/api/catalog/import') {
          if (data.confirm !== true) fail(400, '请先核对资料，再确认导入。');
          const draft = preview(data.filename);
          if (data.hash !== draft.hash) fail(409, '资料已改变，请重新预览核对。');
          if (draft.duplicates.length)
            fail(409, '文件含已导入的编号，未重复导入，也未覆盖原资料。');
          try {
            return send(201, importCatalog(db, draft.items));
          } catch {
            fail(409, '资料未导入，可能已有相同编号；请刷新后核对。');
          }
        }
        const review = /^\/api\/listings\/([a-zA-Z0-9_-]{1,100})\/review$/.exec(path);
        if (review) {
          if (
            !['approve', 'reject', 'withdraw'].includes(data.decision) ||
            !statuses.has(data.expectedStatus)
          )
            fail(400, '请先选择物品和正确的处理方式。');
          const reason = reasonText(data.reason);
          try {
            return send(
              200,
              moderate(db, review[1], data.decision, reason, {
                expectedStatus: data.expectedStatus,
              }),
            );
          } catch (error) {
            fail(error.status || 409, error.message);
          }
        }
        const close = /^\/api\/reports\/([a-zA-Z0-9_-]{1,100})\/close$/.exec(path);
        if (close) {
          const reason = reasonText(data.reason);
          if (data.confirm !== true) fail(400, '请确认已完成举报处理。');
          db.exec('BEGIN IMMEDIATE');
          try {
            const result = db
              .prepare("UPDATE reports SET status='closed' WHERE id=? AND status='open'")
              .run(close[1]);
            if (!result.changes) fail(409, '举报已被处理或不存在，请刷新后核对。');
            db.prepare('INSERT INTO report_resolutions VALUES(?,?,?)').run(
              close[1],
              reason,
              new Date().toISOString(),
            );
            db.exec('COMMIT');
            return send(200, { id: close[1], status: 'closed' });
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        }
      }
      const files = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
        '/style.css': ['style.css', 'text/css; charset=utf-8'],
      };
      if (req.method === 'GET' && files[path]) {
        const [name, type] = files[path];
        res.writeHead(200, { 'Content-Type': type });
        return res.end(readFileSync(join(ui, name)));
      }
      if (req.method === 'GET' && path === '/icon.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        return res.end(readFileSync(join(root, 'design/brand/linliji-icon.svg')));
      }
      req.resume();
      send(404, { error: '页面或操作不存在。' });
    } catch (error) {
      send(error.status || 500, {
        error: error.status ? error.message : '操作未完成，请检查数据位置和文件权限后重试。',
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, db, dbPath, draftDirectory };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const app = createOperationsServer({ dbPath: process.env.LINLIJI_OPS_DB_PATH || undefined });
  app.server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? '8792 端口已被占用，请先检查已有管理页面。'
        : '管理服务启动失败：' + error.code,
    );
    app.db.close();
    process.exitCode = 1;
  });
  app.server.listen(8792, '127.0.0.1', () => console.log('邻里集管理页面：http://127.0.0.1:8792/'));
}
