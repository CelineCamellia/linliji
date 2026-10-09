import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { loadConfig } from '../server/runtime.mjs';

mkdirSync('.cache/tests', { recursive: true });
mkdirSync('artifacts/android', { recursive: true });
const directory = mkdtempSync(resolve('.cache/tests/android-server-'));
process.env.TEMP = process.env.TMP = directory;
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const apps = [];
let browser;
const checks = [];
async function service(name) {
  const config = loadConfig({
    APP_MODE: 'production',
    LOCAL_ONLY: '1',
    PUBLIC_ORIGIN: 'http://127.0.0.1:8788',
    OPERATOR_NAME: '隔离测试',
    SUPPORT_EMAIL: 'tests@linliji.cn',
    REGISTRATION_MODE: 'open',
  });
  const app = createApp({
    dbPath: join(directory, name, 'test.sqlite'),
    staticDir: resolve('dist/android-web'),
    config,
  });
  apps.push(app);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  return { ...app, base: 'http://127.0.0.1:' + app.server.address().port };
}
const text = (page, value) => page.getByText(value, { exact: true }).last();
try {
  const one = await service('one'),
    two = await service('two');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://appassets.androidplatform.net/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: one.base + url.pathname + url.search });
    await route.fulfill({ response });
  });
  for (const [host, base] of [
    ['one.linliji.test', one.base],
    ['two.linliji.test', two.base],
  ])
    await page.route('https://' + host + '/**', async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: base + url.pathname + url.search });
      await route.fulfill({ response });
    });
  await page.route('https://bad.linliji.test/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"offline"}' }),
  );
  const go = (name) =>
    page.goto('https://appassets.androidplatform.net/#/pages/' + name + '/index', {
      waitUntil: 'networkidle',
    });
  await go('home');
  await expect(text(page, '连接你的社区')).toBeVisible();
  await text(page, '设置服务地址').click();
  const endpoint = page.locator('uni-input input');
  await endpoint.fill('http://plain.linliji.test');
  await text(page, '保存并检查连接').click();
  await expect(text(page, '请填写 HTTPS 服务地址')).toBeVisible();
  checks.push('首次启动引导连接，拒绝明文服务');
  await endpoint.fill('https://one.linliji.test');
  await text(page, '保存并检查连接').click();
  await expect(text(page, '连接成功，可以返回首页')).toBeVisible();
  await go('profile');
  await text(page, '登录 / 注册').click();
  await text(page, '首次使用，注册账号').click();
  await page.locator('uni-input input').nth(0).fill('android_resident');
  await page.locator('uni-input input').nth(1).fill('android-test-password');
  await page.locator('uni-switch').click();
  await text(page, '注册并登录').click();
  await expect(text(page, '已登录')).toBeVisible();
  assert.equal(one.db.prepare('SELECT count(*) n FROM users').get().n, 1);
  checks.push('连接 HTTPS 服务后能注册真实账号');
  await go('settings');
  await endpoint.fill('https://bad.linliji.test');
  await text(page, '保存并检查连接').click();
  await expect(text(page, '服务地址不可用')).toBeVisible();
  await go('profile');
  await expect(text(page, '已登录')).toBeVisible();
  await go('settings');
  await expect(endpoint).toHaveValue('https://one.linliji.test/api');
  checks.push('无效服务不会覆盖原地址或账号');
  await endpoint.fill('https://two.linliji.test');
  await text(page, '保存并检查连接').click();
  await expect(text(page, '连接成功，可以返回首页')).toBeVisible();
  await go('profile');
  await expect(text(page, '登录 / 注册')).toBeVisible();
  assert.equal(two.db.prepare('SELECT count(*) n FROM users').get().n, 0);
  checks.push('切换服务后清除当前显示身份，不跨服务使用账号');
  await go('settings');
  await endpoint.fill('https://one.linliji.test');
  await text(page, '保存并检查连接').click();
  await expect(text(page, '连接成功，可以返回首页')).toBeVisible();
  await go('profile');
  await expect(text(page, '已登录')).toBeVisible();
  checks.push('切回原服务恢复其独立会话');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'artifacts/android/connection-profile.png', fullPage: true });
  writeFileSync(
    'artifacts/android/results.json',
    JSON.stringify(
      { checks, errors, scope: '浏览器模拟 WebView 地址；未代替安卓真机验收' },
      null,
      2,
    ),
  );
  for (const check of checks) console.log('PASS ' + check);
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true });
      writeFileSync(join(directory, 'failure.txt'), await page.locator('body').innerText());
    }
  }
  throw error;
} finally {
  await browser?.close();
  for (const app of apps) {
    await new Promise((r) => app.server.close(r));
    app.db.close();
  }
}
