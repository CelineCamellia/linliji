<template>
  <view class="page"
    ><TopBar back :title="editingId ? '修改邻里信息' : '发布邻里信息'" /><view class="form"
      ><text class="page-title">把你的好物和手艺，分享给邻居。</text
      ><text class="page-subtitle">居民自己发布，联系后商量服务或交换细节</text>
      <view class="publish-types"
        ><view
          v-for="type in listingKinds"
          :key="type.id"
          class="publish-type"
          :class="{ selected: form.kind === type.id }"
          @click="selectKind(type.id)"
          ><text>{{ type.label }}</text
          ><text class="type-copy">{{ type.description }}</text></view
        ></view
      >
      <view class="card"
        ><PhotoPicker v-model="photos" :disabled="busy" @busy="uploading = $event" />
        <view class="field"
          ><text class="field-label">选择分类示意图</text
          ><view class="art-options"
            ><view
              v-for="a in arts"
              :key="a.id"
              class="art-option"
              :class="{ active: form.art === a.id }"
              @click="form.art = a.id"
              ><image :src="art(a.id)" mode="aspectFit" /><text>{{ a.label }}</text></view
            ></view
          ><text class="tiny muted">配图为分类插画，请在描述里说明真实情况。</text></view
        >
        <view class="field"
          ><text class="field-label">{{
            form.kind === 'service' ? '你能帮邻居做什么' : '物品名称'
          }}</text
          ><input
            id="publish-title"
            v-model="form.title"
            class="field-input"
            maxlength="40"
            :placeholder="
              form.kind === 'service'
                ? '例如：会修小家电，帮邻居看看'
                : '例如：闲置的书桌或一套图书'
            "
        /></view>
        <view class="field"
          ><text class="field-label">详细描述</text
          ><textarea
            id="publish-description"
            v-model="form.description"
            class="field-textarea"
            maxlength="600"
            :placeholder="
              form.kind === 'service'
                ? '说说你的手艺、能帮哪些忙、服务范围及费用说明（至少 10 个字）'
                : '说说使用情况、有无瑕疵、交接方式（至少 10 个字）'
            "
          />
        </view>
        <view v-if="form.kind === 'service'" class="field"
          ><text class="field-label">费用方式</text
          ><view class="chip-row"
            ><text
              v-for="mode in priceModes"
              :key="mode.id"
              class="chip"
              :class="{ active: form.priceMode === mode.id }"
              @click="form.priceMode = mode.id"
              >{{ mode.label }}</text
            ></view
          ></view
        >
        <view
          v-if="form.kind === 'sale' || (form.kind === 'service' && form.priceMode === 'fixed')"
          class="field"
          ><text class="field-label">{{
            form.kind === 'service' ? '参考费用（元）' : '转让价格（元）'
          }}</text
          ><input
            id="publish-price"
            v-model="priceText"
            class="field-input"
            type="digit"
            maxlength="10"
            placeholder="例如 65.00，具体内容请在描述里说明"
        /></view>
        <view v-if="form.kind === 'exchange'" class="field"
          ><text class="field-label">想换什么</text
          ><textarea
            id="publish-exchange"
            v-model="form.exchangeFor"
            class="field-textarea exchange-field"
            maxlength="120"
            placeholder="例如：想换儿童绘本，也可以商量其他物品"
          />
        </view>
        <view v-if="form.kind === 'service'" class="field"
          ><text class="field-label">可联系或帮忙时间（选填）</text
          ><input
            id="publish-availability"
            v-model="form.availability"
            class="field-input"
            maxlength="80"
            placeholder="例如：周末白天，请先电话联系"
        /></view>
        <view v-if="form.kind !== 'service'" class="field"
          ><text class="field-label">物品成色</text
          ><picker :range="conditions" @change="form.condition = conditions[$event.detail.value]"
            ><view class="field-picker">{{ form.condition }} ⌄</view></picker
          ></view
        >
        <view class="field"
          ><text class="field-label">所在城市</text
          ><input
            id="publish-city"
            v-model="form.city"
            class="field-input"
            maxlength="30"
            placeholder="例如：洛阳"
        /></view>
        <view class="field"
          ><text class="field-label">所属社区 / 群</text
          ><input
            id="publish-community"
            v-model="form.community"
            class="field-input"
            maxlength="30"
            placeholder="填写你所在的社区或群名称"
          /><view class="chip-row community-shortcuts"
            ><text
              v-for="name in communityNames"
              :key="name"
              class="chip"
              :class="{ active: form.community === name }"
              @click="form.community = name"
              >{{ name }}</text
            ></view
          ><text class="tiny muted">同一社区或群请使用相同名称，方便邻居找到。</text></view
        >
        <view class="field"
          ><text class="field-label">所在区县</text
          ><input
            id="publish-area"
            v-model="form.area"
            class="field-input"
            maxlength="30"
            placeholder="例如：洛龙区"
        /></view>
        <view class="field"
          ><text class="field-label">联系手机号</text
          ><input
            id="publish-phone"
            v-model="form.phone"
            class="field-input"
            maxlength="11"
            type="number"
            placeholder="感兴趣的邻居可通过此号码联系你"
        /></view>
        <view class="consent" @click="consent = !consent"
          ><view class="consent-box" :class="{ checked: consent }">{{ consent ? '✓' : '' }}</view
          ><text>我确认描述属实，并同意向主动联系的已登录用户提供此手机号。</text></view
        ><view v-if="validation" class="error-banner">{{ validation }}</view
        ><button
          class="btn full-width"
          :loading="busy"
          :disabled="busy || uploading"
          @click="submit"
        >
          {{ editingId ? '保存并重新审核' : '提交发布' }}
        </button> </view
      ><view class="notice"
        >{{
          isRelease
            ? '发布内容经人工审核后展示，可在“我的发布”查看结果。'
            : '当前连接本机开发服务。'
        }}请明确描述服务范围或物品状态；暂不提供在线付款。</view
      ></view
    ></view
  >
