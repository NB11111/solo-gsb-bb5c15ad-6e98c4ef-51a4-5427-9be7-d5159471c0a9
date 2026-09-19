'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'plans.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll() {
  ensureDir();
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(plans) {
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(plans, null, 2));
  fs.renameSync(tmp, FILE); // 原子替换，避免写一半损坏
}

function list() {
  return readAll()
    .map(p => ({ id: p.id, name: p.name, sceneCount: p.scenes.length, updatedAt: p.updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function get(id) {
  const plan = readAll().find(p => p.id === id) || null;
  return plan ? withDefaults(plan) : null;
}

/** 兼容旧数据：补齐时长受限编排引入的字段。 */
function withDefaults(plan) {
  plan.scenes = (plan.scenes || []).map(s => ({
    id: s.id,
    name: s.name,
    props: Array.isArray(s.props) ? s.props : [],
    duration: Number.isFinite(Number(s.duration)) ? Number(s.duration) : 0,
    required: Boolean(s.required),
    value: Number.isFinite(Number(s.value)) ? Number(s.value) : 0,
  }));
  plan.options = plan.options && plan.options.mode === 'limited'
    ? { mode: 'limited', timeLimit: Number(plan.options.timeLimit) || 0 }
    : { mode: 'standard' };
  return plan;
}

function create({ name, scenes, constraints, options }) {
  const plans = readAll();
  const now = new Date().toISOString();
  const plan = {
    id: crypto.randomUUID(), name, scenes, constraints,
    options: options || { mode: 'standard' },
    createdAt: now, updatedAt: now,
  };
  plans.push(plan);
  writeAll(plans);
  return plan;
}

function update(id, { name, scenes, constraints, options }) {
  const plans = readAll();
  const i = plans.findIndex(p => p.id === id);
  if (i === -1) return null;
  plans[i] = {
    ...plans[i], name, scenes, constraints,
    options: options || { mode: 'standard' },
    updatedAt: new Date().toISOString(),
  };
  writeAll(plans);
  return plans[i];
}

function remove(id) {
  const plans = readAll();
  const next = plans.filter(p => p.id !== id);
  if (next.length === plans.length) return false;
  writeAll(next);
  return true;
}

module.exports = { list, get, create, update, remove };
