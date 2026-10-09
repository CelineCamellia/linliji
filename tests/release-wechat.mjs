import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createApp } from '../server/index.mjs';
import { loadConfig, POLICY_VERSION } from '../server/runtime.mjs';

mkdirSync('artifacts/release', { recursive: true });
const root = resolve('dist/mp-weixin');
const config = loadConfig({
  APP_MODE: 'production',
  PUBLIC_ORIGIN: 'https://pilot.linliji.cn',
  WX_APPID: 'wx0000000000000000',
  WX_APP_SECRET: 'c'.repeat(32),
  OPERATOR_NAME: '编译测试运营者',
  SUPPORT_EMAIL: 'test@linliji.cn',
  INVITE_CODE: 'compiled-test-invite-1',
});
const codes = [];
const { server, db } = createApp({
  dbPath: ':memory:',
  config,
  exchangeWechat: async (code) => {
    codes.push(code);
    return 'compiled-test-openid';
  },
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const checks = [];
try {
  const cache = new Map(),
    storage = new Map([
      ['llj-api', 'http://192.168.1.12:8787/api'],
      ['llj-token', 'old-demo-token'],
    ]),
    requests = [],
    navigations = [];
  let sequence = 0;
  const uni = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    getEnterOptionsSync: () => ({ scene: 1001 }),
    getLaunchOptionsSync: () => ({ scene: 1001 }),
    navigateTo: (options) => {
      navigations.push(options.url);
      options.complete?.();
    },
    login: (options) => options.success({ code: 'code-' + ++sequence }),
    request: (options) => {
      requests.push({ url: options.url, header: options.header });
      const url = new URL(options.url);
      // Redirect test transport to the isolated real backend. The emitted URL is asserted below.
      fetch(base + url.pathname + url.search, {
        method: options.method,
        headers: options.header,
        body: options.data ? JSON.stringify(options.data) : undefined,
      })
        .then(async (r) => options.success({ statusCode: r.status, data: await r.json() }))
        .catch(options.fail);
    },
  };
  const vendor = { index: uni, reactive: (v) => v };
  const sandbox = vm.createContext({
    console,
    getCurrentPages: () => [],
    setTimeout,
    clearTimeout,
  });
  function load(file) {
    file = resolve(file);
    if (file === resolve(root, 'common/vendor.js')) return vendor;
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    vm.runInContext(
      '(function(require,module,exports){' + readFileSync(file, 'utf8') + '\n})',
      sandbox,
      { filename: file },
    )((name) => load(resolve(dirname(file), name)), module, module.exports);
    return module.exports;
  }
  const api = load(resolve(root, 'lib/api.js'));
  assert.equal(api.isRelease, true);
  assert.equal(api.hasSession(), false);
  assert.equal(api.apiBase(), 'https://pilot.linliji.cn/api');
  await api.api('/public/listings', { public: true });
  assert.equal(codes.length, 0);
  assert.equal(requests[0].header.Authorization, undefined);
  checks.push('正式编译模块忽略体验地址和体验身份；公开浏览不登录');
  await assert.rejects(api.api('/me'), /先登录/);
  assert.deepEqual(navigations, ['/pages/login/index']);
  const first = await api.loginWechat(POLICY_VERSION, config.inviteCode);
  assert.equal(codes[0], 'code-1');
  assert.equal(api.hasSession(), true);
  const me = await api.api('/me');
  assert.equal(me.id, first.user.id);
  assert.ok(requests.every((r) => r.url.startsWith('https://pilot.linliji.cn/api')));
  assert.match(requests.at(-1).header.Authorization, /^Bearer /);
  checks.push('真实编译模块调用模拟 wx.login，服务端换取身份后才能访问个人资料');
  await api.api('/auth/logout', { method: 'POST', data: {} });
  await assert.rejects(api.api('/me'), /过期/);
  assert.equal(api.hasSession(), false);
  assert.equal(api.state.user, null);
  const again = await api.loginWechat(POLICY_VERSION, config.inviteCode);
  assert.equal(again.user.id, first.user.id);
  checks.push('401 清理凭证；重新登录恢复稳定账号');
  const project = JSON.parse(readFileSync(resolve(root, 'project.config.json'), 'utf8'));
  assert.equal(project.setting.urlCheck, true);
  assert.equal(project.appid, 'wx0000000000000000');
  for (const file of ['lib/api.js', 'pages/settings/index.js', 'app.js']) {
    const content = readFileSync(resolve(root, file), 'utf8');
    assert.ok(
      !/auth\/demo|llj-api|192\.168\.|127\.0\.0\.1/.test(content),
      file + ' contains no development connection',
    );
    assert.ok(!content.includes(config.appSecret));
  }
  checks.push('合法域名检查开启；核心编译模块无体验登录、局域网地址或密钥');
  writeFileSync(
    'artifacts/release/wechat-compiled-results.json',
    JSON.stringify(
      {
        status: 'passed',
        checks,
        limitation:
          '模拟微信 API 的编译后运行测试；尚未连接真实微信 code2Session 或手机完成正式登录。',
      },
      null,
      2,
    ),
  );
  for (const check of checks) console.log('PASS ' + check);
} finally {
  await new Promise((r) => server.close(r));
  db.close();
}
