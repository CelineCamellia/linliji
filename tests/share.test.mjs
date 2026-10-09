import test from 'node:test';
import assert from 'node:assert/strict';
import {
  friendShare,
  timelineShare,
  sharedCity,
  sharedCategory,
  isTimelineScene,
  isTimelinePreview,
} from '../apps/client/src/lib/share.js';

test('首页和分类分享恢复城市及类别，朋友圈使用 query 而非路径', () => {
  const home = friendShare('home', { city: '洛阳' });
  assert.equal(new URL(home.path, 'https://local.test').searchParams.get('city'), '洛阳');
  assert.match(home.title, /邻里集/);
  const clothes = friendShare('category', { city: '杭州', category: 'clothes' });
  assert.equal(new URL(clothes.path, 'https://local.test').searchParams.get('category'), 'clothes');
  const timeline = timelineShare('category', { city: '洛阳', category: 'repair' });
  assert.equal(new URLSearchParams(timeline.query).get('category'), 'repair');
  assert.equal(new URLSearchParams(timeline.query).get('city'), '洛阳');
  assert.equal(timeline.path, undefined);
});

test('分享只带公开物品标识和固定配图，不复制私人表单或连接设置', () => {
  const options = {
    city: '杭州',
    kind: 'market',
    token: 'secret-token',
    api: 'http://private-server',
    mine: true,
    addressId: 'private-address',
    phone: '13800000000',
    item: {
      id: 'abc-123',
      title: '原木小边桌',
      status: 'available',
      art: 'table',
      city: '洛阳',
      phone: '13800000000',
      user_id: 'private-user',
      owned: true,
    },
  };
  const card = friendShare('detail', options);
  const query = new URL(card.path, 'https://local.test').searchParams;
  assert.deepEqual([...query.keys()].sort(), ['city', 'id', 'kind']);
  assert.equal(query.get('id'), 'abc-123');
  assert.equal(query.get('city'), '洛阳');
  assert.equal(query.get('kind'), 'market');
  assert.equal(card.imageUrl, '/static/art/table.png');
  for (const secret of [
    'secret-token',
    'private-server',
    'private-address',
    '13800000000',
    'private-user',
  ])
    assert.ok(!JSON.stringify(card).includes(secret));
  const mine = friendShare('market', options);
  assert.equal(new URL(mine.path, 'https://local.test').searchParams.has('mine'), false);
  assert.equal(mine.imageUrl, '/static/app-icon.png');
});

test('预约只分享服务编号，失败详情和私人页面分享退回首页', () => {
  const service = friendShare('booking', {
    item: { id: 's1', title: '空调清洗', art: 'aircon' },
    note: 'private-note',
    addressId: 'private-address',
    date: '2026-10-04',
  });
  assert.equal(service.path, '/pages/booking/index?id=s1');
  assert.ok(!JSON.stringify(service).includes('private-'));
  for (const status of ['withdrawn', 'reserved'])
    assert.equal(
      friendShare('detail', { kind: 'market', item: { id: 'm1', status } }).path,
      '/pages/home/index',
    );
  assert.equal(friendShare('detail', { item: null }).path, '/pages/home/index');
  assert.equal(friendShare('orders', { orderId: 'private-order' }).path, '/pages/home/index');
});

test('分享输入校验拒绝额外参数和外部图片地址', () => {
  assert.equal(sharedCity('杭州&token=secret'), '');
  assert.equal(sharedCategory('__proto__'), 'all');
  const card = friendShare('detail', {
    city: '杭州&token=secret',
    item: { id: 'p1', title: '番茄', art: 'https://example.test/track' },
  });
  assert.equal(card.imageUrl, '/static/app-icon.png');
  assert.equal(card.path, '/pages/detail/index?id=p1&kind=product');
  assert.equal(
    friendShare('detail', { item: { id: 'p1&token=secret' } }).path,
    '/pages/home/index',
  );
});

test('朋友圈识别使用当前进入场景，正常重进不会继续使用匿名模式', () => {
  assert.equal(isTimelineScene({ scene: 1154 }), true);
  assert.equal(isTimelineScene({ scene: 1007 }), false);
  assert.equal(isTimelineScene(undefined), false);
  const previous = globalThis.uni;
  try {
    globalThis.uni = {
      getEnterOptionsSync: () => ({ scene: 1154 }),
      getLaunchOptionsSync: () => ({ scene: 1007 }),
    };
    assert.equal(isTimelinePreview(), true);
    globalThis.uni.getEnterOptionsSync = () => ({ scene: 1007 });
    globalThis.uni.getLaunchOptionsSync = () => ({ scene: 1154 });
    assert.equal(isTimelinePreview(), false);
  } finally {
    if (previous === undefined) delete globalThis.uni;
    else globalThis.uni = previous;
  }
});
