<template>
  <view class="product-card" @click="go('/pages/detail/index?kind=product&id=' + item.id)"
    ><view class="product-picture"
      ><image :src="art(item.art)" mode="aspectFit" /><text class="picture-tag">{{
        item.tag
      }}</text></view
    ><view class="product-info"
      ><text class="product-title">{{ item.title }}</text
      ><text class="muted small">{{ item.unit }}</text
      ><view class="row-between price-row"
        ><view
          ><text class="currency">¥</text><text class="price">{{ money(item.price) }}</text></view
        ><button
          v-if="!singlePage && !isRelease"
          class="add-btn"
          aria-label="加入购物车"
          @click.stop="add"
        >
          <text>＋</text>
        </button></view
      ><view class="small muted"
        >{{ item.shop }} · {{ isRelease ? item.area : item.distance + 'km' }}</view
      ></view
    ></view
  >
</template>
<script setup>
import { ref } from 'vue';
import { go, art, money, addCart, showError, isRelease } from '../lib/api';
import { isTimelinePreview } from '../lib/share';
const singlePage = isTimelinePreview();
const props = defineProps({ item: Object });
const busy = ref(false);
async function add() {
  if (props.item.options.length > 1)
    return go('/pages/detail/index?kind=product&id=' + props.item.id);
  if (busy.value) return;
  busy.value = true;
  try {
    await addCart(props.item, props.item.options[0]);
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
  }
}
</script>
