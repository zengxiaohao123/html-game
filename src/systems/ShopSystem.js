// src/systems/ShopSystem.js
// 商店 / 魔法商店（设计文档 v0.5 §11.1 / §11.2）
//
// 共同点：
//   * 库存存在地块上（tile.contentState.shop），多店彼此独立
//   * 每周一自动刷新（免费，不计入手动次数）
//   * 手动刷新每周 3 次，价格 4 / 8 / 12 逐个递增
//   * 买到的东西每格只有 1 件；卖价 = 物品本身价值；售出后不再上架
//   * 魔导书 / 技能 / 收藏品 / 载具不可出售
//   * 离开后本回合内不能再进同一家店
//
// 差异：
//   商店 12 格：载具 1~3、设施/资源 2~3、作物 2~3、收藏品 4~7
//   魔法商店 10 格：魔导书 3~4、消耗道具 2~4、技能 2~3、载具 1~3
//
// 技能货架：直接售卖技能物品本身，购买后直接入背包。
//
// 抽取：先各类抽到下限，剩余格数逐格随机分给"未达上限"的类别（§11.1 算法），
//       候选不足时由 RandomPool 自动补入占位物品（野生种子 / 回忆录）。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { ITEMS } from '../data/items.js';
import { drawFromPool } from './RandomPool.js';
import * as InventorySystem from './InventorySystem.js';
import { VehicleSystem } from './VehicleSystem.js';
import { ITEM_TO_VEHICLE } from '../data/vehicles.js';
import { weekKey } from './CalendarSystem.js';

/** 魔法商店直接售卖的技能货架（沿用旧版售价；id 取自物品库现有技能条目） */
export const SHOP_SKILLS = [
  { id: 'skill_zongheng', price: 10 },
  { id: 'skill_link_shift', price: 20 },
];

/** 两类商店的配置 */
export const SHOP_KINDS = {
  shop: {
    kind: 'shop',
    label: '商店',
    slots: 12,
    groups: [
      { pool: 'POOL-08', min: 1, max: 3, label: '载具' },
      { pool: 'POOL-05', min: 2, max: 3, label: '设施/资源' },
      { pool: 'POOL-06', min: 2, max: 3, label: '作物' },
      { pool: 'POOL-07', min: 4, max: 7, label: '收藏品' },
    ],
  },
  magic: {
    kind: 'magic',
    label: '魔法商店',
    slots: 10,
    groups: [
      { pool: 'POOL-09', min: 3, max: 4, label: '魔导书' },
      { pool: 'POOL-10', min: 2, max: 4, label: '消耗道具' },
      { pool: 'SHOP_SKILL', min: 2, max: 3, label: '技能' },
      { pool: 'POOL-08', min: 1, max: 3, label: '载具' },
    ],
  },
};

/** 不可出售的一级/二级/三级分类 */
const UNSELLABLE_TIER3 = new Set(['魔导书', '收藏品']);
const UNSELLABLE_TIER2 = new Set(['技能']);
const UNSHELLABLE_TIER1 = new Set(['载具']);

/** 会员卡等折扣（0 = 无折扣） */
export function currentDiscount(gs) {
  return gs?.flags?.shopDiscount || 0;
}

/** 商品的实付价（已含折扣） */
export function effectivePrice(gs, item) {
  const base = item?.price ?? ITEMS[item?.id]?.value ?? 0;
  const d = currentDiscount(gs);
  return d > 0 ? Math.max(1, Math.floor(base * (1 - d))) : base;
}

export function isSellable(itemId) {
  const it = ITEMS[itemId];
  if (!it) return false;
  if (UNSHELLABLE_TIER1.has(it.tier1)) return false;
  if (UNSELLABLE_TIER2.has(it.tier2)) return false;
  if (UNSELLABLE_TIER3.has(it.tier3)) return false;
  return true;
}

/**
 * 是否带【唯一】：场上至多 1 个，未售出前不会出现在别的商店或随机池里。
 * 判定依据来自物品库：显性词条含【唯一】，或叠放规则里写明"自带【唯一】"。
 */
export function isUniqueItem(itemId) {
  const it = ITEMS[itemId];
  if (!it) return false;
  if ((it.traits || []).includes('唯一')) return true;
  const rule = it.stackRule || '';
  // 注意：占位物品写的是"无【唯一】"，不能误判
  return /【唯一】/.test(rule) && !/无【唯一】/.test(rule);
}

