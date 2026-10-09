<template>
  <view class="page"
    ><TopBar back :title="kind === 'market' ? '邻里信息' : '好物详情'" /><view
      v-if="error"
      class="error-banner"
      @click="load"
      >{{ error }} · 点击重试</view
    ><view v-if="!item && !error" class="loading">加载中…</view
    ><template v-if="item"
      ><view class="detail-layout"
        ><swiper v-if="item.photos?.length" class="detail-image" indicator-dots
          ><swiper-item v-for="(photo, index) in item.photos" :key="photo.id"
            ><image
              class="detail-image"
              :src="mediaUrl(photo.url)"
              mode="aspectFit"
              @click="previewPhotos(index)" /></swiper-item></swiper
        ><image v-else class="detail-image" :src="art(item.art)" mode="aspectFit" /><view
          class="detail-main"
          ><view class="row-between"
            ><text class="status-label">{{ kind === 'market' ? kindLabel(item) : item.tag }}</text
            ><text class="small muted">{{
              kind === 'market'
                ? item.city + ' · ' + (item.community || item.area)
                : item.shop + (isRelease ? ' · ' + item.area : ' · 示例门店')
            }}</text></view
          ><text class="page-title">{{ item.title }}</text
          ><text class="page-subtitle">{{
            item.subtitle ||
            (listingKind(item) === 'service'
              ? '邻居的手艺，身边的帮手'
              : listingKind(item) === 'exchange'
                ? '各取所需，让闲置流转'
                : '让好物遇见下一位主人')
          }}</text
          ><view v-if="kind === 'market'" class="detail-price">{{ priceLabel(item) }}</view
          ><view v-else
            ><text class="currency">¥</text><text class="detail-price">{{ money(item.price) }}</text
            ><text class="small muted"> / {{ item.unit || '件' }}</text></view
          ><view v-if="item.exchangeFor" class="listing-extra"
            ><text class="field-label">想换什么</text><text>{{ item.exchangeFor }}</text></view
          ><view v-if="kind === 'market' && listingKind(item) !== 'service'" class="listing-extra"
            ><text class="field-label">物品成色</text><text>{{ item.condition }}</text></view
          ><view v-if="item.availability" class="listing-extra"
            ><text class="field-label">可联系或帮忙时间</text
            ><text>{{ item.availability }}</text></view
          ><view class="divider" /><template v-if="kind === 'product' && !singlePage && !isRelease"
            ><text class="field-label">选择规格</text
            ><view class="chip-row"
              ><text
                v-for="s in item.options"
                :key="s"
                class="chip"
                :class="{ active: spec === s }"
                @click="spec = s"
                >{{ s }}</text
              ></view
            ><text class="stock small muted"
              >剩余 {{ item.stock }} 件 · 在购物车中调整数量</text
            ></template
          ><template v-else-if="kind === 'market'"
            ><text class="field-label">发布者 · {{ item.nickname }}</text
            ><text class="small muted">{{
              item.demo
                ? '示例物品，仅供功能体验'
                : item.owned
                  ? '这是你发布的信息'
                  : '联系邻居，先确认内容与安排'
            }}</text></template
          ><view class="divider" /><text class="field-label">{{
            kind === 'market' ? '发布详情' : '关于这件好物'
          }}</text
          ><text class="description">{{ item.description }}</text
          ><view
            v-if="
              kind === 'market' &&
              listingKind(item) === 'sale' &&
              !item.owned &&
              !singlePage &&
              !isRelease
            "
            class="selected-address"
            @click="go('/pages/addresses/index?select=1')"
            ><text>{{ address ? address.name + ' · ' + address.phone : '选择同城联系地址 →' }}</text
            ><view v-if="address" class="address-detail"
              >{{ address.city }}{{ address.area }}{{ address.detail }}</view
            ></view
          >
          <view class="sticky-actions" v-if="kind === 'product' && !singlePage && !isRelease"
            ><button class="btn secondary" @click="favorite">
              {{ saved ? '已收藏' : '收藏好物' }}</button
            ><button class="btn" :loading="busy" :disabled="busy || !item.stock" @click="add">
              加入购物车
            </button></view
          ><view v-else-if="isRelease && !singlePage && kind === 'product'" class="sticky-actions"
            ><button class="btn secondary" @click="favorite">
              {{ saved ? '已收藏' : '收藏好物' }}</button
            ><button class="btn" @click="contactShop">联系商家</button></view
          ><view v-else-if="!singlePage && kind === 'market'" class="sticky-actions"
            ><template v-if="item.owned"
              ><button
                class="btn secondary"
                :disabled="busy || item.status === 'reserved'"
                @click="go('/pages/publish/index?id=' + item.id)"
              >
                修改信息</button
              ><button
                class="btn outline"
                :disabled="busy || !['available', 'pending', 'rejected'].includes(item.status)"
                @click="withdraw"
              >
                下架信息
              </button></template
            ><template v-else
              ><button
                class="btn secondary"
                :disabled="busy || item.status === 'withdrawn'"
                @click="contact"
              >
                联系邻居</button
              ><button
                v-if="!isRelease && listingKind(item) === 'sale'"
                class="btn"
                :loading="busy"
                :disabled="busy || item.status !== 'available'"
                @click="reserve"
              >
                {{ item.status === 'available' ? '预约当面交易' : '已预约 / 已下架' }}</button
              ><button
                v-if="isRelease && item.status === 'available'"
                class="btn outline"
                @click="report"
              >
                举报信息
              </button></template
            ></view
          ></view
        ></view
      ><view class="notice">{{
        isRelease
          ? '当前提供居民信息发布与联系。请确认服务范围、费用和交换条件，物品当面验看；暂不提供在线付款。'
          : '体验版不收款，不安排真实配送或交易。商品图片为本地插画示意。'
      }}</view></template
    ></view
  >
