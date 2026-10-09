import { reactive } from 'vue';
import { isTimelinePreview, sharedCity } from './share';
import { communities } from '../config/communities';
export const isRelease = import.meta.env.VITE_APP_MODE === 'production';
export const appVersion = import.meta.env.VITE_APP_VERSION || '0.3.0';
export const fixedCity = import.meta.env.VITE_SERVICE_CITY || '';
let fallback = 'http://127.0.0.1:8787/api';
// #ifdef H5
fallback = '/api';
// #endif
export const configurableServer = import.meta.env.VITE_CONFIGURABLE_SERVER === '1';
export const apiBase = () =>
  isRelease
    ? configurableServer
      ? uni.getStorageSync('llj-server-url') || import.meta.env.VITE_API_BASE_URL || ''
      : import.meta.env.VITE_API_BASE_URL || fallback
    : uni.getStorageSync('llj-api') || import.meta.env.VITE_API_BASE_URL || fallback;
export const site = reactive({
  defaultCity: '洛阳',
  cities: ['洛阳', '北京', '上海', '广州', '深圳', '成都', '杭州'],
  registration: 'invite',
  wechatLogin: false,
});
const storageKey = (key) => (isRelease ? 'llj-live-' + apiBase() + '-' + key : 'llj-' + key);
export const hasSession = () => !!uni.getStorageSync(storageKey('token'));
const validCommunity = (value) =>
  typeof value === 'string' && value.trim().length <= 30 && !/[\u0000-\u001f]/.test(value)
    ? value.trim()
    : '';
