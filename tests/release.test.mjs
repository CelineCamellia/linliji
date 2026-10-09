import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server/index.mjs';
import { openDatabase } from '../server/db.mjs';
import { moderate } from '../server/moderation.mjs';
import { importCatalog } from '../server/catalog.mjs';
import { loadConfig, publicOrigin, POLICY_VERSION } from '../server/runtime.mjs';

const env = {
  APP_MODE: 'production',
  PUBLIC_ORIGIN: 'https://pilot.linliji.cn',
  WX_APPID: 'wx0000000000000000',
  WX_APP_SECRET: 'a'.repeat(32),
  OPERATOR_NAME: '集成测试运营者',
  SUPPORT_EMAIL: 'test@linliji.cn',
  INVITE_CODE: 'integration-only-0001',
};
const listing = {
  title: '集成测试书桌',
  description: '测试专用信息，不用于真实交易或联系。',
  price: 5000,
  art: 'table',
  condition: '九成新',
  city: '杭州',
  area: '西湖区',
  phone: '13800000000',
  phoneSharingConsent: true,
};
async function setup(t) {
  const calls = [];
  const app = createApp({
    dbPath: ':memory:',
    config: loadConfig(env),
    exchangeWechat: async (code) => {
      calls.push(code);
      if (code === 'invalid') throw Object.assign(Error('微信凭证无效'), { status: 401 });
      return 'openid-' + code.split(':')[0];
    },
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.db.close();
  });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  async function request(path, { token, data, method = data ? 'POST' : 'GET', origin } = {}) {
    const r = await fetch(base + '/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { status: r.status, data: await r.json() };
  }
  async function login(code = 'seller:1') {
    const r = await request('/auth/wechat', {
      data: { code, consentVersion: POLICY_VERSION, inviteCode: env.INVITE_CODE },
    });
    assert.equal(r.status, 200);
    return r.data;
  }
  return { ...app, request, login, base, calls };
}

test('生产配置拒绝缺失参数、明文地址、IP、测试域名和错误模式', () => {
  assert.equal(loadConfig(env).mode, 'production');
  for (const key of [
    'PUBLIC_ORIGIN',
    'WX_APPID',
    'WX_APP_SECRET',
    'OPERATOR_NAME',
    'SUPPORT_EMAIL',
    'INVITE_CODE',
  ])
    assert.throws(() => loadConfig({ ...env, [key]: '' }), undefined, key);
  for (const url of [
    'http://real.cn',
    'https://127.0.0.1',
    'https://localhost',
    'https://example.com',
    'https://preview.invalid',
    'https://foo.cn/api',
    'https://name:password@foo.cn',
    'https://foo.cn:9443',
  ])
    assert.throws(() => publicOrigin(url), undefined, url);
  assert.throws(() => loadConfig({ APP_MODE: 'prod' }));
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }));
});
test('正式数据库不灌入示例，禁止正式与体验共用数据库', () => {
  mkdirSync('.cache/tests', { recursive: true });
  const path = resolve(mkdtempSync(resolve('.cache/tests/release-db-')), 'test.sqlite');
  let db = openDatabase(path, { seedDemo: false });
  assert.equal(db.prepare('SELECT count(*) n FROM products').get().n, 0);
  db.close();
  assert.throws(() => openDatabase(path), /数据库必须分开/);
  db = openDatabase(path, { seedDemo: false });
  assert.equal(db.prepare('SELECT count(*) n FROM listings').get().n, 0);
  db.close();
});
test('正式服务禁用体验账号、下载入口、未开放订单，并支持安卓来源', async (t) => {
  const c = await setup(t);
  assert.equal((await c.request('/health')).data.mode, 'production');
  assert.equal((await c.request('/auth/demo', { data: {} })).status, 404);
  assert.equal((await fetch(c.base + '/download')).status, 404);
  assert.equal((await fetch(c.base + '/downloads/wechat-project.zip')).status, 404);
  assert.equal(
    (await c.request('/health', { origin: 'https://appassets.androidplatform.net' })).status,
    200,
  );
  assert.equal((await c.request('/health', { origin: 'https://untrusted.invalid' })).status, 403);
  assert.deepEqual((await c.request('/products')).data, []);
  const { token } = await c.login();
  for (const path of ['/cart', '/addresses', '/orders', '/bookings', '/listings/id/reserve'])
    assert.equal((await c.request(path, { token, data: {} })).status, 403);
});
test('微信登录必须同意政策；由服务端校验凭证并维持稳定身份', async (t) => {
  const c = await setup(t);
  assert.equal(
    (await c.request('/auth/wechat', { data: { code: 'forged', openid: 'fake' } })).status,
    400,
  );
  assert.equal(c.calls.length, 0);
  assert.equal(
    (await c.request('/auth/wechat', { data: { code: 'invalid', consentVersion: POLICY_VERSION } }))
      .status,
    401,
  );
  const first = await c.login('same:1'),
    again = await c.login('same:2');
  assert.equal(first.user.id, again.user.id);
  assert.notEqual(first.token, again.token);
  assert.equal(c.db.prepare('SELECT count(*) n FROM users').get().n, 1);
  assert.equal(c.db.prepare('SELECT version FROM consents').get().version, POLICY_VERSION);
  assert.ok(!JSON.stringify(first).includes('openid'));
  assert.notEqual(c.db.prepare('SELECT token FROM sessions').get().token, first.token);
});
test('安卓账号加盐验证、邀请码与重复注册控制', async (t) => {
  const c = await setup(t),
    data = {
      username: 'neighbor1',
      password: 'secure-test-password',
      consentVersion: POLICY_VERSION,
      inviteCode: env.INVITE_CODE,
    };
  assert.equal(
    (await c.request('/auth/register', { data: { ...data, inviteCode: 'bad' } })).status,
    403,
  );
  const first = await c.request('/auth/register', { data });
  assert.equal(first.status, 201);
  assert.equal((await c.request('/auth/register', { data })).status, 409);
  assert.equal(
    (await c.request('/auth/password', { data: { ...data, password: 'incorrect-passwd' } })).status,
    401,
  );
  const again = await c.request('/auth/password', { data });
  assert.equal(again.status, 200);
  assert.equal(first.data.user.id, again.data.user.id);
  const stored = c.db.prepare('SELECT * FROM credentials').get();
  assert.equal(stored.password_hash.length, 128);
  assert.ok(!JSON.stringify(stored).includes(data.password));
});
test('未审核内容只对所有者可见，审核通过才允许公开与联系', async (t) => {
  const c = await setup(t),
    seller = await c.login('seller'),
    buyer = await c.login('buyer');
  const created = await c.request('/listings', { token: seller.token, data: listing });
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'pending');
  const id = created.data.id;
  assert.deepEqual((await c.request('/public/listings')).data, []);
  assert.equal((await c.request('/public/listings/' + id)).status, 404);
  assert.equal((await c.request('/listings/' + id, { token: buyer.token })).status, 404);
  assert.equal(
    (await c.request('/listings/' + id + '/contact', { token: buyer.token })).status,
    404,
  );
  assert.equal(
    (await c.request('/listings?mine=1', { token: seller.token })).data[0].status,
    'pending',
  );
  moderate(c.db, id, 'approve', '内容符合试运行规则');
  const publicResult = await c.request('/public/listings/' + id);
  assert.equal(publicResult.status, 200);
  assert.equal(publicResult.data.phone, undefined);
  assert.equal(
    (await c.request('/listings/' + id + '/contact', { token: buyer.token })).data.phone,
    listing.phone,
  );
  assert.throws(() => moderate(c.db, id, 'approve', '重复审核'), /状态/);
  assert.equal(
    (
      await c.request('/reports', {
        token: buyer.token,
        data: { listingId: id, reason: '疑似虚假信息' },
      })
    ).status,
    201,
  );
  moderate(c.db, id, 'withdraw', '举报核实，停止展示');
  assert.equal((await c.request('/public/listings/' + id)).status, 404);
  assert.equal(
    (await c.request('/listings/' + id + '/contact', { token: buyer.token })).status,
    404,
  );
});
test('驳回反馈只对所有者可见，用户不能改审批状态', async (t) => {
  const c = await setup(t),
    seller = await c.login('seller'),
    other = await c.login('other');
  const {
    data: { id },
  } = await c.request('/listings', {
    token: seller.token,
    data: { ...listing, status: 'available' },
  });
  moderate(c.db, id, 'reject', '描述不完整，请下架后重新发布');
  assert.equal(
    (await c.request('/listings/' + id, { token: seller.token })).data.review,
    '描述不完整，请下架后重新发布',
  );
  assert.equal((await c.request('/listings/' + id, { token: other.token })).status, 404);
  assert.equal(
    (await c.request('/listings/' + id, { token: other.token, method: 'DELETE' })).status,
    404,
  );
});
test('退出立即撤销当前凭证，其他设备凭证仍有效', async (t) => {
  const c = await setup(t),
    first = await c.login('same:1'),
    second = await c.login('same:2');
  assert.equal((await c.request('/auth/logout', { token: first.token, data: {} })).status, 200);
  assert.equal((await c.request('/me', { token: first.token })).status, 401);
  assert.equal((await c.request('/me', { token: second.token })).status, 200);
});
test('注销删除账号关联数据和所有凭证，不影响其他账号', async (t) => {
  const c = await setup(t),
    seller = await c.login('seller'),
    other = await c.login('other');
  const {
    data: { id },
  } = await c.request('/listings', { token: seller.token, data: listing });
  moderate(c.db, id, 'approve', '审核通过');
  await c.request('/reports', {
    token: other.token,
    data: { listingId: id, reason: '疑似虚假发布' },
  });
  assert.equal(
    (await c.request('/me', { token: seller.token, method: 'DELETE', data: { confirm: 'no' } }))
      .status,
    400,
  );
  assert.equal(
    (await c.request('/me', { token: seller.token, method: 'DELETE', data: { confirm: 'DELETE' } }))
      .status,
    200,
  );
  assert.equal((await c.request('/me', { token: seller.token })).status, 401);
  assert.equal((await c.request('/public/listings/' + id)).status, 404);
  for (const table of ['listings', 'reports', 'moderation'])
    assert.equal(c.db.prepare('SELECT count(*) n FROM ' + table).get().n, 0);
  assert.equal(c.db.prepare('SELECT count(*) n FROM identities').get().n, 1);
  assert.equal((await c.request('/me', { token: other.token })).status, 200);
});
test('仍有预约时注销拒绝并保留完整数据', async (t) => {
  const c = await setup(t),
    u = await c.login();
  c.db
    .prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?)')
    .run(
      'unfinished',
      u.user.id,
      'market',
      'pending',
      '{}',
      new Date().toISOString(),
      'unfinished-key',
    );
  assert.equal(
    (await c.request('/me', { token: u.token, method: 'DELETE', data: { confirm: 'DELETE' } }))
      .status,
    409,
  );
  assert.equal((await c.request('/me', { token: u.token })).status, 200);
});
test('隐私接口匿名开放，响应不包含密钥或邀请码', async (t) => {
  const c = await setup(t),
    r = await c.request('/policy');
  assert.equal(r.status, 200);
  assert.equal(r.data.operator, env.OPERATOR_NAME);
  assert.ok(!JSON.stringify(r.data).includes(env.WX_APP_SECRET));
  assert.ok(!JSON.stringify(r.data).includes(env.INVITE_CODE));
});

