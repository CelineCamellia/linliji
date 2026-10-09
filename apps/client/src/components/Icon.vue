<template>
  <image
    class="ui-icon"
    :src="'/static/icons/' + name + (active ? '-active' : '') + '.png'"
    :style="{ width: size + 'px', height: size + 'px' }"
    mode="aspectFit"
  />
</template>
<script setup>
defineProps({
  name: { type: String, default: 'arrow' },
  size: { type: Number, default: 20 },
  active: Boolean,
});
</script>