/**
 * 收集"已经被占用"的唯一物品：其它商店里未售出的 + 玩家背包里的。
 * 生成新库存时排除，避免同一件唯一物品同时出现在两家店。
 */
export function collectUniqueHeld(gs, exceptTileIdx) {
  const held = new Set();
  for (const t of gs.map.outerTiles) {
    if (t.idx === exceptTileIdx) continue;
    const stock = t.contentState?.shop?.stock;
    if (!Array.isArray(stock)) continue;
    for (const item of stock) {
      if (!item.sold && isUniqueItem(item.id)) held.add(item.id);
    }
  }
  for (const e of gs.inventory?.items || []) {
    if (e.qty > 0 && isUniqueItem(e.itemId)) held.add(e.itemId);
  }
  return held;
}

/** 地块内容 id → 商店类型 */
export function shopKindOfContent(contentId) {
  if (contentId === 'resource_shop') return 'shop';
  if (contentId === 'resource_magic_shop') return 'magic';
  return null;
}

/**
 * 按 §11.1 算法决定各类抽几件
 * @returns {number[]} 与 groups 等长
 */
export function planCounts(cfg, rand = Math.random) {
  const counts = cfg.groups.map((g) => g.min);
  let left = cfg.slots - counts.reduce((a, b) => a + b, 0);

  while (left > 0) {
    const open = cfg.groups
      .map((g, i) => ({ i, max: g.max }))
      .filter((x) => counts[x.i] < x.max);
    if (open.length === 0) break;             // 全部到上限，剩余格留空
    const pick = open[Math.floor(rand() * open.length)];
    counts[pick.i] += 1;
    left -= 1;
  }
  return counts;
}

/** 技能货架抽取：每个货位独立从 SHOP_SKILLS 等权抽取，允许重复（同一技能可购买多份） */
function drawShopSkills(count, rand = Math.random) {
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(SHOP_SKILLS[Math.floor(rand() * SHOP_SKILLS.length)]);
  }
  return picked;
}

/** 生成一批商品 */
export function generateStock(kind, rand = Math.random, opts = {}) {
  const exclude = opts.exclude || null;
  const cfg = SHOP_KINDS[kind];
  const counts = planCounts(cfg, rand);
  const stock = [];

  cfg.groups.forEach((g, i) => {
    const picked = g.pool === 'SHOP_SKILL'
      ? drawShopSkills(counts[i], rand)
      : drawFromPool(g.pool, counts[i], { unique: false, exclude });
    for (const p of picked) {
      if (!p.id) continue;
      const def = ITEMS[p.id];
      stock.push({
        id: p.id,
        name: def?.name || p.name || p.id,
        emoji: def?.emoji || '❓',
        price: p.price ?? null,
        value: def?.value ?? null,
        rarity: p.rarity ?? def?.rarity ?? 1,
        group: g.label,
        placeholder: p.placeholder === true || p.wasPlaceholder === true,
        sold: false,
      });
    }
  });

  // 按种类分组排序（不按稀有度）
  const order = cfg.groups.map((g) => g.label);
  stock.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  return stock;
}

/** 受祝福的"打折商品"：随机 30% 的格子打 7 折 */
function applyBlessDiscount(stock) {
  for (const item of stock) {
    if (item.price != null && Math.random() < 0.3) {
      item.price = Math.max(1, Math.floor(item.price * 0.7));
      item.discounted = true;
    }
  }
  return stock;
}

/** 取（必要时创建 / 换周刷新）某个商店地块的状态 */
export function getShop(gs, tileIdx) {
  const tile = gs.map.outerTiles[tileIdx];
  if (!tile) return null;
  const kind = shopKindOfContent(tile.contentId);
  if (!kind) return null;

  const st = tile.contentState || (tile.contentState = {});
  const wk = weekKey(gs);

  if (!st.shop) {
    st.shop = {
      kind,
      weekKey: wk,
      stock: generateStock(kind, Math.random, { exclude: collectUniqueHeld(gs, tileIdx) }),
      refreshUsed: 0,
      visited: false,
      freeRefreshPending: 0,
      leftAtTurn: -1,
    };
    devLog.info('[Shop] 初次生成', kind, 'tile', tileIdx, '共', st.shop.stock.length, '件');
  } else if (st.shop.weekKey !== wk) {
    // 跨周：自动刷新（免费，不占手动次数）
    st.shop.stock = generateStock(kind, Math.random, { exclude: collectUniqueHeld(gs, tileIdx) });
    st.shop.weekKey = wk;
    st.shop.refreshUsed = 0;
    EventBus.emit(GE.TOAST_SHOW, { text: `🏪 ${SHOP_KINDS[kind].label} 已按周刷新`, duration: 1600 });
    devLog.info('[Shop] 每周自动刷新', kind, 'tile', tileIdx);
  }
  return st.shop;
}

