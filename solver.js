'use strict';

/**
 * 求解器：在全部约束下，求道具增减次数最少的场景演出顺序。
 *
 * 支持两种编排模式（options.mode）：
 *  - standard（默认）：全部场景必须参演，求道具增减次数最少的顺序。
 *  - limited（时长受限编排）：从场景中选择包含全部必演场景（required）的子集，
 *    总时长不超过 options.timeLimit，未入选场景不参与任何约束，固定序位按入选
 *    后的演出序列计算。目标为先最大化入选可选场景的价值总和，再最小化道具增减。
 *
 * 场景字段：{ id, name, props, duration?, required?, value? }
 *  - duration: 场景时长（非负数，默认 0）
 *  - required: 是否必演（布尔，默认 false）
 *  - value:    可选场景的价值（非负数，默认 0；仅可选场景计入总价值）
 *
 * 约束类型：
 *  - dependencies:        [{ before, after }]   before 必须排在 after 之前
 *  - fixedPositions:      [{ sceneId, position }] 场景固定在第 position 位（1 起）
 *  - forbiddenAdjacencies:[{ a, b }]            a 与 b 不得相邻
 *
 * 目标函数：开场布置道具数 + 每次换景的（撤下数 + 上台数）之和。
 *
 * 算法：n <= 12，使用子集 DP（Held-Karp 风格），状态 (已排集合, 末尾场景)，
 * 复杂度 O(2^n * n^2)，最坏约 70 万状态，毫秒级完成。时长受限模式枚举全部
 * 候选子集（必演掩码的超集且总时长不超限）并复用同一块 DP 内存，总工作量
 * 约 O(3^n * n)，12 个场景仍在毫秒~数百毫秒级。
 */

const MAX_SCENES = 12;

function nonNegNumber(v) {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
}

function normalizeProps(props) {
  const out = [];
  const seen = new Set();
  for (const p of props || []) {
    const s = String(p).trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function popcount(x) {
  let c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

/** 把输入编译成位掩码/矩阵模型，供 DP 使用。 */
function buildModel(scenes, constraints) {
  const n = scenes.length;
  const index = new Map();
  scenes.forEach((s, i) => index.set(s.id, i));
  const propSets = scenes.map(s => new Set(normalizeProps(s.props)));
  const durations = scenes.map(s => nonNegNumber(s.duration));
  const required = scenes.map(s => Boolean(s && s.required));
  const values = scenes.map(s => (s && s.required ? 0 : nonNegNumber(s.value)));

  // prereq[i]: 必须排在 i 之前的场景位掩码（时长受限模式下仅统计同时入选的前置）
  const prereq = new Array(n).fill(0);
  for (const d of (constraints && constraints.dependencies) || []) {
    const a = index.get(d.before);
    const b = index.get(d.after);
    if (a === undefined || b === undefined) continue;
    prereq[b] |= (1 << a);
  }

  // 固定序位（position 为 1 起，内部转 0 起）
  const fixedPosOfScene = new Array(n).fill(-1);
  const sceneAtPos = new Array(n).fill(-1);
  for (const f of (constraints && constraints.fixedPositions) || []) {
    const i = index.get(f.sceneId);
    if (i === undefined) continue;
    const p = Number(f.position) - 1;
    if (p < 0 || p >= n) continue;
    fixedPosOfScene[i] = p;
    sceneAtPos[p] = i; // 若两个场景固定同一序位，DP 必然无解，由冲突分析给出核心
  }

  // 禁止相邻矩阵（对称）
  const bad = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const f of (constraints && constraints.forbiddenAdjacencies) || []) {
    const a = index.get(f.a);
    const b = index.get(f.b);
    if (a === undefined || b === undefined || a === b) continue;
    bad[a][b] = bad[b][a] = true;
  }

  // 换景代价：对称差大小
  const cost = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let c = 0;
      for (const p of propSets[i]) if (!propSets[j].has(p)) c++;
      for (const p of propSets[j]) if (!propSets[i].has(p)) c++;
      cost[i][j] = c;
    }
  }
  const setupCost = propSets.map(s => s.size);

  return {
    n, propSets, durations, required, values,
    prereq, fixedPosOfScene, sceneAtPos, bad, cost, setupCost,
  };
}

