/**
 * core/Storage.js —— 存档系统（§6.3）
 *
 * 8 个槽位：0 号=自动存档（睡觉）；1..7 号=手动。
 * 内容段存档点：战斗/事件/剧情前一帧（调用方在进入前保存快照）。
 * localStorage 持久化；带版本号，读档时做迁移校验。
 *
 * 存档内容是"游戏世界完整快照"（StateSerializer 负责序列化 GameState）。
 */

import { CONFIG } from './Const.js';
import { devLog } from './Logger.js';

const KEY_PREFIX = 'hero_before_save_v1::';
export const SAVE_VERSION = 1;
export const SAVE_META_KEY = `${KEY_PREFIX}meta`;
const SETTINGS_KEY = `${KEY_PREFIX}settings`;

function slotKey(i) { return `${KEY_PREFIX}slot::${i}`; }

function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** 读取所有槽位元信息（不含完整快照，给存档/读档列表用） */
export function listSaves() {
  const meta = safeParse(localStorage.getItem(SAVE_META_KEY), {}) || {};
  const result = [];
  for (let i = 0; i < CONFIG.SAVE_SLOTS; i++) {
    result.push(meta[i] ?? { slot: i, empty: true });
  }
  return result;
}

/**
 * 写入存档
 * @param {number} slot 0..7
 * @param {object} snapshot 完整世界快照
 * @param {object} info { label, kind: 'auto'|'manual', day, location }
 */
export function writeSave(slot, snapshot, info = {}) {
  if (slot < 0 || slot >= CONFIG.SAVE_SLOTS) {
    throw new Error(`非法存档槽位 ${slot}`);
  }
  const now = Date.now();
  const record = {
    version: SAVE_VERSION,
    savedAt: now,
    kind: info.kind || (slot === CONFIG.AUTO_SLOT ? 'auto' : 'manual'),
    label: info.label || '',
    day: info.day ?? null,
    location: info.location ?? '',
    snapshot,
  };
  localStorage.setItem(slotKey(slot), JSON.stringify(record));

  const meta = safeParse(localStorage.getItem(SAVE_META_KEY), {}) || {};
  meta[slot] = {
    slot, empty: false, savedAt: now, version: SAVE_VERSION,
    kind: record.kind, label: record.label, day: record.day, location: record.location,
  };
  localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta));
  devLog.info('save', `写入槽位 ${slot}（${record.kind}）day=${info.day ?? '?'}`);
  return meta[slot];
}

/** 读取完整存档（含 snapshot）；空槽返回 null */
export function readSave(slot) {
  const raw = localStorage.getItem(slotKey(slot));
  if (!raw) return null;
  const record = safeParse(raw, null);
  if (!record) return null;
  if (record.version !== SAVE_VERSION) {
    devLog.warn('save', `槽位 ${slot} 版本 ${record.version} 与当前 ${SAVE_VERSION} 不一致，尝试兼容`);
  }
  return record;
}

export function deleteSave(slot) {
  localStorage.removeItem(slotKey(slot));
  const meta = safeParse(localStorage.getItem(SAVE_META_KEY), {}) || {};
  delete meta[slot];
  localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta));
}

/** 是否存在任意存档（主菜单"继续游戏"） */
export function hasAnySave() {
  return listSaves().some((s) => !s.empty);
}

/** 设置（音量等） */
export function loadSettings() {
  return safeParse(localStorage.getItem(SETTINGS_KEY), {
    bgmVolume: 0.6, sfxVolume: 0.8, textSpeed: 'normal',
  });
}
export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

