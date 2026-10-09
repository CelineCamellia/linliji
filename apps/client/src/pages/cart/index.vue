<template>
  <view class="page"
    ><TopBar back title="购物车" /><text class="page-title">把喜欢的，带回家。</text
    ><text class="page-subtitle">已选 {{ count }} 件好物 · {{ state.city }}</text
    ><view v-if="error" class="error-banner" @click="load">{{ error }} · 点击重试</view
    ><view v-if="loading" class="loading">加载购物车…</view
    ><EmptyState
      v-else-if="!items.length"
      title="购物车还空着"
      description="附近好店的日常好物，等你挑选"
      action="去逛逛"
      @action="tab('category')"
    />
    <view v-if="items.length" class="cart-layout"
      ><view
        ><view v-for="line in items" :key="line.product.id + line.spec" class="cart-line"
          ><image
            :src="art(line.product.art)"
            mode="aspectFit"
            @click="go('/pages/detail/index?id=' + line.product.id)"
          /><view class="line-main"
            ><text class="product-title">{{ line.product.title }}</text
            ><text class="small muted">{{ line.spec }} · {{ line.product.unit }}</text
            ><view class="row-between line-bottom"
              ><view
                ><text class="currency">¥</text
                ><text class="price">{{ money(line.product.price) }}</text></view
              ><view class="quantity"
                ><button :disabled="busy" @click="update(line, -1)">−</button
                ><text>{{ line.quantity }}</text
                ><button
                  :disabled="busy || line.quantity >= line.product.stock"
                  @click="update(line, 1)"
                >
                  ＋
                </button></view
              ></view
            ></view
          ></view
        ></view
      ><view
        ><view class="card"
          ><text class="field-label">配送到</text
          ><view class="selected-address" @click="go('/pages/addresses/index?select=1')"
            ><text>{{ address ? address.name + ' · ' + address.phone : '添加收货地址 →' }}</text
            ><view v-if="address" class="address-detail"
              >{{ address.city }}{{ address.area }}{{ address.detail }}</view
            ><view class="address-detail">点击更换地址 →</view></view
          ><view class="field"
            ><text class="field-label">订单备注</text
            ><input
              class="field-input"
              v-model="note"
              maxlength="200"
              placeholder="给店家留句话（选填）" /></view
          ><view class="summary-row"
            ><text>商品金额</text><text>¥{{ money(total) }}</text></view
          ><view class="summary-row"><text>配送费（体验）</text><text>¥0</text></view
          ><view class="divider" /><view class="row-between"
            ><text>合计</text
            ><view
              ><text class="currency">¥</text><text class="price">{{ money(total) }}</text></view
            ></view
          ><view class="spacer" /><button
            class="btn full-width"
            :loading="busy"
            :disabled="busy"
            @click="checkout"
          >
            提交体验订单</button
          ><view class="notice">本次仅创建演示订单，不发起支付，不安排配送。</view></view
        ></view
      ></view
    ></view
  >
</template>
<script setup>
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import EmptyState from '../../components/EmptyState.vue';
import {
  api,
  getCart,
  art,
  money,
  state,
  go,
  tab,
  toast,
  showError,
  selectedAddress,
  key,
  confirm,
} from '../../lib/api';
const items = ref([]),
  address = ref(null),
  note = ref(''),
  busy = ref(false),
  loading = ref(false),
  error = ref('');
let requestKey = key();
const count = computed(() => items.value.reduce((n, i) => n + i.quantity, 0)),
  total = computed(() => items.value.reduce((n, i) => n + i.quantity * i.product.price, 0));
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [c, a] = await Promise.all([getCart(), api('/addresses')]);
    items.value = c;
    address.value = selectedAddress(a);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function update(line, diff) {
  if (busy.value) return;
  if (line.quantity + diff === 0 && !(await confirm('移出购物车？', line.product.title))) return;
  busy.value = true;
  try {
    items.value = await api('/cart', {
      method: 'PATCH',
      data: { productId: line.product.id, spec: line.spec, quantity: line.quantity + diff },
    });
    state.cartCount = count.value;
    requestKey = key();
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
  }
}
async function checkout() {
  if (!address.value) {
    toast('请先添加收货地址');
    return go('/pages/addresses/index?select=1');
  }
  if (busy.value) return;
  busy.value = true;
  try {
    await api('/orders', {
      method: 'POST',
      data: { addressId: address.value.id, note: note.value },
      key: requestKey,
    });
    requestKey = key();
    items.value = [];
    state.cartCount = 0;
    toast('订单已保存，未扣款');
    tab('orders');
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
  }
}
onShow(load);
</script>
<style scoped>
.cart-layout {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 24px;
}
.cart-line {
  display: flex;
  align-items: center;
  gap: 16px;
  background: #fff;
  padding: 16px;
  border: 1px solid #e8ecdf;
  border-radius: 17px;
  margin-bottom: 13px;
}
.cart-line image {
  width: 96px;
  height: 96px;
  border-radius: 12px;
}
.line-main {
  flex: 1;
  min-width: 0;
}
.line-bottom {
  margin-top: 14px;
}
.quantity {
  display: flex;
  align-items: center;
  border: 1px solid #e3e9dc;
  border-radius: 8px;
  overflow: hidden;
  height: 30px;
}
.quantity button {
  width: 30px;
  height: 30px;
  color: #567146;
  background: #f3f6ed;
  font-size: 18px;
}
.quantity text {
  min-width: 31px;
  text-align: center;
  font-size: 12px;
}
@media (max-width: 700px) {
  .cart-layout {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .cart-line {
    padding: 13px;
    gap: 12px;
  }
  .cart-line image {
    width: 79px;
    height: 79px;
  }
}
</style>