/** 子集 DP。返回 { cost, orderIdx } 或 null（无解）。 */
function runDP(model) {
  const { n, prereq, fixedPosOfScene, sceneAtPos, bad, cost, setupCost } = model;
  const fullMask = (1 << n) - 1;
  const size = 1 << n;
  const dp = new Array(size);
  const parent = new Array(size);

  const allowedAt = (j, pos) =>
    (fixedPosOfScene[j] === -1 || fixedPosOfScene[j] === pos) &&
    (sceneAtPos[pos] === -1 || sceneAtPos[pos] === j);

  const ensure = (m) => {
    if (!dp[m]) {
      dp[m] = new Array(n).fill(Infinity);
      parent[m] = new Array(n).fill(-1);
    }
  };

  for (let j = 0; j < n; j++) {
    if (prereq[j] !== 0) continue;      // 有前置依赖的场景不能排首位
    if (!allowedAt(j, 0)) continue;
    const m = 1 << j;
    ensure(m);
    dp[m][j] = setupCost[j];
  }

  for (let mask = 1; mask <= fullMask; mask++) {
    const row = dp[mask];
    if (!row) continue;
    const pos = popcount(mask); // 下一位的序位（0 起）
    if (pos >= n) continue;
    for (let last = 0; last < n; last++) {
      const cur = row[last];
      if (cur === Infinity) continue;
      for (let j = 0; j < n; j++) {
        const bit = 1 << j;
        if (mask & bit) continue;
        if ((prereq[j] & ~mask) !== 0) continue; // 前置依赖必须已全部排入
        if (!allowedAt(j, pos)) continue;
        if (bad[last][j]) continue;
        const nm = mask | bit;
        const nc = cur + cost[last][j];
        ensure(nm);
        if (nc < dp[nm][j]) { // 严格小于：保证结果确定性（按下标字典序取先到达者）
          dp[nm][j] = nc;
          parent[nm][j] = last;
        }
      }
    }
  }

  const fullRow = dp[fullMask];
  if (!fullRow) return null;
  let best = Infinity;
  let bestLast = -1;
  for (let last = 0; last < n; last++) {
    if (fullRow[last] < best) {
      best = fullRow[last];
      bestLast = last;
    }
  }
  if (bestLast === -1) return null;

  const orderIdx = [];
  let mask = fullMask;
  let last = bestLast;
  while (true) {
    orderIdx.push(last);
    const p = parent[mask][last];
    if (p === -1) break;
    mask ^= (1 << last);
    last = p;
  }
  orderIdx.reverse();
  return { cost: best, orderIdx };
}

/**
 * 子集 DP：仅安排 subset（位掩码）中的场景。
 *
 * 与 runDP 的语义差别（对应"未入选场景不参与约束、固定序位按入选序列计算"）：
 *  - 依赖：前置场景未入选时忽略，即只要求 (prereq[j] & subset) 已排入；
 *  - 固定序位：按入选后的演出序列（popcount）逐场景校验，同一序位固定了两个
 *    入选场景时本函数必然返回 null（无需 sceneAtPos 槽位强推）；
 *  - 禁止相邻：只可能由两个入选场景触发。
 *
 * 为枚举大量候选子集，dpCost/parent/gen 为跨子集复用的共享缓冲区，用
 * generation 标记区分不同子集，避免重复分配。
 */
function runSubsetDP(model, subset, buf, genNo) {
  const { n, prereq, fixedPosOfScene, bad, cost, setupCost } = model;
  const { dpCost, dpParent, gen } = buf;
  if (subset === 0) return { cost: 0, orderIdx: [] };

  const idx = (m, j) => m * n + j;
  const fixedOK = (j, pos) => fixedPosOfScene[j] === -1 || fixedPosOfScene[j] === pos;

  for (let j = 0; j < n; j++) {
    const bit = 1 << j;
    if (!(subset & bit)) continue;
    if (prereq[j] & subset) continue;   // 入选的前置依赖不能排首位（未入选的忽略）
    if (!fixedOK(j, 0)) continue;
    const k = idx(bit, j);
    gen[k] = genNo;
    dpCost[k] = setupCost[j];
    dpParent[k] = -1;
  }

  // 数值升序遍历子集：严格子掩码必小于超集，天然满足拓扑序
  for (let m = 1; m <= subset; m++) {
    if ((m & subset) !== m) continue;
    const pos = popcount(m);
    if (pos === popcount(subset)) continue;
    for (let last = 0; last < n; last++) {
      const kLast = idx(m, last);
      if (gen[kLast] !== genNo) continue;
      const cur = dpCost[kLast];
      for (let j = 0; j < n; j++) {
        const bit = 1 << j;
        if (!(subset & bit) || (m & bit)) continue;
        if (prereq[j] & subset & ~m) continue; // 入选的前置必须已排入
        if (!fixedOK(j, pos)) continue;
        if (bad[last][j]) continue;
        const nm = m | bit;
        const k = idx(nm, j);
        const nc = cur + cost[last][j];
        if (gen[k] !== genNo || nc < dpCost[k]) {
          gen[k] = genNo;
          dpCost[k] = nc;
          dpParent[k] = last;
        }
      }
    }
  }

  let best = Infinity;
  let bestLast = -1;
  for (let last = 0; last < n; last++) {
    const k = idx(subset, last);
    if (gen[k] === genNo && dpCost[k] < best) {
      best = dpCost[k];
      bestLast = last;
    }
  }
  if (bestLast === -1) return null;

  const orderIdx = [];
  let m = subset;
  let last = bestLast;
  while (last !== -1) {
    orderIdx.push(last);
    const k = idx(m, last);
    const p = dpParent[k];
    m ^= (1 << last);
    last = p;
  }
  orderIdx.reverse();
  return { cost: best, orderIdx };
}

