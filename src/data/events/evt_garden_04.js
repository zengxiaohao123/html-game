// src/data/events/evt_garden_04.js
// 《林缘菜畦》—— 每日限 1 次；单层三选一，选项 1 带 85% / 15% 概率分叉。
// 文案逐字来自《事件库.xlsx》事件总表 / 节点表 / 选项表（前者优先）。
//
// 结算拆分（只显示代价、未显示奖励的选项）：
//   初始选项常驻只显示行动力代价；代价在选择时结算。
//   奖励（作物 / 回血）放到结果节点的唯一「结果确认」选项被确认后再发放。
//
// 概率分叉（选项表备注）：
//   85%：行动力-3 → dig_full_end（奖励：豌豆×4、卷心菜×2、玉米×2、生命+100%）
//   15%：行动力-3 → dig_heal_end（奖励：生命+100%）

/** 代价：选择时立即结算 */
const DIG_COST = [{ type: 'stamina', amount: -3 }];
const PICK_COST = [{ type: 'stamina', amount: -1 }];

/** 奖励：后续唯一结果选项确认时结算 */
const DIG_FULL_REWARD = [
  { type: 'item', itemId: 'item_pea', qty: 4 },
  { type: 'item', itemId: 'item_cabbage', qty: 2 },
  { type: 'item', itemId: 'item_corn', qty: 2 },
  { type: 'heal', percent: 1 },
];
const DIG_HEAL_REWARD = [{ type: 'heal', percent: 1 }];
const PICK_REWARD = [
  { type: 'item', itemId: 'item_pea', qty: 2 },
  { type: 'item', itemId: 'item_cabbage', qty: 2 },
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
            { weight: 85, effects: DIG_COST, next: 'dig_full_end' },
            { weight: 15, effects: DIG_COST, next: 'dig_heal_end' },
          ],
          next: 'dig_full_end',
        },
        {
          id: 'pick',
          label: '顺手摘几把现成的',
          sub: '行动力-1',
          effects: PICK_COST,
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
      options: [
        {
          id: 'dig_full_take',
          label: '收下这一篓菜',
          sub: '获得豌豆×4、卷心菜×2、玉米×2 · 生命+100%',
          effects: DIG_FULL_REWARD,
          end: true,
        },
      ],
    },
    dig_heal_end: {
      text: '你顺着地垄翻找了半晌，能入口的却没多少。挑出几把嚼了垫垫肚子，缓过一阵劲，地垄上也就只剩些青梗子，再没有什么可拿的。',
      options: [
        {
          id: 'dig_heal_take',
          label: '就着菜叶垫垫肚子',
          sub: '生命+100%',
          effects: DIG_HEAL_REWARD,
          end: true,
        },
      ],
    },
    pick_end: {
      text: '你没往深处走，只在边上捋了几把长得像样的菜，搭在臂弯里，便继续往前去了。',
      options: [
        {
          id: 'pick_take',
          label: '把菜收进臂弯',
          sub: '获得豌豆×2、卷心菜×2',
          effects: PICK_REWARD,
          end: true,
        },
      ],
    },
    leave_end: {
      text: '你没有停下脚步，沿着林缘的小路继续走，身后那半畦菜地重新隐进了树影里。',
      end: true,
    },
  },
};
