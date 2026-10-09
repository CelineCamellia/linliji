<template>
  <view class="page"
    ><TopBar title="我的订单" /><text class="page-title">生活小事，有迹可循。</text
    ><text class="page-subtitle">好物订单、上门服务和闲置预约，都在这里</text
    ><view class="chip-row order-tabs"
      ><text
        v-for="f in filters"
        :key="f.id"
        class="chip"
        :class="{ active: filter === f.id }"
        @click="filter = f.id"
        >{{ f.label }}</text
      ></view
    ><view v-if="error" class="error-banner" @click="load">{{ error }} · 点击重试</view
    ><view v-if="loading" class="loading">加载订单…</view
    ><EmptyState
      v-else-if="!visible.length"
      title="还没有相关订单"
      description="从身边的一份新鲜、一件好物开始"
      action="逛逛附近"
      @action="tab('category')"
    /><view class="order-grid"
      ><view v-for="o in visible" :key="o.id" class="order-card card"
        ><view class="row-between"
          ><text class="small muted">{{ kindText(o.kind) }} · {{ formatDate(o.created) }}</text
          ><text class="status-label" :class="{ cancelled: o.status === 'cancelled' }">{{
            o.status === 'cancelled' ? '已取消' : '待确认 · 体验'
          }}</text></view
        ><view class="order-summary" @click="expanded = expanded === o.id ? '' : o.id"
          ><image :src="art(o.art)" mode="aspectFit" /><view class="order-main"
            ><text class="order-title">{{ o.title }}</text
            ><text class="small muted">{{
              o.kind === 'service'
                ? o.date + ' ' + o.slot
                : o.kind === 'market'
                  ? '同城当面交接'
                  : '商品订单 · 不安排真实配送'
            }}</text
            ><view class="order-price"
              ><text class="price-label">{{ o.estimate ? '参考价' : '合计' }} </text
              ><text class="currency">¥</text><text class="price">{{ money(o.total) }}</text></view
            ></view
          ></view
        ><view v-if="expanded === o.id" class="order-details"
          ><text class="small muted">订单号：{{ o.id }}</text
          ><view class="divider" /><view
            v-for="(i, index) in o.items || []"
            :key="index"
            class="summary-row"
            ><text>{{ i.product.title }} · {{ i.spec }} ×{{ i.quantity }}</text
            ><text>¥{{ money(i.quantity * i.product.price) }}</text></view
          ><text class="detail-line">{{ o.address.name }} · {{ o.address.phone }}</text
          ><text class="detail-line muted"
            >{{ o.address.city }}{{ o.address.area }}{{ o.address.detail }}</text
          ><text v-if="o.note" class="detail-line muted">备注：{{ o.note }}</text
          ><text v-if="o.meeting" class="detail-line muted">{{ o.meeting }}</text></view
        ><view class="order-actions"
          ><button
            v-if="o.kind === 'market' && o.status === 'pending'"
            class="btn compact outline"
            @click="go('/pages/detail/index?kind=market&id=' + o.listingId)"
          >
            联系卖家</button
          ><button class="btn compact outline" @click="expanded = expanded === o.id ? '' : o.id">
            {{ expanded === o.id ? '收起详情' : '查看详情' }}</button
          ><button
            v-if="o.status === 'pending'"
            class="btn compact secondary"
            :disabled="busy === o.id"
            @click="cancel(o)"
          >
            {{ busy === o.id ? '正在取消…' : '取消订单' }}
          </button></view
        ></view
      ></view
    ><view class="notice">{{
      isRelease
        ? '试运行暂未开放在线下单。闲置可通过详情页联系发布者。'
        : '订单均为体验记录，未收取费用。维修参考价需正式服务前确认；取消体验订单无需退款。'
    }}</view></view
  >
</template>
<script setup>
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import EmptyState from '../../components/EmptyState.vue';
import {
  api,
  art,
  money,
  go,
  tab,
  toast,
  showError,
  confirm,
  getCart,
  isRelease,
} from '../../lib/api';
const filters = [
    { id: 'all', label: '全部订单' },
    { id: 'shopping', label: '好物订单' },
    { id: 'service', label: '上门服务' },
    { id: 'market', label: '闲置预约' },
  ],
  filter = ref('all'),
  orders = ref([]),
  expanded = ref(''),
  busy = ref(''),
  error = ref(''),
  loading = ref(false);
const visible = computed(() =>
    orders.value.filter((o) => filter.value === 'all' || o.kind === filter.value),
  ),
  kindText = (k) => ({ shopping: '好物订单', service: '上门服务', market: '闲置预约' })[k],
  formatDate = (s) => s.slice(0, 10);
async function load() {
  if (isRelease) {
    orders.value = [];
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    orders.value = await api('/orders');
    getCart().catch(() => {});
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function cancel(o) {
  if (busy.value) return;
  if (!(await confirm('取消这笔体验订单？', '商品库存或闲置预约状态会恢复，不涉及退款。'))) return;
  busy.value = o.id;
  try {
    await api('/orders/' + o.id + '/cancel', { method: 'POST' });
    toast('订单已取消');
    await load();
  } catch (e) {
    showError(e);
  } finally {
    busy.value = '';
  }
}
onShow(load);
</script>
<style scoped>
.order-tabs {
  margin: 23px 0;
}
.order-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 17px;
}
.order-summary {
  display: flex;
  gap: 14px;
  align-items: center;
  margin: 20px 0;
}
.order-summary image {
  height: 85px;
  width: 85px;
  border-radius: 13px;
}
.order-main {
  flex: 1;
  min-width: 0;
}
.order-title {
  display: block;
  font-weight: 700;
  margin-bottom: 6px;
  font-size: 15px;
}
.order-main > .small {
  display: block;
  font-size: 10px;
}
.order-price {
  margin-top: 11px;
}
.order-price .price {
  font-size: 20px;
}
.order-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.order-details {
  padding: 14px;
  background: #f7f8f3;
  border-radius: 12px;
  margin-bottom: 17px;
}
.detail-line {
  display: block;
  font-size: 11px;
  margin-top: 8px;
}
.order-details > .small {
  font-size: 10px;
  word-break: break-all;
}
@media (max-width: 700px) {
  .order-grid {
    grid-template-columns: 1fr;
  }
  .order-tabs {
    gap: 7px;
  }
  .order-tabs .chip {
    padding: 7px 11px;
    font-size: 11px;
  }
}
</style>
