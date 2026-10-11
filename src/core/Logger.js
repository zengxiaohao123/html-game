/**
 * core/Logger.js —— 开发日志与游戏内"行动记录"双通道
 *
 * 1. devLog：写到 console + 内存环形缓冲（供调试面板 / 导出，满足"日志保存"）。
 * 2. GameLog：游戏内行动记录（探索态信息区、战斗战斗记录），驱动 UI。
 *
 * 所有关键结算都应留痕，便于排查规则实现是否符合设计文档。
 */

import { EventBus } from './EventBus.js';
import { GE } from './GameEvents.js';
import { LogKind } from './Const.js';

const DEV_RING_MAX = 2000;
const devRing = [];

function ts() {
  return new Date().toISOString().slice(11, 23);
}

export const devLog = {
  _push(level, tag, args) {
    const entry = { t: ts(), level, tag, msg: args.map(String).join(' ') };
    devRing.push(entry);
    if (devRing.length > DEV_RING_MAX) devRing.shift();
    const line = `[${entry.t}][${level}][${tag}] ${entry.msg}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  },
  info(tag, ...a) { devLog._push('info', tag, a); },
  warn(tag, ...a) { devLog._push('warn', tag, a); },
  error(tag, ...a) { devLog._push('error', tag, a); },
  ring() { return devRing.slice(); },
  dump() {
    return devRing.map((e) => `[${e.t}][${e.level}][${e.tag}] ${e.msg}`).join('\n');
  },
};

/**
 * 游戏内记录器：每个频道（explore / combat）独立保留最近 N 条。
 * UI 订阅对应事件增量渲染。
 */
const CHANNEL_MAX = 200;
const channels = new Map();

function push(channel, kind, text, extra = null) {
  if (!channels.has(channel)) channels.set(channel, []);
  const list = channels.get(channel);
  const entry = { id: Date.now() + Math.random(), kind, text, extra };
  list.push(entry);
  if (list.length > CHANNEL_MAX) list.shift();
  EventBus.emit(GE.EXPLORE_LOG, { channel, entry });
  if (channel === 'combat') EventBus.emit(GE.BATTLE_LOG, entry);
  return entry;
}

export const GameLog = {
  info(ch, text, extra) { return push(ch, LogKind.INFO, text, extra); },
  good(ch, text, extra) { return push(ch, LogKind.GOOD, text, extra); },
  bad(ch, text, extra) { return push(ch, LogKind.BAD, text, extra); },
  reaction(ch, text, extra) { return push(ch, LogKind.REACTION, text, extra); },
  system(ch, text, extra) { return push(ch, LogKind.SYSTEM, text, extra); },
  list(channel) { return channels.get(channel) ?? []; },
  clear(channel) { channels.set(channel, []); },
  clearAll() { channels.clear(); },
};
