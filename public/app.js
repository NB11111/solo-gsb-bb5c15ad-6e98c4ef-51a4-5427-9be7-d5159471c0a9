'use strict';

/* ================= 状态 ================= */
const MAX_SCENES = 12;
let uidCounter = 0;
const uid = () => `s${Date.now().toString(36)}_${uidCounter++}`;

const state = {
  planId: null,
  scenes: [], // { id, name, props: [], duration, required, value }
  constraints: { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] },
  options: { mode: 'standard', timeLimit: 60 },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const sceneName = (id) => {
  const s = state.scenes.find(x => x.id === id);
  return s ? s.name : '（已删除）';
};
const isLimited = () => state.options.mode === 'limited';

/* ================= 场景编辑 ================= */
function renderScenes() {
  const tbody = $('#scene-tbody');
  tbody.innerHTML = '';
  state.scenes.forEach((s, i) => {
    const tr = document.createElement('tr');

    const tdIdx = document.createElement('td');
    tdIdx.textContent = i + 1;

    const tdName = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'scene-name';
    nameInput.value = s.name;
    nameInput.placeholder = `场景 ${i + 1}`;
    nameInput.addEventListener('input', () => {
      s.name = nameInput.value;
      renderConstraintForms(); // 名称变化同步到下拉框
    });
    tdName.appendChild(nameInput);

    const tdProps = document.createElement('td');
    const propsInput = document.createElement('input');
    propsInput.type = 'text';
    propsInput.className = 'scene-props';
    propsInput.value = s.props.join(', ');
    propsInput.placeholder = '如：长桌, 椅子, 烛台';
    propsInput.addEventListener('input', () => {
      s.props = propsInput.value.split(/[,，]/).map(x => x.trim()).filter(Boolean);
    });
    tdProps.appendChild(propsInput);

    const tdDuration = document.createElement('td');
    const durInput = document.createElement('input');
    durInput.type = 'number';
    durInput.className = 'scene-duration';
    durInput.min = '0';
    durInput.step = '1';
    durInput.value = s.duration ?? 0;
    durInput.addEventListener('input', () => {
      const v = Number(durInput.value);
      s.duration = Number.isFinite(v) && v >= 0 ? v : 0;
    });
    tdDuration.appendChild(durInput);

    const tdRequired = document.createElement('td');
    const reqInput = document.createElement('input');
    reqInput.type = 'checkbox';
    reqInput.className = 'scene-required';
    reqInput.checked = Boolean(s.required);
    reqInput.title = '必演场景（时长受限编排时必须入选）';
    reqInput.addEventListener('change', () => { s.required = reqInput.checked; });
    tdRequired.appendChild(reqInput);

    const tdValue = document.createElement('td');
    const valInput = document.createElement('input');
    valInput.type = 'number';
    valInput.className = 'scene-value';
    valInput.min = '0';
    valInput.step = '1';
    valInput.value = s.value ?? 0;
    valInput.addEventListener('input', () => {
      const v = Number(valInput.value);
      s.value = Number.isFinite(v) && v >= 0 ? v : 0;
    });
    tdValue.appendChild(valInput);

    const tdOp = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'btn btn-sm btn-danger';
    del.textContent = '删除';
    del.addEventListener('click', () => {
      state.scenes.splice(i, 1);
      // 清理引用该场景的约束
      const c = state.constraints;
      c.dependencies = c.dependencies.filter(d => d.before !== s.id && d.after !== s.id);
      c.fixedPositions = c.fixedPositions.filter(f => f.sceneId !== s.id);
      c.forbiddenAdjacencies = c.forbiddenAdjacencies.filter(f => f.a !== s.id && f.b !== s.id);
      renderAll();
    });
    tdOp.appendChild(del);

    tr.append(tdIdx, tdName, tdProps, tdDuration, tdRequired, tdValue, tdOp);
    tbody.appendChild(tr);
  });

  $('#scene-count').textContent = `共 ${state.scenes.length} / ${MAX_SCENES} 个场景`;
  $('#btn-add-scene').disabled = state.scenes.length >= MAX_SCENES;
  renderModeUI();
}

