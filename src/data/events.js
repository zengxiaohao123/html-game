// src/data/events.js
// ─────────────────────────────────────────────────────────────────────────────
// 事件节点表（选项驱动的多级状态机数据源，设计文档 §18.1 / §18.2）
// ─────────────────────────────────────────────────────────────────────────────
// 约定：**新增事件只加数据**，不改 StoryUI / facilities 逻辑。
//
// EventDef 结构：
//   {
//     id:    事件 id（会拼成 story_<id>，并作为 RES-001 的 eventId）
//     name:  事件名（标题行不渲染，仅 title / 日志用）
//     icon:  剧情区左侧圆形徽记（emoji；缺省 🎲）
//     weight: 事件池权重
//     start: 起始节点 id
//     nodes: { [nodeId]: EventNode }
//   }
//
// EventNode 结构：
//   {
//     text:    正文；字符串或字符串数组（数组按段渲染，段间空一行）
//     next?:   无选项时的下一节点 id
//     end?:    true = 本节点为终止节点
//     options?: EventOption[]  存在即等待玩家选择（最多 4 个）
//     onEnter?: (ctx) => void  仅做表现/日志，禁止在此结算
//   }
//   没有 options、也没有 next 的节点 = 终止节点（事件关闭、解锁输入）。
//
// EventOption 结构：
//   {
//     id:              选项 id（仅代码使用，**永不上屏**）
//     label:           主标题（玩家看到的全部文本）
//     sub?/detail?:    副标题 / 待确认后展开的详情
//     disabled?/disabledReason?: 灰化不可选
//     safe?:           true = 单击即生效（不走二次确认）
//     effects?:        EventEffect[]  结算效果；选项确认的同一 tick 执行且只执行一次
//     next?:           跳转节点 id（任意深度；缺省 = 本事件结束）
//     end?:            true = 选择后结束事件
//     onSelect?:       (ctx) => void  额外回调（不得替代 effects 做结算）
//   }
//
// EventEffect 词表见 src/systems/EventEffects.js：
//   { type:'gold', amount }
//   { type:'item', itemId, qty }            qty > 0 获得 / qty < 0 失去
//   { type:'stamina', amount }
//   { type:'heal', amount | percent }
//   { type:'terrain', terrainId, tileIdx? } 缺省作用在事件所在地块
//   { type:'buff', buffId, days?, params? }
//   { type:'creature', kind }
// ─────────────────────────────────────────────────────────────────────────────

/** 占位正文（正式事件池定稿后整段替换，结构不变） */
const PH = '（占位正文：事件正式文案待事件池定稿后录入，此处仅用于验证选项驱动结算与多级分支。）';

/**
 * 示例事件 1：单层 3 选项，三个选项产生不同结果。
 * 进入事件只展示正文，不产生任何数值变化；结果全部挂在选项的 effects 上。
 */
const EVENT_SIMPLE = {
  id: 'evt_ph_08',
  name: '占位事件·遗落的行囊',
  icon: '🎒',
  weight: 1,
  start: 'intro',
  nodes: {
    intro: {
      text: [
        '你在这块地方停下了脚步。',
        `路边搁着一只被遗落的行囊。\n${PH}`,
      ],
      next: 'choice',
    },
    choice: {
      text: '你打算怎么处理？',
      options: [
        {
          id: 'search',
          label: '翻找行囊',
          sub: '占位副标题：也许里面还有能用的东西',
          detail: PH,
          effects: [{ type: 'item', itemId: 'item_wheat', qty: 2 }],
          next: 'searched',
        },
        {
          id: 'purse',
          label: '拿走钱袋',
          sub: '占位副标题：先把值钱的收好',
          detail: PH,
          effects: [{ type: 'gold', amount: 6 }],
          next: 'purse_taken',
        },
        {
          id: 'leave',
          label: '原样离开',
          sub: '占位副标题：不属于自己的东西不动',
          safe: true,
          effects: [],
          end: true,
        },
      ],
    },
    searched: {
      text: `你从行囊里翻出一些小麦，把其余的东西放回原处。\n${PH}`,
      end: true,
    },
    purse_taken: {
      text: `钱袋里是几枚金币，你把它收进衣袋。\n${PH}`,
      end: true,
    },
  },
};

/**
 * 示例事件 2：两层嵌套。
 * 第一层选「沿着痕迹走」后进入第二段，再在 A.1 / A.2 / A.3 中做第二次选择；
 * 第二层三个叶子选项分别产生回复、生成生物、地形 + 状态三种不同结果。
 * 分支编号只存在于代码的节点 id 中，不会出现在选项文本或任何层级提示里。
 */
const EVENT_NESTED = {
  id: 'evt_ph_09',
  name: '占位事件·岔路',
  icon: '🪧',
  weight: 1,
  start: 'intro',
  nodes: {
    intro: {
      text: [
        '前方的路在这里分成了两条。',
        `左侧有踩踏的痕迹，右侧传来隐隐的水声。\n${PH}`,
      ],
      next: 'fork',
    },
    fork: {
      text: '你准备往哪边走？',
      options: [
        {
          id: 'trail',
          label: '沿着痕迹走',
          sub: '占位副标题：看看留下痕迹的人去了哪里',
          detail: PH,
          next: 'trail_scene',
        },
        {
          id: 'water',
          label: '循着水声走',
          sub: '占位副标题：先找到水源再说',
          detail: PH,
          effects: [{ type: 'stamina', amount: 1 }],
          next: 'water_end',
        },
      ],
    },
    trail_scene: {
      text: `痕迹把你带到一小片空地，四周安静得有些反常。\n${PH}`,
      next: 'trail_choice',
    },
    trail_choice: {
      text: '你决定在这里做什么？',
      options: [
        {
          id: 'rest',
          label: '在空地上歇脚',
          sub: '占位副标题：恢复一些精神',
          detail: PH,
          effects: [{ type: 'heal', percent: 0.1 }],
          next: 'rest_end',
        },
        {
          id: 'delve',
          label: '继续深入',
          sub: '占位副标题：草丛里有动静',
          detail: PH,
          effects: [{ type: 'creature', kind: 'chick' }],
          next: 'delve_end',
        },
        {
          id: 'sow',
          label: '把种子撒在空地上',
          sub: '占位副标题：也许明年这里会不一样',
          detail: PH,
          effects: [
            { type: 'terrain', terrainId: 'terrain_grass' },
            { type: 'buff', buffId: 'grumpy', days: 1 },
          ],
          next: 'sow_end',
        },
      ],
    },
    water_end: {
      text: `水边只有风，没有别的动静。\n${PH}`,
      end: true,
    },
    rest_end: {
      text: `你靠着树干休息了一会儿。\n${PH}`,
      end: true,
    },
    delve_end: {
      text: `草丛里钻出一只小家伙，跟在了你身后。\n${PH}`,
      end: true,
    },
    sow_end: {
      text: `你把种子撒进土里，心里莫名踏实了一些。\n${PH}`,
      end: true,
    },
  },
};

/** 全部事件定义（新增事件直接往这里加条目） */
export const EVENT_DEFS = [EVENT_SIMPLE, EVENT_NESTED];

/** 按 id 取事件定义；找不到返回 null */
export function getEventDef(id) {
  return EVENT_DEFS.find((e) => e.id === id) || null;
}

export default EVENT_DEFS;
