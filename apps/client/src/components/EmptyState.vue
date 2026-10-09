<template>
  <view class="empty-state"
    ><image src="/static/art/plant.png" mode="aspectFit" /><text class="empty-title">{{
      title || '这里还空着，去附近逛逛吧'
    }}</text
    ><text class="muted">{{ description }}</text
    ><button v-if="action" class="btn secondary" @click="$emit('action')">
      {{ action }}
    </button></view
  >
</template>
<script setup>
defineProps({ title: String, description: String, action: String });
defineEmits(['action']);
</script>