/* ================= 模式切换 ================= */
function renderModeUI() {
  $$('input[name="mode"]').forEach(r => { r.checked = r.value === state.options.mode; });
  $('#mode-limit').hidden = !isLimited();
  $('#time-limit').value = state.options.timeLimit ?? 60;
}

/* ================= 约束编辑 ================= */
function fillSelect(sel, selectedId) {
  sel.innerHTML = '';
  for (const s of state.scenes) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name || '(未命名)';
    sel.appendChild(opt);
  }
  if (selectedId && state.scenes.some(s => s.id === selectedId)) sel.value = selectedId;
}

function renderConstraintForms() {
  fillSelect($('#dep-form [data-role="before"]'));
  fillSelect($('#dep-form [data-role="after"]'));
  fillSelect($('#fixed-form [data-role="scene"]'));
  fillSelect($('#noadj-form [data-role="a"]'));
  fillSelect($('#noadj-form [data-role="b"]'));
  const posInput = $('#fixed-form [data-role="position"]');
  posInput.max = Math.max(1, state.scenes.length);
  renderConstraintLists();
}

function renderConstraintLists() {
  const depList = $('#dep-list');
  depList.innerHTML = '';
  state.constraints.dependencies.forEach((d, i) => {
    depList.appendChild(constraintItem(
      `「${sceneName(d.before)}」必须在「${sceneName(d.after)}」之前`,
      () => { state.constraints.dependencies.splice(i, 1); renderConstraintLists(); }
    ));
  });

  const fixedList = $('#fixed-list');
  fixedList.innerHTML = '';
  state.constraints.fixedPositions.forEach((f, i) => {
    fixedList.appendChild(constraintItem(
      `「${sceneName(f.sceneId)}」固定在第 ${f.position} 位`,
      () => { state.constraints.fixedPositions.splice(i, 1); renderConstraintLists(); }
    ));
  });

  const noadjList = $('#noadj-list');
  noadjList.innerHTML = '';
  state.constraints.forbiddenAdjacencies.forEach((f, i) => {
    noadjList.appendChild(constraintItem(
      `「${sceneName(f.a)}」与「${sceneName(f.b)}」禁止相邻`,
      () => { state.constraints.forbiddenAdjacencies.splice(i, 1); renderConstraintLists(); }
    ));
  });
}

function constraintItem(text, onRemove) {
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.textContent = text;
  const del = document.createElement('button');
  del.className = 'btn btn-sm btn-danger';
  del.textContent = '✕';
  del.addEventListener('click', onRemove);
  li.append(span, del);
  return li;
}

function renderAll() {
  renderScenes();
  renderConstraintForms();
}

/* ================= 求解 ================= */
function payload() {
  return {
    scenes: state.scenes.map(s => ({
      id: s.id,
      name: s.name.trim(),
      props: s.props,
      duration: Number(s.duration) || 0,
      required: Boolean(s.required),
      value: Number(s.value) || 0,
    })),
    constraints: state.constraints,
    options: isLimited()
      ? { mode: 'limited', timeLimit: Number(state.options.timeLimit) || 0 }
      : { mode: 'standard' },
  };
}

