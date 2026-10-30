// src/systems/RandomPool.js
// 随机池抽取 —— 数据来自《物品库》「随机池」工作表（gen_library.py 生成到 POOLS）
//
// 核心规则（物品库「说明」+ 用户确认）：
//   1. 占位物品（野生种子 FAC-013、回忆录 ITM-COL-004）**平时抽取权重为 0**；
//      只有当某个池的可用候选数 < 本次需要抽的件数时，才把占位物品补进抽取范围。
//   2. 允许同一池出现多个同样的占位物品。
//   3. 权重列目前全为空 → 按等权抽取；将来填了权重，只改数据不改代码。
//   4. 候选不足时允许重复抽同一条目（否则池子抽不满，商店会少格）。

import { POOLS, ITEMS } from '../data/items.js';
import { Random } from '../core/Random.js';

/** 表格里被标记为「占位物品」的 id（从物品总表备注里自动识别，不写死） */
export const PLACEHOLDER_IDS = Object.values(ITEMS)
  .filter((it) => (it.notes || '').includes('占位物品') || it.hiddenTags?.includes('占位'))
  .map((it) => it.id);

/** 取池定义，找不到返回 null */
export function getPool(code) {
  return POOLS[code] || null;
}

/** 全部池编号 */
export function allPoolCodes() {
  return Object.keys(POOLS);
}

/**
 * 解析某个池"本次可用"的候选列表。
 * @param {string} code    池编号，如 'POOL-05'
 * @param {number} need    本次要抽几件
 * @returns {{code, pool, candidates, placeholderUsed, realCount}}
 */
export function resolveCandidates(code, need = 1) {
  const pool = getPool(code);
  if (!pool) return { code, pool: null, candidates: [], placeholderUsed: false, realCount: 0 };

  const real = pool.entries.filter((e) => e.id && !e.placeholder);
  const ownPlaceholders = pool.entries.filter((e) => e.id && e.placeholder);

  // 候选够 → 占位权重 0，完全不进入抽取范围
  if (real.length >= need) {
    return { code, pool, candidates: real, placeholderUsed: false, realCount: real.length };
  }

  // 候选不够 → 本地占位 + 全局占位（如魔导书池本身没有占位条目，用野生种子兜底）
  const injected = [];
  for (const ph of ownPlaceholders) injected.push(ph);
  for (const id of PLACEHOLDER_IDS) {
    if (injected.some((e) => e.id === id)) continue;
    injected.push({ libCode: null, id, name: ITEMS[id]?.name, price: null, weight: null, rarity: 99, placeholder: true, notes: '候选不足时补入' });
  }
  return {
    code,
    pool,
    candidates: [...real, ...injected],
    placeholderUsed: true,
    realCount: real.length,
  };
}

/** 按权重抽一个（权重为空按 1 处理） */
function pickWeighted(list) {
  const weights = list.map((e) => (typeof e.weight === 'number' && e.weight > 0 ? e.weight : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

/**
 * 从池里抽 n 件（默认不去重；候选不足时必然重复）。
 * @returns {Array<{id, name, price, rarity, placeholder}>}
 */
export function drawFromPool(code, count = 1, opts = {}) {
  const { unique = false } = opts;
  const { candidates, placeholderUsed } = resolveCandidates(code, count);
  if (candidates.length === 0) return [];

  const picked = [];
  const pool = candidates.slice();
  for (let i = 0; i < count; i++) {
    const src = unique && pool.length > 0 ? pool : candidates;
    if (src.length === 0) break;
    const hit = pickWeighted(src);
    picked.push({ ...hit, wasPlaceholder: placeholderUsed && hit.placeholder === true });
    if (unique) {
      const idx = pool.indexOf(hit);
      if (idx >= 0) pool.splice(idx, 1);
    }
  }
  return picked;
}

/**
 * 按类别数量区间抽一组商品（商店 / 魔法商店共用）。
 * @param {Array<{pool:string, min:number, max:number}>} groups
 * @returns {{items: Array, detail: Array}}  detail 供 UI/调试查看每类抽了几件
 */
export function drawGroups(groups) {
  const items = [];
  const detail = [];
  for (const g of groups) {
    const n = Random.rand(g.min, g.max);
    const picked = drawFromPool(g.pool, n);
    items.push(...picked);
    detail.push({ pool: g.pool, want: n, got: picked.length });
  }
  return { items, detail };
}
