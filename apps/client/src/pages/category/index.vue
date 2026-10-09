<template>
  <view class="page"
    ><TopBar title="逛附近" /><text class="page-title">需要的，都在附近。</text
    ><text class="page-subtitle">{{ state.city }} · 发现身边的小店与好服务</text>
    <view class="search-bar"
      ><Icon name="search" /><input
        v-model="query"
        placeholder="搜商品、店铺或服务"
        confirm-type="search"
        @confirm="load"
      /><text class="search-action" @click="load">搜索</text></view
    >
    <view class="category-tabs"
      ><view
        v-for="c in tabs"
        :key="c.id"
        class="category-tab"
        :class="{ active: category === c.id }"
        @click="
          category = c.id;
          load();
        "
        >{{ c.label }}</view
      ></view
    >
    <view class="row-between filters"
      ><view class="chip-row"
        ><text
          class="chip"
          :class="{ active: sort === 'default' }"
          @click="
            sort = 'default';
            load();
          "
          >综合推荐</text
        ><text
          class="chip"
          :class="{ active: sort === 'price' }"
          @click="
            sort = 'price';
            load();
          "
          >价格从低到高</text
        ><text
          v-if="category !== 'repair' && !isRelease"
          class="chip"
          :class="{ active: sort === 'near' }"
          @click="
            sort = 'near';
            load();
          "
          >离我最近</text
        ></view
      ><text class="tiny muted">{{ items.length }} 个结果</text></view
    >
    <view v-if="error" class="error-banner" @click="load">{{ error }} · 点击重试</view
    ><view v-if="loading" class="loading">正在寻找附近的好物…</view>
    <template v-else
      ><view v-if="category === 'repair'" class="service-list"
        ><view
          v-for="s in items"
          :key="s.id"
          class="service-card"
          @click="go('/pages/booking/index?id=' + s.id)"
          ><image class="service-art" :src="art(s.art)" mode="aspectFit" /><view
            class="service-content"
            ><text class="service-title">{{ s.title }}</text
            ><text class="service-subtitle">{{ s.subtitle }}</text
            ><text class="small muted">{{ s.duration }} · 参考报价</text
            ><view class="service-bottom"
              ><view
                ><text class="currency">¥</text><text class="price">{{ money(s.price) }}</text
                ><text class="small muted"> / {{ s.unit }}</text></view
              ><button v-if="!singlePage" class="btn compact secondary">
                {{ isRelease ? '查看' : '预约' }}
              </button></view
            ></view
          ></view
        ></view
      ><view v-else class="product-grid"
        ><ProductCard v-for="p in items" :key="p.id" :item="p" /></view
      ><EmptyState
        v-if="!items.length"
        title="暂时没有找到相关内容"
        :description="
          isRelease || fixedCity
            ? '试试其他关键词；商家资料核实后展示'
            : '试试其他关键词；示例商家目前位于杭州'
        "
        action="查看全部"
        @action="
          query = '';
          load();
        " /></template
    ><view class="notice">{{
      isRelease
        ? '商品和服务请联系商家确认，不提供线上支付和履约担保。'
        : '商品、商家与距离为示例数据，支持体验选购和预约流程。'
    }}</view>
  </view>
</template>
<script setup>
import { ref, onUnmounted } from 'vue';
import { onShow, onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import Icon from '../../components/Icon.vue';
import ProductCard from '../../components/ProductCard.vue';
import EmptyState from '../../components/EmptyState.vue';
import {
  api,
  art,
  money,
  go,
  state,
  locationQuery,
  fixedCity,
  getCart,
  applySharedCity,
  isRelease,
  hasSession,
} from '../../lib/api';
import {
  friendShare,
  timelineShare,
  setShareMenu,
  isTimelinePreview,
  sharedCategory,
} from '../../lib/share';
const singlePage = isTimelinePreview();
const tabs = [
    { id: 'all', label: '全部' },
    { id: 'farm', label: '新鲜买菜' },
    { id: 'repair', label: '上门维修' },
    { id: 'clothes', label: '附近衣橱' },
  ],
  category = ref('all'),
  query = ref(''),
  sort = ref('default'),
  items = ref([]),
  error = ref(''),
  loading = ref(false);
let seq = 0;
async function load() {
  const current = ++seq;
  error.value = '';
  loading.value = true;
  try {
    let r = await api(
      category.value === 'repair'
        ? '/services?' + locationQuery()
        : '/products?' +
            locationQuery() +
            '&category=' +
            (category.value === 'all' ? '' : category.value) +
            '&q=' +
            encodeURIComponent(query.value) +
            '&sort=' +
            sort.value,
      { public: true },
    );
    if (category.value === 'repair') {
      r = r.filter((s) => (s.title + s.subtitle).includes(query.value));
      if (sort.value === 'price') r.sort((a, b) => a.price - b.price);
    }
    if (current === seq) items.value = r;
  } catch (e) {
    if (current === seq) error.value = e.message;
  } finally {
    if (current === seq) loading.value = false;
  }
}
onLoad((q) => {
  applySharedCity(q.city);
  if (q.category) {
    category.value = sharedCategory(q.category);
    uni.removeStorageSync('llj-category');
    uni.removeStorageSync('llj-search');
  }
});
// #ifdef MP-WEIXIN
onShareAppMessage(() => friendShare('category', { city: state.city, category: category.value }));
onShareTimeline(() => timelineShare('category', { city: state.city, category: category.value }));
// #endif
onShow(() => {
  setShareMenu();
  const c = uni.getStorageSync('llj-category');
  if (c) {
    category.value = c;
    uni.removeStorageSync('llj-category');
  }
  const q = uni.getStorageSync('llj-search');
  if (q !== '' && q !== undefined) {
    query.value = q;
    uni.removeStorageSync('llj-search');
  }
  load();
  if (!singlePage && (!isRelease || hasSession())) getCart().catch(() => {});
});
uni.$on('city-change', load);
onUnmounted(() => uni.$off('city-change', load));
</script>
<style scoped>
.category-tabs {
  display: flex;
  gap: 28px;
  border-bottom: 1px solid #e7eadf;
  margin-top: 24px;
}
.category-tab {
  padding: 12px 1px;
  font-size: 14px;
  color: #899380;
}
.category-tab.active {
  color: #146b53;
  font-weight: 700;
  border-bottom: 3px solid #146b53;
}
.filters {
  margin: 20px 0;
}
.filters .chip {
  font-size: 10px;
  padding: 6px 11px;
}
.filters .tiny {
  white-space: nowrap;
}
@media (max-width: 700px) {
  .category-tabs {
    justify-content: space-between;
    gap: 10px;
  }
  .category-tab {
    font-size: 13px;
  }
  .filters {
    align-items: flex-start;
  }
}
</style>