async function api(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

function showStatus(msg, isError) {
  const el = $('#status-line');
  el.textContent = msg;
  el.style.color = isError ? '#ffb3b0' : '';
}

async function doSolve() {
  $('#result-card').hidden = true;
  const data = await api('/api/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload()),
  });
  const box = $('#result');
  box.innerHTML = '';
  $('#result-card').hidden = false;

  if (data.errors) {
    box.appendChild(errorBlock(data.errors));
    return;
  }
  if (!data.ok) {
    box.appendChild(unsolvableBlock(data));
    return;
  }
  box.appendChild(data.mode === 'limited' ? limitedResultBlock(data) : resultBlock(data));
  $('#result-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function errorBlock(errors) {
  const div = document.createElement('div');
  div.className = 'conflict-box';
  const h = document.createElement('h3');
  h.textContent = '输入有误';
  const ul = document.createElement('ul');
  ul.className = 'error-list';
  for (const e of errors) {
    const li = document.createElement('li');
    li.textContent = e;
    ul.appendChild(li);
  }
  div.append(h, ul);
  return div;
}

function conflictBlock(conflict) {
  const div = document.createElement('div');
  div.className = 'conflict-box';
  const h = document.createElement('h3');
  h.textContent = '⚠ 无解：约束相互冲突';
  const p = document.createElement('p');
  p.textContent = conflict.message;
  const ul = document.createElement('ul');
  for (const c of conflict.constraints) {
    const li = document.createElement('li');
    li.textContent = c.text;
    ul.appendChild(li);
  }
  div.append(h, p, ul);
  return div;
}

/** 统一无解展示：标准模式的 conflict，或时长受限模式的 reason/message/conflict。 */
function unsolvableBlock(data) {
  if (data.reason === 'required-overtime') {
    const div = document.createElement('div');
    div.className = 'conflict-box';
    const h = document.createElement('h3');
    h.textContent = '⏱ 无解：必演场景已超时';
    const p = document.createElement('p');
    p.textContent = data.message;
    const detail = document.createElement('p');
    detail.className = 'time-summary';
    detail.innerHTML = `必演总时长 <strong>${data.requiredDuration}</strong> ／ 上限 <strong>${data.timeLimit}</strong>`;
    div.append(h, p, detail);
    return div;
  }
  if (data.reason === 'no-feasible-arrangement') {
    const div = document.createElement('div');
    div.className = 'conflict-box';
    const h = document.createElement('h3');
    h.textContent = '⚠ 无解：没有可行编排';
    const p = document.createElement('p');
    p.textContent = data.message;
    div.append(h, p);
    const items = [];
    if (data.conflict) {
      if (data.conflict.text) items.push(data.conflict.text);
      else if (Array.isArray(data.conflict.constraints)) {
        for (const c of data.conflict.constraints) items.push(c.text);
      }
    }
    if (items.length) {
      const ul = document.createElement('ul');
      for (const text of items) {
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      }
      div.appendChild(ul);
    }
    return div;
  }
  return conflictBlock(data.conflict);
}

/** 场景标签（必演/可选） */
function sceneTag(id) {
  const s = state.scenes.find(x => x.id === id);
  const tag = document.createElement('span');
  tag.className = s && s.required ? 'tag tag-required' : 'tag tag-optional';
  tag.textContent = s && s.required ? '必演' : '可选';
  return tag;
}

function limitedResultBlock(data) {
  const frag = document.createDocumentFragment();

  // 时长与价值汇总
  const summary = document.createElement('div');
  summary.className = 'time-summary';
  const remainCls = data.remainingDuration > 0 ? 'time-ok' : 'time-zero';
  summary.innerHTML =
    `已用时长 <strong>${data.usedDuration}</strong> ／ 上限 <strong>${data.timeLimit}</strong>` +
    `　｜　剩余时长 <strong class="${remainCls}">${data.remainingDuration}</strong>` +
    `　｜　入选可选价值总和 <strong>${data.totalValue}</strong>` +
    `　｜　道具增减总次数 <strong>${data.totalCost}</strong>`;
  frag.appendChild(summary);

  // 入选 / 舍弃
  const picks = document.createElement('div');
  picks.className = 'picks';

  const sel = document.createElement('div');
  sel.className = 'picks-col';
  const selHead = document.createElement('h3');
  selHead.textContent = `✅ 入选场景（${data.selectedScenes.length}）`;
  sel.appendChild(selHead);
  const selUl = document.createElement('ul');
  selUl.className = 'pick-list';
  data.selectedScenes.forEach((id, i) => {
    const li = document.createElement('li');
    const s = state.scenes.find(x => x.id === id);
    li.innerHTML = `<span class="pick-pos">第 ${i + 1} 位</span> ${escapeHtml(sceneName(id))}` +
      `　<span class="hint">时长 ${s ? s.duration : ''}${s && !s.required ? `，价值 ${s.value}` : ''}</span>`;
    li.appendChild(sceneTag(id));
    selUl.appendChild(li);
  });
  sel.appendChild(selUl);

  const drop = document.createElement('div');
  drop.className = 'picks-col';
  const dropHead = document.createElement('h3');
  dropHead.append(`🚫 舍弃场景（${data.discardedScenes.length}）　`);
  const dropHint = document.createElement('span');
  dropHint.className = 'hint';
  dropHint.textContent = '不参与约束与编排';
  dropHead.appendChild(dropHint);
  drop.appendChild(dropHead);
  const dropUl = document.createElement('ul');
  dropUl.className = 'pick-list';
  if (!data.discardedScenes.length) {
    const li = document.createElement('li');
    li.className = 'pick-empty';
    li.textContent = '（无，全部场景均入选）';
    dropUl.appendChild(li);
  }
  for (const d of data.discardedScenes) {
    const li = document.createElement('li');
    li.innerHTML = `${escapeHtml(sceneName(d.id))}　<span class="hint">时长 ${d.duration}，可选价值 ${d.value}</span>`;
    const tag = document.createElement('span');
    tag.className = 'tag tag-discarded';
    tag.textContent = '舍弃';
    li.appendChild(tag);
    dropUl.appendChild(li);
  }
  drop.appendChild(dropUl);

  picks.append(sel, drop);
  frag.appendChild(picks);

  // 演出顺序
  const hOrder = document.createElement('h3');
  hOrder.textContent = '演出顺序';
  frag.appendChild(hOrder);
  const flow = document.createElement('div');
  flow.className = 'order-flow';
  data.order.forEach((id, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'order-arrow';
      arrow.textContent = '→';
      flow.appendChild(arrow);
    }
    const chip = document.createElement('span');
    chip.className = 'order-chip' + (state.scenes.find(x => x.id === id && x.required) ? ' chip-required' : '');
    chip.textContent = `${i + 1}. ${sceneName(id)}`;
    flow.appendChild(chip);
  });
  frag.appendChild(flow);

  // 换景明细
  const h = document.createElement('h3');
  h.textContent = '换景明细';
  frag.appendChild(h);

  const ul = document.createElement('ul');
  ul.className = 'step-list';
  data.steps.forEach((step, i) => {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.className = 'step-title';
    if (step.type === 'setup') {
      title.textContent = `开场布置 →「${sceneName(step.scene)}」`;
    } else {
      title.textContent = `换景 ${i}：「${sceneName(step.from)}」→「${sceneName(step.to)}」`;
    }
    li.appendChild(title);

    const detail = document.createElement('div');
    const parts = [];
    if (step.removed.length) {
      parts.push(`<span class="prop-del">撤下：${escapeHtml(step.removed.join('、'))}</span>`);
    }
    if (step.added.length) {
      parts.push(`<span class="prop-add">上台：${escapeHtml(step.added.join('、'))}</span>`);
    }
    if (!parts.length) parts.push('<span class="prop-none">道具无变化</span>');
    detail.innerHTML = parts.join('　｜　') + `　<span class="step-count">（${step.count} 次）</span>`;
    li.appendChild(detail);
    ul.appendChild(li);
  });
  frag.appendChild(ul);
  return frag;
}

