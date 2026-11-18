// src/data/events/evt_stall_02.js
// 《树荫下的木箱》—— 每日限 1 次；单层二选一，无离开选项。
// 文案逐字来自《事件库.xlsx》事件总表 / 节点表 / 选项表（前者优先）。
//
// 购买项的可变部分（事件库「变量预留」）：
//   x  = 实际花费金币：按商品原始总价 × 40%~150% 随机，每次进入重新随机
//   xx = 本次商品与数量：只抽一种物品（可多件），调用普通商店随机池
//        （POOL-05/06/07/08，不含魔法商店）。
//        数量取以下约束的交集：至少 1、总价（原始单价）≤60、【唯一】≤1、任何物品 ≤4。
//        可能抽到载具，获得时进载具页，不进背包；载具同样受「最多 4」约束。

import { POOLS, ITEMS } from '../items.js';
import { isUniqueItem, unavailableUniqueIds } from '../../systems/ItemUniqueness.js';
import { ITEM_TO_VEHICLE } from '../vehicles.js';
import { getGold } from '../../systems/GoldSystem.js';

/** 普通商店的四个货架池（不含魔法商店） */
const SHOP_POOLS = ['POOL-05', 'POOL-06', 'POOL-07', 'POOL-08'];
/** 单种商品按原始单价计算的总价上限 */
const ITEM_TOTAL_CAP = 60;
/** 单次购买任何物品的硬数量上限 */
const ITEM_QTY_CAP = 4;
/** 实际花费相对原始总价的波动区间 */
const COST_RATE_MIN = 0.4;
const COST_RATE_MAX = 1.5;

const NODES = {
  intro: {
    text: '路边的树荫下摆着一只旧木箱，箱面上码着几样零散物件，用粗绳分门别类捆好。摊主不在跟前，只留下一块写着价钱的木牌，风把牌角吹得轻轻掀起。',
    options: [],
  },
  buy_end: {
    text: '你挑好物件，按木牌上的价钱付了金币，把它收进随身的行囊。',
    end: true,
  },
  rest_end: {
    text: '你没有碰摊上的东西，靠着木箱在树荫下坐了一会儿。风穿过枝叶，身上的乏劲松快了不少。',
    end: true,
  },
};

/** 汇总普通商店池里可出售的候选（排除占位、已占用唯一物品、无价格条目） */
function collectShopCandidates(gs) {
  const blocked = unavailableUniqueIds(gs);
  const seen = new Set();
  const out = [];
  for (const code of SHOP_POOLS) {
    for (const entry of POOLS[code]?.entries || []) {
      if (!entry.id || entry.placeholder || seen.has(entry.id) || blocked.has(entry.id)) continue;
      const price = Number(entry.price);
      if (!(price > 0) || price > ITEM_TOTAL_CAP) continue;
      seen.add(entry.id);
      out.push({ id: entry.id, name: entry.name, price });
    }
  }
  return out;
}

/** 掷出数量：至少 1；唯一物品最多 1；其余不超过 4，且总价不超过 60 */
function rollQty(item) {
  if (isUniqueItem(item.id)) return 1;
  const byPrice = Math.floor(ITEM_TOTAL_CAP / item.price);
  const max = Math.max(1, Math.min(ITEM_QTY_CAP, byPrice));
  return 1 + Math.floor(Math.random() * max);
}

/** 生成一次摊位商品与实付价（每次只抽一种物品，可多件） */
export function buildStallOffer(gs) {
  const candidates = collectShopCandidates(gs);
  if (!candidates.length) return null;

  const item = candidates[Math.floor(Math.random() * candidates.length)];
  const qty = rollQty(item);
  const baseTotal = item.price * qty;
  const rate = COST_RATE_MIN + Math.random() * (COST_RATE_MAX - COST_RATE_MIN);
  const cost = Math.max(1, Math.round(baseTotal * rate));

  return {
    goods: [{ ...item, qty }],
    baseTotal,
    cost,
    detail: `${ITEMS[item.id]?.name || item.name}×${qty}`,
  };
}

/** 商品 → EventEffect[]（载具进载具页，其余进背包） */
function goodsEffects(goods) {
  return goods.map((g) => (
    ITEM_TO_VEHICLE[g.id]
      ? { type: 'vehicle', itemId: g.id, qty: g.qty }
      : { type: 'item', itemId: g.id, qty: g.qty }
  ));
}

/**
 * 每次进入事件时生成当次商品与价格，填入 x / xx 两个变量位。
 * 返回一份新的 EventDef，不修改模块级静态定义。
 */
function prepare(gs) {
  const offer = buildStallOffer(gs);
  const buy = offer
    ? {
      id: 'buy',
      label: '挑一样物件买下',
      sub: `花费${offer.cost}金币，买下${offer.detail}`,
      effects: [{ type: 'gold', amount: -offer.cost }, ...goodsEffects(offer.goods)],
      next: 'buy_end',
      disabled: getGold(gs) < offer.cost,
    }
    : {
      id: 'buy',
      label: '挑一样物件买下',
      sub: '花费若干金币，买下摊上的物件',
      next: 'buy_end',
      disabled: true,
    };

  return {
    ...STALL_DEF,
    nodes: {
      ...NODES,
      intro: {
        ...NODES.intro,
        options: [
          buy,
          {
            id: 'rest',
            label: '在木箱旁歇一会儿',
            sub: '行动力+1',
            effects: [{ type: 'stamina', amount: 1 }],
            next: 'rest_end',
          },
        ],
      },
    },
  };
}

const STALL_DEF = {
  id: 'evt_stall_02',
  name: '树荫下的木箱',
  icon: '📦',
  weight: 1,
  repeatability: 'daily',
  start: 'intro',
  prepare,
  nodes: NODES,
};

export default STALL_DEF;
