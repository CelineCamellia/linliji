<template>
  <view class="page"
    ><TopBar back title="预约上门服务" /><view class="form"
      ><view v-if="error" class="error-banner" @click="load">{{ error }} · 点击重试</view
      ><view v-if="service"
        ><view class="service-card"
          ><image class="service-art" :src="art(service.art)" mode="aspectFit" /><view
            class="service-content"
            ><text class="service-title">{{ service.title }}</text
            ><text class="service-subtitle">{{ service.subtitle }}</text
            ><text class="currency">¥</text><text class="price">{{ money(service.price) }}</text
            ><text class="small muted"> / {{ service.unit }}</text></view
          ></view
        ><view class="notice">{{ service.description }}</view
        ><view class="spacer" /><view v-if="isRelease" class="card"
          ><view class="notice">请先联系服务商，确认服务范围、报价和上门时间。</view
          ><button class="btn full-width" @click="contactService">联系服务商</button></view
        ><view v-else class="card"
          ><text class="field-label">上门地址</text
          ><view class="selected-address" @click="go('/pages/addresses/index?select=1')"
            ><text>{{ address ? address.name + ' · ' + address.phone : '添加上门地址 →' }}</text
            ><view v-if="address" class="address-detail"
              >{{ address.city }}{{ address.area }}{{ address.detail }}</view
            ><view class="address-detail">点击更换地址 →</view></view
          ><view class="field"
            ><text class="field-label">预约日期</text
            ><picker
              mode="date"
              :value="date"
              :start="minDate"
              :end="maxDate"
              @change="date = $event.detail.value"
              ><view class="field-picker">{{ date }} <text class="muted">⌄</text></view></picker
            ></view
          ><view class="field"
            ><text class="field-label">上门时段</text
            ><view class="chip-row"
              ><text
                v-for="s in slots"
                :key="s"
                class="chip"
                :class="{ active: slot === s }"
                @click="slot = s"
                >{{ s }}</text
              ></view
            ></view
          ><view class="field"
            ><text class="field-label">需要什么帮助？</text
            ><textarea
              class="field-textarea"
              v-model="note"
              maxlength="500"
              placeholder="请描述问题、设备型号或需要注意的事项（选填）"
            /></view
          ><view class="summary-row"
            ><text>预计服务时长</text><text>{{ service.duration }}</text></view
          ><view class="summary-row"
            ><text>参考起步价</text><text>¥{{ money(service.price) }}</text></view
          ><view class="notice"
            >具体费用需服务前确认。当前仅保存体验预约，不会通知真实师傅或安排上门。</view
          ><view class="spacer" /><button
            class="btn full-width"
            :loading="busy"
            :disabled="busy"
            @click="submit"
          >
            提交体验预约
          </button></view
        ></view
      ><view v-else-if="!error" class="loading">正在加载服务…</view></view
    ></view
  >
</template>
<script setup>
import { ref } from 'vue';
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import {
  api,
  art,
  money,
  go,
  tab,
  toast,
  showError,
  selectedAddress,
  key,
  tomorrow,
  state,
  applySharedCity,
  isRelease,
  confirm,
} from '../../lib/api';
import { friendShare, setShareMenu } from '../../lib/share';
const service = ref(null),
  id = ref(''),
  address = ref(null),
  date = ref(tomorrow()),
  minDate = tomorrow(),
  maxDate = tomorrow(30),
  slots = ['09:00–12:00', '13:00–17:00', '18:00–20:00'],
  slot = ref(slots[0]),
  note = ref(''),
  busy = ref(false),
  error = ref('');
let requestKey = key();
async function load() {
  setShareMenu({ enabled: false });
  if (!id.value) return;
  error.value = '';
  try {
    const [s, a] = await Promise.all([
      api('/services', { public: true }),
      isRelease ? Promise.resolve([]) : api('/addresses'),
    ]);
    service.value = s.find((x) => x.id === id.value);
    if (!service.value) throw new Error('服务不存在');
    address.value = selectedAddress(a);
    setShareMenu({ timeline: false });
  } catch (e) {
    error.value = e.message;
  }
}
async function contactService() {
  try {
    const r = await api('/services/' + id.value + '/contact');
    if (await confirm('联系服务商', '是否拨打 ' + r.phone + '？请先确认费用和服务安排。'))
      uni.makePhoneCall({ phoneNumber: r.phone, fail: () => toast('可手动拨打：' + r.phone) });
  } catch (e) {
    showError(e);
  }
}
async function submit() {
  if (!address.value) {
    toast('请先添加上门地址');
    return go('/pages/addresses/index?select=1');
  }
  if (busy.value) return;
  busy.value = true;
  try {
    await api('/bookings', {
      method: 'POST',
      key: requestKey,
      data: {
        serviceId: id.value,
        addressId: address.value.id,
        date: date.value,
        slot: slot.value,
        note: note.value,
      },
    });
    requestKey = key();
    toast('体验预约已保存');
    tab('orders');
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
  }
}
// #ifdef MP-WEIXIN
onShareAppMessage(() => friendShare('booking', { city: state.city, item: service.value }));
// #endif
onLoad((q) => {
  applySharedCity(q.city);
  id.value = q.id || '';
});
onShow(load);
</script>
