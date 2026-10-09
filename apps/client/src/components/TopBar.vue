<template>
  <view class="topbar"
    ><view class="topbar-left" @click="!singlePage && (back ? backPage() : selectCity())"
      ><Icon v-if="back && !singlePage" name="chevron-left" :size="22" /><template v-else
        ><image
          class="brand-mark"
          src="/static/app-icon.png"
          mode="aspectFit"
          alt="邻里集" /></template
      ><view
        ><text class="topbar-title">{{ title || '邻里集' }}</text
        ><text v-if="!back" class="location"
          >{{ state.city }}{{ state.community ? ' · ' + state.community : ''
          }}<text v-if="!singlePage" class="tiny-arrow">⌄</text></text
        ></view
      ></view
    ><view v-if="!singlePage" class="topbar-right"
      ><text v-if="!back" class="demo-pill">{{ isRelease ? '邻里服务' : '开发环境' }}</text
      ><view v-if="!isRelease" class="cart-icon" @click="go('/pages/cart/index')"
        ><Icon name="cart" :size="23" /><text v-if="state.cartCount" class="badge">{{
          state.cartCount
        }}</text></view
      ></view
    ></view
  >
</template>
<script setup>
import Icon from './Icon.vue';
import { state, selectCity, go, tab, isRelease, fixedCity } from '../lib/api';
import { isTimelinePreview } from '../lib/share';
const singlePage = isTimelinePreview();
defineProps({ title: String, back: Boolean });
function backPage() {
  if (getCurrentPages().length > 1) uni.navigateBack();
  else tab('home');
}
</script>
<style scoped>
/* #ifdef MP-WEIXIN */
.topbar-right {
  margin-right: 90px;
}
.demo-pill {
  display: none;
}
.topbar-title {
  font-size: 18px;
}
.location {
  margin-left: 8px;
}
/* #endif */
</style>
