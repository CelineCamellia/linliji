export const listingKinds = [
  { id: 'sale', label: '卖闲置', description: '让家里的好物接着用' },
  { id: 'service', label: '邻里手艺', description: '把会做的事分享给邻居' },
  { id: 'exchange', label: '以物换物', description: '用闲置换一件需要的东西' },
];
export const listingKind = (item) =>
  ['sale', 'service', 'exchange'].includes(item?.kind) ? item.kind : 'sale';
export const kindLabel = (item) =>
  ({ sale: '闲置买卖', service: '邻里手艺', exchange: '以物换物' })[listingKind(item)];
export function priceLabel(item) {
  if (listingKind(item) === 'exchange') return '以物换物';
  if (item.priceMode === 'free') return '免费帮忙';
  if (item.priceMode === 'negotiable') return '费用面议';
  return '¥' + (Number(item.price || 0) / 100).toFixed(2).replace(/\.00$/, '');
}
export const statusLabel = (value) =>
  ({
    available: '展示中',
    reserved: '已有预约',
    withdrawn: '已下架',
    pending: '等待审核',
    rejected: '审核未通过',
  })[value] || value;
