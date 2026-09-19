'use strict';

const path = require('path');
const express = require('express');
const { solve, MAX_SCENES, normalizeProps, nonNegNumber } = require('./solver');
const store = require('./store');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** 校验并规范化 { scenes, constraints, options }，返回 { errors, scenes, constraints, options } */
function validatePayload(body) {
  const errors = [];
  const rawScenes = body && body.scenes;
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    errors.push('至少需要 1 个场景');
  }
  const scenes = [];
  if (Array.isArray(rawScenes)) {
    if (rawScenes.length > MAX_SCENES) errors.push(`场景数量不能超过 ${MAX_SCENES} 个`);
    const ids = new Set();
    rawScenes.forEach((s, i) => {
      const id = String((s && s.id) ?? `s${i + 1}`);
      const name = String((s && s.name) ?? '').trim();
      if (!name) errors.push(`第 ${i + 1} 个场景缺少名称`);
      if (ids.has(id)) errors.push(`场景 id 重复：${id}`);
      ids.add(id);
      const duration = nonNegNumber(s && s.duration);
      if (s && s.duration !== undefined && duration !== Number(s.duration)) {
        errors.push(`第 ${i + 1} 个场景的时长必须是非负数字`);
      }
      const value = nonNegNumber(s && s.value);
      if (s && s.value !== undefined && value !== Number(s.value)) {
        errors.push(`第 ${i + 1} 个场景的可选价值必须是非负数字`);
      }
      scenes.push({
        id,
        name,
        props: normalizeProps(s && s.props),
        duration,
        required: Boolean(s && s.required),
        value,
      });
    });
  }

  const idSet = new Set(scenes.map(s => s.id));
  const c = (body && body.constraints) || {};
  const dependencies = [];
  const fixedPositions = [];
  const forbiddenAdjacencies = [];

  for (const d of c.dependencies || []) {
    if (!idSet.has(d.before) || !idSet.has(d.after)) {
      errors.push('依赖约束引用了不存在的场景');
      continue;
    }
    dependencies.push({ before: d.before, after: d.after });
  }
  for (const f of c.fixedPositions || []) {
    const pos = Number(f.position);
    if (!idSet.has(f.sceneId)) {
      errors.push('固定序位约束引用了不存在的场景');
      continue;
    }
    if (!Number.isInteger(pos) || pos < 1 || pos > scenes.length) {
      errors.push(`固定序位必须是 1 到 ${scenes.length} 之间的整数`);
      continue;
    }
    fixedPositions.push({ sceneId: f.sceneId, position: pos });
  }
  for (const f of c.forbiddenAdjacencies || []) {
    if (!idSet.has(f.a) || !idSet.has(f.b)) {
      errors.push('禁止相邻约束引用了不存在的场景');
      continue;
    }
    forbiddenAdjacencies.push({ a: f.a, b: f.b });
  }

  // 编排模式（缺省为 standard，兼容旧方案/旧客户端）
  const rawOptions = (body && body.options) || {};
  const mode = rawOptions.mode === 'limited' ? 'limited' : 'standard';
  const options = { mode };
  if (mode === 'limited') {
    const tl = Number(rawOptions.timeLimit);
    if (!Number.isFinite(tl) || tl < 0) {
      errors.push('整场时长上限必须是非负数字');
    } else {
      options.timeLimit = tl;
    }
  }

  return {
    errors,
    scenes,
    constraints: { dependencies, fixedPositions, forbiddenAdjacencies },
    options,
  };
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/solve', (req, res) => {
  const { errors, scenes, constraints, options } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ ok: false, errors });
  res.json(solve(scenes, constraints, options));
});

app.get('/api/plans', (req, res) => {
  res.json({ plans: store.list() });
});

app.post('/api/plans', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ ok: false, errors: ['方案名称不能为空'] });
  const { errors, scenes, constraints, options } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ ok: false, errors });
  const plan = store.create({ name, scenes, constraints, options });
  res.status(201).json({ ok: true, plan });
});

app.get('/api/plans/:id', (req, res) => {
  const plan = store.get(req.params.id);
  if (!plan) return res.status(404).json({ ok: false, errors: ['方案不存在'] });
  res.json({ ok: true, plan });
});

app.put('/api/plans/:id', (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ ok: false, errors: ['方案名称不能为空'] });
  const { errors, scenes, constraints, options } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ ok: false, errors });
  const plan = store.update(req.params.id, { name, scenes, constraints, options });
  if (!plan) return res.status(404).json({ ok: false, errors: ['方案不存在'] });
  res.json({ ok: true, plan });
});

app.delete('/api/plans/:id', (req, res) => {
  if (!store.remove(req.params.id)) {
    return res.status(404).json({ ok: false, errors: ['方案不存在'] });
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`舞台换景顺序优化服务已启动: http://localhost:${PORT}`);
});
