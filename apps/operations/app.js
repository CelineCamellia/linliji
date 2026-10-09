const embeddedAdmin = window.location.pathname.startsWith('/admin/');
const apiPath = (path) => (embeddedAdmin ? path.replace(/^\/api\//, '/api/admin/') : path);
const $ = (id) => document.getElementById(id);
const node = (tag, text, cls) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (cls) element.className = cls;
  return element;
};
const message = (id, text) => {
  $(id).textContent = text;
  $(id).hidden = !text;
};
const button = (text, action, cls = 'secondary') => {
  const element = node('button', text, cls);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
};
const statusName = {
  pending: '待审核',
  available: '展示中',
  rejected: '未通过',
  withdrawn: '已下架',
  reserved: '已有预约',
};
const decisionName = { approve: '通过并展示', reject: '不通过', withdraw: '下架信息' };
const kindLabel = (item) =>
  ({ sale: '闲置买卖', service: '邻里手艺', exchange: '以物换物' })[item.kind || 'sale'] ||
  '闲置买卖';
const listingPrice = (item) =>
  item.kind === 'exchange'
    ? '以物换物'
    : item.priceMode === 'free'
      ? '免费帮忙'
      : item.priceMode === 'negotiable'
        ? '费用面议'
        : '¥' + (item.price / 100).toFixed(2);
const date = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '';
const locationLabel = (item) => [item.city, item.community, item.area].filter(Boolean).join(' · ');
let tab = 'listings',
  page = 1,
  total = 0,
  sequence = 0,
  draftSequence = 0,
  selectedDraft = null,
  pending = null,
  busy = false;

async function request(path, data) {
  let response;
  try {
    response = await fetch(apiPath(path), {
      method: data ? 'POST' : 'GET',
      headers: data ? { 'Content-Type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Error('连接中断，结果尚未确认，请刷新核对后再操作。');
  }
  if (response.status === 401 && embeddedAdmin) {
    window.location.assign('/admin/login');
    throw Error('管理登录已过期');
  }
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(Error(value.error || '操作未完成，请重试。'), { status: response.status });
  return value;
}
async function overview() {
  const state = await request('/api/status');
  for (const name of ['pending', 'available', 'reports', 'catalog'])
    $(name + '-count').textContent = state.counts[name];
  $('database').textContent = state.database;
}
function empty(title, copy) {
  $('empty-title').textContent = title;
  $('empty-copy').textContent = copy;
  $('empty').hidden = false;
}
function actions(item) {
  const group = node('div', undefined, 'record-actions');
  group.append(button('查看详情', () => showDetail(item.id)));
  if (item.status === 'pending') {
    group.append(
      button('通过并展示', () => decide(item, 'approve'), 'primary'),
      button('不通过', () => decide(item, 'reject'), 'secondary danger'),
    );
  } else if (item.status === 'available')
    group.append(button('下架信息', () => decide(item, 'withdraw'), 'secondary danger'));
  return group;
}
function listingCard(item) {
  const card = node('article', undefined, 'record'),
    head = node('div', undefined, 'record-header');
  head.append(node('h3', item.title), node('span', listingPrice(item), 'price'));
  card.append(
    head,
    node('p', kindLabel(item) + ' · ' + locationLabel(item), 'record-meta'),
    node('p', item.description, 'description'),
    ...(item.exchangeFor ? [node('p', '想换：' + item.exchangeFor, 'description')] : []),
    ...(item.availability ? [node('p', '时间：' + item.availability, 'description')] : []),
    node('p', [item.nickname, date(item.created)].filter(Boolean).join(' · '), 'record-meta'),
    node('span', statusName[item.status] || item.status, 'tag'),
    actions(item),
  );
  return card;
}
function reportCard(item) {
  const card = node('article', undefined, 'record');
  card.append(
    node('h3', item.listing?.title || '信息已删除'),
    node('p', '举报时间：' + date(item.created), 'record-meta'),
    node('p', '举报内容：' + item.reason, 'description'),
  );
  if (item.listing)
    card.append(
      node(
        'p',
        locationLabel(item.listing) +
          ' · ' +
          (statusName[item.listing_status] || item.listing_status),
        'record-meta',
      ),
    );
  const group = node('div', undefined, 'record-actions');
  if (item.listing) group.append(button('查看信息', () => showDetail(item.listing_id)));
  if (item.status === 'open') {
    if (['available', 'pending'].includes(item.listing_status))
      group.append(
        button(
          '下架信息',
          () =>
            decide(
              { ...item.listing, id: item.listing_id, status: item.listing_status },
              'withdraw',
            ),
          'secondary danger',
        ),
      );
    group.append(
      button(
        '标记已处理',
        () =>
          openDecision({
            kind: 'report',
            id: item.id,
            title: '处理举报',
            target: item.listing?.title || '信息已删除',
            hint: '请先核实并处理问题，再记录处理结果。关闭举报不会自动下架信息。',
            confirm: '确认已处理',
          }),
        'primary',
      ),
    );
  } else
    card.append(
      node(
        'p',
        item.resolution ? '处理结果：' + item.resolution : '已处理（历史记录）',
        'description',
      ),
      node('p', date(item.resolved_at), 'record-meta'),
    );
  card.append(group);
  return card;
}
async function load() {
  const current = ++sequence;
  $('refresh').disabled = true;
  message('error', '');
  try {
    await overview();
    if (current !== sequence) return;
    $('empty').hidden = true;
    $('pagination').hidden = true;
    if (tab === 'catalog') {
      const data = await request('/api/drafts');
      if (current !== sequence) return;
      const selected = $('draft-file').value;
      $('draft-file').replaceChildren(
        new Option('请选择资料文件', ''),
        ...data.files.map((name) => new Option(name, name)),
      );
      if (data.files.includes(selected)) {
        $('draft-file').value = selected;
        await previewDraft();
      } else {
        selectedDraft = null;
        renderDraft();
      }
      if (!data.files.length)
        empty('还没有保存的商家资料', '打开资料工具，填写并保存后再回来刷新。');
      return;
    }
    const status = tab === 'listings' ? $('listing-status').value : $('report-status').value;
    const data = await request(
      '/api/' +
        tab +
        '?status=' +
        status +
        '&page=' +
        page +
        (tab === 'listings' ? '&kind=' + $('listing-kind').value : ''),
    );
    if (current !== sequence) return;
    total = data.total;
    if (!data.items.length && page > 1) {
      page--;
      return await load();
    }
    $('records').replaceChildren(...data.items.map(tab === 'listings' ? listingCard : reportCard));
    if (!data.items.length)
      empty(
        tab === 'listings'
          ? '这个状态下暂无发布'
          : '暂无' + (status === 'open' ? '待处理' : '已处理') + '举报',
        tab === 'listings'
          ? '邻居发布手艺、闲置或交换信息后，可以在这里核对和处理。'
          : '居民提交举报后，可以在这里跟进处理结果。',
      );
    $('pagination').hidden = total <= 20;
    $('previous').disabled = page <= 1;
    $('next').disabled = page * 20 >= total;
    $('page-info').textContent = '第 ' + page + ' 页 · 共 ' + total + ' 条';
  } catch (error) {
    if (current === sequence) message('error', error.message);
  } finally {
    if (current === sequence) $('refresh').disabled = false;
  }
}
function switchTab(next) {
  tab = next;
  page = 1;
  sequence++;
  draftSequence++;
  $('records').replaceChildren();
  $('empty').hidden = true;
  $('pagination').hidden = true;
  $('list-filter').hidden = tab !== 'listings';
  $('report-filter').hidden = tab !== 'reports';
  $('catalog-panel').hidden = tab !== 'catalog';
  for (const element of document.querySelectorAll('[data-tab]'))
    element.classList.toggle('active', element.dataset.tab === tab);
  $('section-title').textContent = {
    listings: '发布审核',
    reports: '举报处理',
    catalog: '商家资料',
  }[tab];
  $('section-description').textContent = {
    listings: '认真核对描述和所在社区，再决定是否展示。',
    reports: '核实邻居的反馈，记录处理结果。',
    catalog: '备用资料工具；居民自己发布无需先导入商家。',
  }[tab];
  message('notice', '');
  load();
}
async function showDetail(id) {
  try {
    const item = await request('/api/listings/' + encodeURIComponent(id));
    $('detail-title').textContent = item.title;
    $('detail-body').replaceChildren(
      node('p', locationLabel(item), 'record-meta'),
      node('p', item.description, 'description'),
      node('p', kindLabel(item) + ' · ' + listingPrice(item)),
      ...(item.kind !== 'service' ? [node('p', '成色：' + item.condition)] : []),
      ...(item.exchangeFor ? [node('p', '想换：' + item.exchangeFor, 'description')] : []),
      ...(item.availability ? [node('p', '时间：' + item.availability, 'description')] : []),
      node('p', '当前状态：' + statusName[item.status]),
    );
    for (const history of item.history) {
      const entry = node('div', undefined, 'history');
      entry.append(
        node(
          'strong',
          (decisionName[history.decision] || history.decision) + ' · ' + date(history.created),
        ),
        node('p', history.reason),
      );
      $('detail-body').append(entry);
    }
    if (item.photos?.length) {
      const gallery = node('div', undefined, 'review-photos');
      for (const id of item.photos) {
        const photo = node('img');
        photo.src = apiPath('/api/photos/' + id);
        photo.alt = '居民上传的照片';
        gallery.append(photo);
      }
      $('detail-body').prepend(gallery);
    }
    if (!item.history.length) $('detail-body').append(node('p', '尚无审核记录', 'muted'));
    $('detail-dialog').showModal();
  } catch (error) {
    message('error', error.message);
  }
}
function decide(item, decision) {
  openDecision({
    kind: 'review',
    id: item.id,
    expectedStatus: item.status,
    decision,
    title: decisionName[decision],
    target: item.title,
    hint:
      decision === 'approve'
        ? '确认描述真实、归属社区正确后，再将这条信息展示给居民。'
        : decision === 'reject'
          ? '说明需要补充或不予展示的原因，发布者可以查看这条反馈。'
          : '下架后居民无法继续查看和联系此信息，处理理由会保留。',
    confirm: '确认' + decisionName[decision],
  });
}
function openDecision(value) {
  if (busy) return;
  pending = value;
  $('decision-title').textContent = value.title;
  $('decision-target').textContent = value.target;
  $('decision-hint').textContent = value.hint;
  $('confirm-decision').textContent = value.confirm;
  $('reason').value = '';
  $('reason').required = value.kind !== 'import';
  $('reason-field').hidden = value.kind === 'import';
  message('decision-error', '');
  $('decision-dialog').showModal();
}
function lock(value) {
  busy = value;
  for (const id of ['confirm-decision', 'cancel-decision', 'reason']) $(id).disabled = value;
}
$('decision-dialog').addEventListener('cancel', (event) => {
  if (busy) event.preventDefault();
});
$('decision-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !pending || !event.currentTarget.reportValidity()) return;
  const action = pending;
  lock(true);
  message('decision-error', '');
  try {
    if (action.kind === 'review')
      await request('/api/listings/' + action.id + '/review', {
        decision: action.decision,
        expectedStatus: action.expectedStatus,
        reason: $('reason').value,
      });
    else if (action.kind === 'report')
      await request('/api/reports/' + action.id + '/close', {
        reason: $('reason').value,
        confirm: true,
      });
    else
      await request('/api/catalog/import', {
        filename: action.draft.filename,
        hash: action.draft.hash,
        confirm: true,
      });
    $('decision-dialog').close();
    pending = null;
    message(
      'notice',
      action.kind === 'import'
        ? '资料已导入当前运营数据。'
        : action.kind === 'report'
          ? '举报已处理，结果已记录。'
          : '发布处理结果已保存。',
    );
    await load();
  } catch (error) {
    message('decision-error', error.message);
    if (error.status === 409) await load();
  } finally {
    lock(false);
  }
});
$('cancel-decision').addEventListener('click', () => {
  if (!busy) {
    $('decision-dialog').close();
    pending = null;
  }
});
$('close-detail').addEventListener('click', () => $('detail-dialog').close());
function renderDraft() {
  const draft = selectedDraft;
  $('draft-summary').hidden = !draft;
  $('draft-items').replaceChildren();
  $('import-draft').disabled = !draft || !!draft.duplicates.length;
  if (!draft) return;
  $('draft-summary').textContent =
    '共 ' +
    draft.count +
    ' 条资料，请核对商家、价格、覆盖社区和联系方式。' +
    (draft.duplicates.length
      ? '其中 ' + draft.duplicates.length + ' 条编号已存在，不能重复导入。'
      : '');
  for (const item of draft.items) {
    const card = node('article', undefined, 'record');
    card.append(
      node('h3', item.title),
      node(
        'p',
        (item.kind === 'service'
          ? '维修服务'
          : item.category === 'farm'
            ? '生鲜商品'
            : '服装商品') +
          ' · ' +
          item.shop,
        'record-meta',
      ),
      node('p', locationLabel(item), 'record-meta'),
      node('p', item.description, 'description'),
      node(
        'p',
        '¥' + (item.price / 100).toFixed(2) + ' / ' + item.unit + ' · 联系电话：' + item.phone,
        'record-meta',
      ),
    );
    $('draft-items').append(card);
  }
}
async function previewDraft() {
  const current = ++draftSequence,
    filename = $('draft-file').value;
  selectedDraft = null;
  renderDraft();
  if (!filename) return;
  try {
    const draft = await request('/api/drafts/preview?filename=' + encodeURIComponent(filename));
    if (current !== draftSequence || tab !== 'catalog') return;
    selectedDraft = draft;
    renderDraft();
  } catch (error) {
    if (current === draftSequence) message('error', error.message);
  }
}
$('draft-file').addEventListener('change', () => {
  message('error', '');
  previewDraft();
});
$('import-draft').addEventListener('click', () => {
  if (selectedDraft && !selectedDraft.duplicates.length)
    openDecision({
      kind: 'import',
      draft: selectedDraft,
      title: '确认导入商家资料',
      target: selectedDraft.count + ' 条商品与服务资料',
      hint: '确认商家授权、价格、联系方式及社区归属正确。导入到本机运营数据，同编号不会覆盖已有资料。',
      confirm: '确认导入',
    });
});
for (const item of document.querySelectorAll('[data-tab]'))
  item.addEventListener('click', () => switchTab(item.dataset.tab));
for (const item of document.querySelectorAll('[data-go]'))
  item.addEventListener('click', () => {
    if (item.dataset.go === 'available') {
      $('listing-status').value = 'available';
      switchTab('listings');
    } else {
      if (item.dataset.go === 'listings') $('listing-status').value = 'pending';
      switchTab(item.dataset.go);
    }
  });
for (const id of ['listing-status', 'listing-kind', 'report-status'])
  $(id).addEventListener('change', () => {
    page = 1;
    load();
  });
$('previous').addEventListener('click', () => {
  if (page > 1) {
    page--;
    load();
  }
});
$('next').addEventListener('click', () => {
  if (page * 20 < total) {
    page++;
    load();
  }
});
$('refresh').addEventListener('click', load);
load();

if (embeddedAdmin) {
  $('admin-logout').hidden = false;
  $('admin-logout').addEventListener('click', async () => {
    try {
      await request('/api/session/logout', {});
      window.location.assign('/admin/login');
    } catch (error) {
      message('error', error.message);
    }
  });
}

if (location.pathname.startsWith('/admin/')) {
  document
    .querySelectorAll('[data-go="catalog"],[data-tab="catalog"]')
    .forEach((el) => (el.hidden = true));
  document.querySelector('footer p').textContent = '管理当前服务的居民发布与举报。';
}
