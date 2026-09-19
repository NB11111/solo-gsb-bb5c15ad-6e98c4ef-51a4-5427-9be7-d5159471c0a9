'use strict';

const assert = require('assert');
const { solve } = require('../solver');

const S = (id, props, over = {}) => ({
  id, name: id, props,
  duration: over.duration || 0,
  required: Boolean(over.required),
  value: over.value || 0,
});
const empty = { dependencies: [], fixedPositions: [], forbiddenAdjacencies: [] };
const C = (over) => ({ ...empty, ...over });
const L = (timeLimit) => ({ mode: 'limited', timeLimit });

/* 1. 无约束时选择道具变化最少的顺序 */
{
  const scenes = [
    S('A', ['桌', '椅']),
    S('B', ['桌', '椅', '灯']),
    S('C', ['树']),
  ];
  const r = solve(scenes, C());
  assert.strictEqual(r.ok, true);
  // 最优为 C->A->B：开场 1（树）+ C→A 3（撤树上桌椅）+ A→B 1（上灯）= 5
  assert.strictEqual(r.totalCost, 5);
  assert.deepStrictEqual(r.order, ['C', 'A', 'B']);
  assert.strictEqual(r.steps.length, 3);
  assert.strictEqual(r.steps[0].type, 'setup');
}

/* 2. 依赖约束 */
{
  const scenes = [S('A', ['x']), S('B', ['y']), S('C', ['z'])];
  const r = solve(scenes, C({ dependencies: [{ before: 'C', after: 'A' }] }));
  assert.strictEqual(r.ok, true);
  assert.ok(r.order.indexOf('C') < r.order.indexOf('A'));
}