function resultBlock(data) {
  const frag = document.createDocumentFragment();

  const flow = document.createElement('div');
  flow.className = 'order-flow';
  data.order.forEach((id, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'order-arrow';
      arrow.textContent = '→';
      flow.appendChild(arrow);
    }
    const chip = document.createElement('span');
    chip.className = 'order-chip';
    chip.textContent = `${i + 1}. ${sceneName(id)}`;
    flow.appendChild(chip);
  });
  frag.appendChild(flow);

  const total = document.createElement('p');
  total.className = 'total-line';
  total.innerHTML = `道具增减总次数：<strong>${data.totalCost}</strong> 次（含开场布置，下同）`;
  frag.appendChild(total);

  const h = document.createElement('h3');
  h.textContent = '换景明细';
  frag.appendChild(h);

  const ul = document.createElement('ul');
  ul.className = 'step-list';
  data.steps.forEach((step, i) => {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.className = 'step-title';
    if (step.type === 'setup') {
      title.textContent = `开场布置 →「${sceneName(step.scene)}」`;
    } else {
      title.textContent = `换景 ${i}：「${sceneName(step.from)}」→「${sceneName(step.to)}」`;
    }
    li.appendChild(title);

    const detail = document.createElement('div');
    const parts = [];
    if (step.removed.length) {
      parts.push(`<span class="prop-del">撤下：${escapeHtml(step.removed.join('、'))}</span>`);
    }
    if (step.added.length) {
      parts.push(`<span class="prop-add">上台：${escapeHtml(step.added.join('、'))}</span>`);
    }
    if (!parts.length) parts.push('<span class="prop-none">道具无变化</span>');
    detail.innerHTML = parts.join('　｜　') + `　<span class="step-count">（${step.count} 次）</span>`;
    li.appendChild(detail);
    ul.appendChild(li);
  });
  frag.appendChild(ul);
  return frag;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* ================= 方案保存 / 载入 ================= */
