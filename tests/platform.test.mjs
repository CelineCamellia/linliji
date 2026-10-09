import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/index.mjs';
import { loadConfig, POLICY_VERSION } from '../server/runtime.mjs';

const env = {
  APP_MODE: 'production',
  LOCAL_ONLY: '1',
  PUBLIC_ORIGIN: 'http://127.0.0.1:8788',
  OPERATOR_NAME: '自动化测试',
  SUPPORT_EMAIL: 'tests@linliji.cn',
  REGISTRATION_MODE: 'open',
  ADMIN_PASSWORD: 'admin-test-password-12345',
};
const listing = {
  title: '邻里物品测试标题',
  description: '这条信息仅用于隔离自动化测试。',
  kind: 'sale',
  price: 100,
  art: 'book',
  condition: '九成新',
  city: '洛阳',
  area: '洛龙区',
  community: '同名社区',
  phone: '13800000000',
  phoneSharingConsent: true,
};
async function setup(t, changes = {}) {
  mkdirSync('.cache/tests', { recursive: true });
  const directory = mkdtempSync(resolve('.cache/tests/platform-'));
  const config = loadConfig({ ...env, ...changes });
  const app = createApp({
    dbPath: join(directory, 'test.sqlite'),
    config,
    exchangeWechat: async (code) => 'test-openid-' + code,
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  config.origin = base;
  config.origins.push(base);
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    app.db.close();
  });
  async function request(
    path,
    { token, cookie, data, origin = base, method = data ? 'POST' : 'GET' } = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
      redirect: 'manual',
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, headers: response.headers, data: body };
  }
  async function account(username = 'test_resident') {
    const r = await request('/api/auth/register', {
      data: { username, password: 'resident-test-password', consentVersion: POLICY_VERSION },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  }
  async function admin() {
    const r = await request('/api/admin/session', {
      data: { username: 'admin', password: env.ADMIN_PASSWORD },
    });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  }
  async function upload(token, bytes, type = 'image/png', extra = false) {
    const form = new FormData();
    form.append('photo', new Blob([bytes], { type }), 'photo.png');
    if (extra) form.append('photo', new Blob([bytes], { type }), 'second.png');
    const r = await fetch(base + '/api/uploads', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form,
    });
    return { status: r.status, data: await r.json() };
  }
  async function review(id, cookie, decision = 'approve') {
    const r = await request('/api/admin/listings/' + id + '/review', {
      cookie,
      data: { decision, expectedStatus: 'pending', reason: '已核对测试资料' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  return { ...app, config, base, request, account, admin, upload, review };
}

test('本机生产流程无需微信密钥，注册策略和公开配置不泄漏秘密', async (t) => {
  const c = await setup(t);
  const site = await c.request('/api/site');
  assert.equal(site.data.wechatLogin, false);
  assert.equal(site.data.registration, 'open');
  assert.ok(!JSON.stringify(site.data).includes(env.ADMIN_PASSWORD));
  await c.account();
  assert.equal(
    (
      await c.request('/api/auth/wechat', {
        data: { code: 'unused', consentVersion: POLICY_VERSION },
      })
    ).status,
    403,
  );
  assert.throws(() => loadConfig({ ...env, PUBLIC_ORIGIN: 'http://0.0.0.0:8788' }));
  assert.throws(() => loadConfig({ ...env, LOCAL_ONLY: '0' }));
  assert.throws(() => loadConfig({ ...env, WX_APPID: 'wx0000000000000000' }));
  const closed = await setup(t, { REGISTRATION_MODE: 'closed' });
  assert.equal(
    (
      await closed.request('/api/auth/register', {
        data: {
          username: 'closed_user',
          password: 'resident-test-password',
          consentVersion: POLICY_VERSION,
        },
      })
    ).status,
    403,
  );
});

test('管理员独立会话、同源写操作、错误密码和退出撤销', async (t) => {
  const c = await setup(t),
    resident = await c.account();
  assert.equal((await c.request('/api/admin/status')).status, 401);
  assert.equal((await c.request('/api/admin/status', { token: resident.token })).status, 401);
  assert.equal((await c.request('/admin/')).headers.get('location'), '/admin/login');
  assert.equal(
    (await c.request('/api/admin/session', { data: { username: 'admin', password: 'wrong' } }))
      .status,
    401,
  );
  const r = await c.request('/api/admin/session', {
    data: { username: 'admin', password: env.ADMIN_PASSWORD },
  });
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await c.request('/api/admin/status', { cookie })).status, 200);
  assert.equal(
    (
      await c.request('/api/admin/session/logout', {
        cookie,
        origin: 'https://foreign.invalid',
        data: {},
      })
    ).status,
    403,
  );
  assert.equal((await c.request('/api/admin/session/logout', { cookie, data: {} })).status, 200);
  assert.equal((await c.request('/api/admin/status', { cookie })).status, 401);
});

test('图片验证、所有权、审核、修改与注销形成完整权限流程', async (t) => {
  const c = await setup(t),
    owner = await c.account(),
    other = await c.account('other_resident'),
    cookie = await c.admin();
  const png = await sharp({
    create: { width: 1800, height: 900, channels: 3, background: '#146b53' },
  })
    .png()
    .toBuffer();
  assert.equal((await c.upload(owner.token, Buffer.from('not an image'))).status, 400);
  assert.equal((await c.upload(owner.token, Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await c.upload(owner.token, png, 'image/png', true)).status, 400);
  assert.equal((await c.upload(owner.token, png, 'image/jpeg')).status, 400);
  const photo = await c.upload(owner.token, png);
  assert.equal(photo.status, 201, JSON.stringify(photo.data));
  assert.equal(photo.data.width, 1600);
  assert.equal(photo.data.height, 800);
  const path = '/api/media/' + photo.data.id;
  assert.equal((await fetch(c.base + path)).status, 404);
  assert.equal((await fetch(c.base + photo.data.url)).status, 200);
  assert.equal(
    (await fetch(c.base + photo.data.url.replace('signature=', 'signature=0'))).status,
    404,
  );
  assert.equal(
    (
      await c.request('/api/listings', {
        token: other.token,
        data: { ...listing, photos: [photo.data.id] },
      })
    ).status,
    403,
  );
  const made = await c.request('/api/listings', {
    token: owner.token,
    data: { ...listing, photos: [photo.data.id] },
  });
  assert.equal(made.status, 201);
  const id = made.data.id;
  assert.equal(
    (await c.request('/api/listings/' + id, { token: owner.token })).data.phone,
    listing.phone,
  );
  assert.equal((await c.request('/api/listings/' + id, { token: other.token })).status, 404);
  assert.equal(
    (await fetch(c.base + '/api/admin/photos/' + photo.data.id, { headers: { Cookie: cookie } }))
      .status,
    200,
  );
  await c.review(id, cookie);
  assert.equal((await fetch(c.base + path)).status, 200);
  const shown = await c.request('/api/public/listings/' + id);
  assert.equal(shown.data.phone, undefined);
  assert.equal(shown.data.photos[0].url, path);
  assert.equal(
    (
      await c.request('/api/listings', {
        token: owner.token,
        data: { ...listing, photos: [photo.data.id] },
      })
    ).status,
    403,
  );
  const edited = await c.request('/api/listings/' + id, {
    method: 'PATCH',
    token: owner.token,
    data: { ...listing, title: '修改后的邻里物品', photos: [photo.data.id] },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.status, 'pending');
  assert.equal((await fetch(c.base + path)).status, 404);
  assert.equal((await c.request('/api/public/listings/' + id)).status, 404);
  await c.review(id, cookie);
  const deleted = await c.request('/api/me', {
    method: 'DELETE',
    token: owner.token,
    data: { confirm: 'DELETE' },
  });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  assert.equal((await fetch(c.base + path)).status, 404);
  c.media.prune(Date.now() + 2 * 86400000);
  assert.equal(existsSync(join(c.media.directory, photo.data.id + '.webp')), false);
});

test('同名社区按城市隔离，修改不能冒用其他居民的信息', async (t) => {
  const c = await setup(t),
    a = await c.account(),
    b = await c.account('resident_two'),
    cookie = await c.admin();
  for (const city of ['洛阳', '成都']) {
    const r = await c.request('/api/listings', { token: a.token, data: { ...listing, city } });
    assert.equal(r.status, 201);
    await c.review(r.data.id, cookie);
  }
  const results = await c.request(
    '/api/public/listings?city=' +
      encodeURIComponent('成都') +
      '&community=' +
      encodeURIComponent('同名社区') +
      '&page=1',
  );
  assert.equal(results.data.total, 1);
  assert.equal(results.data.items[0].city, '成都');
  assert.equal(
    (
      await c.request('/api/listings/' + results.data.items[0].id, {
        method: 'PATCH',
        token: b.token,
        data: listing,
      })
    ).status,
    404,
  );
});

test('微信新账号遵守邀请码与关闭注册策略，已有账号仍可登录', async (t) => {
  const c = await setup(t, {
    REGISTRATION_MODE: 'invite',
    INVITE_CODE: 'test-invite-code-12345',
    WX_APPID: 'wx0000000000000000',
    WX_APP_SECRET: 'a'.repeat(32),
  });
  const data = { code: 'existing', consentVersion: POLICY_VERSION };
  assert.equal((await c.request('/api/auth/wechat', { data })).status, 403);
  assert.equal(
    (
      await c.request('/api/auth/wechat', {
        data: { ...data, inviteCode: 'test-invite-code-12345' },
      })
    ).status,
    200,
  );
  c.config.registrationMode = 'closed';
  assert.equal((await c.request('/api/auth/wechat', { data })).status, 200);
  assert.equal(
    (await c.request('/api/auth/wechat', { data: { ...data, code: 'new' } })).status,
    403,
  );
});
