export function communityValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 30)
    throw Object.assign(new Error('社区名称须为 1–30 个字'), { status: 400 });
  return value.trim();
}

export function inCommunity(item, selected) {
  if (!selected) return true;
  return (
    item.community === selected ||
    item.community === '全市' ||
    item.community === '全' + item.city ||
    (!item.community && item.area === selected)
  );
}