test('商家资料按真实城市展示，电话仅登录后提供，导入失败全部回滚', async (t) => {
  const c = await setup(t);
  const offer = {
    kind: 'product',
    id: 'real-offer',
    title: '测试资料商品',
    subtitle: '接口测试资料',
    description: '自动化测试专用，非真实营业资料。',
    city: '洛阳',
    area: '涧西区',
    shop: '测试资料店',
    price: 800,
    unit: '份',
    art: 'tomato',
    category: 'farm',
    stock: 10,
    options: ['标准'],
    phone: '13800000000',
    phoneSharingConsent: true,
  };
  const service = {
    ...offer,
    kind: 'service',
    id: 'real-service',
    art: 'repair',
    duration: '面议',
  };
  importCatalog(c.db, [offer, service]);
  const list = (await c.request('/products?city=' + encodeURIComponent('洛阳'))).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].phone, undefined);
  assert.equal(list[0].demo, false);
  assert.equal((await c.request('/services?city=' + encodeURIComponent('洛阳'))).data.length, 1);
  assert.equal((await c.request('/products?city=' + encodeURIComponent('杭州'))).data.length, 0);
  assert.equal((await c.request('/products/real-offer/contact')).status, 401);
  const u = await c.login();
  assert.equal(
    (await c.request('/products/real-offer/contact', { token: u.token })).data.phone,
    offer.phone,
  );
  assert.equal(
    (await c.request('/services/real-service/contact', { token: u.token })).data.phone,
    offer.phone,
  );
  assert.throws(() => importCatalog(c.db, [{ ...offer, id: 'rolled-back' }, offer]));
  assert.equal(c.db.prepare('SELECT id FROM products WHERE id=?').get('rolled-back'), undefined);
});
test('发布接口强制验证联系方式授权，不只依赖界面勾选', async (t) => {
  const c = await setup(t),
    u = await c.login();
  assert.equal(
    (
      await c.request('/listings', {
        token: u.token,
        data: { ...listing, phoneSharingConsent: false },
      })
    ).status,
    400,
  );
  assert.equal(c.db.prepare('SELECT count(*) n FROM listings').get().n, 0);
});
