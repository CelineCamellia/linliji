<template>
  <view class="page"
    ><TopBar back title="地址管理" /><view class="form"
      ><text class="page-title">每一份好物，都有归处。</text
      ><text class="page-subtitle">{{
        selectMode ? '选择一个地址，继续刚才的操作' : '管理收货和上门服务地址'
      }}</text
      ><view v-if="error" class="error-banner" @click="load">{{ error }} · 点击重试</view>
      <view
        v-for="a in addresses"
        :key="a.id"
        class="address-card card"
        :class="{ selected: a.id === selectedId }"
        ><view @click="choose(a)"
          ><view class="row-between"
            ><text class="field-label">{{ a.name }} · {{ a.phone }}</text
            ><text class="status-label">{{ a.id === selectedId ? '已选' : '选择' }}</text></view
          ><text class="small muted">{{ a.city }} · {{ a.area }} · {{ a.detail }}</text></view
        ><view class="address-actions"
          ><button class="remove-address" :disabled="busy" @click="remove(a)">
            删除地址
          </button></view
        ></view
      >
      <view class="card"
        ><text class="section-title">添加新地址</text><view class="spacer" /><view class="field"
          ><text class="field-label">联系人</text
          ><input
            class="field-input"
            v-model="form.name"
            maxlength="20"
            placeholder="请输入姓名（至少 2 个字）" /></view
        ><view class="field"
          ><text class="field-label">手机号码</text
          ><input
            class="field-input"
            v-model="form.phone"
            type="number"
            maxlength="11"
            placeholder="请输入 11 位手机号" /></view
        ><view class="field"
          ><text class="field-label">城市</text
          ><view v-if="fixedCity" class="field-picker">{{ fixedCity }}</view
          ><picker
            v-else
            :range="cities"
            :value="Math.max(0, cities.indexOf(form.city))"
            @change="form.city = cities[$event.detail.value]"
            ><view class="field-picker">{{ form.city }} <text class="muted">⌄</text></view></picker
          ></view
        ><view class="field"
          ><text class="field-label">区县</text
          ><input
            class="field-input"
            v-model="form.area"
            maxlength="30"
            :placeholder="fixedCity ? '例如：洛龙区' : '例如：西湖区'" /></view
        ><view class="field"
          ><text class="field-label">详细地址</text
          ><input
            class="field-input"
            v-model="form.detail"
            maxlength="150"
            placeholder="街道、小区、楼栋和门牌号" /></view
        ><view v-if="validation" class="error-banner">{{ validation }}</view
        ><button class="btn full-width" :loading="busy" :disabled="busy" @click="save">
          保存地址
        </button></view
      ><view class="notice">{{
        fixedCity
          ? '请填写实际所在区县与详细地址，上门安排需与服务方确认。'
          : '地址只用于当前体验账号的订单与服务预约。示例门店服务城市为杭州，体验时请填写测试信息。'
      }}</view></view
    ></view
  >
</template>
<script setup>
import { ref, reactive } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import { api, state, toast, showError, confirm, fixedCity } from '../../lib/api';
const cities = fixedCity ? [fixedCity] : ['杭州', '洛阳', '郑州', '成都'],
  selectMode = ref(false),
  addresses = ref([]),
  selectedId = ref(uni.getStorageSync('llj-address')),
  busy = ref(false),
  error = ref(''),
  validation = ref(''),
  form = reactive({ name: '', phone: '', city: state.city, area: '', detail: '' });
async function load() {
  error.value = '';
  try {
    addresses.value = await api('/addresses');
  } catch (e) {
    error.value = e.message;
  }
}
function choose(a) {
  uni.setStorageSync('llj-address', a.id);
  selectedId.value = a.id;
  if (selectMode.value) uni.navigateBack();
  else toast('已设为当前地址');
}
async function save() {
  validation.value = '';
  if (form.name.trim().length < 2) return (validation.value = '请填写至少 2 个字的联系人姓名');
  if (!/^1[3-9]\d{9}$/.test(form.phone)) return (validation.value = '请输入正确的 11 位手机号');
  if (form.area.trim().length < 2 || form.detail.trim().length < 5)
    return (validation.value = '请补充区县及至少 5 个字的详细地址');
  if (busy.value) return;
  busy.value = true;
  try {
    const a = await api('/addresses', { method: 'POST', data: { ...form } });
    uni.setStorageSync('llj-address', a.id);
    selectedId.value = a.id;
    toast('地址已保存');
    if (selectMode.value) uni.navigateBack();
    else {
      Object.assign(form, { name: '', phone: '', area: '', detail: '' });
      await load();
    }
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
  }
}
async function remove(a) {
  if (!(await confirm('删除这个地址？', '已创建订单中的地址信息仍会保留。'))) return;
  busy.value = true;
  try {
    await api('/addresses/' + a.id, { method: 'DELETE' });
    if (selectedId.value === a.id) {
      uni.removeStorageSync('llj-address');
      selectedId.value = '';
    }
    await load();
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
  }
}
onLoad((q) => (selectMode.value = q.select === '1'));
onShow(load);
</script>
<style scoped>
.address-card {
  margin-bottom: 14px;
}
.address-card.selected {
  border-color: #9fbf93;
}
.address-card .field-label {
  margin-bottom: 3px;
}
.address-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 13px;
}
.remove-address {
  font-size: 11px;
  color: #9a9f90;
}
.form > .card:last-of-type {
  margin-top: 22px;
}
.page-title {
  font-size: 25px;
}
</style>
