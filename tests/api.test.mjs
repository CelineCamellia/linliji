import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from '../server/index.mjs';
const future = (n) => new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const addressData = {
  name: '测试邻居',
  phone: '13800000000',
  city: '杭州',
  area: '西湖区',
  detail: '测试小区一号楼 101',
};
const listingData = {
  title: '测试闲置小边桌',
  description: '这是一件测试物品，成色较好，同城自提。',
  price: 6000,
  art: 'table',
  condition: '九成新',
  city: '杭州',
  area: '西湖区',
  phone: '13800000000',
};
async function context(t, dbPath = ':memory:') {
  const app = createApp({ dbPath });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await new Promise((r) => app.server.close(r));
    app.db.close();
  }
  t.after(close);
  const base = 'http://127.0.0.1:' + app.server.address().port;
  async function request(path, { method = 'GET', data, token, key, origin } = {}) {
    const r = await fetch(base + '/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: r.status, data: await r.json() };
  }
  async function login() {
    const r = await request('/auth/demo', { method: 'POST', data: { nickname: '测试邻居' } });
    assert.equal(r.status, 201);
    return r.data.token;
  }
  async function address(token, data = addressData) {
    const r = await request('/addresses', { method: 'POST', data, token });
    assert.equal(r.status, 201);
    return r.data;
  }
  return { ...app, base, request, login, address, close };
}
test('目录分类、中文搜索、价格排序和城市范围', async (t) => {
  const c = await context(t);
  const r = await c.request('/products?category=farm&q=' + encodeURIComponent('番茄'));
  assert.equal(r.status, 200);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].id, 'p1');
  const sorted = (await c.request('/products?sort=price')).data;
  assert.equal(sorted.length, 12);
  assert.ok(sorted.every((p, i) => !i || p.price >= sorted[i - 1].price));
  assert.deepEqual((await c.request('/products?city=' + encodeURIComponent('洛阳'))).data, []);
  assert.deepEqual((await c.request('/services?city=' + encodeURIComponent('洛阳'))).data, []);
});
test('身份验证与来源白名单', async (t) => {
  const c = await context(t);
  for (const path of ['/orders', '/addresses', '/cart', '/listings'])
    assert.equal((await c.request(path)).status, 401);
  assert.equal((await c.request('/health', { origin: 'https://unexpected.example' })).status, 403);
  assert.equal((await c.request('/health')).data.mode, 'demo');
});

test('朋友圈未登录读取仅返回公开闲置内容，联系方式和个人数据仍受保护', async (t) => {
  const c = await context(t),
    seller = await c.login();
  const item = (await c.request('/listings', { method: 'POST', token: seller, data: listingData }))
    .data;
  const sessionCount = c.db.prepare('SELECT count(*) n FROM sessions').get().n;
  const result = await c.request('/public/listings/' + item.id);
  assert.equal(result.status, 200);
  assert.equal(result.data.title, listingData.title);
  for (const key of ['phone', 'owned', 'user_id', 'address', 'token'])
    assert.equal(result.data[key], undefined);
  const list = await c.request('/public/listings?mine=1&city=' + encodeURIComponent('杭州'));
  assert.equal(list.status, 200);
  assert.ok(list.data.some((x) => x.id === item.id));
  assert.deepEqual(
    (await c.request('/public/listings?city=' + encodeURIComponent('洛阳'))).data,
    [],
  );
  for (const path of ['/listings/' + item.id + '/contact', '/addresses', '/orders'])
    assert.equal((await c.request(path)).status, 401);
  assert.equal((await c.request('/public/listings/' + item.id + '/contact')).status, 401);
  assert.equal(
    (await c.request('/public/listings', { method: 'POST', data: listingData })).status,
    401,
  );
  assert.equal((await c.request('/public/listings/' + item.id, { method: 'DELETE' })).status, 401);
  assert.equal(c.db.prepare('SELECT count(*) n FROM sessions').get().n, sessionCount);
});