/* 3. 固定序位 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = solve(scenes, C({ fixedPositions: [{ sceneId: 'B', position: 1 }] }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.order[0], 'B');
}

/* 4. 禁止相邻 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = solve(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] }));
  assert.strictEqual(r.ok, true);
  for (let i = 0; i + 1 < r.order.length; i++) {
    const pair = [r.order[i], r.order[i + 1]].sort().join(',');
    assert.notStrictEqual(pair, 'A,B');
  }
}

/* 5. 依赖环 → 无解并指出环 */
{
  const scenes = [S('A', []), S('B', []), S('C', [])];
  const r = solve(scenes, C({
    dependencies: [
      { before: 'A', after: 'B' },
      { before: 'B', after: 'C' },
      { before: 'C', after: 'A' },
    ],
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'dependency-cycle');
  assert.strictEqual(r.conflict.constraints.length, 3);
}

/* 6. 固定序位冲突（两个场景同一位）→ 极小冲突核心 */
{
  const scenes = [S('A', []), S('B', [])];
  const r = solve(scenes, C({
    fixedPositions: [
      { sceneId: 'A', position: 1 },
      { sceneId: 'B', position: 1 },
    ],
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.type, 'constraint-set');
  assert.strictEqual(r.conflict.constraints.length, 2);
}

/* 7. 依赖与固定序位冲突 */
{
  const scenes = [S('A', []), S('B', [])];
  const r = solve(scenes, C({
    dependencies: [{ before: 'A', after: 'B' }],
    fixedPositions: [{ sceneId: 'B', position: 1 }],
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.constraints.length, 2);
}

/* 8. 禁止相邻导致的无解（2 个场景互不相邻） */
{
  const scenes = [S('A', []), S('B', [])];
  const r = solve(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.constraints.length, 1);
}

/* 9. 12 个场景性能冒烟测试（应远小于 1 秒） */
{
  const scenes = [];
  for (let i = 0; i < 12; i++) scenes.push(S(`S${i}`, [`p${i}`, `p${i + 1}`]));
  const t0 = Date.now();
  const r = solve(scenes, C({
    dependencies: [{ before: 'S0', after: 'S11' }],
    fixedPositions: [{ sceneId: 'S5', position: 6 }],
    forbiddenAdjacencies: [{ a: 'S1', b: 'S2' }],
  }));
  const elapsed = Date.now() - t0;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.order.length, 12);
  assert.ok(elapsed < 1000, `求解耗时 ${elapsed}ms，超过预期`);
}

/* 10. 换景明细账目核对：总次数 = 各步之和 */
{
  const scenes = [
    S('A', ['桌', '椅', '灯']),
    S('B', ['椅', '灯', '幕']),
    S('C', ['幕', '鼓']),
  ];
  const r = solve(scenes, C());
  assert.strictEqual(r.ok, true);
  const sum = r.steps.reduce((acc, s) => acc + s.count, 0);
  assert.strictEqual(sum, r.totalCost);
  // 最优顺序为 C->B->A：开场 2（幕鼓）+ C→B 3（撤鼓上椅灯）+ B→A 2（撤幕上桌）= 7
  assert.strictEqual(r.totalCost, 7);
  assert.deepStrictEqual(r.order, ['C', 'B', 'A']);
}

/* 11. 时长受限：结果结构与时长账目 */
{
  const scenes = [
    S('A', ['x'], { required: true, duration: 10 }),
    S('B', ['y'], { required: true, duration: 10 }),
    S('C', ['z'], { value: 5, duration: 10 }),
  ];
  const r = solve(scenes, C(), L(30));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, 'limited');
  assert.ok(r.order.includes('A') && r.order.includes('B'));
  assert.ok(r.selectedScenes.includes('C'));
  assert.deepStrictEqual(r.discardedScenes, []);
  assert.strictEqual(r.totalValue, 5);
  assert.strictEqual(r.usedDuration, 30);
  assert.strictEqual(r.timeLimit, 30);
  assert.strictEqual(r.remainingDuration, 0);
}

/* 12. 时长受限：上限只容得下必演，可选全舍弃 */
{
  const scenes = [
    S('A', ['x'], { required: true, duration: 10 }),
    S('B', ['y'], { required: true, duration: 10 }),
    S('C', ['z'], { value: 5, duration: 10 }),
  ];
  const r = solve(scenes, C(), L(20));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order.sort(), ['A', 'B']);
  assert.deepStrictEqual(r.discardedScenes.map(d => d.id), ['C']);
  assert.strictEqual(r.discardedScenes[0].required, false);
  assert.strictEqual(r.totalValue, 0);
  assert.strictEqual(r.usedDuration, 20);
  assert.strictEqual(r.remainingDuration, 0);
}

/* 13. 第一目标：最大化入选可选价值（在价值面前时长不直接起决定作用） */
{
  const scenes = [
    S('A', ['x'], { required: true, duration: 10 }),
    S('C', ['c'], { value: 5, duration: 10 }),
    S('D', ['d'], { value: 9, duration: 15 }),
  ];
  // 上限 25：C 与 D 只能二选一（10+10=20 与 10+15=25），选价值更高的 D
  const r = solve(scenes, C(), L(25));
  assert.strictEqual(r.ok, true);
  assert.ok(r.order.includes('D'));
  assert.ok(!r.order.includes('C'));
  assert.strictEqual(r.totalValue, 9);
}

/* 14. 第二目标：价值相同时最小化道具增减 */
{
  const scenes = [
    S('A', ['桌', '椅'], { required: true, duration: 10 }),
    S('B', ['桌', '椅', '灯'], { value: 3, duration: 10 }),
    S('C', ['树'], { value: 3, duration: 10 }),
  ];
  // 上限 20：B、C 二选一，价值相同；选 B（与 A 道具更接近）
  const r = solve(scenes, C(), L(20));
  assert.strictEqual(r.ok, true);
  assert.ok(r.order.includes('B'));
  assert.ok(!r.order.includes('C'));
  assert.strictEqual(r.totalValue, 3);
  // A→B 仅 1 次换景；开场 2，总 3
  assert.strictEqual(r.totalCost, 3);
}

/* 15. 未入选场景不参与依赖：依赖的一方未入选时直接忽略 */
{
  const scenes = [
    S('A', ['x'], { required: true, duration: 10 }),
    S('C', ['z'], { value: 5, duration: 10 }),
  ];
  const r = solve(scenes, C({ dependencies: [{ before: 'C', after: 'A' }] }), L(10));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['A']);
  assert.deepStrictEqual(r.discardedScenes.map(d => d.id), ['C']);
}

/* 16. 未入选场景不参与禁止相邻；入选时仍需满足 */
{
  const scenes = [
    S('A', [], { required: true, duration: 10 }),
    S('B', [], { required: true, duration: 10 }),
    S('C', [], { value: 5, duration: 10 }),
  ];
  // 上限 20：C 因时长不能入选，A、B 又禁止相邻 → 必演层面不可行
  let r = solve(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] }), L(20));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-feasible-arrangement');
  // 上限 30：C 入选并插在 A、B 之间即可满足
  r = solve(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] }), L(30));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['B', 'C', 'A']);
}

/* 17. 固定序位按入选后的演出序列计算 */
{
  const scenes = [
    S('A', [], { required: true, duration: 10 }),
    S('B', [], { required: true, duration: 10 }),
    S('C', [], { value: 5, duration: 10 }),
  ];
  // 仅必演入选时，B 固定第 2 位
  const r = solve(scenes, C({ fixedPositions: [{ sceneId: 'B', position: 2 }] }), L(20));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.order, ['A', 'B']);
  // 全部入选时，B 仍在第 2 位
  const r2 = solve(scenes, C({ fixedPositions: [{ sceneId: 'B', position: 2 }] }), L(30));
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.order[1], 'B');
}

/* 18. 固定序位超出必演数量、但可选场景可在时长内补位 → 仍有解 */
{
  const scenes = [
    S('A', [], { required: true, duration: 10 }),
    S('B', [], { required: true, duration: 10 }),
    S('C', [], { value: 5, duration: 10 }),
  ];
  const r = solve(scenes, C({ fixedPositions: [{ sceneId: 'B', position: 3 }] }), L(30));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.order[2], 'B');
}

