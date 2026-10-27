// src/state/migrate.js
// GS 存档迁移：把旧存档的 GS 补全到当前 schema
// 算法：拿一份全新的 createInitialState() 作为模板，
//       对 loadedGs 做深合并——缺失字段从模板取默认值。
//       只补缺失字段，不覆盖已有值（玩家存档里的数据不能被清空）。
//       递归补全 plain object，数组保持原样不动。

import { createInitialState } from './gameState.js';
import { devLog } from '../core/Logger.js';

/**
 * 判断一个值是否是 plain object（非数组、非 null）
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 递归补全 target 里缺失的字段，从 source 取默认值。
 * - 只处理 plain object
 * - 数组保持原样不补（outerTiles、available、items 等）
 * - target 里已有的值一律不覆盖
 * @param {object} target 被补全的对象（原地修改）
 * @param {object} source 模板对象
 * @param {string} path 当前字段路径（用于日志）
 * @returns {string[]} 补全过的字段路径列表
 */
function deepMergeDefaults(target, source, path = '') {
  const filled = [];
  if (!isPlainObject(target) || !isPlainObject(source)) return filled;

  for (const key of Object.keys(source)) {
    const childPath = path ? `${path}.${key}` : key;

    if (!(key in target)) {
      // target 缺失这个 key → 从 source 整体拷贝一份默认值
      // 注意：数组直接引用即可（createInitialState 每次都新建 fresh 对象），
      //       但为了安全对 plain object 做深拷贝
      const srcVal = source[key];
      if (Array.isArray(srcVal)) {
        target[key] = srcVal.slice(); // 数组浅拷贝足够
      } else if (isPlainObject(srcVal)) {
        target[key] = JSON.parse(JSON.stringify(srcVal)); // 对象深拷贝
      } else {
        target[key] = srcVal; // 原始值直接赋值
      }
      filled.push(childPath);
      continue;
    }

    // target 有这个 key → 如果两边都是 plain object，递归补全
    if (isPlainObject(target[key]) && isPlainObject(source[key])) {
      filled.push(...deepMergeDefaults(target[key], source[key], childPath));
    }
    // 数组、原始值、类型不匹配：一律不覆盖
  }

  return filled;
}

/**
 * 把旧存档的 GS 迁移到当前 schema。
 * 原地修改 loadedGs（也返回它方便链式调用）。
 * @param {object} loadedGs 从 Storage.load 拿到的 GS
 * @returns {object} 补全后的 GS（就是 loadedGs 本身）
 */
export function migrateGS(loadedGs) {
  if (!isPlainObject(loadedGs)) {
    devLog.warn('[migrateGS] loadedGs 不是有效对象，跳过迁移');
    return loadedGs;
  }

  const fresh = createInitialState();
  const filled = deepMergeDefaults(loadedGs, fresh);

  if (filled.length > 0) {
    devLog.info('[migrateGS] 补全了', filled.length, '个缺失字段:', filled.join(', '));
  } else {
    devLog.info('[migrateGS] 存档 schema 已是最新，无需迁移');
  }

  return loadedGs;
}

export default migrateGS;
