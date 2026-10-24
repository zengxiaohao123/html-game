// src/state/storage.js
// localStorage 8 槽位存档读写
// 约定：
//   - slot 1 = 自动存档（每日开始 + 返回主菜单触发）
//   - slot 2~8 = 手动存档
//   - 所有 save 必须深克隆：JSON.parse(JSON.stringify(gs))，避免外部引用干扰

import { devLog } from '../core/Logger.js';
import { SLOTS_MAX, AUTOSAVE_SLOT, STORAGE_PREFIX } from '../utils/constants.js';

/**
 * 生成某槽位对应的 localStorage key
 * @param {number} slot 1~8
 */
function slotKey(slot) {
  if (slot === AUTOSAVE_SLOT) return `${STORAGE_PREFIX}autosave`;
  return `${STORAGE_PREFIX}slot_${slot}`;
}

/**
 * 深克隆 GS（序列化 round-trip，足够 Phase 0 用）
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export const Storage = {
  /**
   * 存档
   * @param {number} slot 槽位号 1~8
   * @param {object} gs 全局状态对象
   * @returns {boolean} 是否保存成功
   */
  save(slot, gs) {
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOTS_MAX) {
      devLog.error('Storage.save: invalid slot', slot);
      return false;
    }
    try {
      const payload = {
        slot,
        savedAt: Date.now(),
        gs: deepClone(gs),
      };
      localStorage.setItem(slotKey(slot), JSON.stringify(payload));
      devLog.info('存档成功 slot', slot);
      return true;
    } catch (e) {
      devLog.error('Storage.save 失败:', e);
      return false;
    }
  },

  /**
   * 自动存档（写 slot 1）
   * @param {object} gs
   */
  autoSave(gs) {
    return Storage.save(AUTOSAVE_SLOT, gs);
  },

  /**
   * 读档
   * @param {number} slot
   * @returns {object|null} GS 对象（已深克隆）；槽位为空或损坏返回 null
   */
  load(slot) {
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOTS_MAX) {
      devLog.error('Storage.load: invalid slot', slot);
      return null;
    }
    try {
      const raw = localStorage.getItem(slotKey(slot));
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (!payload || !payload.gs) {
        devLog.warn('Storage.load: slot', slot, 'payload 缺少 gs 字段');
        return null;
      }
      devLog.info('读档成功 slot', slot, 'savedAt:', new Date(payload.savedAt).toLocaleString());
      return deepClone(payload.gs);
    } catch (e) {
      devLog.error('Storage.load 失败:', e);
      return null;
    }
  },

  /**
   * 列出所有槽位的元信息（不含 GS 本体）
   * @returns {Array<{slot:number, used:boolean, savedAt:number|null}>}
   */
  listSlots() {
    const result = [];
    for (let s = 1; s <= SLOTS_MAX; s++) {
      const raw = localStorage.getItem(slotKey(s));
      if (!raw) {
        result.push({ slot: s, used: false, savedAt: null });
        continue;
      }
      try {
        const p = JSON.parse(raw);
        result.push({ slot: s, used: true, savedAt: p.savedAt ?? null });
      } catch {
        result.push({ slot: s, used: false, savedAt: null });
      }
    }
    return result;
  },

  /**
   * 清空某槽位
   * @param {number} slot
   * @returns {boolean}
   */
  clearSlot(slot) {
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOTS_MAX) {
      devLog.error('Storage.clearSlot: invalid slot', slot);
      return false;
    }
    try {
      localStorage.removeItem(slotKey(slot));
      devLog.info('清档 slot', slot);
      return true;
    } catch (e) {
      devLog.error('Storage.clearSlot 失败:', e);
      return false;
    }
  },
};