/* 19. 必演场景总时长超限 → required-overtime */
{
  const scenes = [
    S('A', [], { required: true, duration: 15 }),
    S('B', [], { required: true, duration: 20 }),
    S('C', [], { value: 5, duration: 1 }),
  ];
  const r = solve(scenes, C(), L(30));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'required-overtime');
  assert.strictEqual(r.requiredDuration, 35);
  assert.strictEqual(r.timeLimit, 30);
}

/* 20. 必演内部不可行（禁止相邻且无位可插）→ no-feasible-arrangement 并指出冲突 */
{
  const scenes = [
    S('A', [], { required: true, duration: 10 }),
    S('B', [], { required: true, duration: 10 }),
    S('C', [], { value: 5, duration: 10 }),
  ];
  const r = solve(scenes, C({ forbiddenAdjacencies: [{ a: 'A', b: 'B' }] }), L(20));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-feasible-arrangement');
  assert.ok(r.message.length > 0);
  assert.ok(r.conflict.constraints.some(c => c.kind === 'forbiddenAdjacency'));
}

/* 21. 必演依赖环 → no-feasible-arrangement 指出环 */
{
  const scenes = [
    S('A', [], { required: true, duration: 10 }),
    S('B', [], { required: true, duration: 10 }),
    S('C', [], { required: true, duration: 10 }),
  ];
  const r = solve(scenes, C({
    dependencies: [
      { before: 'A', after: 'B' },
      { before: 'B', after: 'C' },
      { before: 'C', after: 'A' },
    ],
  }), L(100));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-feasible-arrangement');
  assert.strictEqual(r.conflict.type, 'dependency-cycle');
  assert.strictEqual(r.conflict.constraints.length, 3);
}

/* 22. 固定序位需要补位但时长内可选场景不够 → no-feasible-arrangement */
{
  const scenes = [
    S('A', [], { required: true, duration: 10 }),
    S('B', [], { required: true, duration: 10 }),
    S('C', [], { value: 5, duration: 30 }),
  ];
  // B 固定第 3 位，需要 1 个可选补位；C 时长 30，必演已用 20，上限 40 放不下
  const r = solve(scenes, C({ fixedPositions: [{ sceneId: 'B', position: 3 }] }), L(40));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-feasible-arrangement');
}

/* 23. 同分结果确定：重复求解顺序一致 */
{
  const scenes = [
    S('A', ['a'], { required: true, duration: 10 }),
    S('B', ['b'], { value: 1, duration: 10 }),
    S('C', ['c'], { value: 1, duration: 10 }),
    S('D', ['d'], { value: 1, duration: 10 }),
  ];
  const cons = C();
  const r1 = solve(JSON.parse(JSON.stringify(scenes)), cons, L(40));
  const r2 = solve(JSON.parse(JSON.stringify(scenes)), cons, L(40));
  assert.strictEqual(r1.ok, true);
  assert.deepStrictEqual(r1.order, r2.order);
}

/* 24. 12 场景时长受限性能冒烟（应小于 2 秒） */
{
  const scenes = [];
  for (let i = 0; i < 12; i++) {
    scenes.push(S(`S${i}`, [`p${i}`, `p${i + 1}`], { duration: 5, value: 10 }));
  }
  scenes[0].required = true;
  scenes[11].required = true;
  const t0 = Date.now();
  const r = solve(scenes, C({
    dependencies: [{ before: 'S0', after: 'S11' }],
    fixedPositions: [{ sceneId: 'S5', position: 6 }],
    forbiddenAdjacencies: [{ a: 'S1', b: 'S2' }],
  }), L(55));
  const elapsed = Date.now() - t0;
  assert.strictEqual(r.ok, true);
  assert.ok(r.order.includes('S0') && r.order.includes('S11'));
  assert.ok(r.usedDuration <= 55);
  assert.ok(elapsed < 2000, `时长受限求解耗时 ${elapsed}ms，超过预期`);
}

/* 25. 换景明细与账目（时长受限模式） */
{
  const scenes = [
    S('A', ['桌', '椅', '灯'], { required: true, duration: 10 }),
    S('B', ['椅', '灯', '幕'], { value: 3, duration: 10 }),
  ];
  const r = solve(scenes, C(), L(20));
  assert.strictEqual(r.ok, true);
  const sum = r.steps.reduce((acc, s) => acc + s.count, 0);
  assert.strictEqual(sum, r.totalCost);
  assert.strictEqual(r.steps[0].type, 'setup');
}

/* 26. 旧调用方式（不传 options）与标准模式结果一致，且返回 mode 字段 */
{
  const scenes = [S('A', ['桌', '椅']), S('B', ['桌']), S('C', ['树'])];
  const r1 = solve(scenes, C());
  const r2 = solve(scenes, C(), { mode: 'standard' });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.mode, 'standard');
  assert.deepStrictEqual(r1.order, r2.order);
  assert.strictEqual(r1.totalCost, r2.totalCost);
}

console.log('全部测试通过 ✔');
