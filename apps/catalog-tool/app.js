const $ = id => document.getElementById(id);
const form = $('catalog-form');
const field = name => form.elements.namedItem(name);
const arts = {
  service: [['repair', '工具 / 维修'], ['aircon', '空调'], ['washer', '洗衣机'], ['clean', '清洁']],
  farm: [['tomato', '番茄'], ['lettuce', '蔬菜'], ['orange', '水果'], ['eggs', '鸡蛋'], ['corn', '玉米'], ['carrot', '胡萝卜']],
  clothes: [['shirt', '上衣'], ['bag', '包袋'], ['blouse', '衬衫'], ['shoe', '鞋'], ['cardigan', '针织'], ['cap', '帽子']]
};
let items = [], editing = null, dirty = false, formDirty = false, ready = false, saving = false;
const message = (id, text) => { $(id).textContent = text; $(id).hidden = !text; };
const textNode = (tag, text, cls) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
function setBusiness(selectedArt) {
  const service = field('business').value === 'service';
  $('service-fields').hidden = !service;
  $('product-fields').hidden = service;
  field('duration').disabled = !service;
  field('duration').required = service;
  for (const name of ['stock', 'options']) {
    field(name).disabled = service;
    field(name).required = !service;
  }
  field('art').replaceChildren(...arts[field('business').value].map(([value, label]) => new Option(label, value)));
  if (selectedArt) field('art').value = selectedArt;
}
function resetForm() {
  form.reset();
  editing = null;
  formDirty = false;
  setBusiness();
  $('form-title').textContent = '填写一条资料';
  $('add').textContent = '加入资料表 ＋';
  message('form-error', '');
}
function render() {
  $('count').textContent = items.length + ' 条';
  $('empty').hidden = items.length > 0;
  $('items').replaceChildren(...items.map((item, index) => {
    const li = document.createElement('li');
    li.className = 'item';
    const img = document.createElement('img');
    img.src = '/art/' + item.art + '.png';
    img.alt = '';
    const body = document.createElement('div');
    body.className = 'item-body';
    const name = item.kind === 'service' ? '维修' : item.category === 'farm' ? '生鲜' : '服装';
    body.append(textNode('h3', item.title), textNode('p', name + ' · ' + item.shop), textNode('p', item.city + ' · ' + item.area));
    const bottom = document.createElement('div');
    bottom.className = 'item-bottom';
    bottom.append(textNode('span', '¥' + (item.price / 100).toFixed(2) + ' / ' + item.unit, 'price'));
    const actions = document.createElement('div');
    actions.className = 'actions';
    const edit = textNode('button', '修改');
    edit.type = 'button';
    edit.setAttribute('aria-label', '修改 ' + item.title);
    edit.addEventListener('click', () => editItem(index));
    const remove = textNode('button', '移除', 'remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', '移除 ' + item.title);
    remove.addEventListener('click', () => {
      if (!confirm('从当前资料表移除“' + item.title + '”？之前已保存的文件仍会保留。')) return;
      if (editing === index) resetForm();
      else if (editing !== null && editing > index) editing--;
      items.splice(index, 1);
      dirty = true;
      message('save-result', '');
      render();
    });
    actions.append(edit, remove);
    bottom.append(actions);
    body.append(bottom);
    li.append(img, body);
    return li;
  }));
  $('save').disabled = !ready || saving || (!items.length && !dirty);
  $('add').disabled = !ready || saving;
  if (ready) $('status').textContent = dirty ? '资料表有修改，记得保存到 E 盘。' : items.length ? '已载入保存资料，可以继续添加或修改。' : '添加真实资料后，即可保存。';
}
function editItem(index) {
  if (formDirty && !confirm('当前填写的内容还没加入资料表，放弃这些填写并修改所选资料？')) return;
  resetForm();
  const item = items[index];
  editing = index;
  field('business').value = item.kind === 'service' ? 'service' : item.category;
  setBusiness(item.art);
  for (const name of ['shop', 'title', 'subtitle', 'description', 'unit', 'city', 'area', 'phone']) field(name).value = item[name];
  field('community').value = item.community || '';
  field('price').value = (item.price / 100).toFixed(2);
  field('consent').checked = item.phoneSharingConsent === true;
  if (item.kind === 'service') field('duration').value = item.duration;
  else { field('stock').value = item.stock; field('options').value = item.options.join('\n'); }
  $('form-title').textContent = '修改资料';
  $('add').textContent = '更新这条资料';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  field('title').focus({ preventScroll: true });
}
field('business').addEventListener('change', () => setBusiness());
field('city').addEventListener('change', () => { field('area').value = ''; });
form.addEventListener('input', () => { formDirty = true; message('form-error', ''); });
form.addEventListener('change', () => { formDirty = true; message('form-error', ''); });
$('reset').addEventListener('click', () => {
  if (formDirty && !confirm('放弃当前尚未加入资料表的填写内容？')) return;
  resetForm();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  if (!ready || saving) return;
  if (!form.reportValidity()) return;
  try {
    if (editing === null && items.length >= 500) throw Error('每份资料最多 500 条，请先保存。');
    const get = name => field(name).value.trim();
    const amount = get('price');
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(amount)) throw Error('价格最多保留两位小数。');
    const [whole, fraction = ''] = amount.split('.');
    const price = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (price < 1 || price > 10000000) throw Error('价格须在 0.01–100000 元之间。');
    const service = get('business') === 'service';
    const item = {
      kind: service ? 'service' : 'product',
      id: editing === null ? (service ? 'service-' : 'product-') + crypto.randomUUID() : items[editing].id,
      title: get('title'), subtitle: get('subtitle'), description: get('description'), city: get('city'),
      area: get('area'), ...(get('community') ? {community:get('community')} : {}), shop: get('shop'), price, unit: get('unit'), art: get('art'),
      phone: get('phone'), phoneSharingConsent: field('consent').checked
    };
    for (const name of ['title', 'subtitle', 'description', 'area', 'shop', 'unit']) if (!item[name]) throw Error('请完整填写资料，内容不能只有空格。');
    if (!/^1[3-9]\d{9}$/.test(item.phone) || !item.phoneSharingConsent) throw Error('请填写正确的手机号并确认展示授权。');
    if (service) {
      item.duration = get('duration');
      if (!item.duration) throw Error('请填写预计服务时长。');
    } else {
      item.category = get('business');
      item.stock = Number(get('stock'));
      if (!/^\d+$/.test(get('stock')) || !Number.isSafeInteger(item.stock) || item.stock > 100000) throw Error('库存须为 0–100000 的整数。');
      item.options = get('options').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!item.options.length || item.options.length > 20 || item.options.some(s => s.length > 30)) throw Error('请填写 1–20 项规格，每项最多 30 个字。');
    }
    if (editing === null) items.push(item);
    else items[editing] = item;
    dirty = true;
    resetForm();
    message('save-result', '');
    render();
  } catch (error) { message('form-error', error.message); }
});
$('save').addEventListener('click', async () => {
  if (formDirty) {
    message('form-error', '正在填写的内容尚未加入资料表，请先点击“加入资料表”或“更新这条资料”，再保存。');
    $('form-error').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (saving || (!items.length && !dirty)) return;
  saving = true;
  render();
  $('save').textContent = '正在保存…';
  message('save-result', '');
  message('connection-error', '');
  try {
    const response = await fetch('/api/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '保存失败');
    dirty = false;
    message('save-result', '已保存 ' + result.count + ' 条资料：' + result.path);
  } catch (error) {
    message('connection-error', '保存未完成：' + (error instanceof TypeError ? '本机工具连接已中断，请重新打开工具。当前资料仍在此页面中。' : error.message));
  } finally {
    saving = false;
    $('save').textContent = '保存到 E 盘';
    render();
  }
});
window.addEventListener('beforeunload', event => {
  if (dirty || formDirty) { event.preventDefault(); event.returnValue = ''; }
});
setBusiness();
async function initialize() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    if (!response.ok || status.tool !== 'linliji-catalog-drafts') throw Error('未连接到商家资料工具。');
    $('directory').textContent = status.directory;
    const latest = await fetch('/api/latest');
    const data = await latest.json();
    if (!latest.ok) throw Error(data.error || '无法读取已有资料。');
    items = data.items;
    ready = true;
    render();
  } catch (error) {
    message('connection-error', '工具启动未完成：' + error.message + ' 请通过项目中的“填写商家资料.cmd”重新打开。');
    $('status').textContent = '连接未完成，暂不能保存。';
  }
}
initialize();
