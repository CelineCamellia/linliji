import { communityValue } from './community.mjs';
const text = (v, label, max = 100) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    throw Error(label + '不能为空且不能超过 ' + max + ' 字');
  return v.trim();
};
const arts = new Set([
  'tomato',
  'lettuce',
  'orange',
  'eggs',
  'corn',
  'carrot',
  'shirt',
  'bag',
  'blouse',
  'shoe',
  'cardigan',
  'cap',
  'aircon',
  'repair',
  'washer',
  'clean',
]);
export function validateCatalog(input) {
  if (!Array.isArray(input) || !input.length || input.length > 500)
    throw Error('资料应为 1–500 条记录的 JSON 数组');
  const items = input.map((value) => {
    if (!value || !['product', 'service'].includes(value.kind))
      throw Error('kind 必须是 product 或 service');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value.id || ''))
      throw Error('id 必须为 1–64 位字母数字、下划线或横线');
    if (!Number.isSafeInteger(value.price) || value.price < 1 || value.price > 10000000)
      throw Error('price 以分为单位，须为正整数且不超过 10000000');
    if (!/^1[3-9]\d{9}$/.test(value.phone || ''))
      throw Error('phone 需为商家已授权展示的 11 位手机号');
    if (value.phoneSharingConsent !== true)
      throw Error('请取得商家联系信息展示授权并设置 phoneSharingConsent=true');
    if (!['杭州', '洛阳', '郑州', '成都'].includes(value.city))
      throw Error('city 需为应用当前支持的城市');
    if (!arts.has(value.art)) throw Error('art 不是可用插画名称');
    const data = {
      id: value.id,
      title: text(value.title, 'title', 40),
      subtitle: text(value.subtitle, 'subtitle'),
      description: text(value.description, 'description', 1000),
      city: value.city,
      area: text(value.area, 'area', 30),
      shop: text(value.shop, 'shop', 50),
      price: value.price,
      unit: text(value.unit, 'unit', 30),
      art: value.art,
      tag: '同城信息',
      demo: false,
    };
    const community = communityValue(value.community);
    if (community) data.community = community;
    if (value.kind === 'product') {
      if (!['farm', 'clothes'].includes(value.category))
        throw Error('商品 category 为 farm 或 clothes');
      if (!Number.isSafeInteger(value.stock) || value.stock < 0 || value.stock > 100000)
        throw Error('stock 为 0–100000 的整数');
      if (!Array.isArray(value.options) || !value.options.length || value.options.length > 20)
        throw Error('商品需填写 1–20 项 options 规格');
      data.options = value.options.map((v) => text(v, '规格', 30));
      data.category = value.category;
      data.stock = value.stock;
    } else data.duration = text(value.duration, 'duration', 50);
    return { kind: value.kind, data, phone: value.phone };
  });
  const keys = items.map((v) => v.kind + ':' + v.data.id);
  if (new Set(keys).size !== keys.length) throw Error('同一次导入中存在重复编号');
  return items;
}

export function importCatalog(db, input) {
  const items = validateCatalog(input);
  db.exec('BEGIN IMMEDIATE');
  try {
    // Insert only: overwriting a published offer requires a deliberate removal first.
    for (const { kind, data, phone } of items) {
      if (kind === 'product')
        db.prepare('INSERT INTO products VALUES(?,?,?)').run(
          data.id,
          JSON.stringify(data),
          data.stock,
        );
      else db.prepare('INSERT INTO services VALUES(?,?)').run(data.id, JSON.stringify(data));
      db.prepare('INSERT INTO catalog_contacts VALUES(?,?,?)').run(kind, data.id, phone);
    }
    db.exec('COMMIT');
    return { imported: items.length };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
