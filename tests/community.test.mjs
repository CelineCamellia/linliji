import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../server/index.mjs';
import { importCatalog, validateCatalog } from '../server/catalog.mjs';
import { communityValue, inCommunity } from '../server/community.mjs';

test('社区匹配支持任意城市、全市服务及明确标注社区的旧资料', () => {
  assert.equal(inCommunity({ city: '洛阳', community: '石油社区' }, '石油社区'), true);
  assert.equal(inCommunity({ city: '洛阳', community: '地矿社区' }, '石油社区'), false);
  assert.equal(inCommunity({ city: '洛阳', community: '全洛阳' }, '石油社区'), true);
  assert.equal(inCommunity({ city: '杭州', community: '石油社区' }, '石油社区'), true);
  assert.equal(inCommunity({ city: '洛阳', area: '地矿社区' }, '地矿社区'), true);
  assert.equal(inCommunity({ city: '洛阳', area: '新地矿社区' }, '地矿社区'), false);
  assert.equal(inCommunity({ city: '洛阳', area: '洛龙区' }, '地矿社区'), false);
  assert.equal(communityValue(undefined), '');
  for (const value of [true, {}, ' '.repeat(3), '字'.repeat(31)])
    assert.throws(() => communityValue(value));
});

test('商品、维修和已发布闲置按社区筛选，导入与发布保留社区字段', async (t) => {
  mkdirSync('.cache/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.cache/tests/community-'));
  const { server, db } = createApp({ dbPath: join(directory, 'test.sqlite') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  const offers = ['石油社区', '地矿社区', '全洛阳'].flatMap((community, index) =>
    ['product', 'service'].map((kind) => ({
      kind,
      id: kind + '-community-' + index,
      title: '自动化测试资料',
      subtitle: '只用于隔离测试',
      description: '非真实商家或商品，不用于实际营业。',
      city: '洛阳',
      community,
      area: '洛龙区',
      shop: '测试资料',
      price: 100,
      unit: '份',
      art: kind === 'product' ? 'tomato' : 'repair',
      phone: '13800000000',
      phoneSharingConsent: true,
      ...(kind === 'product'
        ? { category: 'farm', stock: 10, options: ['测试规格'] }
        : { duration: '约一小时' }),
    })),
  );
  importCatalog(db, offers);
  for (const route of ['products', 'services']) {
    const all = await fetch(base + '/' + route + '?city=' + encodeURIComponent('洛阳')).then((r) =>
      r.json(),
    );
    assert.equal(all.length, 3);
    const selected = await fetch(
      base +
        '/' +
        route +
        '?city=' +
        encodeURIComponent('洛阳') +
        '&community=' +
        encodeURIComponent('石油社区'),
    ).then((r) => r.json());
    assert.deepEqual(selected.map((item) => item.community).sort(), ['全洛阳', '石油社区'].sort());
  }
  assert.throws(() => validateCatalog([{ ...offers[0], community: false }]), /社区名称/);
  const session = await fetch(base + '/auth/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '社区检查' }),
  }).then((r) => r.json());
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token };
  for (const community of ['石油社区', '地矿社区']) {
    const response = await fetch(base + '/listings', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: '社区筛选测试物品',
        description: '仅用于接口检查的隔离资料，不用于出售。',
        price: 100,
        art: 'book',
        condition: '九成新',
        city: '洛阳',
        area: '洛龙区',
        community,
        phone: '13800000000',
        phoneSharingConsent: true,
      }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).community, community);
  }
  for (const route of ['public/listings', 'listings']) {
    const response = await fetch(
      base +
        '/' +
        route +
        '?city=' +
        encodeURIComponent('洛阳') +
        '&community=' +
        encodeURIComponent('地矿社区'),
      { headers },
    );
    assert.equal(response.status, 200);
    const items = await response.json();
    assert.equal(items.length, 1);
    assert.equal(items[0].community, '地矿社区');
    assert.equal(items[0].phone, undefined);
  }
});
