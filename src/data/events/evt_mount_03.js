// src/data/events/evt_mount_03.js
// 《翻车现场》—— 可重复；单层六选一（五个载具购买 + 离开）。
// 文案逐字来自《事件库.xlsx》事件总表 / 节点表 / 选项表（前者优先）。

import { getGold } from '../../systems/GoldSystem.js';

const NODES = {
  intro: {
    text: '一阵哐当乱响从路边传来。一辆货车侧翻在地，车辕歪斜，一个男人被压在车架底下，正手脚并用地往外挣。你把他从木架下拉出来，他一骨碌爬起身，拍去满身灰土，不等你开口便搓着手堆起笑：“这趟纯属意外，您可别往心里去。车上这些家伙省草料、肯出力，您是我的恩人——就打5折，不，2折，卖给您如何？”',
    options: [],
  },
  horse_end: {
    text: '你从泥地里牵过那匹马，商人在旁连声夸你好眼力。',
    end: true,
  },
  dragon_end: {
    text: '你俯身把地龙从车架底下拽出来，商人跟在一旁，把这桩买卖翻来覆去地念叨。',
    end: true,
  },
  tractor_end: {
    text: '你扶住拖拉机的把手，把它从车架旁挪了出来，商人忙凑过来扶稳了另一边。',
    end: true,
  },
  broom_end: {
    text: '你拾起那把魔法扫帚，收进行囊。',
    end: true,
  },
  horn_end: {
    text: '你捡起唤风号角，收进行囊。',
    end: true,
  },
  leave_end: {
    text: '你对这些载具没有兴趣，转身离开了此地，留下男人在原地训斥他的坐骑们。',
    end: true,
  },
};

/** 五档载具购买：sub 逐字来自选项表 */
const PURCHASES = [
  { id: 'horse', label: '买下马匹', sub: '3 金币 · 马匹×1', itemId: 'item_horse', cost: 3, next: 'horse_end' },
  { id: 'dragon', label: '买下地龙', sub: '3 金币 · 地龙×1', itemId: 'item_earth_dragon', cost: 3, next: 'dragon_end' },
  { id: 'tractor', label: '买下拖拉机', sub: '3 金币 · 拖拉机×1', itemId: 'item_tractor', cost: 3, next: 'tractor_end' },
  { id: 'broom', label: '买下魔法扫帚', sub: '6 金币 · 魔法扫帚×1', itemId: 'item_broom', cost: 6, next: 'broom_end' },
  { id: 'horn', label: '买下唤风号角', sub: '8 金币 · 唤风号角×1', itemId: 'item_horn', cost: 8, next: 'horn_end' },
];

/** 购买项：金币不足时灰化（不显示额外提示） */
function purchaseOption(purchase, gold) {
  return {
    id: purchase.id,
    label: purchase.label,
    sub: purchase.sub,
    effects: [
      { type: 'gold', amount: -purchase.cost },
      { type: 'vehicle', itemId: purchase.itemId, qty: 1 },
    ],
    next: purchase.next,
    disabled: gold < purchase.cost,
  };
}

/** 每次进入按当前金币决定哪些购买项可点 */
function prepare(gs) {
  const gold = getGold(gs);
  return {
    ...MOUNT_DEF,
    nodes: {
      ...NODES,
      intro: {
        ...NODES.intro,
        options: [
          ...PURCHASES.map((p) => purchaseOption(p, gold)),
          {
            id: 'leave',
            label: '转身离开',
            sub: '多一事不如少一事',
            next: 'leave_end',
          },
        ],
      },
    },
  };
}

const MOUNT_DEF = {
  id: 'evt_mount_03',
  name: '翻车现场',
  icon: '🛞',
  weight: 1,
  repeatability: 'repeatable',
  start: 'intro',
  prepare,
  nodes: NODES,
};

export default MOUNT_DEF;