</template>
<script setup>
import { ref } from 'vue';
import { onLoad, onShow, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import {
  api,
  art,
  money,
  go,
  tab,
  toast,
  showError,
  confirm,
  addCart,
  selectedAddress,
  key,
  applySharedCity,
  state,
  isRelease,
  hasSession,
  mediaUrl,
} from '../../lib/api';
import { friendShare, timelineShare, setShareMenu, isTimelinePreview } from '../../lib/share';
import { kindLabel, listingKind, priceLabel } from '../../lib/listing';
const singlePage = isTimelinePreview();
const item = ref(null),
  id = ref(''),
  kind = ref('product'),
  spec = ref(''),
  saved = ref(false),
  busy = ref(false),
  address = ref(null),
  error = ref('');
let requestKey = key();
async function load() {
  setShareMenu({ enabled: false });
  if (!id.value) {
    error.value = '分享内容不存在';
    return;
  }
  error.value = '';
  try {
    item.value = await api(
      (kind.value === 'market'
        ? singlePage || (isRelease && !hasSession())
          ? '/public/listings/'
          : '/listings/'
        : '/products/') + encodeURIComponent(id.value),
      { public: singlePage || kind.value === 'product' || (isRelease && !hasSession()) },
    );
    spec.value = spec.value || item.value.options?.[0];
    saved.value = (uni.getStorageSync('llj-favorites') || []).includes(id.value);
    if (kind.value === 'market' && listingKind(item.value) === 'sale' && !singlePage && !isRelease)
      address.value = selectedAddress(await api('/addresses'));
    setShareMenu({ enabled: kind.value === 'product' || item.value.status === 'available' });
  } catch (e) {
    item.value = null;
    error.value = e.message;
  }
}
function previewPhotos(index) {
  uni.previewImage({ urls: item.value.photos.map((p) => mediaUrl(p.url)), current: index });
}
function favorite() {
  const ids = uni.getStorageSync('llj-favorites') || [];
  const next = saved.value ? ids.filter((i) => i !== id.value) : [...ids, id.value];
  uni.setStorageSync('llj-favorites', next);
  saved.value = !saved.value;
  toast(saved.value ? '已收藏' : '已取消收藏');
}
async function add() {
  if (busy.value) return;
  busy.value = true;
  try {
    await addCart(item.value, spec.value);
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
  }
}
async function contactShop() {
  try {
    const r = await api('/products/' + id.value + '/contact');
    if (await confirm('联系商家', '请先确认价格、库存和交付安排。是否拨打 ' + r.phone + '？'))
      uni.makePhoneCall({ phoneNumber: r.phone, fail: () => toast('可手动拨打：' + r.phone) });
  } catch (e) {
    showError(e);
  }
}
async function contact() {
  try {
    const r = await api('/listings/' + id.value + '/contact');
    if (await confirm('联系邻居', '发布者电话：' + r.phone + '。是否拨打？'))
      uni.makePhoneCall({ phoneNumber: r.phone, fail: () => toast('可手动拨打：' + r.phone) });
  } catch (e) {
    showError(e);
  }
}
async function report() {
  uni.showActionSheet({
    itemList: ['涉嫌诈骗或虚假信息', '违法、侵权或危险物品', '泄露隐私或其他违规'],
    success: async (r) => {
      try {
        await api('/reports', {
          method: 'POST',
          data: {
            listingId: id.value,
            reason: ['涉嫌诈骗或虚假信息', '违法、侵权或危险物品', '泄露隐私或其他违规'][
              r.tapIndex
            ],
          },
        });
        toast('举报已提交，运营者将核查');
      } catch (e) {
        showError(e);
      }
    },
  });
}
async function reserve() {
  if (!address.value) return go('/pages/addresses/index?select=1');
  if (busy.value) return;
  busy.value = true;
  try {
    await api('/listings/' + id.value + '/reserve', {
      method: 'POST',
      data: { addressId: address.value.id },
      key: requestKey,
    });
    requestKey = key();
    toast('预约已保存（体验）');
    tab('orders');
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
  }
}
async function withdraw() {
  if (!(await confirm('下架这条信息？', '下架后不会出现在邻里集市中，其他人无法再联系。'))) return;
  busy.value = true;
  try {
    await api('/listings/' + id.value, { method: 'DELETE' });
    await load();
    toast('已下架');
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
  }
}
// #ifdef MP-WEIXIN
onShareAppMessage(() =>
  friendShare('detail', { city: state.city, kind: kind.value, item: item.value }),
);
onShareTimeline(() =>
  timelineShare('detail', { city: state.city, kind: kind.value, item: item.value }),
);
// #endif
onLoad((q) => {
  applySharedCity(q.city);
  id.value = q.id || '';
  kind.value = q.kind === 'market' ? 'market' : 'product';
});
onShow(load);
</script>
<style scoped>
.listing-extra {
  margin-top: 18px;
  padding: 15px;
  background: #edf3e6;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.listing-extra .field-label {
  display: block;
  margin-bottom: 4px;
}
.detail-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 35px;
  margin-top: 14px;
}
.detail-image {
  width: 100%;
  height: 440px;
  background: #edf1e6;
  border-radius: 24px;
}
.detail-main {
  padding: 10px 0;
}
.detail-price {
  font-size: 37px;
  color: #c67545;
  font-weight: 750;
}
.description {
  display: block;
  color: #84907c;
  line-height: 1.9;
  font-size: 13px;
  white-space: pre-wrap;
  margin-bottom: 20px;
}
.stock {
  display: block;
  margin-top: 13px;
}
.detail-main .page-title {
  font-size: 26px;
  margin-top: 19px;
}
.detail-main .sticky-actions {
  position: static;
}
@media (max-width: 700px) {
  .detail-layout {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .detail-image {
    height: 300px;
  }
  .detail-main .page-title {
    font-size: 24px;
  }
  .detail-main .sticky-actions {
    position: sticky;
  }
}
</style>
