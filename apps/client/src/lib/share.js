export const WECHAT_NAME = '邻里集';
export const SHARE_CITIES = ['杭州', '洛阳', '郑州', '成都'];
const categories = { all: '附近好物', farm: '新鲜买菜', repair: '上门维修', clothes: '附近衣橱' };
const icon = '/static/app-icon.png';
const artNames = new Set([
  'washer',
  'tomato',
  'table',
  'shoe',
  'shirt',
  'repair',
  'plant',
  'orange',
  'lettuce',
  'eggs',
  'corn',
  'coffee',
  'clean',
  'carrot',
  'cardigan',
  'cap',
  'book',
  'blouse',
  'bike',
  'bag',
  'aircon',
]);
export const sharedCity = (value) =>
  typeof value === 'string' && /^[\p{L}\p{N} ·.-]{2,30}$/u.test(value.trim()) ? value.trim() : '';
export const sharedCategory = (value) =>
  Object.prototype.hasOwnProperty.call(categories, value) ? value : 'all';
export const isTimelineScene = (options) => Number(options?.scene) === 1154;

export function isTimelinePreview() {
  // #ifdef MP-WEIXIN
  if (typeof uni !== 'undefined') {
    const options = uni.getEnterOptionsSync?.() || uni.getLaunchOptionsSync?.();
    return isTimelineScene(options);
  }
  // #endif
  return false;
}

// Only public navigation fields belong in a share URL. Never copy page options,
// form fields, API addresses, tokens or user-specific filters into the card.
function content(page, { city, category, kind, item } = {}) {
  const params = {};
  let target = ['home', 'category', 'market', 'detail', 'booking'].includes(page) ? page : 'home';
  let title = `${WECHAT_NAME} · 好生活，就在附近`,
    imageUrl = icon;
  if (sharedCity(city)) params.city = city;
  if (target === 'category') {
    params.category = sharedCategory(category);
    title = `${categories[params.category]} · ${WECHAT_NAME}`;
  }
  if (target === 'market') title = `${params.city || '同城'}邻里集市 · ${WECHAT_NAME}`;
  if (target === 'detail' || target === 'booking') {
    const available =
      item &&
      /^[a-zA-Z0-9-]{1,64}$/.test(item.id) &&
      (kind !== 'market' || item.status === 'available');
    if (available) {
      params.id = item.id;
      if (kind === 'market' && sharedCity(item.city)) params.city = item.city;
      if (target === 'detail') params.kind = kind === 'market' ? 'market' : 'product';
      title = `${String(item.title || '附近好物').slice(0, 60)} · ${WECHAT_NAME}`;
      if (artNames.has(item.art)) imageUrl = `/static/art/${item.art}.png`;
    } else target = 'home';
  }
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return { title, imageUrl, query, path: `/pages/${target}/index${query ? '?' + query : ''}` };
}
export function friendShare(page, options) {
  const { title, path, imageUrl } = content(page, options);
  return { title, path, imageUrl };
}
export function timelineShare(page, options) {
  const { title, query, imageUrl } = content(page, options);
  return { title, query, imageUrl };
}
export function setShareMenu({ timeline = true, enabled = true } = {}) {
  // #ifdef MP-WEIXIN
  if (isTimelinePreview()) return;
  const menus = ['shareAppMessage', 'shareTimeline'];
  const fail = (error) => console.warn('微信分享菜单暂不可用：' + error.errMsg);
  if (!enabled) uni.hideShareMenu({ menus, fail });
  else {
    if (!timeline) uni.hideShareMenu({ menus: ['shareTimeline'], fail });
    uni.showShareMenu({ menus: timeline ? menus : ['shareAppMessage'], fail });
  }
  // #endif
}