</template>
<script setup>
import { ref, reactive, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import TopBar from '../../components/TopBar.vue';
import PhotoPicker from '../../components/PhotoPicker.vue';
import { api, art, state, toast, showError, tab, isRelease } from '../../lib/api';
import { communities } from '../../config/communities';
import { listingKinds } from '../../lib/listing';
const communityNames = computed(() => [
    ...communities.filter((item) => item.city === form.city).map((item) => item.name),
    '全市',
  ]),
  conditions = ['全新', '九成新', '八成新', '七成新及以下'];
const itemArts = [
    { id: 'table', label: '家具' },
    { id: 'bike', label: '出行' },
    { id: 'coffee', label: '家电' },
    { id: 'plant', label: '绿植' },
    { id: 'bag', label: '箱包' },
    { id: 'shirt', label: '服装' },
    { id: 'book', label: '图书' },
  ],
  serviceArts = [
    { id: 'repair', label: '维修安装' },
    { id: 'clean', label: '清洁整理' },
    { id: 'aircon', label: '空调' },
    { id: 'washer', label: '家电' },
    { id: 'book', label: '其他手艺' },
  ],
  priceModes = [
    { id: 'negotiable', label: '费用面议' },
    { id: 'fixed', label: '固定价格' },
    { id: 'free', label: '免费帮忙' },
  ];
const form = reactive({
    kind: 'sale',
    priceMode: 'fixed',
    title: '',
    description: '',
    art: 'table',
    condition: '九成新',
    city: state.city,
    community: state.community || '',
    area: '',
    phone: '',
    exchangeFor: '',
    availability: '',
  }),
  priceText = ref(''),
  consent = ref(false),
  busy = ref(false),
  validation = ref('');
const photos = ref([]),
  uploading = ref(false),
  editingId = ref('');
const arts = computed(() => (form.kind === 'service' ? serviceArts : itemArts));
function selectKind(kind) {
  if (busy.value || !listingKinds.some((item) => item.id === kind)) return;
  form.kind = kind;
  form.priceMode = kind === 'exchange' ? 'exchange' : kind === 'service' ? 'negotiable' : 'fixed';
  if (!arts.value.some((item) => item.id === form.art)) form.art = arts.value[0].id;
  validation.value = '';
}
onLoad(async (q) => {
  if (q.kind) selectKind(q.kind);
  if (q.id) {
    busy.value = true;
    try {
      const item = await api('/listings/' + encodeURIComponent(q.id));
      if (!item.owned) throw new Error('只能修改自己的发布');
      editingId.value = item.id;
      for (const name of Object.keys(form)) if (item[name] !== undefined) form[name] = item[name];
      photos.value = item.photos || [];
      priceText.value = String(item.price / 100);
      consent.value = true;
    } catch (e) {
      validation.value = e.message;
    } finally {
      busy.value = false;
    }
  }
});
async function submit() {
  if (busy.value || uploading.value) return;
  validation.value = '';
  if (form.title.trim().length < 4) return (validation.value = '标题至少填写 4 个字');
  if (form.description.trim().length < 10)
    return (validation.value = '请至少用 10 个字说明真实情况');
  if (
    form.priceMode === 'fixed' &&
    (!/^\d{1,6}(\.\d{1,2})?$/.test(priceText.value) ||
      Number(priceText.value) <= 0 ||
      Number(priceText.value) > 100000)
  )
    return (validation.value = '价格须在 0.01–100000 元之间，最多两位小数');
  if (form.kind === 'exchange' && form.exchangeFor.trim().length < 2)
    return (validation.value = '请说明你想换什么，至少 2 个字');
  if (form.kind === 'service' && form.availability && form.availability.trim().length < 2)
    return (validation.value = '可联系时间请至少填写 2 个字，或留空');
  if (!/^[\p{L}\p{N} ·.-]{2,30}$/u.test(form.city.trim()))
    return (validation.value = '请填写 2–30 字的城市名称');
  if (!form.community.trim()) return (validation.value = '请填写所属社区或群名称');
  if (form.area.trim().length < 2) return (validation.value = '请填写所在区县');
  if (!/^1[3-9]\d{9}$/.test(form.phone)) return (validation.value = '请填写正确的 11 位手机号');
  if (!consent.value) return (validation.value = '发布前请确认描述与联系方式授权');
  busy.value = true;
  try {
    await api('/listings' + (editingId.value ? '/' + editingId.value : ''), {
      method: editingId.value ? 'PATCH' : 'POST',
      data: {
        ...form,
        photos: photos.value.map((p) => p.id),
        phoneSharingConsent: consent.value,
        price: form.priceMode === 'fixed' ? Math.round(Number(priceText.value) * 100) : 0,
      },
    });
    uni.setStorageSync('llj-mine', true);
    toast(isRelease ? '已提交，审核后展示' : '发布成功');
    tab('market');
  } catch (e) {
    showError(e);
  } finally {
    busy.value = false;
  }
}
</script>
<style scoped>
.publish-types {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
  margin: 24px 0 18px;
}
.publish-type {
  padding: 15px 10px;
  border: 1px solid #dce4d4;
  background: #f3f5ed;
  border-radius: 14px;
  color: #60754f;
  font-size: 14px;
}
.publish-type.selected {
  border-color: #146b53;
  background: #e8f1e1;
  color: #146b53;
}
.type-copy {
  display: block;
  font-size: 10px;
  margin-top: 5px;
  line-height: 1.6;
}
.art-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.art-option {
  width: 72px;
  border: 2px solid transparent;
  border-radius: 13px;
  background: #f3f5ed;
  padding: 4px;
  overflow: hidden;
  text-align: center;
}
.art-option.active {
  border-color: #77a26b;
}
.art-option image {
  width: 60px;
  height: 60px;
  border-radius: 8px;
}
.art-option text {
  font-size: 10px;
}
.consent {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 22px 0;
  color: #6b775f;
  font-size: 12px;
}
.consent-box {
  width: 19px;
  height: 19px;
  flex-shrink: 0;
  border: 1px solid #b9c6af;
  border-radius: 5px;
  line-height: 17px;
  text-align: center;
}
.consent-box.checked {
  background: #146b53;
  color: white;
  border-color: #146b53;
}
.page-title {
  font-size: 25px;
}
.community-shortcuts {
  margin: 12px 0;
}
.community-shortcuts .chip {
  font-size: 11px;
}
.exchange-field {
  height: 90px;
}
@media (max-width: 700px) {
  .page-title {
    font-size: 23px;
  }
  .publish-type {
    font-size: 13px;
    padding: 13px 8px;
  }
}
</style>
