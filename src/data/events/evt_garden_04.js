// src/data/events/evt_garden_04.js
// 《林缘菜畦》—— 每日限 1 次；单层三选一，选项 1 带 85% / 15% 概率分叉。
// 文案逐字来自《事件库.xlsx》事件总表 / 节点表 / 选项表（前者优先）。
//
// 概率分叉（选项表备注）：
//   85%：行动力-3，豌豆×4、卷心菜×2、玉米×2，回复所有生命值 → dig_full_end
//   15%：行动力-3，回复所有生命值 → dig_heal_end
//   未选择时不展示作物与回血，常驻仅提示行动力-3。

/** 85%：出力翻摘换厚补给 + 回满生命 */
const DIG_FULL_EFFECTS = [
  { type: 'stamina', amount: -3 },
  { type: 'item', itemId: 'item_pea', qty: 4 },
  { type: 'item', itemId: 'item_cabbage', qty: 2 },
  { type: 'item', itemId: 'item_corn', qty: 2 },
  { type: 'heal', percent: 1 },
];

/** 15%：只回满生命 */
const DIG_HEAL_EFFECTS = [
  { type: 'stamina', amount: -3 },
  { type: 'heal', percent: 1 },
];

export default {
  id: 'evt_garden_04',
  name: '林缘菜畦',
  icon: '🥬',
  weight: 1,
  repeatability: 'daily',
  start: 'intro',
  nodes: {
    intro: {
      text: '风从林隙里钻过来，带着一股新翻泥土的潮气。林缘留着半畦无人照看的菜地，豆荚垂在旧木桩上，菜叶被虫蛀出几个窟窿，地垄上踩出浅浅的痕迹。看不出是谁栽下的，也看不出还会不会有人来收。',
      options: [
        {
          id: 'dig',
          label: '顺着地垄翻找一遍',
          sub: '行动力-3',
          branches: [
            { weight: 85, effects: DIG_FULL_EFFECTS, next: 'dig_full_end' },
            { weight: 15, effects: DIG_HEAL_EFFECTS, next: 'dig_heal_end' },
          ],
          next: 'dig_full_end',
        },
        {
          id: 'pick',
          label: '顺手摘几把现成的',
          sub: '行动力-1',
          effects: [
            { type: 'stamina', amount: -1 },
            { type: 'item', itemId: 'item_pea', qty: 2 },
            { type: 'item', itemId: 'item_cabbage', qty: 2 },
          ],
          next: 'pick_end',
        },
        {
          id: 'leave',
          label: '转身离开',
          sub: '多一事不如少一事',
          next: 'leave_end',
        },
      ],
    },
    dig_full_end: {
      text: '你蹲下身，顺着地垄把能摘的都摘了一遍，篓子很快堆满。挑几个最嫩的就着露水吃了，胃里落了实诚的东西，身上的乏跟着松下来，余下的菜捆好抱在怀里。',
      end: true,
    },
    dig_heal_end: {
      text: '你顺着地垄翻找了半晌，能入口的却没多少。挑出几把嚼了垫垫肚子，缓过一阵劲，地垄上也就只剩些青梗子，再没有什么可拿的。',
      end: true,
    },
    pick_end: {
      text: '你没往深处走，只在边上捋了几把长得像样的菜，搭在臂弯里，便继续往前去了。',
      end: true,
    },
    leave_end: {
      text: '你没有停下脚步，沿着林缘的小路继续走，身后那半畦菜地重新隐进了树影里。',
      end: true,
    },
  },
};
