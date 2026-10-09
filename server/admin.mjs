import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createOperationsServer } from '../scripts/operations.mjs';

const digest = (value) => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const ui = resolve(import.meta.dirname, '../apps/operations');

export function createAdmin({ db, dbPath, config, media, body, rate }) {
  const sessions = new Map();
  const cookieName = config.localOnly ? 'llj-admin' : '__Host-llj-admin';
  const cookieFlags = '; Path=/; HttpOnly; SameSite=Strict' + (config.localOnly ? '' : '; Secure');
  const enabled = !!config.adminPassword;
  const operations = enabled
    ? createOperationsServer({
        database: db,
        dbPath,
        origin: () => config.origin,
        mediaStore: media,
        draftDirectory: join(dirname(resolve(dbPath)), 'catalog-drafts'),
      })
    : null;
  return async ({ path, method, req, res, send, ip }) => {
    if (path !== '/admin' && !path.startsWith('/admin/') && !path.startsWith('/api/admin/'))
      return false;
    if (!enabled) fail(404, '此服务未配置管理员');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const redirect = (location) => {
      res.writeHead(302, { Location: location });
      res.end();
      return true;
    };
    if (path === '/admin' && method === 'GET') return redirect('/admin/');
    const publicFiles = {
      '/admin/login': ['login.html', 'text/html'],
      '/admin/login.js': ['login.js', 'text/javascript'],
      '/admin/style.css': ['style.css', 'text/css'],
      '/admin/icon.svg': ['../../design/brand/linliji-icon.svg', 'image/svg+xml'],
    };
    if (method === 'GET' && publicFiles[path]) {
      const [name, type] = publicFiles[path];
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
      res.end(readFileSync(join(ui, name)));
      return true;
    }
    if (
      method !== 'GET' &&
      (req.headers.origin !== config.origin ||
        !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
    ) {
      req.resume();
      fail(403, '请从管理页面提交操作');
    }
    if (path === '/api/admin/session' && method === 'POST') {
      rate('admin-login:' + ip, 10);
      const data = await body(req);
      const username = typeof data.username === 'string' ? data.username : '';
      const password =
        typeof data.password === 'string' && data.password.length <= 200 ? data.password : '';
      const correctUser = equal(username, config.adminUsername),
        correctPassword = equal(password, config.adminPassword);
      if (!correctUser || !correctPassword) fail(401, '管理员账号或密码不正确');
      for (const [token, expires] of sessions) if (expires < Date.now()) sessions.delete(token);
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
      const token = randomBytes(32).toString('hex');
      sessions.set(digest(token).toString('hex'), Date.now() + 8 * 3600_000);
      res.setHeader('Set-Cookie', cookieName + '=' + token + '; Max-Age=28800' + cookieFlags);
      send(200, { ok: true });
      return true;
    }
    const token = (req.headers.cookie || '')
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
    const key = token && /^[a-f0-9]{64}$/.test(token) ? digest(token).toString('hex') : '';
    if (!key || !(sessions.get(key) > Date.now())) {
      if (path.startsWith('/admin/')) return redirect('/admin/login');
      fail(401, '请先登录管理页面');
    }
    if (path === '/api/admin/session/logout' && method === 'POST') {
      sessions.delete(key);
      res.setHeader('Set-Cookie', cookieName + '=; Max-Age=0' + cookieFlags);
      send(200, { ok: true });
      return true;
    }
    const original = req.url;
    req.url = path.startsWith('/api/admin/')
      ? req.url.replace('/api/admin/', '/api/')
      : req.url.replace('/admin/', '/');
    operations.server.emit('request', req, res);
    // The handler captures its URL synchronously before awaiting a request body.
    req.url = original;
    return true;
  };
}
