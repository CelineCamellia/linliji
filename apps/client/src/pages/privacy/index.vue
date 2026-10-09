<template>
  <view class="page"
    ><TopBar back title="隐私与服务说明" /><view class="form"
      ><text class="page-title">安心使用，明白选择。</text
      ><view v-if="error" class="error-banner" @click="load">{{ error }} · 点击重试</view
      ><view v-if="policy" class="card"
        ><text class="policy-title">运营者：{{ policy.operator }}</text
        ><text class="policy-text">联系邮箱：{{ policy.contact }}\n版本：{{ policy.version }}</text
        ><view v-for="section in policy.sections" :key="section.title" class="policy-section"
          ><text class="policy-title">{{ section.title }}</text
          ><text class="policy-text">{{ section.text }}</text></view
        ></view
      ></view
    ></view
  >
</template>
<script setup>
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import { api } from '../../lib/api';
const policy = ref(null),
  error = ref('');
async function load() {
  try {
    error.value = '';
    policy.value = await api('/policy', { public: true });
  } catch (e) {
    error.value = e.message;
  }
}
onLoad(load);
</script>
<style scoped>
.policy-section {
  margin-top: 24px;
}
.policy-title {
  font-size: 16px;
  font-weight: 600;
  display: block;
  margin-bottom: 8px;
}
.policy-text {
  font-size: 14px;
  line-height: 1.9;
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
  color: #627264;
}
</style>
