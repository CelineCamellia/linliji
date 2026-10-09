import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { loadConfig } from '../server/runtime.mjs';

mkdirSync('.cache/tests', { recursive: true });
mkdirSync('artifacts/platform', { recursive: true });
const directory = mkdtempSync(resolve('.cache/tests/platform-ui-'));
process.env.TEMP = process.env.TMP = directory;
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const config = loadConfig({
  APP_MODE: 'production',
  LOCAL_ONLY: '1',
  PUBLIC_ORIGIN: 'http://127.0.0.1:8788',
  REGISTRATION_MODE: 'open',
  OPERATOR_NAME: '界面测试',
  SUPPORT_EMAIL: 'tests@linliji.cn',
  ADMIN_PASSWORD: 'ui-admin-password-12345',
});
const app = createApp({
  dbPath: join(directory, 'test.sqlite'),
  staticDir: resolve(process.env.TEST_STATIC_DIR || 'dist/web'),
  config,
});
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + app.server.address().port;
config.origin = base;
config.origins.push(base);
const checks = [],
  errors = [];
let browser;
const pass = (text) => {
  checks.push(text);
  console.log('PASS ' + text);
};
const navigate = (p, name, query = '') => p.goto(base + '/#/pages/' + name + '/index' + query);
const text = (p, value) => p.getByText(value, { exact: true }).last();
const field = (p, id) => p.locator('#publish-' + id + ' input,#publish-' + id + ' textarea');
try {
  browser = await chromium.launch({ headless: true });
  const resident = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    admin = await browser.newPage({ viewport: { width: 1280, height: 960 } }),
    visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const page of [resident, admin, visitor])
    page.on('pageerror', (e) => errors.push(e.message));
  await admin.goto(base + '/admin/');
  await expect(admin.locator('#login-form')).toBeVisible();
  await admin.locator('#username').fill('admin');
  await admin.locator('#password').fill('ui-admin-password-12345');
  await admin.locator('#login-button').click();
  await expect(admin.locator('#pending-count')).toHaveText('0');
  await expect(admin.locator('[data-tab=catalog]')).not.toBeVisible();
  pass('管理员独立登录，进入同源审核后台');
  await navigate(resident, 'profile');
  await text(resident, '登录 / 注册').click();
  await text(resident, '首次使用，注册账号').click();
  const inputs = resident.locator('uni-input input');
  await inputs.nth(0).fill('photo_neighbor');
  await inputs.nth(1).fill('neighbor-ui-password-123');
  await expect(inputs).toHaveCount(2);
  await resident.locator('uni-switch').click();
  await text(resident, '注册并登录').click();
  await expect(text(resident, '已登录')).toBeVisible();
  pass('开放注册不需要邀请码，居民账号正常建立');
  await navigate(resident, 'publish');
  await field(resident, 'title').fill('邻居转让一张书桌');
  await field(resident, 'description').fill(
    '测试资料：书桌使用正常，桌面有轻微磨损，可在社区门口当面检查。',
  );
  await field(resident, 'price').fill('35');
  await field(resident, 'community').fill('石油社区');
  await field(resident, 'area').fill('洛龙区');
  await field(resident, 'phone').fill('13800000000');
  const photo = join(directory, 'photo.png');
  copyFileSync('apps/client/src/static/art/table.png', photo);
  const chooser = resident.waitForEvent('filechooser');
  await text(resident, '＋ 添加照片').click();
  await (await chooser).setFiles(photo);
  await expect(resident.locator('.photos .photo')).toHaveCount(1);
  await expect(text(resident, '＋ 添加照片')).toBeVisible();
  await resident.locator('.consent').click();
  await text(resident, '提交发布').click();
  await expect(text(resident, '等待审核')).toBeVisible();
  const id = app.db.prepare('SELECT id FROM listings').get().id;
  assert.equal((await fetch(base + '/api/public/listings/' + id)).status, 404);
  pass('居民选图、上传、发布进入审核，公开接口暂不可见');
  await admin.locator('#refresh').click();
  await admin.locator('#records').getByRole('button', { name: '查看详情' }).click();
  await expect(admin.locator('.review-photos img')).toBeVisible();
  assert.equal(
    await admin
      .locator('.review-photos img')
      .evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  await admin.locator('#close-detail').click();
  await admin.locator('#records').getByRole('button', { name: '通过并展示', exact: true }).click();
  await admin.locator('#reason').fill('照片和文字说明一致，允许展示');
  await admin.locator('#confirm-decision').click();
  await expect(admin.locator('#decision-dialog')).not.toBeVisible();
  pass('审核人员能看照片并通过发布');
  await navigate(visitor, 'detail', '?kind=market&id=' + id);
  await expect(text(visitor, '邻居转让一张书桌')).toBeVisible();
  await expect(visitor.locator('uni-swiper')).toBeVisible();
  assert.ok(!(await visitor.locator('body').innerText()).includes('13800000000'));
  await navigate(visitor, 'home');
  await expect(text(visitor, '邻居转让一张书桌')).toBeVisible();
  await visitor.screenshot({ path: 'artifacts/platform/home-mobile.png', fullPage: true });
  await navigate(visitor, 'location');
  await text(visitor, '成都').click();
  await expect(visitor.locator('.community-eyebrow')).toContainText('成都');
  await expect(visitor.locator('.neighbor-card')).toHaveCount(0);
  pass('匿名浏览能看到审核照片，切换城市不会串入同名社区发布');
  await navigate(resident, 'detail', '?kind=market&id=' + id);
  await text(resident, '修改信息').click();
  await expect(field(resident, 'phone')).toHaveValue('13800000000');
  await expect(resident.locator('.photos .photo')).toHaveCount(1);
  await field(resident, 'title').fill('邻居转让实木小书桌');
  await text(resident, '保存并重新审核').click();
  await expect(text(resident, '等待审核')).toBeVisible();
  assert.equal((await fetch(base + '/api/public/listings/' + id)).status, 404);
  pass('本人修改保留照片和电话，修改后重新进入审核');
  await admin.locator('#refresh').click();
  await admin.screenshot({ path: 'artifacts/platform/admin-desktop.png', fullPage: true });
  await admin.locator('#admin-logout').click();
  await expect(admin.locator('#login-form')).toBeVisible();
  await admin.goto(base + '/admin/');
  await expect(admin.locator('#login-form')).toBeVisible();
  pass('管理员退出后不能继续访问审核页');
  assert.deepEqual(errors, []);
  writeFileSync(
    'artifacts/platform/results.json',
    JSON.stringify({ created: new Date().toISOString(), checks, errors }, null, 2),
  );
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    for (let i = 0; i < pages.length; i++)
      await pages[i]
        .screenshot({ path: join(directory, 'failure-' + i + '.png'), fullPage: true })
        .catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise((r) => app.server.close(r));
  app.db.close();
}
