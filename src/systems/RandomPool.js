// src/systems/RandomPool.js
// 随机池抽取 —— 数据来自《物品库》「随机池」工作表（gen_library.py 生成到 POOLS）
//
// 核心规则（物品库「说明」+ 用户 2026-11-14 确认）：
//   1. 占位物品只使用**本池自己**标注为「是否占位＝是」的条目，不再跨池兜底。
//      平时不进入抽取范围；只有当本池"本次可用候选数 < 本次还需抽的件数"时，
//      才把本池占位条目补进候选。阈值 = 本次还需抽的件数（见设计文档 §12.6）。
//   2. 占位物品一定不具【唯一】，允许同一批里重复抽到多个。
//   3. 唯一物品（收藏品 / 魔导书等）：
//        * 同一批抽取内抽过即封禁，不再重复出现；
//        * exclude 集合里已有的（背包持有 / 其他商店未售出）直接不进候选；
//        * 传入 gs 时自动并入全局占用表（ItemUniqueness）。
//   4. 权重列目前全为空 → 按等权抽取；将来填了权重，只改数据不改代码。
//   5. 候选不足且本池没有占位条目时，宁可少抽，也不重复抽唯一物品。

import { POOLS, ITEMS } from '../data/items.js';
import { isUniqueItem, unavailableUniqueIds } from './ItemUniqueness.js';

/** 表格里被标记为「占位物品」的 id（仅供校验 / 冒烟用，抽取不再跨池使用） */
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
 * 把 opts 里的 exclude（Set / 数组）与 gs 的全局占用表合并成一个可变集合。
 * 返回的 Set 会被抽取向后续写入"本批已抽中的唯一物品"。
 */
function resolveBlocked(opts = {}) {
  const blocked = opts.exclude instanceof Set
    ? opts.exclude
    : new Set(opts.exclude || []);
  if (opts.gs) {
    for (const id of unavailableUniqueIds(opts.gs, opts.exceptTileIdx ?? null)) blocked.add(id);
  }
  return blocked;
}

/**
 * 解析某个池"本次可用"的候选列表（不负责写入占用）。
 * @param {string} code   池编号，如 'POOL-07'
 * @param {number} need   本次要抽几件
 * @param {{exclude?:Set<string>|string[], gs?:object, exceptTileIdx?:number}} opts
 * @returns {{code, pool, candidates, placeholderUsed, realCount}}
 */
export function resolveCandidates(code, need = 1, opts = {}) {
  const pool = getPool(code);
  if (!pool) return { code, pool: null, candidates: [], placeholderUsed: false, realCount: 0 };

  const blocked = resolveBlocked(opts);
  const real = pool.entries.filter((e) => e.id && !e.placeholder && !blocked.has(e.id));
  const ownPlaceholders = pool.entries.filter((e) => e.id && e.placeholder);

  // 候选够 → 占位完全不进入抽取范围
  if (real.length >= need || ownPlaceholders.length === 0) {
    return { code, pool, candidates: real, placeholderUsed: false, realCount: real.length };
  }
  return {
    code,
    pool,
    candidates: [...real, ...ownPlaceholders],
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
 * 从池里抽 n 件。
 * @param {string} code
 * @param {number} count
 * @param {{gs?:object, exclude?:Set<string>|string[], unique?:boolean, exceptTileIdx?:number}} opts
 *   unique=true 时非占位条目在本批内也不重复（旧行为，保留给需要严格不重复的调用方）
 * @returns {Array<{id, name, price, rarity, placeholder, wasPlaceholder}>}
 */
export function drawFromPool(code, count = 1, opts = {}) {
  const pool = getPool(code);
  if (!pool) return [];

  const blocked = resolveBlocked(opts);
  const strictUnique = opts.unique === true;
  const picked = [];

  for (let i = 0; i < count; i++) {
    const remaining = count - i;
    const real = pool.entries.filter((e) => e.id && !e.placeholder && !blocked.has(e.id));
    const ownPlaceholders = pool.entries.filter((e) => e.id && e.placeholder);
    // 阈值：本池可用正常候选 < 本次还需抽的件数 → 补入本池占位条目
    const list = (real.length < remaining && ownPlaceholders.length > 0)
      ? [...real, ...ownPlaceholders]
      : real;
    if (list.length === 0) break;

    const hit = pickWeighted(list);
    if (isUniqueItem(hit.id) || (strictUnique && !hit.placeholder)) blocked.add(hit.id);
    picked.push({ ...hit, wasPlaceholder: hit.placeholder === true });
  }
  return picked;
}
