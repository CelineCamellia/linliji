<template>
  <view class="page home"
    ><TopBar />
    <view v-if="!singlePage" class="search-bar"
      ><Icon name="search" /><input
        v-model="search"
        placeholder="找邻居的手艺、闲置或想换的东西"
        confirm-type="search"
        @confirm="doSearch"
      /><text class="search-action" @click="doSearch">搜索</text></view
    >
    <view v-if="error" class="connection-card"
      ><text class="connection-title">{{
        configurableServer && !apiBase() ? '连接你的社区' : '内容暂时加载失败'
      }}</text
      ><text class="connection-message">{{ error }}</text
      ><view class="connection-actions"
        ><button
          v-if="!configurableServer || apiBase()"
          class="btn secondary"
          :disabled="loading"
          @click="load"
        >
          重新连接</button
        ><button
          v-if="(!isRelease || configurableServer) && !singlePage"
          class="btn"
          @click="go('/pages/settings/index')"
        >
          设置服务地址
        </button></view
      ></view
    >
    <CommunityPicker />
    <view class="hero"
      ><view class="hero-content"
        ><text class="hero-eyebrow">{{ state.city }} · 邻居自己的小集</text
        ><text class="hero-title">住得近，<br />帮得上。</text
        ><text class="hero-desc">一门手艺，一件闲置，一次交换</text
        ><button v-if="!singlePage" class="hero-button" @click="go('/pages/publish/index')">
          我也来发布 <Icon name="arrow" :size="17" active /></button
        ><text class="hero-bottom">—— 好东西、好手艺，留在邻里间</text></view
      ><view class="hero-art"
        ><view class="hero-orbit" /><image
          class="hero-tomato"
          :src="art('repair')"
          mode="aspectFit"
        /><image class="hero-lettuce" :src="art('book')" mode="aspectFit" /><view
          class="fresh-stamp"
          ><text>HELLO NEIGHBOR</text><text class="stamp-big">邻</text
          ><text>附近的人 · 身边的事</text></view
        ></view
      ></view
    >
    <view class="benefit-strip"
      ><view><Icon name="pin" :size="15" active /><text>就在社区里</text></view
      ><view><Icon name="heart" :size="15" active /><text>居民自己发布</text></view
      ><view><Icon name="repeat" :size="15" active /><text>让好物流转</text></view></view
    >
    <view class="category-menu"
      ><view
        v-for="c in categories"
        :key="c.kind"
        class="category-entry"
        @click="browseNeighbors(c.kind)"
        ><view class="category-circle"><image :src="art(c.art)" mode="aspectFit" /></view
        ><text class="category-name">{{ c.title }}</text
        ><text class="category-subtitle">{{ c.subtitle }}</text></view
      ></view
    >
    <view class="neighborhood-note"
      ><view
        ><text class="note-label">邻里互助</text
        ><text class="note-copy">你会的，可能正是邻居需要的</text></view
      ></view
    >
    <view class="section"
      ><view class="section-heading"
        ><view
          ><text class="section-kicker">NEIGHBORS CAN HELP</text
          ><text class="section-title">附近有手艺的邻居</text></view
        ><view class="section-more" @click="browseNeighbors('service')"
          >全部<Icon name="arrow" :size="15" /></view></view
      ><view class="market-grid"
        ><NeighborCard v-for="item in services.slice(0, 4)" :key="item.id" :item="item" /></view
      ><EmptyState
        v-if="!loading && !error && !services.length"
        title="你的手艺，邻居可能正需要"
        description="会修家电、装家具，也可以发布自己的拿手事"
        :action="singlePage ? '' : '发布我的手艺'"
        @action="go('/pages/publish/index?kind=service')"
    /></view>
    <view class="section"
      ><view class="section-heading"
        ><view
          ><text class="section-kicker">FROM YOUR NEIGHBORHOOD</text
          ><text class="section-title">邻居最近在发布</text></view
        ><view class="section-more" @click="browseNeighbors()"
          >全部<Icon name="arrow" :size="15" /></view></view
      ><view v-if="loading" class="loading">正在看看邻居的新消息…</view
      ><view class="market-grid"
        ><NeighborCard v-for="item in recent.slice(0, 6)" :key="item.id" :item="item" /></view
      ><EmptyState
        v-if="!loading && !error && !recent.length"
        title="这里的第一条信息，等你来发布"
        description="一件闲置、一门手艺，或者想换的东西"
        :action="singlePage ? '' : '发布邻里信息'"
        @action="go('/pages/publish/index')"
    /></view>
    <view class="notice"
      >由居民自行发布与联系。请提前确认服务内容、费用或交换条件，发布内容经审核后展示。分类插画仅作示意。</view
    ><view class="footer-note">邻 里 集 / 把 彼 此 需 要 的 留 在 附 近</view>
  </view>
