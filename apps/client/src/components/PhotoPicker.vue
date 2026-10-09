<template>
  <view class="field">
    <text class="field-label">实物或服务照片（选填）</text>
    <view class="photos">
      <view v-for="(photo, index) in modelValue" :key="photo.id" class="photo">
        <image :src="mediaUrl(photo.url)" mode="aspectFill" @click="preview(index)" />
        <button
          class="remove"
          :disabled="busy || disabled"
          @click="remove(index)"
          aria-label="移除照片"
        >
          ×
        </button>
      </view>
      <button
        v-if="modelValue.length < 4"
        class="choose"
        :disabled="busy || disabled"
        @click="choose"
      >
        {{ busy ? '上传中…' : '＋ 添加照片' }}
      </button>
    </view>
    <text class="tiny muted">最多 4 张，每张不超过 5 MB。请勿上传证件、家庭住址或他人隐私。</text>
    <text v-if="error" class="error-banner">{{ error }}</text>
  </view>
</template>
<script setup>
import { ref } from 'vue';
import { uploadPhoto, mediaUrl } from '../lib/api';
const props = defineProps({ modelValue: { type: Array, default: () => [] }, disabled: Boolean });
const emit = defineEmits(['update:modelValue', 'busy']);
const busy = ref(false),
  error = ref('');
function remove(index) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  );
}
function preview(index) {
  uni.previewImage({ urls: props.modelValue.map((p) => mediaUrl(p.url)), current: index });
}
async function choose() {
  if (busy.value || props.disabled) return;
  error.value = '';
  busy.value = true;
  emit('busy', true);
  try {
    const result = await new Promise((resolve, reject) =>
      uni.chooseImage({
        count: 4 - props.modelValue.length,
        sizeType: ['compressed'],
        sourceType: ['album'],
        success: resolve,
        fail: reject,
      }),
    );
    const photos = [...props.modelValue];
    for (let i = 0; i < result.tempFilePaths.length && photos.length < 4; i++) {
      if (result.tempFiles?.[i]?.size > 5 * 1024 * 1024) throw new Error('每张照片不能超过 5 MB');
      photos.push(await uploadPhoto(result.tempFilePaths[i]));
      emit('update:modelValue', [...photos]);
    }
  } catch (e) {
    if (!String(e.errMsg || '').includes('cancel'))
      error.value = e.message || '未能读取照片，请重试';
  } finally {
    busy.value = false;
    emit('busy', false);
  }
}
</script>
<style scoped>
.photos {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 12px 0;
}
.photo {
  position: relative;
  width: 100px;
  height: 100px;
}
.photo image {
  width: 100%;
  height: 100%;
  border-radius: 12px;
}
.remove {
  position: absolute;
  right: -6px;
  top: -6px;
  width: 25px;
  height: 25px;
  line-height: 22px;
  padding: 0;
  border-radius: 50%;
  background: #263e32;
  color: white;
  font-size: 20px;
}
.choose {
  width: 100px;
  height: 100px;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #edf3e6;
  border: 1px dashed #9caf98;
  color: #146b53;
  font-size: 12px;
  line-height: 1.5;
  padding: 8px;
}
</style>
