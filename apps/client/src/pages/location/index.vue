<template>
  <view class="page"
    ><TopBar back title="选择城市" /><view class="form"
      ><text class="page-title">看看身边的邻居。</text
      ><text class="page-subtitle">手动选择城市，无需开启定位权限。</text
      ><view class="card"
        ><view class="field"
          ><text class="field-label">城市名称</text
          ><input
            v-model="query"
            class="field-input"
            maxlength="30"
            placeholder="输入城市，例如：苏州"
            confirm-type="done"
            @confirm="choose(query)" /></view
        ><view class="chip-row"
          ><text
            v-for="city in matches"
            :key="city"
            class="chip"
            :class="{ active: state.city === city }"
            @click="choose(city)"
            >{{ city }}</text
          ></view
        ><view v-if="error" class="error-banner">{{ error }}</view
        ><button class="btn full-width city-confirm" @click="choose(query)">
          选择这个城市
        </button></view
      ><view class="notice"
        >社区名称会按城市分别保存。城市列表里没有的，也可以直接输入。</view
      ></view
    ></view
  >
</template>
<script setup>
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import { state, site, setCity, loadSite, tab, fixedCity } from '../../lib/api';
const query = ref(''),
  error = ref('');
const matches = computed(() =>
  (fixedCity ? [fixedCity] : site.cities).filter((city) => city.includes(query.value.trim())),
);
function choose(city) {
  try {
    if (fixedCity && city !== fixedCity) throw new Error('此服务仅开放' + fixedCity);
    setCity(city);
    if (getCurrentPages().length > 1) uni.navigateBack();
    else tab('home');
  } catch (cause) {
    error.value = cause.message;
  }
}
onLoad(() => loadSite().catch(() => {}));
</script>
<style scoped>
.city-confirm {
  margin-top: 24px;
}
</style>
