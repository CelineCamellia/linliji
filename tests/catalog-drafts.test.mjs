import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createCatalogDraftServer } from '../scripts/catalog-drafts.mjs';
import { importCatalog, validateCatalog } from '../server/catalog.mjs';
import { openDatabase } from '../server/db.mjs';

const service = {
  kind: 'service',
  id: 'test-service',
  title: '测试维修资料',
  subtitle: '仅供自动化验证',
  description: '这是一条自动化测试资料，不是真实商家服务。',
  city: '洛阳',
  area: '洛龙区',
  shop: '测试资料商家',
  price: 8000,
  unit: '次',
  art: 'repair',
  phone: '13800000000',
  phoneSharingConsent: true,
  duration: '预约确认',
};
async function setup(t) {
  mkdirSync('.cache/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.cache/tests/catalog-drafts-'));
  const server = createCatalogDraftServer({ directory });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const save = (items, headers = {}) =>
    fetch(base + '/api/drafts', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ items }),
    });
  return { directory, server, base, save };
}
test('商家草稿可直接导入正式数据库，保存时不创建数据库并剔除额外字段', async (t) => {
  const c = await setup(t);
  const response = await c.save([{ ...service, unwanted: 'should-not-persist' }]);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.count, 1);
  assert.equal(resolve(result.path), join(c.directory, result.filename));
  const items = JSON.parse(readFileSync(result.path, 'utf8'));
  assert.equal(items[0].unwanted, undefined);
  assert.equal(items[0].phone, service.phone);
  assert.deepEqual(readdirSync(c.directory), [result.filename]);
  const db = openDatabase(':memory:', { seedDemo: false });
  try {
    assert.deepEqual(importCatalog(db, items), { imported: 1 });
    assert.equal(db.prepare('SELECT count(*) n FROM services').get().n, 1);
  } finally {
    db.close();
  }
});
test('草稿重复保存不覆盖旧文件，刷新读取最新版本，支持保存清空后的资料表', async (t) => {
  const c = await setup(t);
  const first = await (await c.save([service])).json();
  const original = readFileSync(first.path, 'utf8');
  const second = await (await c.save([{ ...service, price: 9000 }])).json();
  assert.notEqual(first.path, second.path);
  assert.equal(readFileSync(first.path, 'utf8'), original);
  let latest = await (await fetch(c.base + '/api/latest')).json();
  assert.equal(latest.filename, second.filename);
  assert.equal(latest.items[0].price, 9000);
  assert.equal((await c.save([])).status, 201);
  latest = await (await fetch(c.base + '/api/latest')).json();
  assert.deepEqual(latest.items, []);
  assert.equal(readdirSync(c.directory).length, 3);
});
test('缺少授权、重复编号、错误金额或商品规格均拒绝保存，保留有效草稿', async (t) => {
  const c = await setup(t);
  const first = await (await c.save([service])).json();
  for (const invalid of [
    [{ ...service, phoneSharingConsent: false }],
    [{ ...service, price: 0 }],
    [{ ...service, price: 1.1 }],
    [{ ...service, phone: '123' }],
    [{ ...service, city: '未支持城市' }],
    [service, service],
    [{ ...service, kind: 'product', category: 'farm', stock: 1, options: [] }],
    [{ ...service, kind: 'product', category: 'clothes', stock: -1, options: ['一件'] }],
  ])
    assert.equal((await c.save(invalid)).status, 400);
  assert.deepEqual(readdirSync(c.directory), [first.filename]);
  assert.equal((await (await fetch(c.base + '/api/latest')).json()).filename, first.filename);
});
test('本机工具拒绝跨站、伪造主机和非 JSON 保存，不暴露配置文件', async (t) => {
  const c = await setup(t);
  assert.equal(c.server.address().address, '127.0.0.1');
  assert.equal((await c.save([service], { Origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await c.save([service], { 'Content-Type': 'text/plain' })).status, 403);
  assert.equal(
    (
      await fetch(c.base + '/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [service] }),
      })
    ).status,
    403,
  );
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(
      c.base + '/api/latest',
      { headers: { Host: 'untrusted.invalid' } },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal(
    (await fetch(c.base + '/%E7%A7%81%E5%AF%86%E9%85%8D%E7%BD%AE/%E6%9C%8D%E5%8A%A1%E7%AB%AF.env'))
      .status,
    404,
  );
  const page = await fetch(c.base);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await page.text(), /商家资料/);
  assert.deepEqual(readdirSync(c.directory), []);
});
test('过大或损坏的请求不留下文件，校验器不改变调用者资料', async (t) => {
  const c = await setup(t);
  const response = await fetch(c.base + '/api/drafts', {
    method: 'POST',
    headers: { Origin: c.base, 'Content-Type': 'application/json' },
    body: '"' + 'a'.repeat(2 * 1024 * 1024) + '"',
  });
  assert.equal(response.status, 413);
  assert.equal(
    (
      await fetch(c.base + '/api/drafts', {
        method: 'POST',
        headers: { Origin: c.base, 'Content-Type': 'application/json' },
        body: '{',
      })
    ).status,
    400,
  );
  const input = [{ ...service, title: '  测试维修资料  ' }];
  const before = JSON.stringify(input);
  assert.equal(validateCatalog(input)[0].data.title, '测试维修资料');
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(readdirSync(c.directory), []);
});
