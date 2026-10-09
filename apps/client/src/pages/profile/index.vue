<template>
  <view class="page"
    ><TopBar title="我的邻里" /><view class="profile-hero"
      ><image class="avatar" src="/static/app-icon.png" /><view
        ><text class="profile-name">{{
          state.user?.nickname || (isRelease ? '来认识附近的邻居' : '邻里体验官')
        }}</text
        ><text class="profile-subtitle">把日子过好，从身边开始。</text
        ><text class="account-tag">{{
          isRelease ? (state.user ? '已登录' : '浏览无需登录') : '体验账号 · 数据保存在当前服务'
        }}</text></view
      ><image class="profile-plant" :src="art('plant')" mode="aspectFit" /></view
    ><button v-if="isRelease && !state.user" class="btn full-width" @click="openLogin">
      登录 / 注册</button
    ><view v-if="error" class="error-banner" @click="load">{{ error }} · 点击重试</view
    ><view class="stat-grid"
      ><view @click="go('/pages/publish/index?kind=service')"
        ><Icon name="heart" :size="25" active /><text>发布我的手艺</text></view
      ><view @click="myListings"
        ><text class="stat-number">{{ listings.length }}</text
        ><text>我的发布</text></view
      ><view v-if="isRelease" @click="selectCity"
        ><Icon name="pin" :size="25" active /><text>切换城市</text></view
      ><view v-else @click="showFavorites = !showFavorites"
        ><text class="stat-number">{{ favorites.length }}</text
        ><text>收藏好物</text></view
      ></view
    ><view class="profile-layout"
      ><view class="card menu"
        ><view v-for="m in menus" :key="m.label" class="menu-row" @click="m.action()"
          ><view class="row"
            ><Icon :name="m.icon" :size="20" active /><text>{{ m.label }}</text></view
          ><Icon name="arrow" :size="17" /></view></view
      ><view class="profile-promo"
        ><text class="section-kicker">LESS STUFF, MORE LIFE</text
        ><text class="promo-title">你有的，你会的，<br />邻居可能正需要。</text
        ><text class="small muted">从一次分享，认识附近的美好。</text
        ><button class="btn secondary" @click="go('/pages/publish/index')">
          发布邻里信息 →
        </button></view
      ></view
    ><view v-if="showFavorites" class="section"
      ><view class="section-heading"
        ><text class="section-title">我收藏的好物</text
        ><text class="section-more" @click="showFavorites = false">收起</text></view
      ><view class="product-grid"><ProductCard v-for="p in favorites" :key="p.id" :item="p" /></view
      ><EmptyState
        v-if="!favorites.length"
        title="心动好物，值得收藏"
        description="在商品详情中点击收藏，下次更好找" /></view
    ><view class="notice">{{
      isRelease
        ? '同城邻里互助，服务与交换安排请和发布者直接确认。'
        : '当前为本地功能体验版，不接入真实支付或履约。请使用测试姓名、地址与手机号进行体验。'
    }}</view
    ><view class="footer-note">邻里集 LINLIJI · v{{ appVersion }}</view></view
  >
</template>
<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import Icon from '../../components/Icon.vue';
import ProductCard from '../../components/ProductCard.vue';
import EmptyState from '../../components/EmptyState.vue';
import {
  api,
  state,
  art,
  go,
  tab,
  getCart,
  isRelease,
  hasSession,
  openLogin,
  clearSession,
  confirm,
  showError,
  toast,
  appVersion,
  configurableServer,
  selectCity,
} from '../../lib/api';
const orders = ref([]),
  listings = ref([]),
  favorites = ref([]),
  showFavorites = ref(false),
  error = ref('');