async function refreshPlans() {
  const data = await api('/api/plans');
  const sel = $('#plan-select');
  sel.innerHTML = '<option value="">— 选择已保存的方案 —</option>';
  for (const p of data.plans) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name}（${p.sceneCount} 个场景，更新于 ${new Date(p.updatedAt).toLocaleString()}）`;
    sel.appendChild(opt);
  }
  if (state.planId) sel.value = state.planId;
}

async function savePlan() {
  const name = $('#plan-name').value.trim();
  if (!name) { showStatus('请先填写方案名称', true); return; }
  const body = JSON.stringify({ name, ...payload() });
  const headers = { 'Content-Type': 'application/json' };
  const data = state.planId
    ? await api(`/api/plans/${state.planId}`, { method: 'PUT', headers, body })
    : await api('/api/plans', { method: 'POST', headers, body });
  if (data.errors) { showStatus(data.errors.join('；'), true); return; }
  state.planId = data.plan.id;
  showStatus(`方案「${name}」已保存`);
  await refreshPlans();
}

async function loadPlan() {
  const id = $('#plan-select').value;
  if (!id) { showStatus('请先选择要载入的方案', true); return; }
  const data = await api(`/api/plans/${id}`);
  if (!data.ok) { showStatus(data.errors.join('；'), true); return; }
  const p = data.plan;
  state.planId = p.id;
  state.scenes = p.scenes.map(s => ({
    id: s.id, name: s.name, props: s.props.slice(),
    duration: Number(s.duration) || 0,
    required: Boolean(s.required),
    value: Number(s.value) || 0,
  }));
  state.constraints = {
    dependencies: p.constraints.dependencies.map(d => ({ ...d })),
    fixedPositions: p.constraints.fixedPositions.map(f => ({ ...f })),
    forbiddenAdjacencies: p.constraints.forbiddenAdjacencies.map(f => ({ ...f })),
  };
  state.options = p.options && p.options.mode === 'limited'
    ? { mode: 'limited', timeLimit: Number(p.options.timeLimit) || 0 }
    : { mode: 'standard', timeLimit: 60 };
  $('#plan-name').value = p.name;
  $('#result-card').hidden = true;
  renderAll();
  showStatus(`已载入方案「${p.name}」，可继续编辑`);
}

async function deletePlan() {
  const id = $('#plan-select').value;
  if (!id) { showStatus('请先选择要删除的方案', true); return; }
  if (!confirm('确定删除该方案？')) return;
  await api(`/api/plans/${id}`, { method: 'DELETE' });
  if (state.planId === id) state.planId = null;
  showStatus('方案已删除');
  await refreshPlans();
}

function newPlan() {
  state.planId = null;
  state.scenes = [];
  state.constraints = { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] };
  state.options = { mode: 'standard', timeLimit: 60 };
  $('#plan-name').value = '';
  $('#plan-select').value = '';
  $('#result-card').hidden = true;
  renderAll();
  showStatus('已新建空白方案');
}

/* ================= 示例数据 ================= */
function loadSample() {
  newPlan();
  const ids = ['sc1', 'sc2', 'sc3', 'sc4', 'sc5'];
  state.scenes = [
    { id: ids[0], name: '序幕·市集', props: ['摊位', '灯笼', '布幔'], duration: 10, required: true, value: 0 },
    { id: ids[1], name: '王宫大殿', props: ['王座', '立柱', '灯笼', '地毯'], duration: 12, required: true, value: 0 },
    { id: ids[2], name: '森林夜话', props: ['树木', '石头', '月光布'], duration: 8, required: false, value: 15 },
    { id: ids[3], name: '牢房', props: ['铁栏', '锁链', '石头'], duration: 9, required: false, value: 8 },
    { id: ids[4], name: '终幕·庆典', props: ['灯笼', '地毯', '花篮', '彩带'], duration: 10, required: true, value: 0 },
  ];
  state.constraints = {
    dependencies: [
      { before: ids[0], after: ids[1] },
      { before: ids[2], after: ids[3] },
    ],
    fixedPositions: [{ sceneId: ids[4], position: 4 }],
    forbiddenAdjacencies: [{ a: ids[1], b: ids[2] }],
  };
  state.options = { mode: 'limited', timeLimit: 40 };
  $('#plan-name').value = '示例剧目（时长受限）';
  renderAll();
  showStatus('已载入示例数据（时长受限模式，上限 40），可直接点击「计算最优顺序」');
}

/* ================= 事件绑定 ================= */
$('#btn-add-scene').addEventListener('click', () => {
  if (state.scenes.length >= MAX_SCENES) return;
  state.scenes.push({ id: uid(), name: '', props: [], duration: 0, required: false, value: 0 });
  renderAll();
});
$('#btn-sample').addEventListener('click', loadSample);
$('#btn-solve').addEventListener('click', doSolve);
$('#btn-save').addEventListener('click', savePlan);
$('#btn-load').addEventListener('click', loadPlan);
$('#btn-delete').addEventListener('click', deletePlan);
$('#btn-new').addEventListener('click', newPlan);

$$('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    state.options.mode = radio.value;
    renderModeUI();
  });
});
$('#time-limit').addEventListener('input', () => {
  const v = Number($('#time-limit').value);
  if (Number.isFinite(v) && v >= 0) state.options.timeLimit = v;
});

$('#btn-add-dep').addEventListener('click', () => {
  const before = $('#dep-form [data-role="before"]').value;
  const after = $('#dep-form [data-role="after"]').value;
  if (!before || !after) return;
  state.constraints.dependencies.push({ before, after });
  renderConstraintLists();
});
$('#btn-add-fixed').addEventListener('click', () => {
  const sceneId = $('#fixed-form [data-role="scene"]').value;
  const position = Number($('#fixed-form [data-role="position"]').value);
  if (!sceneId || !Number.isInteger(position)) return;
  state.constraints.fixedPositions.push({ sceneId, position });
  renderConstraintLists();
});
$('#btn-add-noadj').addEventListener('click', () => {
  const a = $('#noadj-form [data-role="a"]').value;
  const b = $('#noadj-form [data-role="b"]').value;
  if (!a || !b) return;
  state.constraints.forbiddenAdjacencies.push({ a, b });
  renderConstraintLists();
});

/* ================= 初始化 ================= */
renderAll();
refreshPlans();
