// src/systems/CropHarvest.js
// 通用规则：拆除 / 替换「储存类 / 采摘类」田块时，先自动执行一次采摘结算，再拆除。
//
// 判定口径（与 A-12「储存作物数」统计保持一致，见 PassiveItemSystem）：
//   · 采摘类：郁金香（tulipValue）、蒲公英（dandelionValue）、幽怜草（ghostValue/ghostStored）
//   · 储存类：土豆（potatoStored）、草莓（strawberryStored）、豌豆（peaStored）
//   · 储存类设施：鸡舍（eggStored / eggStoredGolden，两物共享储存上限 10）
//   · 非储存类田块：小麦 / 水稻 / 玉米 / 卷心菜 / 艾草 / 野生种子（产出直接进背包，田里没有可结算的存量）
//   · 史莱姆屋：不储存黏液。黏液是史莱姆死亡时的击杀掉落（BIO-003 → item_slime_gel，直接进背包），
//     与史莱姆屋设施无关，因此拆除史莱姆屋不结算任何黏液存量。
//
// 注意：郁金香走 pickTulip，负价值是否扣金币由《泡沫》决定（见 TulipSystem）；
// 拆除前自动采摘与玩家手动采摘使用完全相同的结算口径。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { ITEMS } from '../data/items.js';
import { InventorySystem } from './InventorySystem.js';
import { syncPumpkin } from './PassiveItemSystem.js';
import { POTATO_ID, potatoStoredOf } from './PotatoSystem.js';
import { TULIP_ID, pickTulip } from './TulipSystem.js';

export const STRAWBERRY_ID = 'facility_strawberry';
export const PEA_ID = 'facility_pea';
export const DANDELION_ID = 'facility_dandelion';
export const GHOST_GRASS_ID = 'facility_ghost_grass';
export const HENHOUSE_ID = 'facility_henhouse';

/** 拆除前需要自动采摘的地块内容 */
export const AUTO_HARVEST_ON_REMOVE = new Set([
  POTATO_ID,
  STRAWBERRY_ID,
  PEA_ID,
  TULIP_ID,
  DANDELION_ID,
  GHOST_GRASS_ID,
  HENHOUSE_ID,
]);

const harvestEntry = (itemId, qty, value) => ({ itemId, qty, value });

/**
 * 拆除 / 替换前自动采摘当前田块的全部存量。
 * @returns {{ harvested: Array<{itemId:string, qty:number, value?:number}>, goldDelta: number }}
 */
export function harvestCropBeforeRemove(gs, tile) {
  const result = { harvested: [], goldDelta: 0 };
  if (!tile || !tile.contentId || !AUTO_HARVEST_ON_REMOVE.has(tile.contentId)) return result;
  const cs = tile.contentState || (tile.contentState = {});

  switch (tile.contentId) {
    case POTATO_ID: {
      const qty = potatoStoredOf(tile);
      if (qty <= 0) break;
      cs.potatoStored = 0;
      InventorySystem.addItem(gs, 'item_potato', qty);
      result.harvested.push(harvestEntry('item_potato', qty));
      break;
    }
    case STRAWBERRY_ID: {
      const qty = Math.max(0, Math.floor(Number(cs.strawberryStored) || 0));
      if (qty <= 0) break;
      cs.strawberryStored = 0;
      InventorySystem.addItem(gs, 'item_strawberry', qty);
      result.harvested.push(harvestEntry('item_strawberry', qty));
      break;
    }
    case PEA_ID: {
      const qty = Math.max(0, Math.floor(Number(cs.peaStored) || 0));
      if (qty <= 0) break;
      cs.peaStored = 0;
      InventorySystem.addItem(gs, 'item_pea', qty);
      result.harvested.push(harvestEntry('item_pea', qty));
      break;
    }
    case DANDELION_ID: {
      const value = Math.max(0, Math.floor(Number(cs.dandelionValue) || 1));
      InventorySystem.addItem(gs, 'item_dandelion', 1, { value });
      result.harvested.push(harvestEntry('item_dandelion', 1, value));
      break;
    }
    case GHOST_GRASS_ID: {
      const value = Math.max(0, Math.floor(Number(cs.ghostValue) || 12));
      InventorySystem.addItem(gs, 'item_ghost_grass', 1, { value });
      result.harvested.push(harvestEntry('item_ghost_grass', 1, value));
      break;
    }
    case HENHOUSE_ID: {
      // 鸡舍产蛋储存于来源鸡舍格（§13.4 OUT-11）：鸡蛋与优质蛋合计上限 10，收获时分别占格
      const normal = Math.max(0, Math.floor(Number(cs.eggStored) || 0));
      const golden = Math.max(0, Math.floor(Number(cs.eggStoredGolden) || 0));
      if (normal > 0) {
        cs.eggStored = 0;
        InventorySystem.addItem(gs, 'item_egg', normal);
        result.harvested.push(harvestEntry('item_egg', normal));
      }
      if (golden > 0) {
        cs.eggStoredGolden = 0;
        InventorySystem.addItem(gs, 'item_golden_egg', golden);
        result.harvested.push(harvestEntry('item_golden_egg', golden));
      }
      break;
    }
    case TULIP_ID: {
      // 与手动采摘同口径：silent 只省略单条采摘 toast，由下方统一汇总
      const picked = pickTulip(gs, tile, { silent: true });
      result.harvested.push(harvestEntry('item_tulip', 1, picked.itemValue));
      result.goldDelta = -picked.debt;
      break;
    }
    default:
      break;
  }

  if (result.harvested.length === 0) return result;

  syncPumpkin(gs);
  EventBus.emit(GE.INVENTORY_CHANGE);
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: tile.idx });
  const parts = result.harvested.map((h) => (h.value !== undefined
    ? `${ITEMS[h.itemId]?.name || h.itemId}×${h.qty}（价值 ${h.value}）`
    : `${ITEMS[h.itemId]?.name || h.itemId}×${h.qty}`));
  EventBus.emit(GE.TOAST_SHOW, { text: `🧺 拆除前自动采摘：${parts.join('、')}`, duration: 2000 });
  return result;
}

export const CropHarvest = {
  AUTO_HARVEST_ON_REMOVE,
  harvestCropBeforeRemove,
};

export default CropHarvest;
