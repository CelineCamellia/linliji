<template>
  <view class="page"
    ><TopBar back title="登录邻里集" /><view class="form"
      ><image class="login-icon" src="/static/app-icon.png" /><text class="page-title"
        >和身边的邻居，连起来。</text
      ><text class="page-subtitle">浏览无需登录，发布和联系时使用账号</text
      ><view class="card">
        <!-- #ifndef MP-WEIXIN -->
        <view class="field"
          ><text class="field-label">账号</text
          ><input
            v-model="username"
            class="field-input"
            maxlength="32"
            placeholder="4–32 位字母、数字或下划线"
        /></view>
        <view class="field"
          ><text class="field-label">密码</text
          ><input
            v-model="password"
            class="field-input"
            password
            maxlength="128"
            placeholder="至少 12 位，请妥善保存"
        /></view>
        <view v-if="register && site.registration === 'invite'" class="field"
          ><text class="field-label">注册邀请码</text
          ><input
            v-model="inviteCode"
            class="field-input"
            password
            maxlength="128"
            placeholder="请向运营者获取"
        /></view>
        <text
          v-if="site.registration !== 'closed'"
          class="section-more"
          @click="register = !register"
          >{{ register ? '已有账号，去登录' : '首次使用，注册账号' }}</text
        >
        <!-- #endif -->
        <!-- #ifdef MP-WEIXIN -->
        <view v-if="site.registration === 'invite'" class="field"
          ><text class="field-label">首次注册邀请码</text
          ><input
            v-model="inviteCode"
            class="field-input"
            password
            maxlength="128"
            placeholder="已有微信账号可留空"
        /></view>
        <!-- #endif -->
        <view class="consent-row"
          ><switch :checked="agreed" color="#146b53" @change="agreed = $event.detail.value" /><text
            >我已阅读并同意</text
          ><text class="section-more" @click="go('/pages/privacy/index')"
            >《隐私与服务说明》</text
          ></view
        >
        <view v-if="error" class="error-banner">{{ error }}</view
        ><button class="btn full-width" :loading="busy" :disabled="busy" @click="submit">
          <!-- #ifdef MP-WEIXIN -->{{ site.wechatLogin ? '微信登录' : '当前服务未开通微信登录'
          }}<!-- #endif -->
          <!-- #ifndef MP-WEIXIN -->{{ register ? '注册并登录' : '登录'
          }}<!-- #endif --></button
        ><view class="notice"
          >账号用于保存你的发布。安卓账号和微信账号目前分别管理，不会自动合并。忘记密码可通过隐私页联系运营者处理。</view
        ></view
      ></view
    ></view
  >
</template>
<script setup>
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import { api, go, loginAccount, loginWechat, toast, site, loadSite } from '../../lib/api';
const username = ref(''),
  password = ref(''),
  inviteCode = ref(''),
  register = ref(false),
  agreed = ref(false),
  busy = ref(false),
  error = ref('');
onLoad(() => loadSite().catch((e) => (error.value = e.message)));
async function submit() {
  if (busy.value) return;
  if (!agreed.value) {
    error.value = '请先阅读并同意隐私与服务说明';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const policy = await api('/policy', { public: true });
    // #ifdef MP-WEIXIN
    await loginWechat(policy.version, inviteCode.value);
    // #endif
    // #ifndef MP-WEIXIN
    await loginAccount({
      username: username.value,
      password: password.value,
      inviteCode: inviteCode.value,
      register: register.value,
      consentVersion: policy.version,
    });
    // #endif
    password.value = '';
    inviteCode.value = '';
    toast('登录成功');
    uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/profile/index' }) });
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<style scoped>
.login-icon {
  width: 76px;
  height: 76px;
  border-radius: 22px;
  margin-bottom: 20px;
}
.consent-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  margin: 24px 0;
}
.consent-row switch {
  transform: scale(0.75);
  transform-origin: left center;
  width: 46px;
}
</style>