/** 两个定长下标序列的字典序比较：a < b 返回 -1；更短且为前缀者更小。 */
function compareLex(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length === b.length ? 0 : (a.length < b.length ? -1 : 1);
}

/**
 * 时长受限编排求解：
 * 枚举所有"包含全部必演、总时长不超限"的候选子集，对每个可行子集求道具增减
 * 最小顺序，再按 (可选价值总和 ↓, 道具增减 ↓, 顺序字典序 ↑) 选出全局最优。
 */
function solveLimited(scenes, constraints, options, model) {
  const m = model || buildModel(scenes, constraints);
  const n = m.n;
  const timeLimit = nonNegNumber(options && options.timeLimit);
  const fullMask = (1 << n) - 1;

  const requiredMask = m.required.reduce((acc, r, i) => acc | (r ? (1 << i) : 0), 0);

  // 各掩码的总时长 / 可选价值（按最低位递推）
  const durSum = new Float64Array(1 << n);
  const valSum = new Float64Array(1 << n);
  for (let mask = 1; mask <= fullMask; mask++) {
    const bit = mask & -mask;
    const j = bit.toString(2).length - 1;
    durSum[mask] = durSum[mask ^ bit] + m.durations[j];
    valSum[mask] = valSum[mask ^ bit] + m.values[j];
  }

  // 必演场景自身超时：任何可行子集都不可能满足，直接判定无解
  if (durSum[requiredMask] > timeLimit) {
    return {
      ok: false,
      reason: 'required-overtime',
      message: `必演场景总时长 ${durSum[requiredMask]} 已超过整场时长上限 ${timeLimit}，无法编排。`,
      requiredDuration: durSum[requiredMask],
      timeLimit,
    };
  }

  const size = 1 << n;
  const buf = {
    dpCost: new Float64Array(size * n),
    dpParent: new Int8Array(size * n),
    gen: new Int32Array(size * n),
  };

  let best = null; // { mask, value, cost, orderIdx }
  let genNo = 0;

  // 候选子集 = requiredMask 的超集，且总时长不超过上限
  const optionalMask = fullMask ^ requiredMask;
  for (let opt = optionalMask;; opt = (opt - 1) & optionalMask) {
    const mask = opt | requiredMask;
    if (durSum[mask] <= timeLimit) {
      const res = runSubsetDP(m, mask, buf, ++genNo);
      if (res) {
        const cand = {
          mask,
          value: valSum[mask],
          cost: res.cost,
          orderIdx: res.orderIdx,
        };
        if (!best ||
            cand.value > best.value ||
            (cand.value === best.value && cand.cost < best.cost) ||
            (cand.value === best.value && cand.cost === best.cost &&
             compareLex(cand.orderIdx, best.orderIdx) < 0)) {
          best = cand;
        }
      }
    }
    if (opt === 0) break;
  }

  if (!best) {
    return limitedInfeasible(scenes, constraints, m, requiredMask, {
      timeLimit,
      requiredDuration: durSum[requiredMask],
    });
  }

  const selected = best.orderIdx;
  const selectedSet = new Set(selected);
  const discarded = [];
  for (let i = 0; i < n; i++) if (!selectedSet.has(i)) discarded.push(i);
  // 舍弃顺序按原录入顺序展示，保证确定
  discarded.sort((a, b) => a - b);

  return {
    ok: true,
    mode: 'limited',
    order: selected.map(i => scenes[i].id),
    selectedScenes: selected.map(i => scenes[i].id),
    discardedScenes: discarded.map(i => ({
      id: scenes[i].id,
      required: Boolean(m.required[i]),
      duration: m.durations[i],
      value: m.values[i],
    })),
    totalValue: best.value,
    totalCost: best.cost,
    usedDuration: durSum[best.mask],
    timeLimit,
    remainingDuration: timeLimit - durSum[best.mask],
    steps: buildSteps(scenes, m, selected),
  };
}