/** 当前手动刷新价格（未到上限时）；返回 null 表示已用完 */
export function manualRefreshCost(shop) {
  if (!shop) return null;
  if (shop.refreshUsed >= 3) return null;
  // C-12：免费刷新只在「下次进入」内有效（enterShop 时 pending → ready；leaveShop 作废）
  if ((shop.freeRefreshReady || 0) > 0) return 0;
  return [4, 8, 12][shop.refreshUsed] ?? null;
}

/**
 * 刷新商店
 * @returns {{ok:boolean, reason?:string, cost?:number}}
 */
export function refreshShop(gs, tileIdx, opts = {}) {
  const shop = getShop(gs, tileIdx);
  if (!shop) return { ok: false, reason: 'notShop' };
  if (opts.free) {                    // 每周自动刷新（外部调用）
    shop.stock = generateStock(shop.kind, Math.random, { exclude: collectUniqueHeld(gs, tileIdx) });
    return { ok: true, cost: 0 };
  }

  const cost = manualRefreshCost(shop);
  if (cost === null) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🏪 本周刷新次数已用完', duration: 1600 });
    return { ok: false, reason: 'noRefreshLeft' };
  }
  if (gs.player.gold < cost) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🏪 金币不足（需 ${cost}）`, duration: 1600 });
    return { ok: false, reason: 'noGold' };
  }

  gs.player.gold -= cost;
  EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: -cost });
  // C-12：RES-006 备注——免费指 0 金币，但正常消耗刷新次数
  if (cost === 0 && (shop.freeRefreshReady || 0) > 0) shop.freeRefreshReady -= 1;
  shop.refreshUsed += 1;
  shop.stock = generateStock(shop.kind, Math.random, { exclude: collectUniqueHeld(gs, tileIdx) });

  EventBus.emit(GE.TOAST_SHOW, { text: `🏪 已刷新（-${cost} 金币）`, duration: 1400 });
  devLog.info('[Shop] 手动刷新', shop.kind, 'cost=', cost, 'used=', shop.refreshUsed);
  return { ok: true, cost };
}

/** 进入商店（记录已访问 + 回合禁入判定） */
export function enterShop(gs, tileIdx) {
  const shop = getShop(gs, tileIdx);
  if (!shop) return { ok: false, reason: 'notShop' };

  if (shop.leftAtTurn >= 0 && shop.leftAtTurn === gs.turn) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🏪 本回合已离开，走动一步后才能再进', duration: 2000 });
    return { ok: false, reason: 'justLeft' };
  }
  shop.visited = true;

  // C-12：受祝福的免费刷新绑定「下次进入」——进入时 pending → ready，本次进入的首次刷新 0 金币
  if ((shop.freeRefreshPending || 0) > 0) {
    shop.freeRefreshReady = (shop.freeRefreshReady || 0) + shop.freeRefreshPending;
    shop.freeRefreshPending = 0;
    EventBus.emit(GE.TOAST_SHOW, { text: `✨ 本次进入首次刷新免费`, duration: 1600 });
  }
  // C-13：RES-004【受祝福时】"下一次进入时，有概率出现打折商品"——进入即对当前库存应用
  if (shop.discountPending) {
    shop.discountPending = false;
    applyBlessDiscount(shop.stock);
    EventBus.emit(GE.TOAST_SHOW, { text: `✨ 祝福生效：部分商品打折`, duration: 1600 });
  }
  return { ok: true, shop };
}

/** 离开商店 */
export function leaveShop(gs, tileIdx) {
  const shop = getShop(gs, tileIdx);
  if (!shop) return { ok: false, reason: 'notShop' };
  shop.leftAtTurn = gs.turn;
  // C-12：免费刷新机会随本次进入结束而作废（未用掉不延续到下次进入）
  shop.freeRefreshReady = 0;
  return { ok: true };
}

/**
 * 购买某格商品（每格只卖 1 件）
 */
export function buy(gs, tileIdx, slotIdx) {
  const shop = getShop(gs, tileIdx);
  if (!shop) return { ok: false, reason: 'notShop' };
  const item = shop.stock[slotIdx];
  if (!item || item.sold) return { ok: false, reason: 'soldOut' };

  const price = effectivePrice(gs, item);
  if (gs.player.gold < price) {
    EventBus.emit(GE.TOAST_SHOW, { text: `💰 金币不足（需 ${price}）`, duration: 1600 });
    return { ok: false, reason: 'noGold' };
  }

  gs.player.gold -= price;
  EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: -price });

  // 载具直接进载具页面，不进背包
  const vehId = ITEM_TO_VEHICLE[item.id];
  if (vehId && ITEMS[item.id]?.tier1 === '载具') {
    VehicleSystem.gainVehicle(gs, vehId);
  } else {
    InventorySystem.addItem(gs, item.id, 1);
  }

  item.sold = true;
  EventBus.emit(GE.TOAST_SHOW, { text: `🛒 买入 ${item.emoji}${item.name}（-${price}）`, duration: 1600 });
  devLog.info('[Shop] buy', item.id, 'price=', price);
  return { ok: true, item, price };
}

/**
 * 卖出物品（价格 = 物品本身价值；opts.qty 支持一次卖出多个，默认 1）
 */
export function sell(gs, itemId, opts = {}) {
  const qty = Math.max(1, Math.floor(Number(opts.qty) || 1));
  if (!isSellable(itemId)) {
    EventBus.emit(GE.TOAST_SHOW, { text: '🚫 该物品不可出售', duration: 1600 });
    return { ok: false, reason: 'notSellable' };
  }
  const have = InventorySystem.countItem(gs, itemId);
  if (have < qty) return { ok: false, reason: 'noItem' };

  const removed = InventorySystem.removeItem(gs, itemId, qty, opts.value !== undefined ? { value: opts.value } : {});
  if (removed < qty) return { ok: false, reason: 'noItem' };

  const value = opts.value ?? ITEMS[itemId]?.value ?? 0;
  const total = value * qty;
  gs.player.gold += total;
  EventBus.emit(GE.GOLD_CHANGE, { newValue: gs.player.gold, delta: total });
  EventBus.emit(GE.TOAST_SHOW, {
    text: `💰 卖出 ${ITEMS[itemId]?.name || itemId}${qty > 1 ? ` ×${qty}` : ''}（+${total}）`,
    duration: 1500,
  });
  devLog.info('[Shop] sell', itemId, 'qty=', qty, 'value=', value);
  return { ok: true, value, qty, total };
}

/** 每周一：刷新场上所有商店（外部由 DaySystem 调用） */
export function weeklyRefreshAll(gs) {
  let n = 0;
  const wk = weekKey(gs);
  for (const tile of gs.map.outerTiles) {
    if (!shopKindOfContent(tile.contentId)) continue;
    const shop = getShop(gs, tile.idx);
    if (!shop) continue;
    shop.stock = generateStock(shop.kind, Math.random, { exclude: collectUniqueHeld(gs, tile.idx) });
    shop.refreshUsed = 0;
    // C-6：同步 weekKey，避免 getShop 的跨周检查在本周首次打开时再刷新一次（双重刷新）
    shop.weekKey = wk;
    n += 1;
  }
  if (n) devLog.info('[Shop] 周一刷新了', n, '家商店');
  return n;
}

/** 受祝福：店内受祝福本次进入即生效；店外受祝福下次进入时生效 */
export function grantFreeRefresh(gs, tileIdx) {
  const shop = getShop(gs, tileIdx);
  if (!shop) return { ok: false };
  if (gs.player?.x === tileIdx) {
    shop.freeRefreshReady = (shop.freeRefreshReady || 0) + 1;
  } else {
    shop.freeRefreshPending = (shop.freeRefreshPending || 0) + 1;
  }
  return { ok: true };
}

/** UI 用：剩余手动刷新次数 */
export function refreshLeft(shop) {
  return Math.max(0, 3 - (shop?.refreshUsed || 0));
}

export const ShopSystem = {
  SHOP_KINDS,
  SHOP_SKILLS,
  isSellable,
  shopKindOfContent,
  generateStock,
  planCounts,
  getShop,
  enterShop,
  leaveShop,
  buy,
  sell,
  refreshShop,
  manualRefreshCost,
  refreshLeft,
  weeklyRefreshAll,
  grantFreeRefresh,
  isUniqueItem,
  collectUniqueHeld,
  currentDiscount,
  effectivePrice,
};
