<template>
  <view class="page">
    <TopBar back title="服务连接设置" />
    <view v-if="configurableServer" class="form">
      <text class="page-title">连接你的邻里服务。</text>
      <text class="page-subtitle">填写社区运营者提供的 HTTPS 地址</text>
      <view class="notice">每个部署独立保存账号和发布。请确认地址属于你要加入的社区服务。</view>
      <form class="card" @submit="save">
        <view class="field"
          ><text class="field-label">服务地址</text
          ><input
            v-model="endpoint"
            class="field-input"
            name="endpoint"
            :disabled="busy"
            placeholder="https://你的服务域名"
          /><text class="small muted">可填写网站根地址或以 /api 结尾的地址。</text></view
        >
        <button class="btn full-width" form-type="submit" :loading="busy" :disabled="busy">
          保存并检查连接
        </button>
        <view v-if="message" :class="ok ? 'notice' : 'error-banner'">{{ message }}</view>
        <button v-if="ok" class="btn secondary full-width return-home" @click="tab('home')">
          返回首页
        </button>
      </form>
      <view class="notice"
        >连接后可以浏览信息，注册或登录后发布、联系邻居。同名账号在不同服务之间不互通。</view
      >
    </view>
    <view v-else class="notice">当前客户端使用部署时配置的服务地址。</view>
  </view>
</template>
<script setup>
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import { apiBase, tab, configurableServer, switchServer, site } from '../../lib/api';
import { normalizeServiceAddress } from '../../lib/connection';
const endpoint = ref(apiBase()),
  busy = ref(false),
  message = ref(''),
  ok = ref(false);
onShow(() => {
  endpoint.value = apiBase();
  message.value = '';
  ok.value = false;
});
async function save(event) {
  if (!configurableServer || busy.value) return;
  busy.value = true;
  ok.value = false;
  message.value = '';
  try {
    const next = normalizeServiceAddress(event.detail.value.endpoint);
    if (!next.startsWith('https://')) throw new Error('请填写 HTTPS 服务地址');
    const probe = (path) =>
      new Promise((resolve, reject) =>
        uni.request({
          url: next + path,
          timeout: 8000,
          success: (r) =>
            r.statusCode === 200 ? resolve(r.data) : reject(new Error('服务地址不可用')),
          fail: () => reject(new Error('无法连接此服务，请检查地址与网络')),
        }),
      );
    const health = await probe('/health');
    if (health.ok !== true || health.name !== '邻里集' || health.mode !== 'production')
      throw new Error('该地址不是可用的邻里集服务');
    const settings = await probe('/site');
    if (
      !Array.isArray(settings.cities) ||
      !['open', 'invite', 'closed'].includes(settings.registration)
    )
      throw new Error('服务配置不兼容，请联系运营者');
    switchServer(next);
    Object.assign(site, settings);
    endpoint.value = next;
    message.value = '连接成功，可以返回首页';
    ok.value = true;
  } catch (error) {
    message.value = error.message;
  } finally {
    busy.value = false;
  }
}
</script>
<style scoped>
.return-home {
  margin-top: 12px;
}
</style>