function myListings() {
  uni.setStorageSync('llj-mine', true);
  tab('market');
}
function info(title, content) {
  uni.showModal({ title, content, showCancel: false, confirmColor: '#146b53' });
}
const menus = [
  ...(configurableServer
    ? [{ label: '服务连接设置', icon: 'settings', action: () => go('/pages/settings/index') }]
    : []),
  ...(!isRelease
    ? [
        { label: '我的收货地址', icon: 'pin', action: () => go('/pages/addresses/index') },
        { label: '我的购物车', icon: 'cart', action: () => go('/pages/cart/index') },
        { label: '服务连接设置', icon: 'settings', action: () => go('/pages/settings/index') },
      ]
    : []),
  { label: '我的邻里发布', icon: 'repeat', action: myListings },
  { label: '隐私与服务说明', icon: 'shield', action: () => go('/pages/privacy/index') },
  { label: '退出登录', icon: 'user', action: logout },
  { label: '注销账号', icon: 'info', action: deleteAccount },
];
async function logout() {
  if (!hasSession()) return;
  try {
    await api('/auth/logout', { method: 'POST' });
    clearSession();
    orders.value = [];
    listings.value = [];
    toast('已退出');
  } catch (e) {
    showError(e);
  }
}
async function deleteAccount() {
  if (!hasSession()) return toast('请先登录');
  if (
    !(await confirm(
      '注销当前账号？',
      '将删除账号、发布内容和个人记录，无法恢复。未完成的体验订单请先取消。',
    ))
  )
    return;
  if (!(await confirm('再次确认注销', '确认删除当前账号及关联数据？'))) return;
  try {
    await api('/me', { method: 'DELETE', data: { confirm: 'DELETE' } });
    clearSession();
    uni.removeStorageSync('llj-favorites');
    orders.value = [];
    listings.value = [];
    favorites.value = [];
    toast('账号已注销');
  } catch (e) {
    showError(e);
  }
}
async function load() {
  error.value = '';
  if (isRelease && !hasSession()) {
    orders.value = [];
    listings.value = [];
    return;
  }
  try {
    const [o, l, p] = await Promise.all([
      api('/orders'),
      api('/listings?mine=1'),
      api('/products', { public: true }),
    ]);
    orders.value = o;
    listings.value = l;
    const ids = uni.getStorageSync('llj-favorites') || [];
    favorites.value = p.filter((p) => ids.includes(p.id));
    getCart().catch(() => {});
  } catch (e) {
    error.value = e.message;
  }
}
onShow(load);
</script>
<style scoped>
.profile-hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20px;
  background: #e5eddb;
  border-radius: 24px;
  padding: 32px;
  overflow: hidden;
}
.avatar {
  width: 68px;
  height: 68px;
  border-radius: 21px;
  position: relative;
  z-index: 1;
}
.profile-name {
  font-size: 23px;
  font-weight: 700;
  display: block;
}
.profile-subtitle {
  display: block;
  color: #7d8c71;
  font-size: 12px;
  margin-top: 5px;
}
.account-tag {
  font-size: 9px;
  border: 1px solid #c9d4be;
  border-radius: 20px;
  padding: 3px 8px;
  display: inline-block;
  margin-top: 10px;
  color: #829271;
}
.profile-plant {
  position: absolute;
  right: 0;
  bottom: -48px;
  width: 230px;
  height: 230px;
  opacity: 0.7;
  mix-blend-mode: multiply;
}
.profile-hero > view {
  z-index: 1;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: white;
  border: 1px solid #e8ecdf;
  border-radius: 18px;
  margin: 20px 0;
  padding: 23px 0;
}
.stat-grid > view {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #929b89;
}
.stat-number {
  font-size: 25px;
  font-weight: 700;
  color: #4d704f;
}
.profile-layout {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 22px;
}
.menu {
  padding: 0 20px;
}
.menu-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0;
  border-bottom: 1px solid #eff1e9;
}
.menu-row:last-child {
  border: 0;
}
.menu-row text {
  font-size: 13px;
}
.profile-promo {
  background: #eeebdd;
  border-radius: 20px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.promo-title {
  font-size: 27px;
  line-height: 1.5;
  font-weight: 700;
  margin: 13px 0;
}
.profile-promo .btn {
  margin-top: 25px;
  align-self: flex-start;
}
@media (max-width: 700px) {
  .profile-hero {
    padding: 25px 19px;
    gap: 14px;
  }
  .avatar {
    width: 55px;
    height: 55px;
    border-radius: 17px;
  }
  .profile-name {
    font-size: 20px;
  }
  .profile-plant {
    width: 145px;
    height: 145px;
    right: -43px;
    bottom: -29px;
    opacity: 0.4;
  }
  .profile-layout {
    grid-template-columns: 1fr;
  }
  .profile-promo {
    padding: 23px;
  }
  .promo-title {
    font-size: 24px;
  }
}
</style>
