// src/systems/CalendarSystem.js
// 日历系统（设计文档 v0.5 §6.1）
//
// 规则：
//   * 周 = 7 天；月 = 28 天（正好 4 周）；一年只有 3、6、9、12 四个月
//     → 一年 = 4 个月 = 112 天 = 16 周
//   * 开局时间：1 年 3 月 1 日，星期一
//   * 每周一早晨（睡觉结束后的【每一日开始时】）触发周级事件（商店自动刷新等）
//
// 存放位置：gs.calendar = { year, month, dayOfMonth, weekday }
//   weekday 1=周一 … 7=周日（周一为一周之始）
// gs.day 仍然保留为"累计第几天"，两者由 tickDay 同步维护。

export const MONTHS = [3, 6, 9, 12];
export const DAYS_PER_MONTH = 28;
export const DAYS_PER_WEEK = 7;
const WEEKDAY_NAMES = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

/** 初始化日历（新游戏时调用；已存在则不动） */
export function initCalendar(gs) {
  if (!gs.calendar) {
    gs.calendar = { year: 1, month: 3, dayOfMonth: 1, weekday: 1 };
  }
  return gs.calendar;
}

/** 取日历（缺失时惰性补一份，兼容旧存档） */
export function getCalendar(gs) {
  return gs.calendar || initCalendar(gs);
}

/** 一周的编号（从开局算起的第几周，用于商店"每周刷新"判定） */
export function weekKey(gs) {
  const c = getCalendar(gs);
  return `${c.year}-M${c.month}-W${Math.floor((c.dayOfMonth - 1) / DAYS_PER_WEEK) + 1}`;
}

/** 是否周一 */
export function isMonday(gs) {
  return getCalendar(gs).weekday === 1;
}

/**
 * 推进一天。返回本次跨过的边界，供上层触发周/月/年事件。
 * @returns {{newWeek:boolean, newMonth:boolean, newYear:boolean}}
 */
export function tickDay(gs) {
  const c = getCalendar(gs);
  c.dayOfMonth += 1;
  let newMonth = false;
  let newYear = false;

  if (c.dayOfMonth > DAYS_PER_MONTH) {
    c.dayOfMonth = 1;
    const mi = MONTHS.indexOf(c.month);
    const next = MONTHS[(mi + 1) % MONTHS.length];
    if (mi === MONTHS.length - 1) newYear = true;   // 12 月 → 次年 3 月
    c.month = next;
    newMonth = true;
  }

  // 周一为一周之始：dayOfMonth 1/8/15/22 对应周一
  c.weekday = ((c.dayOfMonth - 1) % DAYS_PER_WEEK) + 1;

  return { newWeek: c.weekday === 1, newMonth, newYear };
}

/** "1 年 3 月 1 日 星期一" */
export function formatCalendar(gs) {
  const c = getCalendar(gs);
  return `${c.year} 年 ${c.month} 月 ${c.dayOfMonth} 日 ${WEEKDAY_NAMES[c.weekday] || ''}`.trim();
}

/** 顶部 UI 用的短格式："3月1日 周一" */
export function formatShort(gs) {
  const c = getCalendar(gs);
  const w = WEEKDAY_NAMES[c.weekday] ? '周' + WEEKDAY_NAMES[c.weekday].slice(-1) : '';
  return `${c.month}月${c.dayOfMonth}日 ${w}`;
}

export const CalendarSystem = {
  initCalendar,
  getCalendar,
  tickDay,
  isMonday,
  weekKey,
  formatCalendar,
  formatShort,
};
