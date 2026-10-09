import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { createOperationsServer } from '../scripts/operations.mjs';
import { loadConfig } from '../server/runtime.mjs';

mkdirSync('.cache/tests', { recursive: true });
mkdirSync('artifacts/neighborhood', { recursive: true });
const directory = mkdtempSync(resolve('.cache/tests/neighborhood-ui-'));
process.env.TEMP = process.env.TMP = directory;
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.cache/playwright');
const { chromium, expect } = await import('@playwright/test');
const config = loadConfig({
  APP_MODE: 'production',
  PUBLIC_ORIGIN: 'https://pilot.linliji.cn',
  WX_APPID: 'wx0000000000000000',
  WX_APP_SECRET: 'b'.repeat(32),
  OPERATOR_NAME: '邻里界面检查',
  SUPPORT_EMAIL: 'test@linliji.cn',
  INVITE_CODE: 'neighbor-ui-only-1234',
});
const app = createApp({
  dbPath: join(directory, 'test.sqlite'),
  staticDir: resolve('dist/web'),
  config,
});
const ops = createOperationsServer({
  dbPath: join(directory, 'test.sqlite'),
  draftDirectory: join(directory, 'drafts'),
});
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
await new Promise((r) => ops.server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + app.server.address().port,
  adminBase = 'http://127.0.0.1:' + ops.server.address().port;
config.origins.push(base);
let browser, page, admin, visitor;
const checks = [],
  errors = [];
const pass = (value) => {
  checks.push(value);
  console.log('PASS ' + value);
};
const navigate = (p, name, query = '') => p.goto(base + '/#/pages/' + name + '/index' + query);
const text = (p, value) => p.getByText(value, { exact: true }).last();
const input = (p, id) => p.locator('#publish-' + id).locator('input,textarea');
const loginField = (p, label) =>
  p
    .locator('uni-input')
    .filter({ has: p.getByText(label, { exact: true }) })
    .locator('input');
async function register(p, name) {
  await text(p, '首次使用，注册账号').click();
  await loginField(p, '4–32 位字母、数字或下划线').fill(name);
  await loginField(p, '至少 12 位，请妥善保存').fill('neighbor-ui-password-123');
  await loginField(p, '请向运营者获取').fill(config.inviteCode);
  await p.locator('uni-switch').click();
  await text(p, '注册并登录').click();
}
async function fill(p, kind, title) {
  await navigate(p, 'publish', '?kind=' + kind);
  await input(p, 'title').fill(title);
  await input(p, 'description').fill(
    '自动化检查专用资料：只在隔离库内使用，不代表实际服务或交易。',
  );
  await input(p, 'community').fill('洛阳互助测试群');
  await input(p, 'area').fill('洛龙区');
  await input(p, 'phone').fill('13800000000');
}
async function submit(p) {
  await p.locator('.consent').click();
  await text(p, '提交发布').click();
  await expect(p.locator('.market-filters .chip.active')).toHaveText('我的发布');
}
async function approve(kind, title) {
  await admin.goto(adminBase);
  await admin.locator('#listing-kind').selectOption(kind);
  const card = admin.locator('#records article').filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '通过并展示', exact: true }).click();
  await admin.locator('#reason').fill('已核对社区、描述与费用或交换条件');
  await admin.locator('#confirm-decision').click();
  await expect(admin.locator('#decision-dialog')).not.toBeVisible();
  await expect(card).toHaveCount(0);
}
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  admin = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
  visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const p of [page, admin, visitor]) p.on('pageerror', (e) => errors.push(e.message));
  await navigate(page, 'home');
  await expect(page.locator('.hero-title')).toContainText('住得近');
  await expect(page.locator('.category-menu')).toContainText('邻里手艺');
  await expect(page.locator('.category-menu')).toContainText('以物换物');
  await expect(text(page, '今日鲜选')).toHaveCount(0);
  assert.equal(app.db.prepare('SELECT count(*) n FROM users').get().n, 0);
  await navigate(page, 'market');
  await expect(text(page, '暂时没有符合条件的邻里信息')).toBeVisible();
  pass('首页以居民互助为入口，空库无需商家资料，公开浏览不建立账号');

  await navigate(page, 'profile');
  await text(page, '登录 / 注册').click();
  await register(page, 'neighbor_ui_owner');
  await expect(text(page, '已登录')).toBeVisible();
  await fill(page, 'service', '测试邻居帮修小家电');
  await expect(input(page, 'price')).toHaveCount(0);
  await expect(text(page, '物品成色')).toHaveCount(0);
  await input(page, 'availability').fill('周末白天，请先电话确认');
  await text(page, '提交发布').click();
  await expect(text(page, '发布前请确认描述与联系方式授权')).toBeVisible();
  assert.equal(app.db.prepare('SELECT count(*) n FROM listings').get().n, 0);
  await submit(page);
  await expect(text(page, '等待审核')).toBeVisible();
  const service = app.db.prepare('SELECT id,data FROM listings').get();
  assert.equal(JSON.parse(service.data).priceMode, 'negotiable');
  await approve('service', '测试邻居帮修小家电');
  await navigate(page, 'market');
  await text(page, '最新发布').click();
  await page.locator('.feed-kinds').getByText('邻里手艺', { exact: true }).click();
  await expect(text(page, '测试邻居帮修小家电')).toBeVisible();
  pass('居民发布面议手艺，电话授权必填，管理页按类型审核后才展示');

  await navigate(visitor, 'detail', '?kind=market&id=' + service.id);
  await expect(text(visitor, '费用面议')).toBeVisible();
  await expect(text(visitor, '周末白天，请先电话确认')).toBeVisible();
  assert.ok(!(await visitor.locator('body').innerText()).includes('13800000000'));
  await text(visitor, '联系邻居').click();
  await expect(text(visitor, '登录')).toBeVisible();
  await register(visitor, 'neighbor_ui_reader');
  await expect(text(visitor, '联系邻居')).toBeVisible();
  await text(visitor, '联系邻居').click();
  await expect(visitor.locator('.uni-modal__bd')).toContainText('13800000000');
  await visitor.locator('.uni-modal__btn_default').click();
  pass('服务详情正确展示面议与时间，另一位邻居登录后才能查看电话');

  await fill(page, 'exchange', '测试用图书换绘本');
  await text(page, '提交发布').click();
  await expect(text(page, '请说明你想换什么，至少 2 个字')).toBeVisible();
  await input(page, 'exchange').fill('想换儿童绘本或小盆栽');
  await expect(input(page, 'price')).toHaveCount(0);
  await page.route('**/api/listings', (route) =>
    route.request().method() === 'POST' ? route.abort('connectionrefused') : route.continue(),
  );
  await page.locator('.consent').click();
  await text(page, '提交发布').click();
  await expect(text(page, '暂时无法连接服务，请检查网络后重试')).toBeVisible();
  await expect(input(page, 'exchange')).toHaveValue('想换儿童绘本或小盆栽');
  await page.unroute('**/api/listings');
  await text(page, '提交发布').click();
  await expect(page.locator('.market-filters .chip.active')).toHaveText('我的发布');
  await admin.goto(adminBase);
  await admin.locator('#listing-kind').selectOption('exchange');
  await expect(admin.locator('#records')).toContainText('想换儿童绘本或小盆栽');
  await expect(admin.locator('#records .price')).toHaveText('以物换物');
  await approve('exchange', '测试用图书换绘本');
  pass('交换须填写想换什么，前后台不显示零元；断网保留填写内容并能重试');

  await fill(page, 'sale', '测试转让小书桌');
  await input(page, 'price').fill('25.50');
  await submit(page);
  await approve('sale', '测试转让小书桌');
  await fill(page, 'service', '测试邻居免费整理');
  await text(page, '免费帮忙').click();
  await submit(page);
  await approve('service', '测试邻居免费整理');
  await navigate(page, 'home');
  await expect(page.locator('.market-grid').first()).toContainText('免费帮忙');
  await expect(page.locator('.market-grid').last()).toContainText('¥25.50');
  pass('普通闲置保留金额和成色，免费手艺明确标注，首页同步展示居民发布');
  await page.screenshot({ path: join(directory, 'home-mobile.png'), fullPage: true });

  await navigate(page, 'market');
  await text(page, '最新发布').click();
  await page.locator('.feed-kinds').getByText('以物换物', { exact: true }).click();
  await page.locator('.search-bar input').fill('小盆栽');
  await page.locator('.search-action').click();
  await expect(page.locator('.neighbor-card')).toHaveCount(1);
  await expect(text(page, '测试用图书换绘本')).toBeVisible();
  await text(page, '查找社区 / 群').click();
  await page.locator('.community-search input').fill('洛阳互助测试群');
  await page
    .locator('.community-search .community-options')
    .getByText('洛阳互助测试群', { exact: true })
    .click();
  await expect(page.locator('.community-title')).toHaveText('洛阳互助测试群');
  await expect(page.locator('.neighbor-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.community-title')).toHaveText('洛阳互助测试群');
  pass('可搜索交换条件与自定义社区或群，选择后刷新仍保留');

  for (let i = 0; i < 22; i++) {
    const item = {
      id: 'page-' + i,
      title: '隔离分页信息' + i,
      description: '仅用于分页的测试资料，不对外展示。',
      city: '洛阳',
      area: '洛龙区',
      community: '洛阳互助测试群',
      kind: 'sale',
      priceMode: 'fixed',
      price: 100,
      art: 'book',
      condition: '九成新',
      nickname: '分页测试邻居',
    };
    app.db
      .prepare('INSERT INTO listings VALUES(?,?,?,?,?)')
      .run(item.id, 'pagination-owner', JSON.stringify(item), '13800000000', 'available');
  }
  await page.locator('.feed-kinds').getByText('全部', { exact: true }).click();
  await expect(page.locator('.neighbor-card')).toHaveCount(20);
  await text(page, '查看更多').click();
  await expect(page.locator('.neighbor-card')).toHaveCount(26);
  assert.equal(
    new Set(await page.locator('.neighbor-card .market-title').allTextContents()).size,
    26,
  );
  await text(page, '查找社区 / 群').click();
  await page.locator('.community-search input').fill('暂未有发布的测试群');
  await page.locator('.use-community').click();
  await expect(text(page, '暂时没有符合条件的邻里信息')).toBeVisible();
  await text(page, '我的发布').click();
  await expect(page.locator('.neighbor-card')).toHaveCount(4);
  pass('超过一页可继续查看，空社区无误匹配，我的发布不受当前社区筛选影响');

  await navigate(visitor, 'detail', '?kind=market&id=' + service.id);
  await text(visitor, '举报信息').click();
  await text(visitor, '涉嫌诈骗或虚假信息').click();
  await expect(text(visitor, '举报已提交，运营者将核查')).toBeVisible();
  await admin.goto(adminBase);
  await admin.locator('[data-tab=reports]').click();
  await expect(admin.locator('#records')).toContainText('测试邻居帮修小家电');
  await admin.locator('#records').getByRole('button', { name: '下架信息' }).click();
  await admin.locator('#reason').fill('测试反馈核实后停止展示');
  await admin.locator('#confirm-decision').click();
  await expect(admin.locator('#decision-dialog')).not.toBeVisible();
  await admin.locator('#records').getByRole('button', { name: '标记已处理' }).click();
  await admin.locator('#reason').fill('已核对并下架服务信息');
  await admin.locator('#confirm-decision').click();
  await expect(admin.locator('#reports-count')).toHaveText('0');
  await navigate(visitor, 'home');
  await navigate(visitor, 'detail', '?kind=market&id=' + service.id);
  await expect(visitor.locator('.error-banner')).toBeVisible();
  pass('居民举报服务后，管理页可下架并留存说明，下架信息对其他居民不可见');

  const exchange = app.db
    .prepare("SELECT id FROM listings WHERE json_extract(data,'$.kind')='exchange'")
    .get();
  await navigate(page, 'detail', '?kind=market&id=' + exchange.id);
  await text(page, '下架信息').click();
  await page.locator('.uni-modal__btn_primary').click();
  await expect(
    page.locator('.sticky-actions uni-button').filter({ hasText: '下架信息' }),
  ).toHaveAttribute('disabled');
  assert.equal(
    app.db.prepare('SELECT status FROM listings WHERE id=?').get(exchange.id).status,
    'withdrawn',
  );
  pass('发布者可以自行下架交换信息');

  await navigate(page, 'home');
  await text(page, '全洛阳').click();
  await expect(page.locator('.hero-title')).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1366, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(directory, 'home-desktop.png'), fullPage: true });
  await admin.locator('[data-tab=listings]').click();
  await admin.locator('#listing-status').selectOption('available');
  await admin.locator('#listing-kind').selectOption('service');
  await expect(admin.locator('#records')).toContainText('免费帮忙');
  await admin.screenshot({ path: join(directory, 'operations-service.png'), fullPage: true });
  assert.deepEqual(errors, []);
  pass('手机与桌面无横向溢出，管理页正确显示服务类型和费用，无页面脚本异常');

  await navigate(page, 'profile');
  await text(page, '注销账号').click();
  await page.locator('.uni-modal__btn_primary').click();
  await page.locator('.uni-modal__btn_primary').click();
  await expect(text(page, '登录 / 注册')).toBeVisible();
  assert.equal(app.db.prepare('SELECT count(*) n FROM users').get().n, 1);
  assert.equal(
    app.db.prepare("SELECT count(*) n FROM listings WHERE user_id!='pagination-owner'").get().n,
    0,
  );
  pass('注销删除本人发布与相关举报处理记录，保留其他账号');
  writeFileSync(
    'artifacts/neighborhood/界面验收.json',
    JSON.stringify(
      {
        status: 'passed',
        date: new Date().toISOString(),
        checks,
        errors,
        evidence: directory,
        scope: '隔离生产模式数据库，真实本地注册、发布、管理审核与联系接口；未连接手机或公网',
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (page)
    await page
      .screenshot({ path: join(directory, 'failure-resident.png'), fullPage: true })
      .catch(() => {});
  if (admin)
    await admin
      .screenshot({ path: join(directory, 'failure-operations.png'), fullPage: true })
      .catch(() => {});
  writeFileSync(
    'artifacts/neighborhood/界面验收.json',
    JSON.stringify(
      { status: 'failed', checks, errors, evidence: directory, error: error.stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise((r) => ops.server.close(r));
  ops.db.close();
  await new Promise((r) => app.server.close(r));
  app.db.close();
}
