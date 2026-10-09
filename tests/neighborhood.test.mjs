import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { loadConfig, POLICY_VERSION } from '../server/runtime.mjs';
import { moderate } from '../server/moderation.mjs';
import { listingFields } from '../server/listings.mjs';

const baseItem = {
  title: '邻居的测试信息',
  description: '仅用于自动检查的资料，不是真实的服务或交易。',
  city: '洛阳',
  area: '洛龙区',
  community: '地矿社区',
  phone: '13800000000',
  phoneSharingConsent: true,
};
const offers = {
  sale: { kind: 'sale', art: 'book', condition: '九成新', price: 1200 },
  service: {
    kind: 'service',
    art: 'repair',
    priceMode: 'negotiable',
    price: 0,
    availability: '周末白天',
  },
  exchange: {
    kind: 'exchange',
    art: 'book',
    condition: '九成新',
    priceMode: 'exchange',
    price: 0,
    exchangeFor: '儿童绘本或盆栽',
  },
};
async function setup(t) {
  const config = loadConfig({
    APP_MODE: 'production',
    PUBLIC_ORIGIN: 'https://pilot.linliji.cn',
    WX_APPID: 'wx0000000000000000',
    WX_APP_SECRET: 'a'.repeat(32),
    OPERATOR_NAME: '隔离测试',
    SUPPORT_EMAIL: 'tests@linliji.cn',
    INVITE_CODE: 'neighborhood-only-1234',
  });
  const app = createApp({
    dbPath: ':memory:',
    config,
    exchangeWechat: async (code) => 'test-' + code,
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.db.close();
  });
  const request = async (path, { token, data, method = data ? 'POST' : 'GET' } = {}) => {
    const response = await fetch('http://127.0.0.1:' + app.server.address().port + '/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { status: response.status, data: await response.json() };
  };
  const login = async (name) => {
    const result = await request('/auth/wechat', {
      data: { code: name, consentVersion: POLICY_VERSION, inviteCode: config.inviteCode },
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data.token;
  };
  return { ...app, request, login };
}

test('居民可发布买卖、手艺和交换，全部审核后展示，联系方式仍须登录', async (t) => {
  const c = await setup(t),
    owner = await c.login('owner'),
    neighbor = await c.login('neighbor');
  for (const [kind, offer] of Object.entries(offers)) {
    const created = await c.request('/listings', {
      token: owner,
      data: { ...baseItem, ...offer, title: '测试' + kind + '居民发布', status: 'available' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.status, 'pending');
    const id = created.data.id;
    assert.equal((await c.request('/public/listings/' + id)).status, 404);
    assert.equal((await c.request('/listings/' + id, { token: neighbor })).status, 404);
    assert.equal(
      (await c.request('/listings/' + id + '/contact', { token: neighbor })).status,
      404,
    );
    moderate(c.db, id, 'approve', '核对描述与社区');
    const publicItem = (await c.request('/public/listings/' + id)).data;
    assert.equal(publicItem.kind, kind);
    assert.equal(publicItem.phone, undefined);
    assert.equal(publicItem.review, undefined);
    assert.equal(publicItem.owned, undefined);
    if (kind === 'exchange') assert.equal(publicItem.exchangeFor, offer.exchangeFor);
    if (kind === 'service') assert.equal(publicItem.availability, offer.availability);
    assert.equal((await c.request('/listings/' + id + '/contact')).status, 401);
    assert.equal(
      (await c.request('/listings/' + id + '/contact', { token: neighbor })).data.phone,
      baseItem.phone,
    );
  }
  assert.equal((await c.request('/products')).data.length, 0);
  assert.equal((await c.request('/services')).data.length, 0);
});

test('服务计价、交换条件与配图按类型校验，额外字段不会变成联系方式或审核状态', () => {
  for (const priceMode of ['negotiable', 'free'])
    assert.equal(listingFields({ ...offers.service, priceMode }).price, 0);
  assert.equal(listingFields({ ...offers.service, priceMode: 'fixed', price: 1800 }).price, 1800);
  const invalid = [
    { ...offers.service, priceMode: 'fixed', price: 0 },
    { ...offers.service, price: 1500 },
    { ...offers.service, availability: {} },
    { ...offers.exchange, exchangeFor: '' },
    { ...offers.exchange, price: 1 },
    { ...offers.exchange, priceMode: 'fixed' },
    { ...offers.sale, priceMode: 'free' },
    { ...offers.sale, condition: '不明确' },
    { ...offers.service, art: 'table' },
    { ...offers.sale, kind: 'merchant' },
  ];
  for (const input of invalid)
    assert.throws(
      () => listingFields(input),
      (error) => error.status === 400,
    );
  const clean = listingFields({
    ...offers.sale,
    phone: '13800000000',
    status: 'available',
    exchangeFor: '不应保留',
    availability: '不应保留',
  });
  for (const field of ['phone', 'status', 'exchangeFor', 'availability'])
    assert.equal(clean[field], undefined);
});

test('非法新类型发布与未授权电话不会落库，旧闲置发布仍兼容', async (t) => {
  const c = await setup(t),
    token = await c.login('owner');
  for (const change of [
    { ...offers.exchange, exchangeFor: '' },
    { ...offers.service, price: 100 },
    { ...offers.service, phoneSharingConsent: false },
  ])
    assert.equal(
      (await c.request('/listings', { token, data: { ...baseItem, ...change } })).status,
      400,
    );
  assert.equal(c.db.prepare('SELECT count(*) n FROM listings').get().n, 0);
  const { kind, ...legacy } = offers.sale;
  const created = await c.request('/listings', { token, data: { ...baseItem, ...legacy } });
  assert.equal(created.status, 201);
  assert.equal(created.data.kind, 'sale');
  assert.equal(created.data.priceMode, 'fixed');
});

test('分类、社区和关键词筛选一致，面议和交换排在有明确金额的内容之后', async (t) => {
  const c = await setup(t),
    token = await c.login('owner');
  for (const [index, offer] of [
    offers.service,
    offers.exchange,
    offers.sale,
    { ...offers.service, priceMode: 'free' },
  ].entries()) {
    const {
      data: { id },
    } = await c.request('/listings', {
      token,
      data: { ...baseItem, ...offer, title: '筛选测试信息' + index },
    });
    moderate(c.db, id, 'approve', '核对完成');
  }
  for (const route of ['/public/listings', '/listings']) {
    const filtered = await c.request(
      route +
        '?kind=exchange&community=' +
        encodeURIComponent('地矿社区') +
        '&q=' +
        encodeURIComponent('绘本'),
      { token },
    );
    assert.equal(filtered.data.length, 1);
    assert.equal(filtered.data[0].kind, 'exchange');
    assert.equal(
      (await c.request(route + '?community=' + encodeURIComponent('石油社区'), { token })).data
        .length,
      0,
    );
    const sorted = (await c.request(route + '?sort=price', { token })).data;
    assert.equal(sorted[0].priceMode, 'free');
    assert.equal(sorted[1].kind, 'sale');
    assert.equal((await c.request(route + '?kind=unknown', { token })).status, 400);
  }
});

test('社区列表支持上百个名称，只来源于已展示内容，分页不遗漏旧闲置', async (t) => {
  const c = await setup(t),
    token = await c.login('owner');
  for (let i = 0; i < 123; i++) {
    const data = {
      ...baseItem,
      ...offers.sale,
      id: 'legacy-' + i,
      community: '测试群' + i,
      nickname: '测试居民',
    };
    delete data.kind;
    delete data.phone;
    c.db
      .prepare('INSERT INTO listings VALUES(?,?,?,?,?)')
      .run(data.id, null, JSON.stringify(data), '13800000000', 'available');
  }
  for (const [id, status, city] of [
    ['pending', 'pending', '洛阳'],
    ['rejected', 'rejected', '洛阳'],
    ['elsewhere', 'available', '杭州'],
  ])
    c.db
      .prepare('INSERT INTO listings VALUES(?,?,?,?,?)')
      .run(
        id,
        null,
        JSON.stringify({ ...baseItem, ...offers.sale, id, city, community: id }),
        baseItem.phone,
        status,
      );
  const names = await c.request('/public/communities?city=' + encodeURIComponent('洛阳'));
  assert.equal(names.data.length, 123);
  assert.ok(!names.data.includes('pending'));
  const search = await c.request('/public/communities?q=' + encodeURIComponent('测试群122'));
  assert.deepEqual(search.data, ['测试群122']);
  for (const route of ['/public/listings', '/listings']) {
    const ids = [];
    for (let page = 1; page <= 7; page++) {
      const { data } = await c.request(
        route + '?city=' + encodeURIComponent('洛阳') + '&kind=sale&page=' + page,
        { token },
      );
      assert.equal(data.total, 123);
      ids.push(...data.items.map((item) => item.id));
      assert.ok(data.items.every((item) => item.kind === 'sale'));
    }
    assert.equal(new Set(ids).size, 123);
    assert.equal(ids.length, 123);
    for (const page of ['0', 'abc', '1.2', '100001'])
      assert.equal((await c.request(route + '?page=' + page, { token })).status, 400);
  }
});

test('服务和交换支持本人下架及举报，下架后无法继续获取联系方式', async (t) => {
  const c = await setup(t),
    owner = await c.login('owner'),
    neighbor = await c.login('neighbor');
  for (const offer of [offers.service, offers.exchange]) {
    const {
      data: { id },
    } = await c.request('/listings', { token: owner, data: { ...baseItem, ...offer } });
    moderate(c.db, id, 'approve', '核对完成');
    assert.equal(
      (
        await c.request('/reports', {
          token: neighbor,
          data: { listingId: id, reason: '测试举报，需核对描述' },
        })
      ).status,
      201,
    );
    assert.equal(
      (await c.request('/listings/' + id, { token: neighbor, method: 'DELETE' })).status,
      404,
    );
    assert.equal(
      (await c.request('/listings/' + id, { token: owner, method: 'DELETE' })).status,
      200,
    );
    assert.equal((await c.request('/public/listings/' + id)).status, 404);
    assert.equal(
      (await c.request('/listings/' + id + '/contact', { token: neighbor })).status,
      404,
    );
  }
  assert.deepEqual((await c.request('/public/communities')).data, []);
});