/**
 * 必演子集本身排不出可行顺序时给出冲突提示（可选场景无法解除必演内部冲突）。
 * @param extra { timeLimit, requiredDuration } 用于判断固定序位能否由可选场景补位
 */
function limitedInfeasible(scenes, constraints, model, requiredMask, extra) {
  const n = scenes.length;
  const reqScenes = [];
  const reqIdx = new Set();
  scenes.forEach((s, i) => {
    if (requiredMask & (1 << i)) { reqIdx.add(i); reqScenes.push(s); }
  });

  const has = (id) => {
    const i = scenes.findIndex(s => s.id === id);
    return i !== -1 && reqIdx.has(i);
  };
  const reqConstraints = {
    dependencies: ((constraints && constraints.dependencies) || [])
      .filter(d => has(d.before) && has(d.after)),
    fixedPositions: ((constraints && constraints.fixedPositions) || [])
      .filter(f => has(f.sceneId)),
    forbiddenAdjacencies: ((constraints && constraints.forbiddenAdjacencies) || [])
      .filter(f => has(f.a) && has(f.b)),
  };

  // 必演场景固定在超出必演数量的序位上时，必须有足够的可选场景在时长上限内补位。
  const maxPos = reqConstraints.fixedPositions.reduce(
    (mx, f) => Math.max(mx, Number(f.position)), 0);
  const need = maxPos - reqScenes.length;
  if (need > 0) {
    const slack = extra.timeLimit - extra.requiredDuration;
    const optDurations = [];
    for (let i = 0; i < n; i++) if (!reqIdx.has(i)) optDurations.push(model.durations[i]);
    optDurations.sort((a, b) => a - b);
    let cheapest = 0;
    for (let i = 0; i < need; i++) {
      if (i >= optDurations.length) { cheapest = Infinity; break; }
      cheapest += optDurations[i];
    }
    if (cheapest > slack) {
      const f = reqConstraints.fixedPositions.find(x => Number(x.position) === maxPos);
      return {
        ok: false,
        reason: 'no-feasible-arrangement',
        message: `没有可行编排：必演场景共 ${reqScenes.length} 个，而「${
          scenes.find(s => s.id === f.sceneId).name}」要求固定在第 ${maxPos} 位，` +
          `时长上限内也没有足够的可选场景补位。`,
        conflict: describeConstraint(scenes, 'fixedPosition', f),
      };
    }
  }

  const reqModel = buildModel(reqScenes, reqConstraints);
  if (runDP(reqModel) === null) {
    return {
      ok: false,
      reason: 'no-feasible-arrangement',
      message: '包含全部必演场景也找不到满足依赖、固定序位与禁止相邻约束的可行编排（可适当放宽必演场景约束或时长上限）：',
      conflict: analyzeConflict(reqScenes, reqConstraints),
    };
  }

  return {
    ok: false,
    reason: 'no-feasible-arrangement',
    message: '没有可行编排：在给定时长上限内，可选场景无法与必演场景共同排出满足全部约束的序列，可适当放宽时长上限或必演场景的约束。',
    conflict: { type: 'time-limit', constraints: [] },
  };
}

/** 根据入选顺序构造开场布置与逐次换景明细。 */
function buildSteps(scenes, model, orderIdx) {
  const steps = [];
  if (orderIdx.length === 0) return steps;
  const first = orderIdx[0];
  const firstProps = [...model.propSets[first]];
  steps.push({
    type: 'setup',
    scene: scenes[first].id,
    added: firstProps,
    removed: [],
    count: firstProps.length,
  });
  for (let k = 1; k < orderIdx.length; k++) {
    const a = orderIdx[k - 1];
    const b = orderIdx[k];
    const removed = [...model.propSets[a]].filter(p => !model.propSets[b].has(p));
    const added = [...model.propSets[b]].filter(p => !model.propSets[a].has(p));
    steps.push({
      type: 'transition',
      from: scenes[a].id,
      to: scenes[b].id,
      removed,
      added,
      count: removed.length + added.length,
    });
  }
  return steps;
}

