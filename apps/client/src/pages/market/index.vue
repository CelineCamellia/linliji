<template>
  <view class="page"
    ><TopBar title="邻里集市" /><view class="market-heading"
      ><view
        ><text class="section-kicker">FROM ONE NEIGHBOR TO ANOTHER</text
        ><text class="page-title">邻里之间，各有所需。</text
        ><text class="page-subtitle">卖闲置、亮手艺、换好物，都从这里开始</text></view
      ><button v-if="!singlePage" class="btn compact" @click="go('/pages/publish/index')">
        ＋ 发布
      </button></view
    >
    <CommunityPicker />
    <view class="search-bar"
      ><Icon name="search" /><input
        v-model="query"
        placeholder="搜手艺、闲置或想换的东西"
        confirm-type="search"
        @confirm="reload"
      /><text class="search-action" @click="reload">搜索</text></view
    >
    <view class="feed-kinds chip-row"
      ><text
        class="chip"
        :class="{ active: !kind }"
        @click="
          kind = '';
          reload();
        "
        >全部</text
      ><text
        v-for="type in listingKinds"
        :key="type.id"
        class="chip"
        :class="{ active: kind === type.id }"
        @click="
          kind = type.id;
          reload();
        "
        >{{ type.label }}</text
      ></view
    >
    <view class="market-filters chip-row"
      ><text
        class="chip"
        :class="{ active: !mine && sort === 'default' }"
        @click="
          mine = false;
          sort = 'default';
          reload();
        "
        >最新发布</text
      ><text
        class="chip"
        :class="{ active: !mine && sort === 'price' }"
        @click="
          mine = false;
          sort = 'price';
          reload();
        "
        >价格优先</text
      ><text
        v-if="!singlePage"
        class="chip"
        :class="{ active: mine }"
        @click="
          mine = true;
          reload();
        "
        >我的发布</text
      ></view
    >
    <text v-if="mine" class="mine-tip">查看你在各社区发布的信息，包含待审核和已下架内容。</text>
    <view v-if="error" class="error-banner" @click="retry">{{ error }} · 点击重试</view
    ><view v-if="loading && !items.length" class="loading">正在读取邻里的新消息…</view
    ><view class="market-grid"
      ><NeighborCard v-for="item in items" :key="item.id" :item="item" :mine="mine"
    /></view>
    <EmptyState
      v-if="!loading && !error && !items.length"
      :title="mine ? '这个分类下还没有你的发布' : '暂时没有符合条件的邻里信息'"
      description="可以切换社区和分类，或自己发布一条"
      :action="singlePage ? '' : '发布邻里信息'"
      @action="go('/pages/publish/index' + (kind ? '?kind=' + kind : ''))"
    />
    <button
      v-if="items.length < total"
      class="btn secondary load-more"
      :loading="loading"
      :disabled="loading"
      @click="loadMore"
    >
      查看更多</button
    ><view v-if="items.length" class="feed-total">已显示 {{ items.length }} / {{ total }} 条</view>
    <view class="notice"
      >面议和交换不按零元出售展示。联系后先确认费用、服务范围或交换条件；已登录的邻居才能查看联系电话。</view
    >
  </view>
</template>
<script setup>
import { ref, onUnmounted } from 'vue';
import { onShow, onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import Icon from '../../components/Icon.vue';
import EmptyState from '../../components/EmptyState.vue';
import CommunityPicker from '../../components/CommunityPicker.vue';
import NeighborCard from '../../components/NeighborCard.vue';
import { api, go, state, locationQuery, applySharedCity } from '../../lib/api';
import { listingKinds } from '../../lib/listing';
import {
  friendShare,
  timelineShare,
  setShareMenu,
  isTimelinePreview,
  sharedCity,
} from '../../lib/share';
const singlePage = isTimelinePreview(),
  items = ref([]),
  query = ref(''),
  kind = ref(''),
  sort = ref('default'),
  mine = ref(false),
  loading = ref(false),
  error = ref(''),
  total = ref(0);
let seq = 0,
  page = 0,
  failedPage = 1;
async function load(target = 1) {
  const current = ++seq;
  loading.value = true;
  error.value = '';
  if (target === 1) {
    items.value = [];
    total.value = 0;
    page = 0;
  }
  try {
    const personal = mine.value && !singlePage;
    const r = await api(
      (personal ? '/listings' : '/public/listings') +
        '?' +
        (personal ? 'mine=1' : locationQuery()) +
        '&q=' +
        encodeURIComponent(query.value) +
        '&kind=' +
        kind.value +
        '&sort=' +
        sort.value +
        '&page=' +
        target,
      { public: !personal },
    );
    if (current !== seq) return;
    items.value =
      target === 1
        ? r.items
        : [
            ...items.value,
            ...r.items.filter((item) => !items.value.some((old) => old.id === item.id)),
          ];
    total.value = r.total;
    page = target;
  } catch (e) {
    if (current === seq) {
      failedPage = target;
      error.value = e.message;
    }
  } finally {
    if (current === seq) loading.value = false;
  }
}
function reload() {
  load(1);
}
function loadMore() {
  if (!loading.value) load(page + 1);
}
function retry() {
  load(failedPage);
}
onLoad((q) => {
  applySharedCity(q.city);
  if (sharedCity(q.city) || singlePage) {
    mine.value = false;
    uni.removeStorageSync('llj-mine');
  }
});
// #ifdef MP-WEIXIN
onShareAppMessage(() => friendShare('market', { city: state.city }));
onShareTimeline(() => timelineShare('market', { city: state.city }));
// #endif
onShow(() => {
  setShareMenu();
  if (!singlePage) {
    const feed = uni.getStorageSync('llj-feed');
    if (feed) {
      kind.value = listingKinds.some((item) => item.id === feed.kind) ? feed.kind : '';
      query.value = typeof feed.query === 'string' ? feed.query : '';
      mine.value = false;
      sort.value = 'default';
      uni.removeStorageSync('llj-feed');
    }
    if (uni.getStorageSync('llj-mine')) {
      mine.value = true;
      kind.value = '';
      query.value = '';
      uni.removeStorageSync('llj-mine');
    }
  }
  reload();
});
uni.$on('city-change', reload);
onUnmounted(() => uni.$off('city-change', reload));
</script>
<style scoped>
.market-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.market-heading .page-title {
  font-size: 29px;
  margin-top: 7px;
}
.market-heading .page-subtitle {
  font-size: 11px;
}
.market-heading .btn {
  white-space: nowrap;
}
.feed-kinds {
  margin: 22px 0 12px;
}
.market-filters {
  margin-bottom: 20px;
}
.load-more {
  margin: 24px auto;
}
.feed-total {
  text-align: center;
  color: #87927a;
  font-size: 12px;
  margin: 20px;
}
.mine-tip {
  display: block;
  font-size: 12px;
  color: #7d886f;
  margin-bottom: 15px;
}
@media (max-width: 700px) {
  .market-heading .page-title {
    font-size: 23px;
  }
  .market-heading .section-kicker {
    font-size: 8px;
  }
  .chip {
    font-size: 12px;
  }
}
</style>
