import { communityValue, inCommunity } from './community.mjs';
import { listingFields, normalizeListing, listingFeed } from './listings.mjs';
import { serveDownload } from './downloads.mjs';
import http from 'node:http';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname, sep, dirname } from 'node:path';
import { createMediaStore } from './media.mjs';
import { createAdmin } from './admin.mjs';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { openDatabase } from './db.mjs';
import { loadConfig, siteSettings } from './runtime.mjs';
import { createAuth } from './auth.mjs';
const hash = (t) => createHash('sha256').update(t).digest('hex');
const now = () => new Date().toISOString();
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const string = (v, label, min = 1, max = 200) => {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max)
    fail(400, label + '请填写 ' + min + '–' + max + ' 个字符');
  return v.trim();
};
const integer = (v, label, min, max) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) fail(400, label + '超出有效范围');
  return v;
};
const phone = (v) => {
  if (typeof v !== 'string' || !/^1[3-9]\d{9}$/.test(v)) fail(400, '请填写正确的 11 位手机号');
  return v;
};
function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0,
      tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > 32768) {
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error('提交内容过大'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8'),
          value = text ? JSON.parse(text) : {};
        if (!value || Array.isArray(value) || typeof value !== 'object') throw Error();
        resolve(value);
      } catch {
        reject(Object.assign(new Error('请求格式不正确'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}
export function createApp({
  dbPath = resolve('server/data/linliji.sqlite'),
  staticDir = resolve('apps/client/dist/build/h5'),
  config = loadConfig(),
  exchangeWechat,
  mediaDirectory,
} = {}) {
  const production = config.mode === 'production';
  const db = openDatabase(dbPath, { seedDemo: !production }),
    limits = new Map();
  const media = createMediaStore(
    db,
    mediaDirectory ||
      (dbPath === ':memory:'
        ? resolve('.cache/tests/media-' + randomUUID())
        : join(dirname(resolve(dbPath)), 'uploads')),
  );
  const rows = (sql, ...args) => db.prepare(sql).all(...args);
  const row = (sql, ...args) => db.prepare(sql).get(...args);
  const product = (r) => (r ? { ...JSON.parse(r.data), stock: r.stock } : null);
  const listing = (r, uid, detail = false) =>
    normalizeListing({
      ...JSON.parse(r.data),
      photos: media.photos(JSON.parse(r.data), r.user_id === uid),
      status: r.status,
      owned: r.user_id === uid,
      demo: !r.user_id,
      ...(r.user_id === uid
        ? {
            ...(detail ? { phone: r.phone } : {}),
            review: ['rejected', 'withdrawn'].includes(r.status)
              ? row(
                  'SELECT reason FROM moderation WHERE listing_id=? ORDER BY rowid DESC LIMIT 1',
                  r.id,
                )?.reason
              : undefined,
          }
        : {}),
    });
  const publicListing = (r) => {
    const d = normalizeListing(JSON.parse(r.data));
    return {
      id: r.id,
      title: d.title,
      description: d.description,
      kind: d.kind,
      priceMode: d.priceMode,
      price: d.price,
      art: d.art,
      photos: media.photos(d),
      condition: d.condition,
      city: d.city,
      area: d.area,
      ...(d.community ? { community: d.community } : {}),
      ...(d.kind === 'exchange' ? { exchangeFor: d.exchangeFor } : {}),
      ...(d.kind === 'service' && d.availability ? { availability: d.availability } : {}),
      nickname: d.nickname,
      status: 'available',
      demo: !r.user_id,
    };
  };
  function user(req) {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const s =
      token && row('SELECT * FROM sessions WHERE token=? AND expires>?', hash(token), Date.now());
    if (!s) fail(401, '登录已过期，请重新登录');
    return row('SELECT * FROM users WHERE id=?', s.user_id);
  }
  function rate(key, max = 80) {
    const timestamp = Date.now(),
      v = limits.get(key) || { count: 0, until: timestamp + 60000 };
    if (timestamp > v.until) {
      v.count = 0;
      v.until = timestamp + 60000;
    }
    if (++v.count > max) fail(429, '操作太频繁，请稍后再试');
    limits.set(key, v);
    if (limits.size > 5000) for (const [k, v] of limits) if (v.until < timestamp) limits.delete(k);
  }
  function cart(uid) {
    return rows(
      'SELECT c.*,p.data,p.stock FROM cart c JOIN products p ON p.id=c.product_id WHERE user_id=?',
      uid,
    ).map((r) => ({ product: product(r), spec: r.spec, quantity: r.quantity }));
  }
  function address(uid, id) {
    const a = row('SELECT * FROM addresses WHERE id=? AND user_id=?', id, uid);
    if (!a) fail(400, '请先选择收货地址');
    return JSON.parse(a.data);
  }
  function transact(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  function order(req, uid, kind, build) {
    const key = string(req.headers['idempotency-key'], '请求标识', 8, 100);
    const old = row('SELECT * FROM orders WHERE user_id=? AND request_key=?', uid, key);
    if (old) {
      if (old.kind !== kind) fail(409, '请求标识已使用');
      return { ...JSON.parse(old.data), status: old.status };
    }
    return transact(() => {
      const value = { ...build(), id: randomUUID(), kind, created: now(), demo: true };
      db.prepare(
        'INSERT INTO orders(id,user_id,kind,status,data,created,request_key) VALUES(?,?,?,?,?,?,?)',
      ).run(value.id, uid, kind, 'pending', JSON.stringify(value), value.created, key);
      return { ...value, status: 'pending' };
    });
  }
  const auth = createAuth({ db, config, body, rate, exchange: exchangeWechat });
  const admin = createAdmin({ db, dbPath, config, media, body, rate });
  function listingValue(b, u, id) {
    if (production && b.phoneSharingConsent !== true) fail(400, '请确认联系方式公开授权');
    return {
      id,
      title: string(b.title, '标题', 4, 40),
      description: string(b.description, '描述', 10, 600),
      ...listingFields(b),
      area: string(b.area, '区县', 2, 30),
      city: string(b.city, '城市', 2, 30),
      ...(communityValue(b.community) ? { community: communityValue(b.community) } : {}),
      photos: media.validate(b.photos, u.id, id),
      nickname: u.nickname,
      distance: null,
      created: now(),
    };
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(data));
    };
    const origin = req.headers.origin;
    const allowed = production
      ? config.origins
      : process.env.ALLOWED_ORIGINS?.split(',') || config.origins;
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    }
    try {
      const url = new URL(req.url, 'http://localhost'),
        path = url.pathname,
        method = req.method;
      const ip = config.trustProxy
        ? req.headers['x-forwarded-for']?.split(',').pop().trim() || req.socket.remoteAddress
        : req.socket.remoteAddress;
      if (path.startsWith('/api/') && origin && !allowed.includes(origin))
        fail(403, '请求来源未配置');
      if (method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      if (await admin({ path, method, req, res, send, ip })) return;
      if (production && (path === '/download' || path.startsWith('/downloads/')))
        fail(404, '页面不存在');
      if (!production && serveDownload(req, res, path)) return;
      if (!path.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') fail(405, '请求方式不支持');
        const full = resolve(staticDir, '.' + decodeURIComponent(path));
        if (!full.startsWith(resolve(staticDir) + sep) && full !== resolve(staticDir))
          fail(403, '禁止访问');
        const file = extname(full) ? full : join(staticDir, 'index.html');
        if (!existsSync(file) || !statSync(file).isFile()) {
          res.writeHead(404);
          return res.end('Build the H5 app first: npm run build:h5');
        }
        const types = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.json': 'application/json',
          '.woff2': 'font/woff2',
        };
        res.writeHead(200, {
          'Content-Type': types[extname(file)] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(method === 'HEAD' ? undefined : readFileSync(file));
      }

      rate(ip, 300);
      if (path === '/api/health' && method === 'GET') {
        row('SELECT 1');
        return send(200, {
          ok: true,
          mode: config.mode,
          name: '邻里集',
          version: '0.3.0',
          transactions: !production,
        });
      }
      if (path === '/api/site' && method === 'GET') return send(200, siteSettings(config));
      if (/^\/api\/media\/[a-f0-9-]{36}$/.test(path) && method === 'GET')
        return media.serve(req, res, path.split('/').pop());
      if (await auth({ path, method, req, send, ip })) return;
      if (path === '/api/auth/demo' && method === 'POST') {
        if (production) fail(404, '正式服务不提供体验账号');
        rate('login:' + req.socket.remoteAddress, 30);
        const data = await body(req);
        const nickname = data.nickname ? string(data.nickname, '昵称', 2, 16) : '邻里体验官';
        const id = randomUUID(),
          token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO users VALUES(?,?,?)').run(id, nickname, now());
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
          hash(token),
          id,
          Date.now() + 30 * 86400000,
        );
        return send(201, { token, user: { id, nickname }, mode: 'demo' });
      }
      if (path === '/api/products' && method === 'GET') {
        let values = rows('SELECT * FROM products').map(product);
        const category = url.searchParams.get('category'),
          q = url.searchParams.get('q')?.slice(0, 100),
          sort = url.searchParams.get('sort');
        if (url.searchParams.get('city'))
          values = values.filter((p) => (p.city || '杭州') === url.searchParams.get('city'));
        values = values.filter((p) => inCommunity(p, url.searchParams.get('community')));
        if (category) values = values.filter((p) => p.category === category);
        if (q) values = values.filter((p) => (p.title + p.subtitle + p.shop).includes(q));
        if (sort === 'price') values.sort((a, b) => a.price - b.price);
        if (sort === 'near') values.sort((a, b) => a.distance - b.distance);
        return send(200, values);
      }
      if (/^\/api\/products\/[^/]+$/.test(path) && method === 'GET') {
        const p = product(row('SELECT * FROM products WHERE id=?', path.split('/').pop()));
        if (!p) fail(404, '商品不存在');
        return send(200, p);
      }
      if (path === '/api/services' && method === 'GET')
        return send(
          200,
          rows('SELECT * FROM services')
            .map((r) => JSON.parse(r.data))
            .filter(
              (s) =>
                (!url.searchParams.get('city') ||
                  (s.city || '杭州') === url.searchParams.get('city')) &&
                inCommunity(s, url.searchParams.get('community')),
            ),
        );
      // Read-only content for WeChat timeline's anonymous single-page mode.
      if (path === '/api/public/communities' && method === 'GET') {
        const city = url.searchParams.get('city') || config.defaultCity || '洛阳',
          q = url.searchParams.get('q')?.trim().slice(0, 30) || '';
        const names = [
          ...new Set(
            rows("SELECT data FROM listings WHERE status='available'")
              .map((r) => JSON.parse(r.data))
              .filter(
                (item) =>
                  item.city === city &&
                  item.community &&
                  !['全市', '全' + item.city].includes(item.community),
              )
              .map((item) => item.community),
          ),
        ];
        return send(
          200,
          names.filter((name) => name.includes(q)).sort((a, b) => a.localeCompare(b, 'zh-CN')),
        );
      }
      if (path === '/api/public/listings' && method === 'GET') {
        return send(
          200,
          listingFeed(
            rows("SELECT * FROM listings WHERE status='available' ORDER BY rowid DESC").map(
              publicListing,
            ),
            url.searchParams,
          ),
        );
      }
      if (/^\/api\/public\/listings\/[^/]+$/.test(path) && method === 'GET') {
        const l = row(
          "SELECT * FROM listings WHERE id=? AND status='available'",
          path.split('/').pop(),
        );
        if (!l) fail(404, '物品已下架、已被预约或不存在');
        return send(200, publicListing(l));
      }
      const u = user(req),
        uid = u.id;
      if (path === '/api/uploads' && method === 'POST') {
        rate('upload:' + uid, 20);
        return send(201, await media.upload(req, uid));
      }
      if (/^\/api\/(products|services)\/[^/]+\/contact$/.test(path) && method === 'GET') {
        rate('catalog-contact:' + uid, 20);
        const kind = path.split('/')[2] === 'products' ? 'product' : 'service',
          contact = row(
            'SELECT phone FROM catalog_contacts WHERE kind=? AND id=?',
            kind,
            path.split('/')[3],
          );
        if (!contact) fail(404, '暂未提供商家联系方式');
        return send(200, { phone: contact.phone });
      }
      if (path === '/api/me' && method === 'GET')
        return send(200, { id: uid, nickname: u.nickname, mode: config.mode });
      if (path === '/api/auth/logout' && method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token=?').run(
          hash(req.headers.authorization.replace(/^Bearer /, '')),
        );
        return send(200, { ok: true });
      }
      if (path === '/api/me' && method === 'DELETE') {
        const b = await body(req);
        if (b.confirm !== 'DELETE') fail(400, '请确认注销账号');
        transact(() => {
          if (
            row("SELECT id FROM orders WHERE user_id=? AND status='pending'", uid) ||
            row("SELECT id FROM listings WHERE user_id=? AND status='reserved'", uid)
          )
            fail(409, '请先取消尚未完成的预约或订单，再注销账号');
          db.prepare(
            'DELETE FROM reports WHERE user_id=? OR listing_id IN (SELECT id FROM listings WHERE user_id=?)',
          ).run(uid, uid);
          db.prepare(
            'DELETE FROM moderation WHERE listing_id IN (SELECT id FROM listings WHERE user_id=?)',
          ).run(uid);
          for (const table of [
            'sessions',
            'addresses',
            'cart',
            'orders',
            'listings',
            'identities',
            'credentials',
            'consents',
          ])
            db.prepare('DELETE FROM ' + table + ' WHERE user_id=?').run(uid);
          db.prepare('DELETE FROM users WHERE id=?').run(uid);
        });
        return send(200, { ok: true });
      }
      if (
        production &&
        method !== 'GET' &&
        (path === '/api/cart' ||
          path === '/api/addresses' ||
          path === '/api/orders' ||
          path === '/api/bookings' ||
          path.endsWith('/reserve'))
      )
        fail(403, '试运行暂未开放在线下单，请浏览信息或联系发布者');
      if (path === '/api/reports' && method === 'POST') {
        rate('report:' + uid, 5);
        const b = await body(req),
          id = string(b.listingId, '物品编号'),
          reason = string(b.reason, '举报原因', 4, 500);
        if (!row("SELECT id FROM listings WHERE id=? AND status='available'", id))
          fail(404, '物品不存在或已下架');
        db.prepare(
          'INSERT INTO reports(id,user_id,listing_id,reason,created) VALUES(?,?,?,?,?)',
        ).run(randomUUID(), uid, id, reason, now());
        return send(201, { ok: true });
      }
      if (path === '/api/cart' && method === 'GET') return send(200, cart(uid));
      if (path === '/api/cart' && (method === 'POST' || method === 'PATCH')) {
        const data = await body(req),
          p = product(row('SELECT * FROM products WHERE id=?', string(data.productId, '商品编号')));
        if (!p) fail(404, '商品不存在');
        const spec = string(data.spec || '标准', '规格');
        if (!p.options.includes(spec)) fail(400, '请选择有效规格');
        const qty = integer(data.quantity, '数量', 0, 99);
        if (qty > p.stock) fail(409, '库存不足');
        if (qty === 0)
          db.prepare('DELETE FROM cart WHERE user_id=? AND product_id=? AND spec=?').run(
            uid,
            p.id,
            spec,
          );
        else
          db.prepare(
            'INSERT INTO cart VALUES(?,?,?,?) ON CONFLICT(user_id,product_id,spec) DO UPDATE SET quantity=excluded.quantity',
          ).run(uid, p.id, spec, qty);
        return send(200, cart(uid));
      }
      if (path === '/api/addresses' && method === 'GET')
        return send(
          200,
          rows('SELECT * FROM addresses WHERE user_id=?', uid).map((r) => ({
            id: r.id,
            ...JSON.parse(r.data),
          })),
        );
      if (path === '/api/addresses' && method === 'POST') {
        const b = await body(req);
        if (row('SELECT count(*) n FROM addresses WHERE user_id=?', uid).n >= 20)
          fail(400, '最多保存 20 个地址');
        const id = randomUUID(),
          a = {
            name: string(b.name, '联系人', 2, 20),
            phone: phone(b.phone),
            city: string(b.city, '城市', 2, 20),
            area: string(b.area, '区县', 2, 30),
            detail: string(b.detail, '详细地址', 5, 150),
          };
        db.prepare('INSERT INTO addresses VALUES(?,?,?)').run(id, uid, JSON.stringify(a));
        return send(201, { id, ...a });
      }
      if (/^\/api\/addresses\/[^/]+$/.test(path) && method === 'DELETE') {
        db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(
          path.split('/').pop(),
          uid,
        );
        return send(200, { ok: true });
      }
      if (path === '/api/orders' && method === 'GET')
        return send(
          200,
          rows('SELECT * FROM orders WHERE user_id=? ORDER BY created DESC', uid).map((r) => ({
            ...JSON.parse(r.data),
            status: r.status,
          })),
        );
      if (path === '/api/orders' && method === 'POST') {
        const b = await body(req);
        const result = order(req, uid, 'shopping', () => {
          const a = address(uid, string(b.addressId, '地址编号')),
            items = cart(uid);
          if (a.city !== '杭州') fail(400, '示例门店仅支持杭州地址');
          if (!items.length) fail(400, '购物车还是空的');
          const totals = new Map();
          for (const item of items) {
            const quantity = (totals.get(item.product.id) || 0) + item.quantity;
            totals.set(item.product.id, quantity);
            if (quantity > item.product.stock) fail(409, item.product.title + '库存不足');
          }
          const total = items.reduce((n, i) => n + i.product.price * i.quantity, 0);
          for (const item of items)
            db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(
              item.quantity,
              item.product.id,
            );
          db.prepare('DELETE FROM cart WHERE user_id=?').run(uid);
          return {
            items,
            address: a,
            total,
            note: b.note ? string(b.note, '备注', 1, 200) : '',
            title: '邻里好物 · ' + items.reduce((n, i) => n + i.quantity, 0) + ' 件',
            art: items[0].product.art,
          };
        });
        return send(201, result);
      }
      if (path === '/api/bookings' && method === 'POST') {
        const b = await body(req);
        const result = order(req, uid, 'service', () => {
          const s = row('SELECT data FROM services WHERE id=?', string(b.serviceId, '服务编号'));
          if (!s) fail(404, '服务不存在');
          const svc = JSON.parse(s.data),
            a = address(uid, string(b.addressId, '地址编号'));
          if (a.city !== '杭州') fail(400, '示例服务仅支持杭州地址');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) fail(400, '请选择预约日期');
          const dt = Date.parse(b.date + 'T00:00:00+08:00'),
            today = Date.parse(
              new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) + 'T00:00:00+08:00',
            );
          if (
            !Number.isFinite(dt) ||
            dt <= today ||
            dt > today + 30 * 86400000 ||
            new Date(dt + 8 * 3600000).toISOString().slice(0, 10) !== b.date
          )
            fail(400, '请选择明天起 30 天内的日期');
          if (!['09:00–12:00', '13:00–17:00', '18:00–20:00'].includes(b.slot))
            fail(400, '请选择预约时段');
          return {
            title: svc.title,
            art: svc.art,
            total: svc.price,
            serviceId: svc.id,
            address: a,
            date: b.date,
            slot: b.slot,
            note: b.note ? string(b.note, '问题描述', 1, 500) : '',
            estimate: true,
          };
        });
        return send(201, result);
      }
      if (/^\/api\/orders\/[^/]+\/cancel$/.test(path) && method === 'POST') {
        const id = path.split('/')[3];
        const result = transact(() => {
          const o = row('SELECT * FROM orders WHERE id=? AND user_id=?', id, uid);
          if (!o) fail(404, '订单不存在');
          if (o.status !== 'pending') fail(409, '当前订单不能取消');
          const data = JSON.parse(o.data);
          if (o.kind === 'shopping')
            for (const i of data.items)
              db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(
                i.quantity,
                i.product.id,
              );
          if (o.kind === 'market')
            db.prepare(
              "UPDATE listings SET status='available' WHERE id=? AND status='reserved'",
            ).run(data.listingId);
          db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(id);
          return { ...data, status: 'cancelled' };
        });
        return send(200, result);
      }
      if (path === '/api/listings' && method === 'GET') {
        let values = rows('SELECT * FROM listings ORDER BY rowid DESC').map((r) => listing(r, uid));
        if (url.searchParams.get('mine') === '1') values = values.filter((l) => l.owned);
        else values = values.filter((l) => l.status === 'available');
        return send(200, listingFeed(values, url.searchParams));
      }
      if (path === '/api/listings' && method === 'POST') {
        const b = await body(req);
        rate('publish:' + uid, 10);
        const id = randomUUID(),
          p = phone(b.phone),
          value = listingValue(b, u, id),
          status = production ? 'pending' : 'available';
        transact(() => {
          db.prepare('INSERT INTO listings VALUES(?,?,?,?,?)').run(
            id,
            uid,
            JSON.stringify(value),
            p,
            status,
          );
          media.attach(value.photos, uid, id);
        });
        return send(201, {
          ...value,
          photos: media.photos(value, true),
          status,
          owned: true,
          demo: false,
        });
      }
      if (/^\/api\/listings\/[^/]+$/.test(path) && method === 'PATCH') {
        const id = path.split('/').pop(),
          b = await body(req);
        rate('edit:' + uid, 10);
        const p = phone(b.phone),
          value = listingValue(b, u, id),
          status = production ? 'pending' : 'available';
        transact(() => {
          const old = row('SELECT status FROM listings WHERE id=? AND user_id=?', id, uid);
          if (!old) fail(404, '发布不存在');
          if (old.status === 'reserved') fail(409, '已有预约，暂不能修改');
          db.prepare('UPDATE listings SET data=?,phone=?,status=? WHERE id=?').run(
            JSON.stringify(value),
            p,
            status,
            id,
          );
          media.attach(value.photos, uid, id);
        });
        return send(200, {
          ...value,
          photos: media.photos(value, true),
          status,
          owned: true,
          demo: false,
        });
      }
      if (/^\/api\/listings\/[^/]+$/.test(path) && method === 'GET') {
        const l = row('SELECT * FROM listings WHERE id=?', path.split('/').pop());
        if (!l || (l.user_id !== uid && l.status !== 'available' && l.status !== 'reserved'))
          fail(404, '物品不存在');
        return send(200, listing(l, uid, true));
      }
      if (/^\/api\/listings\/[^/]+$/.test(path) && method === 'DELETE') {
        const l = row(
          'SELECT * FROM listings WHERE id=? AND user_id=?',
          path.split('/').pop(),
          uid,
        );
        if (!l) fail(404, '物品不存在');
        if (l.status === 'reserved') fail(409, '已有预约，暂时无法下架');
        db.prepare("UPDATE listings SET status='withdrawn' WHERE id=?").run(l.id);
        return send(200, { ok: true });
      }
      if (/^\/api\/listings\/[^/]+\/contact$/.test(path) && method === 'GET') {
        rate('contact:' + uid, 20);
        const l = row('SELECT * FROM listings WHERE id=?', path.split('/')[3]);
        const reservedByMe =
          l &&
          l.status === 'reserved' &&
          rows(
            "SELECT data FROM orders WHERE user_id=? AND kind='market' AND status='pending'",
            uid,
          ).some((o) => JSON.parse(o.data).listingId === l.id);
        if (!l || (l.status !== 'available' && !reservedByMe))
          fail(404, '物品已下架或已被他人预约');
        if (!l.phone) fail(400, '这是示例物品，没有真实卖家联系方式');
        return send(200, { phone: l.phone });
      }
      if (/^\/api\/listings\/[^/]+\/reserve$/.test(path) && method === 'POST') {
        const b = await body(req);
        const result = order(req, uid, 'market', () => {
          const l = row('SELECT * FROM listings WHERE id=?', path.split('/')[3]);
          if (!l || l.status !== 'available') fail(409, '物品已被预约或已下架');
          if (l.user_id === uid) fail(400, '不能预约自己的物品');
          if (normalizeListing(JSON.parse(l.data)).kind !== 'sale')
            fail(400, '邻里服务与交换请直接联系发布者确认');
          const value = JSON.parse(l.data),
            a = address(uid, string(b.addressId, '地址编号'));
          if (value.city !== a.city) fail(400, '请选择与物品同城的地址');
          db.prepare("UPDATE listings SET status='reserved' WHERE id=?").run(l.id);
          return {
            title: value.title,
            art: value.art,
            total: value.price,
            listingId: l.id,
            address: a,
            seller: value.nickname,
            meeting: '请先联系卖家确认时间地点；示例物品不安排交易。',
          };
        });
        return send(201, result);
      }
      fail(404, '接口不存在');
    } catch (e) {
      if (!e.status) console.error('Request failed:', e.code || e.name);
      if (!res.headersSent)
        send(e.status || 500, { message: e.status ? e.message : '服务暂时不可用，请稍后再试' });
    }
  });
  return { server, db, media };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  if (config.mode === 'production' && !process.env.DB_PATH)
    throw Error('正式服务必须配置独立持久化 DB_PATH');
  const { server, db, media } = createApp({
    config,
    dbPath: process.env.DB_PATH || resolve('server/data/linliji.sqlite'),
    staticDir: process.env.STATIC_DIR || resolve('apps/client/dist/build/h5'),
  });
  const port = Number(process.env.PORT || 8787);
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.listen(port, config.localOnly ? '127.0.0.1' : process.env.HOST || '127.0.0.1', () =>
    console.log('邻里集服务已启动，模式：' + config.mode + '，端口：' + port),
  );
  const cleanup = setInterval(() => media.prune(), 3600000);
  cleanup.unref();
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => {
      server.closeAllConnections();
    }, 10000).unref();
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
