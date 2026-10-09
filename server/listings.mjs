import { inCommunity } from './community.mjs';

const fail = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
const kinds = new Set(['sale', 'service', 'exchange']);
const conditions = new Set(['全新', '九成新', '八成新', '七成新及以下']);
const itemArts = new Set(['table', 'bike', 'coffee', 'plant', 'bag', 'shirt', 'book']);
const serviceArts = new Set(['repair', 'clean', 'aircon', 'washer', 'coffee', 'book']);
const text = (value, label, min, max) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
    fail(label + '请填写 ' + min + '–' + max + ' 个字');
  return value.trim();
};

export function listingFields(input) {
  const kind = input.kind === undefined ? 'sale' : input.kind;
  if (!kinds.has(kind)) fail('请选择卖闲置、邻里手艺或以物换物');
  const priceMode =
    input.priceMode === undefined
      ? kind === 'exchange'
        ? 'exchange'
        : kind === 'service'
          ? 'negotiable'
          : 'fixed'
      : input.priceMode;
  const allowed =
    kind === 'service'
      ? ['fixed', 'negotiable', 'free']
      : kind === 'exchange'
        ? ['exchange']
        : ['fixed'];
  if (!allowed.includes(priceMode)) fail('计价方式与发布类型不一致');
  if (priceMode === 'fixed') {
    if (!Number.isSafeInteger(input.price) || input.price < 1 || input.price > 10000000)
      fail('价格须在 0.01–100000 元之间');
  } else if (input.price !== undefined && input.price !== 0)
    fail('面议、免费和交换不填写金额，请填写 0 或留空');
  if (!(kind === 'service' ? serviceArts : itemArts).has(input.art)) fail('请选择对应类型的配图');
  if (kind !== 'service' && !conditions.has(input.condition)) fail('请选择物品成色');
  return {
    kind,
    priceMode,
    price: priceMode === 'fixed' ? input.price : 0,
    art: input.art,
    condition: kind === 'service' ? '邻里手艺' : input.condition,
    ...(kind === 'exchange' ? { exchangeFor: text(input.exchangeFor, '想换什么', 2, 120) } : {}),
    ...(kind === 'service' && input.availability !== undefined && input.availability !== ''
      ? { availability: text(input.availability, '可联系或帮忙时间', 2, 80) }
      : {}),
  };
}

export function normalizeListing(item) {
  const kind = kinds.has(item.kind) ? item.kind : 'sale';
  return {
    ...item,
    kind,
    priceMode:
      item.priceMode ||
      (kind === 'exchange' ? 'exchange' : kind === 'service' ? 'negotiable' : 'fixed'),
  };
}

export function listingFeed(values, params) {
  const kind = params.get('kind'),
    city = params.get('city'),
    q = params.get('q')?.trim().slice(0, 100),
    sort = params.get('sort');
  if (kind && !kinds.has(kind)) fail('未知的发布类型');
  values = values
    .map(normalizeListing)
    .filter(
      (item) =>
        (!city || item.city === city) &&
        inCommunity(item, params.get('community')) &&
        (!kind || item.kind === kind) &&
        (!q ||
          [item.title, item.description, item.exchangeFor || '', item.availability || '']
            .join(' ')
            .includes(q)),
    );
  if (sort === 'price')
    values.sort((a, b) => {
      const amount = (item) =>
        item.priceMode === 'fixed' ? item.price : item.priceMode === 'free' ? 0 : Infinity;
      return amount(a) - amount(b);
    });
  if (!params.has('page')) return values;
  const page = Number(params.get('page'));
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail('页码不正确');
  const pageSize = 20;
  return {
    items: values.slice((page - 1) * pageSize, page * pageSize),
    total: values.length,
    page,
    pageSize,
  };
}
