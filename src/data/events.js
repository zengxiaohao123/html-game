// src/data/events.js
// ─────────────────────────────────────────────────────────────────────────────
// 事件节点表（选项驱动的多级状态机数据源，设计文档 §18.1 / §18.2）
// ─────────────────────────────────────────────────────────────────────────────
// 约定：**新增事件只加数据**，不改 StoryUI / facilities 逻辑。
//
// EventDef 结构：
//   {
//     id:    事件 id（会拼成 story_<id>，并作为 RES-001 的 eventId）
//     name:  事件标题（显示在剧情区正文上方，同时用于信息区受祝福预览 / 日志）
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
// 叙事口径（2026-11-13 返工）：
//   · **描述完直接给选项**：选项与描述写在同一个节点里，禁止再加一层
//     「你打算怎么做？」之类的过渡问句节点（多一次点击才出选项）。
//   · 结果节点必须是终止节点：不再追加「该离开了」这类无意义选项，
//     结果文本出现后点击屏幕任意处关闭事件（StoryUI 实现）。
//
// EventOption 结构：
//   {
//     id:              选项 id（仅代码使用，**永不上屏**）
//     label:           选项标题（白色选项条内的唯一文本）
//     sub?:            选项描述（白条下方常驻显示的代价 / 后果）
//     detail?:         选项描述的第二段（与 sub 同一视觉参数；缺省不显示）
//     disabled?/disabledReason?: 灰化不可选
//     effects?:        EventEffect[]  结算效果；选项确认的同一 tick 执行且只执行一次
//     next?:           跳转节点 id（任意深度；缺省 = 本事件结束）
//     end?:            true = 选择后结束事件
//     onSelect?:       (ctx) => void  额外回调（不得替代 effects 做结算）
//   }
//   所有选项（含「离开」）一律二次确认，没有单击即生效的例外。
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

/**
 * 事件 1：单层 3 选项，三个选项产生不同结果。
 * 进入事件只展示正文，不产生任何数值变化；结果全部挂在选项的 effects 上。
 */
const EVENT_BAG = {
  id: 'evt_bag_01',
  name: '遗落的行囊',
  icon: '🎒',
  weight: 1,
  start: 'intro',
  nodes: {
    intro: {
      text: [
        '你在一处废弃的营地边停下脚步。林间的风把帐篷布吹得猎猎作响，地上散落着被翻乱的木箱。',
        '营地的主人显然走得很急。一只行囊被落在树根旁，袋口还系着半截绳，里面隐约有东西在反光。',
      ],
      options: [
        {
          id: 'search',
          label: '翻找行囊',
          sub: '消耗1点行动力，获得小麦×2',
          detail: '说不定能翻出些能用的。',
          effects: [
            { type: 'stamina', amount: -1 },
            { type: 'item', itemId: 'item_wheat', qty: 2 },
          ],
          next: 'searched',
        },
        {
          id: 'purse',
          label: '拿走钱袋',
          sub: '获得金币×6',
          detail: '值钱的先收好。',
          effects: [{ type: 'gold', amount: 6 }],
          next: 'purse_taken',
        },
        {
          id: 'leave',
          label: '离开',
          sub: '多一事不如少一事',
          end: true,
        },
      ],
    },
    searched: {
      text: '行囊里有半袋小麦。你抖掉泥土收好，把袋口重新系紧，又原样放回树根旁。',
      end: true,
    },
    purse_taken: {
      text: '钱袋里只有几枚金币。你掂了掂分量，把它塞进衣袋，转身离开营地。',
      end: true,
    },
  },
};

/**
 * 事件 2：两层嵌套。
 * 第一层选「沿着痕迹走」后进入第二段，再在三个选项里做第二次选择；
 * 第二层三个叶子选项分别产生回复、生成生物、地形 + 状态三种不同结果。
 * 分支编号只存在于代码的节点 id 中，不会出现在选项文本或任何层级提示里。
 */