export const state = reactive({
  city: fixedCity || sharedCity(uni.getStorageSync('llj-city')) || '洛阳',
  community: validCommunity(
    uni.getStorageSync(
      'llj-community:' + (fixedCity || sharedCity(uni.getStorageSync('llj-city')) || '洛阳'),
    ),
  ),
  user: uni.getStorageSync(storageKey('user')) || null,
  cartCount: 0,
});
export function saveSession(r) {
  uni.setStorageSync(storageKey('token'), r.token);
  uni.setStorageSync(storageKey('user'), r.user);
  state.user = r.user;
}
export function clearSession() {
  for (const k of ['token', 'user']) uni.removeStorageSync(storageKey(k));
  uni.removeStorageSync('llj-address');
  state.user = null;
  state.cartCount = 0;
}
let sessionPromise;
function transport(path, options = {}) {
  if (!apiBase()) return Promise.reject(new Error('请先填写运营者提供的服务地址'));
  return new Promise((resolve, reject) =>
    uni.request({
      url: apiBase() + path,
      method: options.method || 'GET',
      data: options.data,
      timeout: 10000,
      header: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}),
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      },
      success: (r) => {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(r.data);
        else
          reject(
            Object.assign(new Error(r.data?.message || '请求失败，请稍后再试'), {
              status: r.statusCode,
            }),
          );
      },
      fail: () =>
        reject(
          new Error(
            isRelease
              ? '暂时无法连接服务，请检查网络后重试'
              : '无法连接服务，请检查网络或在「我的」中设置服务地址',
          ),
        ),
    }),
  );
}
export async function ensureSession() {
  if (isTimelinePreview()) throw new Error('此操作需要在完整小程序中使用');
  const token = uni.getStorageSync(storageKey('token'));
  if (token) return token;
  if (isRelease) {
    openLogin();
    throw new Error('请先登录后继续操作');
  }
  if (!sessionPromise)
    sessionPromise = transport('/auth/demo', { method: 'POST', data: { nickname: '邻里体验官' } })
      .then((r) => {
        uni.setStorageSync('llj-token', r.token);
        uni.setStorageSync('llj-user', r.user);
        state.user = r.user;
        return r.token;
      })
      .finally(() => {
        sessionPromise = null;
      });
  return sessionPromise;
}
export async function api(path, options = {}) {
  const token = options.public ? undefined : await ensureSession();
  try {
    return await transport(path, { ...options, token });
  } catch (e) {
    if (e.status === 401 && token) {
      clearSession();
      if (isRelease) openLogin();
    }
    throw e;
  }
}
let openingLogin = false;
export function openLogin() {
  if (openingLogin || getCurrentPages().some((p) => p.route === 'pages/login/index')) return;
  openingLogin = true;
  uni.navigateTo({
    url: '/pages/login/index',
    complete: () => {
      openingLogin = false;
    },
  });
}
export async function loginAccount(data) {
  const r = await transport(data.register ? '/auth/register' : '/auth/password', {
    method: 'POST',
    data,
  });
  saveSession(r);
  return r;
}
export async function loginWechat(consentVersion, inviteCode = '') {
  // #ifdef MP-WEIXIN
  const code = await new Promise((resolve, reject) =>
    uni.login({
      provider: 'weixin',
      success: (r) => (r.code ? resolve(r.code) : reject(new Error('微信登录失败'))),
      fail: () => reject(new Error('微信登录失败，请重试')),
    }),
  );
  const r = await transport('/auth/wechat', {
    method: 'POST',
    data: { code, consentVersion, inviteCode },
  });
  saveSession(r);
  return r;
  // #endif
  // #ifndef MP-WEIXIN
  throw new Error('请在微信小程序中使用微信登录');
  // #endif
}
export const money = (n) => (Number(n || 0) / 100).toFixed(2).replace(/\.00$/, '');
export const art = (name) => '/static/art/' + name + '.png';
export const toast = (title) => uni.showToast({ title, icon: 'none', duration: 2600 });
export const showError = (e) => toast(e.message || '操作失败，请重试');
export const key = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
export function go(url) {
  if (!isTimelinePreview()) uni.navigateTo({ url });
}
export function tab(name) {
  if (!isTimelinePreview()) {
    if (['category', 'orders'].includes(name)) return go('/pages/' + name + '/index');
    uni.switchTab({ url: '/pages/' + name + '/index' });
  }
}
export function browseNeighbors(kind = '', query = '') {
  uni.setStorageSync('llj-feed', { kind, query });
  tab('market');
}
export function browse(category) {
  uni.setStorageSync('llj-category', category);
  tab('category');
}
export function selectCity() {
  if (!isTimelinePreview()) go('/pages/location/index');
}
export function setCity(city) {
  const value = sharedCity(city);
  if (!value) throw new Error('请输入 2–30 字的城市名称');
  if (fixedCity && value !== fixedCity) return;
  state.city = value;
  uni.setStorageSync('llj-city', value);
  state.community = validCommunity(uni.getStorageSync('llj-community:' + value));
  uni.$emit('city-change');
}
export function applySharedCity(city) {
  if (!fixedCity && sharedCity(city) && state.city !== city) setCity(city);
}
export function setCommunity(name) {
  if (isTimelinePreview()) return;
  state.community = ['全市', '全' + state.city].includes(name) ? '' : validCommunity(name);
  uni.setStorageSync('llj-community:' + state.city, state.community);
  uni.$emit('city-change');
}
let siteRequest;
export async function loadSite() {
  const base = apiBase();
  if (!base) throw new Error('请先填写运营者提供的服务地址');
  if (siteRequest?.base === base && Date.now() - siteRequest.created < 30000)
    return siteRequest.promise;
  const promise = api('/site', { public: true })
    .then((value) => {
      if (apiBase() !== base) return site;
      Object.assign(site, value);
      if (!fixedCity && !uni.getStorageSync('llj-city') && sharedCity(value.defaultCity))
        state.city = value.defaultCity;
      return site;
    })
    .catch((error) => {
      siteRequest = null;
      throw error;
    });
  siteRequest = { base, created: Date.now(), promise };
  return promise;
}
export function switchServer(base) {
  uni.setStorageSync('llj-server-url', base);
  siteRequest = null;
  state.user = uni.getStorageSync(storageKey('user')) || null;
  state.cartCount = 0;
}
export function mediaUrl(url) {
  if (
    typeof url !== 'string' ||
    !/^\/api\/media\/[a-f0-9-]{36}(?:\?expires=\d+&signature=[a-f0-9]{64})?$/.test(url)
  )
    return '';
  return apiBase().replace(/\/api$/, '') + url;
}
export async function uploadPhoto(filePath) {
  const token = await ensureSession();
  return new Promise((resolve, reject) =>
    uni.uploadFile({
      url: apiBase() + '/uploads',
      filePath,
      name: 'photo',
      header: { Authorization: 'Bearer ' + token },
      timeout: 30000,
      success: (response) => {
        try {
          const value =
            typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
          if (response.statusCode !== 201) throw new Error(value.message || '照片上传失败');
          resolve(value);
        } catch (error) {
          reject(error);
        }
      },
      fail: () => reject(new Error('照片上传失败，请检查网络后重试')),
    }),
  );
}
export function confirm(title, content) {
  return new Promise((resolve) =>
    uni.showModal({
      title,
      content,
      confirmColor: '#146b53',
      success: (r) => resolve(r.confirm),
      fail: () => resolve(false),
    }),
  );
}
export async function getCart() {
  const c = await api('/cart');
  state.cartCount = c.reduce((n, i) => n + i.quantity, 0);
  return c;
}
export async function addCart(product, spec) {
  const c = await getCart(),
    current = c.find((i) => i.product.id === product.id && i.spec === spec);
  const updated = await api('/cart', {
    method: 'POST',
    data: { productId: product.id, spec, quantity: (current?.quantity || 0) + 1 },
  });
  state.cartCount = updated.reduce((n, i) => n + i.quantity, 0);
  toast('已加入购物车');
}
export function selectedAddress(list) {
  return list.find((a) => a.id === uni.getStorageSync('llj-address')) || list[0] || null;
}
export const cityQuery = () => encodeURIComponent(state.city);
export const locationQuery = () =>
  'city=' +
  cityQuery() +
  (state.community ? '&community=' + encodeURIComponent(state.community) : '');
export function tomorrow(days = 1) {
  return new Date(Date.now() + 8 * 3600000 + days * 86400000).toISOString().slice(0, 10);
}
