<template>
  <view
    class="market-card neighbor-card"
    @click="go('/pages/detail/index?kind=market&id=' + item.id)"
  >
    <image
      :src="item.photos?.length ? mediaUrl(item.photos[0].url) : art(item.art)"
      :mode="item.photos?.length ? 'aspectFill' : 'aspectFit'"
    />
    <view class="market-card-content">
      <text class="kind-tag">{{ kindLabel(item) }}</text
      ><text class="market-title">{{ item.title }}</text>
      <view class="row-between"
        ><text class="neighbor-price">{{ priceLabel(item) }}</text
        ><text v-if="listingKind(item) !== 'service'" class="status-label">{{
          item.condition
        }}</text></view
      >
      <text v-if="item.exchangeFor" class="extra-copy">想换：{{ item.exchangeFor }}</text>
      <text v-if="item.availability" class="extra-copy">时间：{{ item.availability }}</text>
      <view class="market-user"
        ><text>{{ item.nickname }}</text
        ><text>{{ item.community || item.area }}</text></view
      >
      <view v-if="mine" class="notice"
        >{{ statusLabel(item.status) }}{{ item.review ? ' · ' + item.review : '' }}</view
      >
    </view>
  </view>
</template>
<script setup>
import { art, go, mediaUrl } from '../lib/api';
import { kindLabel, listingKind, priceLabel, statusLabel } from '../lib/listing';
defineProps({ item: { type: Object, required: true }, mine: Boolean });
</script>
<style scoped>
.neighbor-card {
  min-width: 0;
}
.kind-tag {
  display: inline-block;
  font-size: 10px;
  color: #54734d;
  background: #edf2e5;
  border-radius: 8px;
  padding: 3px 7px;
  margin-bottom: 7px;
}
.neighbor-price {
  color: #b16d43;
  font-size: 17px;
  font-weight: 700;
}
.extra-copy {
  display: block;
  font-size: 11px;
  line-height: 1.7;
  color: #7a876e;
  margin-top: 8px;
  overflow-wrap: anywhere;
}
.market-user {
  gap: 8px;
  flex-wrap: wrap;
}
.market-user text {
  overflow-wrap: anywhere;
}
.market-title {
  overflow-wrap: anywhere;
}
.notice {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
