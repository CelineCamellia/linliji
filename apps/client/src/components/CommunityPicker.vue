<template>
  <view class="community-panel">
    <view class="community-heading"
      ><view
        ><text class="community-eyebrow">{{ state.city }}街坊 · 身边的人</text
        ><text class="community-title">{{ state.community || '先逛逛你的社区' }}</text></view
      ><text class="peony-mark">邻</text></view
    >
    <view class="community-options"
      ><button class="community-option" :class="{ selected: !state.community }" @click="choose('')">
        全{{ state.city }}</button
      ><button
        v-for="item in localExamples.slice(0, 2)"
        :key="item.name"
        class="community-option"
        :class="{ selected: state.community === item.name }"
        @click="choose(item.name)"
      >
        {{ item.name }}</button
      ><button class="community-option" @click="toggle">
        {{ expanded ? '收起' : '查找社区 / 群' }}
      </button></view
    >
    <view v-if="expanded" class="community-search">
      <input
        v-model="query"
        maxlength="30"
        class="field-input"
        placeholder="输入社区或群名称"
        confirm-type="search"
        @confirm="useQuery"
      />
      <view v-if="loading" class="community-caption">正在读取社区…</view
      ><text v-if="error" class="community-caption">{{ error }}</text>
      <view class="community-options"
        ><button
          v-for="name in matches.slice(0, limit)"
          :key="name"
          class="community-option"
          :class="{ selected: state.community === name }"
          @click="choose(name)"
        >
          {{ name }}
        </button></view
      >
      <button v-if="matches.length > limit" class="community-option" @click="limit += 12">
        更多社区
      </button>
      <button v-if="query.trim()" class="community-option use-community" @click="useQuery">
        按「{{ query.trim() }}」查看
      </button>
      <text class="community-caption"
        >找不到也可以直接输入名称；发布时填写同一个名称，就能在这里找到。</text
      >
    </view>
    <view v-if="selected && selected.groupName" class="community-info"
      ><text>{{ selected.groupName }}</text
      ><text v-if="selected.memberCount !== null">{{ selected.memberCount }} 人</text
      ><text v-if="selected.activity">{{ selected.activity }}</text
      ><text v-if="selected.asOf">群管理员提供 · {{ selected.asOf }}</text></view
    >
    <text v-else class="community-caption">{{
      state.community
        ? '查看这个社区及覆盖全市的邻里信息'
        : '会修东西、有物想卖、想找人交换，都能自己发布'
    }}</text>
  </view>
</template>
<script setup>
import { computed, ref, watch } from 'vue';
import { state, setCommunity, api } from '../lib/api';
import { communities } from '../config/communities';
let requestId = 0;
const expanded = ref(false),
  query = ref(''),
  names = ref([]),
  loading = ref(false),
  error = ref(''),
  limit = ref(12);
const localExamples = computed(() => communities.filter((item) => item.city === state.city));
const selected = computed(() => localExamples.value.find((item) => item.name === state.community));
const matches = computed(() =>
  [
    ...new Set([
      ...localExamples.value.map((item) => item.name),
      ...names.value,
      ...(state.community ? [state.community] : []),
    ]),
  ].filter((name) => name.includes(query.value.trim())),
);
watch(
  () => state.city,
  () => {
    requestId++;
    loading.value = false;
    names.value = [];
    query.value = '';
    expanded.value = false;
  },
);
function choose(name) {
  setCommunity(name);
  expanded.value = false;
}
function useQuery() {
  if (query.value.trim()) choose(query.value.trim());
}
async function toggle() {
  expanded.value = !expanded.value;
  if (!expanded.value) return;
  limit.value = 12;
  error.value = '';
  loading.value = true;
  const id = ++requestId;
  try {
    const result = await api('/public/communities?city=' + encodeURIComponent(state.city), {
      public: true,
    });
    if (id === requestId) names.value = result;
  } catch {
    if (id === requestId) error.value = '暂时无法读取列表，仍可输入社区名称查找。';
  } finally {
    if (id === requestId) loading.value = false;
  }
}
</script>
<style scoped>
.community-panel {
  margin-top: 18px;
  padding: 20px;
  border: 1px solid #e7dfcd;
  border-radius: 20px;
  background: linear-gradient(125deg, #fffaf0, #f4f3e4);
}
.community-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.community-eyebrow {
  display: block;
  font-size: 10px;
  letter-spacing: 1px;
  color: #968460;
}
.community-title {
  display: block;
  font-size: 20px;
  font-weight: 700;
  color: #4d6242;
  margin-top: 7px;
  overflow-wrap: anywhere;
}
.peony-mark {
  flex-shrink: 0;
  width: 43px;
  height: 43px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #cda897;
  border-radius: 15px 19px 14px 20px;
  font-size: 24px;
  color: #a46758;
  background: #f4e6dc;
  transform: rotate(-6deg);
}
.community-options {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin: 17px 0 12px;
}
.community-option {
  margin: 0;
  padding: 8px 14px;
  border: 1px solid #dedfcd;
  border-radius: 24px;
  background: #fffdf7;
  color: #718061;
  font-size: 12px;
  line-height: 1.5;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.community-option.selected,
.use-community {
  background: #146b53;
  color: white;
  border-color: #146b53;
}
.community-caption {
  display: block;
  font-size: 11px;
  line-height: 1.7;
  color: #74795f;
  margin-top: 10px;
}
.community-info {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-size: 11px;
  color: #7f876d;
}
.community-search {
  border-top: 1px solid #e4e2d2;
  padding-top: 14px;
}
.use-community {
  margin: 12px 0;
}
</style>