test('公开分享不暴露已下架或已预约的物品，取消预约后恢复公开', async (t) => {
  const c = await context(t),
    seller = await c.login(),
    buyer = await c.login(),
    addr = await c.address(buyer);
  const item = (await c.request('/listings', { method: 'POST', token: seller, data: listingData }))
    .data;
  const order = await c.request('/listings/' + item.id + '/reserve', {
    method: 'POST',
    token: buyer,
    key: 'public-reserve',
    data: { addressId: addr.id },
  });
  assert.equal(order.status, 201);
  assert.equal((await c.request('/public/listings/' + item.id)).status, 404);
  assert.ok(!(await c.request('/public/listings')).data.some((x) => x.id === item.id));
  await c.request('/orders/' + order.data.id + '/cancel', { method: 'POST', token: buyer });
  assert.equal((await c.request('/public/listings/' + item.id)).status, 200);
  await c.request('/listings/' + item.id, { method: 'DELETE', token: seller });
  assert.equal((await c.request('/public/listings/' + item.id)).status, 404);
  assert.ok(!(await c.request('/public/listings?mine=1')).data.some((x) => x.id === item.id));
  assert.equal(
    (await c.request('/listings/' + item.id, { token: seller })).data.status,
    'withdrawn',
  );
});
test('购物车数量、规格、库存与账号隔离', async (t) => {
  const c = await context(t),
    a = await c.login(),
    b = await c.login();
  for (const quantity of [-1, 1.5, 100])
    assert.equal(
      (
        await c.request('/cart', {
          method: 'POST',
          token: a,
          data: { productId: 'p1', quantity, spec: '标准' },
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await c.request('/cart', {
        method: 'POST',
        token: a,
        data: { productId: 'p7', quantity: 1, spec: '不存在' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await c.request('/cart', {
        method: 'POST',
        token: a,
        data: { productId: 'p7', quantity: 99, spec: 'M' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await c.request('/cart', {
        method: 'POST',
        token: a,
        data: { productId: 'p1', quantity: 2, spec: '标准' },
      })
    ).status,
    200,
  );
  assert.equal((await c.request('/cart', { token: b })).data.length, 0);
});
test('地址校验与删除隔离', async (t) => {
  const c = await context(t),
    a = await c.login(),
    b = await c.login();
  assert.equal(
    (
      await c.request('/addresses', {
        method: 'POST',
        token: a,
        data: { ...addressData, phone: '123' },
      })
    ).status,
    400,
  );
  const addr = await c.address(a);
  await c.request('/addresses/' + addr.id, { method: 'DELETE', token: b });
  assert.equal((await c.request('/addresses', { token: a })).data.length, 1);
  assert.equal((await c.request('/addresses', { token: b })).data.length, 0);
});
test('下单金额由后端计算，库存扣减，重复提交只创建一次', async (t) => {
  const c = await context(t),
    token = await c.login(),
    addr = await c.address(token);
  await c.request('/cart', {
    method: 'POST',
    token,
    data: { productId: 'p1', quantity: 2, spec: '标准' },
  });
  const req = {
    method: 'POST',
    token,
    key: 'checkout-001',
    data: { addressId: addr.id, total: 1 },
  };
  const r = await c.request('/orders', req);
  assert.equal(r.status, 201);
  assert.equal(r.data.total, 1380);
  assert.equal((await c.request('/cart', { token })).data.length, 0);
  assert.equal((await c.request('/products/p1')).data.stock, 126);
  const again = await c.request('/orders', req);
  assert.equal(again.data.id, r.data.id);
  assert.equal((await c.request('/products/p1')).data.stock, 126);
  assert.equal((await c.request('/orders', { token })).data.length, 1);
});
test('取消只恢复一次库存，禁止取消其他用户订单', async (t) => {
  const c = await context(t),
    a = await c.login(),
    b = await c.login(),
    addr = await c.address(a);
  await c.request('/cart', {
    method: 'POST',
    token: a,
    data: { productId: 'p1', quantity: 3, spec: '标准' },
  });
  const o = (
    await c.request('/orders', {
      method: 'POST',
      token: a,
      key: 'cancel-001',
      data: { addressId: addr.id },
    })
  ).data;
  assert.equal(
    (await c.request('/orders/' + o.id + '/cancel', { method: 'POST', token: b })).status,
    404,
  );
  assert.equal(
    (await c.request('/orders/' + o.id + '/cancel', { method: 'POST', token: a })).status,
    200,
  );
  assert.equal((await c.request('/products/p1')).data.stock, 128);
  assert.equal(
    (await c.request('/orders/' + o.id + '/cancel', { method: 'POST', token: a })).status,
    409,
  );
  assert.equal((await c.request('/products/p1')).data.stock, 128);
  assert.equal((await c.request('/orders', { token: b })).data.length, 0);
});
test('库存竞争时事务回滚并保留购物车', async (t) => {
  const c = await context(t),
    a = await c.login(),
    b = await c.login(),
    aa = await c.address(a),
    ab = await c.address(b);
  for (const token of [a, b])
    await c.request('/cart', {
      method: 'POST',
      token,
      data: { productId: 'p7', quantity: 30, spec: 'M' },
    });
  assert.equal(
    (
      await c.request('/orders', {
        method: 'POST',
        token: a,
        key: 'stock-user-a',
        data: { addressId: aa.id },
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await c.request('/orders', {
        method: 'POST',
        token: b,
        key: 'stock-user-b',
        data: { addressId: ab.id },
      })
    ).status,
    409,
  );
  assert.equal((await c.request('/products/p7')).data.stock, 8);
  assert.equal((await c.request('/cart', { token: b })).data[0].quantity, 30);
  assert.equal((await c.request('/orders', { token: b })).data.length, 0);
});
test('空购物车、其他用户地址和异城配送均被拒绝', async (t) => {
  const c = await context(t),
    a = await c.login(),
    b = await c.login(),
    aa = await c.address(a),
    ab = await c.address(b),
    other = await c.address(a, { ...addressData, city: '洛阳' });
  for (const addressId of [aa.id, ab.id, other.id])
    assert.equal(
      (
        await c.request('/orders', {
          method: 'POST',
          token: a,
          key: 'address-' + addressId,
          data: { addressId },
        })
      ).status,
      400,
    );
});
test('维修预约日期、时段验证与合法预约', async (t) => {
  const c = await context(t),
    token = await c.login(),
    addr = await c.address(token);
  for (const date of [future(-1), future(0), future(31), '2026-02-31'])
    assert.equal(
      (
        await c.request('/bookings', {
          method: 'POST',
          token,
          key: 'booking-' + date,
          data: { serviceId: 's1', addressId: addr.id, date, slot: '09:00–12:00' },
        })
      ).status,
      400,
    );
  const data = { serviceId: 's1', addressId: addr.id, date: future(2), slot: '09:00–12:00' };
  assert.equal(
    (
      await c.request('/bookings', {
        method: 'POST',
        token,
        key: 'invalid-slot',
        data: { ...data, slot: '00:00' },
      })
    ).status,
    400,
  );
  const r = await c.request('/bookings', { method: 'POST', token, key: 'booking-valid', data });
  assert.equal(r.status, 201);
  assert.equal(r.data.kind, 'service');
  assert.equal(r.data.total, 8900);
  assert.equal(r.data.estimate, true);
  assert.equal(
    (await c.request('/orders/' + r.data.id + '/cancel', { method: 'POST', token })).status,
    200,
  );
});
test('闲置发布价格校验与联系方式保护', async (t) => {
  const c = await context(t),
    token = await c.login();
  assert.equal(
    (await c.request('/listings', { method: 'POST', token, data: { ...listingData, price: 1.2 } }))
      .status,
    400,
  );
  const r = await c.request('/listings', { method: 'POST', token, data: listingData });
  assert.equal(r.status, 201);
  const list = await c.request('/listings?mine=1', { token });
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].phone, undefined);
  assert.equal((await c.request('/listings/' + r.data.id + '/contact')).status, 401);
  assert.equal(
    (await c.request('/listings/' + r.data.id + '/contact', { token })).data.phone,
    listingData.phone,
  );
  assert.equal((await c.request('/listings/m1/contact', { token })).status, 400);
});
test('闲置所有权、异城预约和下架', async (t) => {
  const c = await context(t),
    a = await c.login(),
    b = await c.login(),
    aa = await c.address(a),
    ab = await c.address(b, { ...addressData, city: '洛阳' });
  const item = (await c.request('/listings', { method: 'POST', token: a, data: listingData })).data;
  assert.equal(
    (await c.request('/listings/' + item.id, { method: 'DELETE', token: b })).status,
    404,
  );
  assert.equal(
    (
      await c.request('/listings/' + item.id + '/reserve', {
        method: 'POST',
        token: a,
        key: 'reserve-self',
        data: { addressId: aa.id },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await c.request('/listings/' + item.id + '/reserve', {
        method: 'POST',
        token: b,
        key: 'reserve-other-city',
        data: { addressId: ab.id },
      })
    ).status,
    400,
  );
  assert.equal(
    (await c.request('/listings?city=' + encodeURIComponent('洛阳'), { token: b })).data.length,
    0,
  );
  assert.equal(
    (await c.request('/listings/' + item.id, { method: 'DELETE', token: a })).status,
    200,
  );
  assert.equal((await c.request('/listings/' + item.id, { token: a })).data.status, 'withdrawn');
});
test('并发预约闲置只有一个成功，取消后恢复可预约', async (t) => {
  const c = await context(t),
    a = await c.login(),
    b = await c.login(),
    aa = await c.address(a),
    ab = await c.address(b);
  const results = await Promise.all([
    c.request('/listings/m1/reserve', {
      method: 'POST',
      token: a,
      key: 'reserve-user-a',
      data: { addressId: aa.id },
    }),
    c.request('/listings/m1/reserve', {
      method: 'POST',
      token: b,
      key: 'reserve-user-b',
      data: { addressId: ab.id },
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const index = results.findIndex((r) => r.status === 201),
    winner = [a, b][index];
  await c.request('/orders/' + results[index].data.id + '/cancel', {
    method: 'POST',
    token: winner,
  });
  assert.equal((await c.request('/listings/m1', { token: a })).data.status, 'available');
});
test('数据库重启后保留身份、地址与购物车', async (t) => {
  mkdirSync('.cache/tests', { recursive: true });
  const dir = mkdtempSync(resolve('.cache/tests/db-')),
    path = resolve(dir, 'test.sqlite');
  const first = await context(t, path),
    token = await first.login();
  await first.address(token);
  await first.request('/cart', {
    method: 'POST',
    token,
    data: { productId: 'p1', quantity: 2, spec: '标准' },
  });
  await first.close();
  const next = await context(t, path);
  assert.equal((await next.request('/addresses', { token })).data.length, 1);
  assert.equal((await next.request('/cart', { token })).data[0].quantity, 2);
});
test('禁止越界读取后端源码', async (t) => {
  const c = await context(t);
  const r = await fetch(c.base + '/%2e%2e%2fserver%2findex.mjs');
  assert.equal(r.status, 403);
});

test('同商品不同规格合并检查总库存，失败时完整保留购物车', async (t) => {
  const c = await context(t),
    token = await c.login(),
    addr = await c.address(token);
  for (const spec of ['S', 'M'])
    await c.request('/cart', {
      method: 'POST',
      token,
      data: { productId: 'p7', quantity: 30, spec },
    });
  assert.equal(
    (
      await c.request('/orders', {
        method: 'POST',
        token,
        key: 'multi-spec-stock',
        data: { addressId: addr.id },
      })
    ).status,
    409,
  );
  assert.equal((await c.request('/products/p7')).data.stock, 38);
  assert.equal((await c.request('/cart', { token })).data.length, 2);
});
test('预约者保留联系卖家权限，其他用户不能读取已预约联系方式', async (t) => {
  const c = await context(t),
    seller = await c.login(),
    buyer = await c.login(),
    other = await c.login(),
    addr = await c.address(buyer);
  const l = (await c.request('/listings', { method: 'POST', token: seller, data: listingData }))
    .data;
  await c.request('/listings/' + l.id + '/reserve', {
    method: 'POST',
    token: buyer,
    key: 'reserve-contact',
    data: { addressId: addr.id },
  });
  assert.equal((await c.request('/listings/' + l.id + '/contact', { token: buyer })).status, 200);
  assert.equal((await c.request('/listings/' + l.id + '/contact', { token: other })).status, 404);
});
