// src/data/events.js
// ─────────────────────────────────────────────────────────────────────────────
// 事件定义汇总入口（选项驱动的多级状态机数据源，设计文档 §18.1 / §18.2）
// ─────────────────────────────────────────────────────────────────────────────
// 结构约定：**一个事件 = 一个模块文件** `src/data/events/<事件id>.js`，
// 各自 export 一个 EventDef；本文件只做 import 汇总，不写具体事件内容。
// 新增事件 = 新建自己的模块文件 + 在本文件加一行 import / 数组项，
// 不需要改动任何已有事件文件。
//
// EventDef 结构：
//   {
//     id:    事件 id（会拼成 story_<id>，并作为 RES-001 的 eventId）
//     name:  事件标题（显示在剧情区正文上方，同时用于信息区受祝福预览 / 日志）
//     icon:  剧情区左侧圆形徽记（emoji；缺省 🎲）
//     weight: 事件池权重（未定稿时填 1）
//     repeatability: 'repeatable' | 'daily' | 'once'
//                可重复（缺省）/ 每日限1次 / 本存档一次性
//     prepare?(gs, ctx): 可选；进入时生成一份本次专用的 EventDef（可填动态变量），
//                返回新对象，不修改共享定义
//     start: 起始节点 id
//     nodes: { [nodeId]: EventNode }
//   }
//
// EventNode 结构：
//   {
//     text:    正文；字符串或字符串数组（数组按段渲染，段间空一行）
//     next?:   无选项时的下一节点 id
//     end?:    true = 本节点为终止节点
//     options?: EventOption[]  存在即等待玩家选择
//   }
//   没有 options、也没有 next 的节点 = 终止节点（事件关闭、解锁输入）。
//
// EventOption 结构：
//   {
//     id:              选项 id（仅代码使用，**永不上屏**）
//     label:           选项标题（白色选项条内的唯一文本）
//     sub?:            选项描述（白条下方常驻显示的代价 / 后果）
//     detail?:         选项描述的第二段（与 sub 同一视觉参数；缺省不显示）
//     disabled?/disabledReason?: 灰化不可选
//     effects?:        EventEffect[]  结算效果；选项确认的同一 tick 执行且只执行一次
//     branches?:       [{ weight, effects?, next?, end? }]  概率分叉：
//                      确认时按 weight 抽签，命中分支的 effects 覆盖选项 effects，
//                      next 优先于选项 next；未配置时退回选项自身的 effects / next
//     next?:           跳转节点 id（任意深度；缺省 = 本事件结束）
//     end?:            true = 选择后结束事件
//   }
//   所有选项（含「离开」）一律二次确认，没有单击即生效的例外。
//
// EventEffect 词表见 src/systems/EventEffects.js。
// ─────────────────────────────────────────────────────────────────────────────

import evt_peddler_01 from './events/evt_peddler_01.js';
import evt_stall_02 from './events/evt_stall_02.js';
import evt_mount_03 from './events/evt_mount_03.js';
import evt_garden_04 from './events/evt_garden_04.js';

/** 全部事件定义（新增事件直接往这里加数组项） */
export const EVENT_DEFS = [
  evt_peddler_01,
  evt_stall_02,
  evt_mount_03,
  evt_garden_04,
];

/** 按 id 取事件定义；找不到返回 null */
export function getEventDef(id) {
  return EVENT_DEFS.find((e) => e.id === id) || null;
}

export default EVENT_DEFS;