</template>
<script setup>
import { ref, onUnmounted } from 'vue';
import { onShow, onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import Icon from '../../components/Icon.vue';
import EmptyState from '../../components/EmptyState.vue';
import NeighborCard from '../../components/NeighborCard.vue';
import CommunityPicker from '../../components/CommunityPicker.vue';
import {
  api,
  art,
  go,
  browseNeighbors,
  locationQuery,
  state,
  applySharedCity,
  isRelease,
  configurableServer,
  loadSite,
  apiBase,
} from '../../lib/api';
import { friendShare, timelineShare, setShareMenu, isTimelinePreview } from '../../lib/share';
const singlePage = isTimelinePreview(),
  search = ref(''),
  services = ref([]),
  recent = ref([]),
  error = ref(''),
  loading = ref(false);
const categories = [
  { kind: 'service', art: 'repair', title: '邻里手艺', subtitle: '会做的事，帮上忙' },
  { kind: 'sale', art: 'bike', title: '闲置买卖', subtitle: '自家的好物，接着用' },
  { kind: 'exchange', art: 'book', title: '以物换物', subtitle: '各取所需，邻里流转' },
];
let seq = 0;
async function load() {
  const current = ++seq;
  loading.value = true;
  error.value = '';
  try {
    await loadSite();
    const [s, m] = await Promise.all([
      api('/public/listings?kind=service&page=1&' + locationQuery(), { public: true }),
      api('/public/listings?page=1&' + locationQuery(), { public: true }),
    ]);
    if (current !== seq) return;
    services.value = s.items;
    recent.value = m.items;
  } catch (e) {
    if (current === seq) {
      error.value = e.message;
      services.value = [];
      recent.value = [];
    }
  } finally {
    if (current === seq) loading.value = false;
  }
}
function doSearch() {
  browseNeighbors('', search.value.trim());
}
onLoad((q) => applySharedCity(q.city));
onShow(() => {
  setShareMenu();
  load();
});
// #ifdef MP-WEIXIN
onShareAppMessage(() => friendShare('home', { city: state.city }));
onShareTimeline(() => timelineShare('home', { city: state.city }));
// #endif
uni.$on('city-change', load);
onUnmounted(() => uni.$off('city-change', load));
</script>
<style scoped>
.connection-card {
  margin-top: 16px;
  padding: 18px;
  border: 1px solid #e6ceb9;
  border-radius: 16px;
  background: #fff8ef;
}
.connection-title {
  display: block;
  font-size: 16px;
  font-weight: 650;
  color: #7b4d2d;
}
.connection-message {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.7;
  color: #8c6c55;
}
.connection-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
}
.connection-actions .btn {
  margin: 0;
  font-size: 12px;
}
.hero {
  margin-top: 20px;
  background: #e5ecd9;
  border-radius: 24px;
  min-height: 319px;
  position: relative;
  overflow: hidden;
  display: flex;
}
.hero-content {
  padding: 33px 36px;
  position: relative;
  z-index: 2;
}
.hero-eyebrow {
  font-size: 9px;
  letter-spacing: 2px;
  color: #7b8b64;
}
.hero-title {
  font-size: 49px;
  line-height: 1.23;
  letter-spacing: 2px;
  color: #28513b;
  font-weight: 750;
  display: block;
  margin: 16px 0 11px;
}
.hero-desc {
  display: block;
  color: #7b8c6e;
  font-size: 12px;
  letter-spacing: 1px;
}
.hero-button {
  display: inline-flex;
  align-items: center;
  gap: 13px;
  background: #fff8e9;
  color: #436744;
  border: 1px solid #dce3cc;
  padding: 11px 16px;
  border-radius: 10px;
  font-size: 12px;
  margin-top: 20px;
}
.hero-bottom {
  display: block;
  margin-top: 19px;
  font-size: 9px;
  color: #94a081;
  letter-spacing: 1px;
}
.hero-art {
  position: absolute;
  right: 0;
  top: 0;
  width: 57%;
  height: 100%;
}
.hero-orbit {
  width: 350px;
  height: 350px;
  border: 1px solid #b2c29a44;
  border-radius: 50%;
  position: absolute;
  top: -26px;
  left: 90px;
}
.hero-tomato {
  width: 270px;
  height: 270px;
  border: 9px solid #fbfaf1;
  box-shadow: 0 15px 25px #4d563217;
  border-radius: 50%;
  position: absolute;
  right: 20px;
  top: 66px;
  transform: rotate(15deg);
}
.hero-lettuce {
  width: 187px;
  height: 187px;
  border: 8px solid #fbfaf1;
  box-shadow: 0 15px 25px #4d563210;
  border-radius: 50%;
  position: absolute;
  left: 12px;
  top: 16px;
  transform: rotate(-14deg);
}
.fresh-stamp {
  position: absolute;
  left: 65px;
  bottom: 22px;
  width: 92px;
  height: 92px;
  transform: rotate(-13deg);
  background: #f7f1d5;
  border: 1px dashed #b0b585;
  outline: 6px solid #f7f1d5;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #677346;
}
.fresh-stamp text {
  font-size: 6px;
  letter-spacing: 1px;
}
.fresh-stamp .stamp-big {
  font-size: 32px;
  line-height: 1.3;
  font-weight: 650;
}
.benefit-strip {
  display: flex;
  justify-content: space-around;
  padding: 15px 0;
  color: #79876f;
  font-size: 11px;
}
.benefit-strip > view {
  display: flex;
  align-items: center;
  gap: 6px;
}
.category-menu {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  margin: 12px 0 25px;
}
.category-entry {
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
}
.category-circle {
  width: 88px;
  height: 83px;
  border-radius: 26px;
  background: #edf0e1;
  overflow: hidden;
  margin-bottom: 10px;
}
.category-circle image {
  width: 100%;
  height: 100%;
  transform: scale(1.07);
}
.category-name {
  font-weight: 700;
  font-size: 15px;
}
.category-subtitle {
  font-size: 10px;
  color: #939b8b;
  margin-top: 4px;
}
.neighborhood-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #f0ece1;
  padding: 14px 20px;
  border-radius: 12px;
  color: #8a795a;
}
.note-label {
  font-size: 12px;
  font-weight: 700;
  padding-right: 14px;
  border-right: 1px solid #d8d2bf;
  margin-right: 14px;
}
.note-copy {
  font-size: 12px;
}
.section-light {
  font-size: 13px;
  color: #8d9685;
  font-weight: 400;
}
.service-link {
  font-size: 12px;
  color: #4d7a58;
}
.service-preview .section-title {
  font-size: 18px;
}
@media (max-width: 700px) {
  .hero {
    min-height: 254px;
    margin-top: 18px;
    border-radius: 20px;
  }
  .hero-content {
    padding: 23px 20px;
  }
  .hero-eyebrow {
    font-size: 6px;
    letter-spacing: 1.2px;
  }
  .hero-title {
    font-size: 35px;
    margin: 14px 0 10px;
    letter-spacing: 1px;
  }
  .hero-desc {
    font-size: 9px;
    letter-spacing: 0;
  }
  .hero-button {
    font-size: 10px;
    padding: 9px 12px;
    margin-top: 16px;
    gap: 8px;
  }
  .hero-bottom {
    font-size: 7px;
    letter-spacing: 0;
    margin-top: 14px;
  }
  .hero-art {
    width: 44%;
  }
  .hero-tomato {
    width: 153px;
    height: 153px;
    right: -28px;
    top: 95px;
    border-width: 6px;
  }
  .hero-lettuce {
    width: 112px;
    height: 112px;
    left: 2px;
    top: 26px;
    border-width: 5px;
  }
  .hero-orbit {
    width: 208px;
    height: 208px;
    left: 10px;
    top: 11px;
  }
  .fresh-stamp {
    width: 55px;
    height: 55px;
    left: -6px;
    bottom: 23px;
    outline-width: 3px;
  }
  .fresh-stamp text {
    font-size: 4px;
    letter-spacing: 0;
  }
  .fresh-stamp .stamp-big {
    font-size: 21px;
  }
  .benefit-strip {
    font-size: 9px;
    padding: 14px 0;
  }
  .benefit-strip > view {
    gap: 4px;
  }
  .category-menu {
    margin: 10px -8px 22px;
  }
  .category-circle {
    width: 61px;
    height: 61px;
    border-radius: 20px;
  }
  .category-name {
    font-size: 13px;
  }
  .category-subtitle {
    font-size: 8px;
  }
  .neighborhood-note {
    padding: 12px;
  }
  .note-label {
    font-size: 10px;
    margin-right: 9px;
    padding-right: 9px;
  }
  .note-copy {
    font-size: 10px;
  }
  .neighborhood-note .small {
    font-size: 10px;
  }
  .section-light {
    font-size: 10px;
  }
  .service-preview .section-title {
    font-size: 16px;
  }
  .section-kicker {
    font-size: 8px;
    letter-spacing: 1.5px;
  }
}
.category-menu {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.hero-desc {
  max-width: 230px;
}
</style>