const EVENT_CROSSROAD = {
  id: 'evt_crossroad_01',
  name: '林间岔路',
  icon: '🪧',
  weight: 1,
  start: 'intro',
  nodes: {
    intro: {
      text: [
        '前方的路在灌木间分成了两条。左侧的泥地上有新鲜的脚印，右侧传来断续的水声。',
        '天色不早了。你在路口站了一会儿，脚下的落叶被风推着，慢慢往低处滚。',
      ],
      options: [
        {
          id: 'trail',
          label: '沿着痕迹走',
          sub: '看看留下痕迹的人去了哪里',
          next: 'trail_scene',
        },
        {
          id: 'water',
          label: '循着水声走',
          sub: '消耗1点行动力，恢复一些精神',
          effects: [{ type: 'stamina', amount: 1 }],
          next: 'water_end',
        },
      ],
    },
    trail_scene: {
      text: '脚印把你带到一小片林间空地。四周安静得反常，草叶上还挂着没干的水珠。',
      options: [
        {
          id: 'rest',
          label: '在空地上歇脚',
          sub: '恢复10%生命',
          detail: '靠着树干坐一会儿。',
          effects: [{ type: 'heal', percent: 0.1 }],
          next: 'rest_end',
        },
        {
          id: 'delve',
          label: '继续深入',
          sub: '草丛里有动静',
          detail: '也许能看清是什么脚印。',
          effects: [{ type: 'creature', kind: 'chick' }],
          next: 'delve_end',
        },
        {
          id: 'sow',
          label: '把种子撒在空地上',
          sub: '改变地形，获得1天状态',
          detail: '也许明年这里会不一样。',
          effects: [
            { type: 'terrain', terrainId: 'terrain_grass' },
            { type: 'buff', buffId: 'grumpy', days: 1 },
          ],
          next: 'sow_end',
        },
      ],
    },
    water_end: {
      text: '水边只有风声。你捧起水洗了把脸，看着水面慢慢平静下来，才起身回到路上。',
      end: true,
    },
    rest_end: {
      text: '你靠着树干休息了一会儿。再站起来时，腿脚的酸胀已经消了大半。',
      end: true,
    },
    delve_end: {
      text: '草丛里钻出一只毛茸茸的小家伙。它犹豫了一下，还是跟在了你身后。',
      end: true,
    },
    sow_end: {
      text: '你把种子撒进松软的土里，踩实。心里莫名踏实了一些。',
      end: true,
    },
  },
};

/**
 * 事件 3：单层 3 选项，复用同一套选项驱动结构。
 */
const EVENT_STONE_HOUSE = {
  id: 'evt_stone_01',
  name: '塌了一半的石屋',
  icon: '🧱',
  weight: 1,
  start: 'intro',
  nodes: {
    intro: {
      text: [
        '路边有一座塌了一半的石屋，屋顶的木梁斜插在墙里。门框上挂着褪色的布条，风一吹就贴在石头上。',
        '屋里似乎还有东西没被搬走，阴影里堆着几个蒙尘的木箱。',
      ],
      options: [
        {
          id: 'enter',
          label: '进屋查看',
          sub: '获得金币×4',
          detail: '木箱里也许还有东西。',
          effects: [{ type: 'gold', amount: 4 }],
          next: 'entered',
        },
        {
          id: 'rest',
          label: '在门口坐一会儿',
          sub: '恢复5%生命',
          effects: [{ type: 'heal', percent: 0.05 }],
          next: 'rested',
        },
        {
          id: 'leave',
          label: '离开',
          sub: '多一事不如少一事',
          end: true,
        },
      ],
    },
    entered: {
      text: '木箱里只剩几枚金币和一堆碎布。你把金币收好，从塌掉的墙口退了出来。',
      end: true,
    },
    rested: {
      text: '你在门槛上坐了一会儿。风从破洞里穿过去，把布条吹得轻轻作响。',
      end: true,
    },
  },
};

/** 全部事件定义（新增事件直接往这里加条目） */
export const EVENT_DEFS = [EVENT_BAG, EVENT_CROSSROAD, EVENT_STONE_HOUSE];

/** 按 id 取事件定义；找不到返回 null */
export function getEventDef(id) {
  return EVENT_DEFS.find((e) => e.id === id) || null;
}

export default EVENT_DEFS;
