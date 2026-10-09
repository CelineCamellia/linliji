import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { createOperationsServer } from '../scripts/operations.mjs';
import { createApp } from '../server/index.mjs';
import { openDatabase } from '../server/db.mjs';
import { loadConfig } from '../server/runtime.mjs';

const filename = '商家资料-20261006T010000000Z-abcdef12.json';
const offer = {
  kind: 'service',
  id: 'ops-service',
  title: '运营流程测试维修',
  subtitle: '隔离数据',
  description: '仅用于自动化测试，不是营业资料。',
  city: '洛阳',
  area: '洛龙区',
  community: '石油社区',
  shop: '测试服务商',
  price: 5000,
  unit: '次',
  art: 'repair',
  duration: '预约确认',
  phone: '13800000000',
  phoneSharingConsent: true,
};
async function fixture(t) {
  mkdirSync('.cache/tests', { recursive: true });
  const dir = mkdtempSync(resolve('.cache/tests/operations-'));
  const app = createOperationsServer({
    dbPath: join(dir, 'operations.sqlite'),
    draftDirectory: join(dir, 'drafts'),
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.db.close();
  });
  async function request(path, { data, method = data ? 'POST' : 'GET', origin = base, raw } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: raw ?? (data ? JSON.stringify(data) : undefined),
    });
    return { status: response.status, data: await response.json() };
  }
  const addListing = (id, status = 'pending', title = '自动化检查物品') =>
    app.db
      .prepare('INSERT INTO listings VALUES(?,?,?,?,?)')
      .run(
        id,
        'test-owner',
        JSON.stringify({
          id,
          title,
          description: '这是一条隔离的测试资料，不用于真实交易。',
          city: '洛阳',
          area: '洛龙区',
          community: '石油社区',
          nickname: '测试发布者',
          price: 500,
          condition: '九成新',
          art: 'book',
          created: new Date().toISOString(),
        }),
        '13800000000',
        status,
      );
  return { ...app, base, dir, request, addListing };
}
test('运营库从空数据初始化，拒绝打开演示库和未知数据库', async (t) => {
  const c = await fixture(t);
  const status = await c.request('/api/status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.data.counts, { pending: 0, available: 0, reports: 0, catalog: 0 });
  const demoPath = join(c.dir, 'demo.sqlite');
  const demo = openDatabase(demoPath);
  const original = demo.prepare('SELECT count(*) n FROM products').get().n;
  demo.close();
  assert.throws(
    () => createOperationsServer({ dbPath: demoPath, draftDirectory: c.draftDirectory }),
    /独立的运营数据库/,
  );
  const check = new DatabaseSync(demoPath, { readOnly: true });
  assert.equal(check.prepare('SELECT count(*) n FROM products').get().n, original);
  assert.equal(
    check.prepare("SELECT count(*) n FROM sqlite_master WHERE name='report_resolutions'").get().n,
    0,
  );
  check.close();
  const unknown = join(c.dir, 'unknown.sqlite');
  const foreign = new DatabaseSync(unknown);
  foreign.exec('CREATE TABLE existing(value TEXT)');
  foreign.close();
  assert.throws(() => createOperationsServer({ dbPath: unknown }), /独立的运营数据库/);
});
test('审核通过后居民接口才展示，重复或过期处理不会覆盖状态', async (t) => {
  const c = await fixture(t);
  c.addListing('pending-one');
  c.addListing('pending-two');
  const business = createApp({
    dbPath: c.dbPath,
    config: loadConfig({
      APP_MODE: 'production',
      PUBLIC_ORIGIN: 'https://ops-tests.linliji.cn',
      WX_APPID: 'wx0000000000000000',
      WX_APP_SECRET: 'a'.repeat(32),
      OPERATOR_NAME: '隔离测试',
      SUPPORT_EMAIL: 'test@linliji.cn',
      INVITE_CODE: 'operations-tests-only-0001',
    }),
  });
  await new Promise((r) => business.server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => business.server.close(r));
    business.db.close();
  });
  const publicItems = () =>
    fetch('http://127.0.0.1:' + business.server.address().port + '/api/public/listings').then((r) =>
      r.json(),
    );
  assert.equal((await publicItems()).length, 0);
  assert.equal(
    (
      await c.request('/api/listings/pending-one/review', {
        data: { decision: 'approve', expectedStatus: 'pending', reason: '描述核对完成' },
      })
    ).status,
    200,
  );
  assert.equal((await publicItems())[0].id, 'pending-one');
  assert.equal(
    (
      await c.request('/api/listings/pending-one/review', {
        data: { decision: 'reject', expectedStatus: 'pending', reason: '过期页面操作' },
      })
    ).status,
    409,
  );
  assert.equal(
    c.db.prepare('SELECT count(*) n FROM moderation WHERE listing_id=?').get('pending-one').n,
    1,
  );
  assert.equal(
    (
      await c.request('/api/listings/pending-two/review', {
        data: { decision: 'reject', expectedStatus: 'pending', reason: '请补充物品状态' },
      })
    ).status,
    200,
  );
  const detail = await c.request('/api/listings/pending-two');
  assert.equal(detail.data.history[0].reason, '请补充物品状态');
  assert.equal(detail.data.phone, undefined);
  assert.equal(
    (
      await c.request('/api/listings/pending-one/review', {
        data: { decision: 'withdraw', expectedStatus: 'available', reason: '信息已不再有效' },
      })
    ).status,
    200,
  );
  assert.equal((await publicItems()).length, 0);
});
test('举报处理保存说明，重复提交拒绝，删除举报时同步删除处理记录', async (t) => {
  const c = await fixture(t);
  c.addListing('reported', 'available');
  c.db
    .prepare('INSERT INTO users VALUES(?,?,?)')
    .run('reporter', '测试邻居', new Date().toISOString());
  c.db
    .prepare('INSERT INTO reports VALUES(?,?,?,?,?,?)')
    .run('report-one', 'reporter', 'reported', '物品信息不准确', 'open', new Date().toISOString());
  const open = await c.request('/api/reports');
  assert.equal(open.data.items[0].listing.title, '自动化检查物品');
  assert.equal(open.data.items[0].user_id, undefined);
  assert.equal(
    (await c.request('/api/reports/report-one/close', { data: { reason: '', confirm: true } }))
      .status,
    400,
  );
  assert.equal(
    (
      await c.request('/api/reports/report-one/close', {
        data: { reason: '已核对并记录处理结果', confirm: true },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await c.request('/api/reports/report-one/close', {
        data: { reason: '重复处理', confirm: true },
      })
    ).status,
    409,
  );
  const closed = await c.request('/api/reports?status=closed');
  assert.equal(closed.data.items[0].resolution, '已核对并记录处理结果');
  assert.equal(
    c.db.prepare('SELECT status FROM listings WHERE id=?').get('reported').status,
    'available',
  );
  c.db.prepare('DELETE FROM reports WHERE id=?').run('report-one');
  assert.equal(c.db.prepare('SELECT count(*) n FROM report_resolutions').get().n, 0);
});
test('导入先核对文件快照，拒绝变更及重复文件，不产生部分导入', async (t) => {
  const c = await fixture(t),
    file = join(c.draftDirectory, filename);
  writeFileSync(file, JSON.stringify([offer]));
  const preview = await c.request('/api/drafts/preview?filename=' + encodeURIComponent(filename));
  assert.equal(preview.data.items[0].community, '石油社区');
  writeFileSync(file, JSON.stringify([{ ...offer, price: 6000 }]));
  assert.equal(
    (
      await c.request('/api/catalog/import', {
        data: { filename, hash: preview.data.hash, confirm: true },
      })
    ).status,
    409,
  );
  assert.equal(c.db.prepare('SELECT count(*) n FROM services').get().n, 0);
  const fresh = await c.request('/api/drafts/preview?filename=' + encodeURIComponent(filename));
  assert.equal(
    (
      await c.request('/api/catalog/import', {
        data: { filename, hash: fresh.data.hash, confirm: true },
      })
    ).status,
    201,
  );
  writeFileSync(file, JSON.stringify([offer, { ...offer, id: 'another-service' }]));
  const duplicate = await c.request('/api/drafts/preview?filename=' + encodeURIComponent(filename));
  assert.equal(duplicate.data.duplicates.length, 1);
  assert.equal(
    (
      await c.request('/api/catalog/import', {
        data: { filename, hash: duplicate.data.hash, confirm: true },
      })
    ).status,
    409,
  );
  assert.equal(c.db.prepare('SELECT count(*) n FROM services').get().n, 1);
  assert.equal(JSON.parse(c.db.prepare('SELECT data FROM services').get().data).price, 6000);
});
test('管理接口拒绝跨站、缺失来源、越界文件及异常提交', async (t) => {
  const c = await fixture(t);
  c.addListing('protected');
  const data = { decision: 'approve', expectedStatus: 'pending', reason: '测试处理' };
  assert.equal(
    (await c.request('/api/listings/protected/review', { data, origin: 'https://other.invalid' }))
      .status,
    403,
  );
  assert.equal(
    (await c.request('/api/listings/protected/review', { data, origin: null })).status,
    403,
  );
  assert.equal((await c.request('/api/drafts/preview?filename=../../private.env')).status, 400);
  assert.equal((await c.request('/server/index.mjs')).status, 404);
  assert.equal(
    (await c.request('/api/listings/protected/review', { method: 'POST', raw: 'invalid' })).status,
    400,
  );
  assert.equal(
    (
      await c.request('/api/listings/protected/review', {
        data: { ...data, reason: 'a'.repeat(10000) },
      })
    ).status,
    413,
  );
  assert.equal(
    c.db.prepare('SELECT status FROM listings WHERE id=?').get('protected').status,
    'pending',
  );
  const status = await new Promise((resolve, reject) => {
    const req = http.get(c.base + '/api/status', { headers: { Host: 'other.invalid' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(status, 403);
});
test('待审核分页完整，非法状态和页码不执行查询', async (t) => {
  const c = await fixture(t);
  for (let i = 0; i < 21; i++) c.addListing('page-' + i);
  const first = await c.request('/api/listings');
  const second = await c.request('/api/listings?page=2');
  assert.equal(first.data.total, 21);
  assert.equal(first.data.items.length, 20);
  assert.equal(second.data.items.length, 1);
  assert.notEqual(first.data.items[0].id, second.data.items[0].id);
  assert.equal((await c.request('/api/listings?status=unknown')).status, 400);
  assert.equal((await c.request('/api/listings?page=-1')).status, 400);
});