/** 检测依赖环，返回构成环的依赖约束数组，无环返回 null。 */
function findDepCycle(scenes, deps) {
  const index = new Map(scenes.map((s, i) => [s.id, i]));
  const adj = scenes.map(() => []);
  for (const d of deps || []) {
    const a = index.get(d.before);
    const b = index.get(d.after);
    if (a === undefined || b === undefined) continue;
    adj[a].push({ to: b, dep: d });
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Array(scenes.length).fill(WHITE);
  const stack = [];
  let result = null;

  function dfs(u) {
    color[u] = GRAY;
    stack.push(u);
    for (const e of adj[u]) {
      if (result) return;
      if (color[e.to] === GRAY) {
        const start = stack.indexOf(e.to);
        const nodes = stack.slice(start).concat([e.to]);
        const cyc = [];
        for (let k = 0; k < nodes.length - 1; k++) {
          const edge = adj[nodes[k]].find(x => x.to === nodes[k + 1]);
          cyc.push(edge.dep);
        }
        result = cyc;
        return;
      }
      if (color[e.to] === WHITE) dfs(e.to);
    }
    stack.pop();
    color[u] = BLACK;
  }

  for (let i = 0; i < scenes.length && !result; i++) {
    if (color[i] === WHITE) dfs(i);
  }
  return result;
}

function describeConstraint(scenes, kind, data) {
  const name = (id) => {
    const s = scenes.find(x => x.id === id);
    return s ? s.name : String(id);
  };
  if (kind === 'dependency') {
    return { kind, data, text: `「${name(data.before)}」必须排在「${name(data.after)}」之前` };
  }
  if (kind === 'fixedPosition') {
    return { kind, data, text: `「${name(data.sceneId)}」固定在第 ${data.position} 位` };
  }
  return { kind, data, text: `「${name(data.a)}」与「${name(data.b)}」禁止相邻` };
}

/**
 * 无解时给出一组可复现的冲突约束：
 * 1. 若依赖存在环，直接返回环上的依赖（本身即最小冲突）；
 * 2. 否则做贪心极小化：逐条尝试移除约束，若仍无解则永久移除，
 *    剩余集合即为"去掉任意一条即可有解"的极小冲突核心。
 */
function analyzeConflict(scenes, constraints) {
  const cycle = findDepCycle(scenes, (constraints && constraints.dependencies) || []);
  if (cycle) {
    return {
      type: 'dependency-cycle',
      message: '场景依赖关系存在循环，无法排出满足全部先后约束的顺序：',
      constraints: cycle.map(d => describeConstraint(scenes, 'dependency', d)),
    };
  }

  const all = [];
  for (const d of (constraints && constraints.dependencies) || []) all.push({ kind: 'dependency', data: d });
  for (const f of (constraints && constraints.fixedPositions) || []) all.push({ kind: 'fixedPosition', data: f });
  for (const f of (constraints && constraints.forbiddenAdjacencies) || []) all.push({ kind: 'forbiddenAdjacency', data: f });

  const satisfiable = (items) => {
    const c = { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] };
    for (const it of items) {
      if (it.kind === 'dependency') c.dependencies.push(it.data);
      else if (it.kind === 'fixedPosition') c.fixedPositions.push(it.data);
      else c.forbiddenAdjacencies.push(it.data);
    }
    return runDP(buildModel(scenes, c)) !== null;
  };

  let core = all.slice();
  for (const item of all) {
    if (core.length <= 1) break;
    const trial = core.filter(x => x !== item);
    if (!satisfiable(trial)) core = trial;
  }

  return {
    type: 'constraint-set',
    message: '以下约束组合相互冲突（移除其中任意一条即可恢复有解）：',
    constraints: core.map(it => describeConstraint(scenes, it.kind, it.data)),
  };
}

/**
 * 求解入口。
 * @param options { mode?: 'standard'|'limited', timeLimit?: number }
 * @returns 有解：{ ok:true, order, totalCost, steps, ... }；
 *          无解：{ ok:false, conflict } 或 { ok:false, reason, message, ... }
 */
function solve(scenes, constraints, options) {
  const mode = options && options.mode === 'limited' ? 'limited' : 'standard';
  const model = buildModel(scenes, constraints);

  if (mode === 'limited') {
    return solveLimited(scenes, constraints, options || {}, model);
  }

  const res = runDP(model);
  if (!res) {
    return { ok: false, conflict: analyzeConflict(scenes, constraints || {}) };
  }

  return {
    ok: true,
    mode: 'standard',
    order: res.orderIdx.map(i => scenes[i].id),
    totalCost: res.cost,
    steps: buildSteps(scenes, model, res.orderIdx),
  };
}

module.exports = { solve, MAX_SCENES, normalizeProps, nonNegNumber };
