// src/state/migrate.js
// GS 存档迁移：把旧存档的 GS 补全到当前 schema
// 算法：拿一份全新的 createInitialState() 作为模板，
//       对 loadedGs 做深合并——缺失字段从模板取默认值。
//       只补缺失字段，不覆盖已有值（玩家存档里的数据不能被清空）。
//       递归补全 plain object；数组保留原元素，但对元素内的对象逐个补全缺失字段（C-7）。

import { createInitialState } from './gameState.js';
import { devLog } from '../core/Logger.js';
import { getCreatureDef } from '../data/creatures.js';
import { DEFAULT_CREATURE_RADIUS, FENCE_ORIGIN_X, FENCE_ORIGIN_Y } from '../core/Geometry.js';

/**
 * 判断一个值是否是 plain object（非数组、非 null）
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 递归补全 target 里缺失的字段，从 source 取默认值。
 * - 只处理 plain object
 * - 数组保持原样不补（outerTiles、available、items 等）
 * - target 里已有的值一律不覆盖
 * @param {object} target 被补全的对象（原地修改）
 * @param {object} source 模板对象
 * @param {string} path 当前字段路径（用于日志）
 * @returns {string[]} 补全过的字段路径列表
 */
function deepMergeDefaults(target, source, path = '') {
  const filled = [];
  if (!isPlainObject(target) || !isPlainObject(source)) return filled;

  for (const key of Object.keys(source)) {
    const childPath = path ? `${path}.${key}` : key;

    if (!(key in target)) {
      // target 缺失这个 key → 从 source 整体拷贝一份默认值
      // 注意：数组直接引用即可（createInitialState 每次都新建 fresh 对象），
      //       但为了安全对 plain object 做深拷贝
      const srcVal = source[key];
      if (Array.isArray(srcVal)) {
        target[key] = srcVal.slice(); // 数组浅拷贝足够
      } else if (isPlainObject(srcVal)) {
        target[key] = JSON.parse(JSON.stringify(srcVal)); // 对象深拷贝
      } else {
        target[key] = srcVal; // 原始值直接赋值
      }
      filled.push(childPath);
      continue;
    }

    // target 有这个 key → 如果两边都是 plain object，递归补全
    if (isPlainObject(target[key]) && isPlainObject(source[key])) {
      filled.push(...deepMergeDefaults(target[key], source[key], childPath));
    } else if (Array.isArray(target[key]) && Array.isArray(source[key]) && source[key].length > 0) {
      // C-7：数组不再"原样保留"——对数组内的对象元素逐个补全缺失字段
      //   （老存档 tile 缺 dailyFlags/states 等字段时设施钩子会抛错）。
      //   模板元素优先取同下标；模板数组更短时用其最后一个对象元素作为 schema
      //   （outerTiles 等齐构数组：模板 8 格、存档可能 20 格）。
      const srcArr = source[key];
      let fallbackEl = null;
      for (let j = srcArr.length - 1; j >= 0; j--) {
        if (isPlainObject(srcArr[j])) { fallbackEl = srcArr[j]; break; }
      }
      for (let i = 0; i < target[key].length; i++) {
        const tEl = target[key][i];
        if (!isPlainObject(tEl)) continue;
        const sEl = isPlainObject(srcArr[i]) ? srcArr[i] : fallbackEl;
        if (sEl) filled.push(...deepMergeDefaults(tEl, sEl, `${childPath}[${i}]`));
      }
    }
    // 原始值、类型不匹配：一律不覆盖
  }

  return filled;
}

/**
 * 旧实时存档 → 日初基线的一次性归一化（《空间碰撞与时序方案》§11.8 / 设计文档 §19.5）
 *
 * 旧档是「按下存档那一刻」的实时状态；读入时把它提升为「本日开始」的基线：
 *   - 墙钟字段一律丢弃（生物 lastMoveTs、移动冷却、祈福锁）
 *   - 连携窗口队列与日内累计归零
 *   - 演出 / 界面态 / 建造态 / 结算中间量清除
 *   - 回合号回到日初 0
 *   - 跨日地基（HP / 成长 / 金币 / 名册 / 地块 / 背包）原样保留
 *   - 随机只保留主种子
 *
 * 对已经是日初基线的存档重复执行结果不变（幂等）。
 *
 * @param {object} gs 载入的 GS（原地修改）
 * @returns {object} 归一化后的 GS
 */
export function normalizeToDayStart(gs) {
  if (!isPlainObject(gs)) return gs;

  // 1) 墙钟
  if (Array.isArray(gs.creatures)) {
    for (const c of gs.creatures) {
      if (isPlainObject(c)) {
        delete c.lastMoveTs;
        delete c.moveEverySec;
        delete c.pauseMs;    // 阶段 2 开发期旧字段
        delete c.retargetMs; // 阶段 2 开发期旧字段
        delete c.pauseLeft;  // 阶段 3 起改用 behaviorState/stateLeft
        delete c.retargetLeft;
      }
    }
  }
  delete gs.blessLockUntilMs;

  // 2) 连携窗口与日内累计（日初由 LinkSkillSystem.resetAll 定义）
  gs.linkSkillQueue = [];
  gs.linkSkillCounters = {};
  gs.lastTurnLinkSkill = 0;

  // 3) 演出 / 交互 / 结算中间量
  gs.uiState = { selectedTileIdx: null, infoTab: 'content', activePanel: null };
  gs.buildMode = false;
  gs.pendingSleepStaminaBonus = 0;
  gs.blessingQueue = [];

  // 4) 回合号：新档恒为 0（旧档的「绝对回合」语义已在上方补丁中消费）
  gs.turn = 0;

  // 5) 随机：只留主种子，不存日内进度
  if (isPlainObject(gs.rng) && 'masterSeed' in gs.rng) {
    gs.rng = { masterSeed: gs.rng.masterSeed };
  }

  return gs;
}

/**
 * 把旧存档的 GS 迁移到当前 schema。
 * 原地修改 loadedGs（也返回它方便链式调用）。
 * @param {object} loadedGs 从 Storage.load 拿到的 GS
 * @returns {object} 补全后的 GS（就是 loadedGs 本身）
 */
export function migrateGS(loadedGs) {
  if (!isPlainObject(loadedGs)) {
    devLog.warn('[migrateGS] loadedGs 不是有效对象，跳过迁移');
    return loadedGs;
  }

  const fresh = createInitialState();
  const filled = deepMergeDefaults(loadedGs, fresh);

  if (filled.length > 0) {
    devLog.info('[migrateGS] 补全了', filled.length, '个缺失字段:', filled.join(', '));
  } else {
    devLog.info('[migrateGS] 存档 schema 已是最新，无需迁移');
  }

  // ── 语义迁移（字段含义变化，不能只靠补默认值） ──

  // B-3：技能冷却键从 `skill_<id>_<tileIdx>` 改为 `skill_<id>`（§12.3 技能卡移动后冷却保留）
  if (isPlainObject(loadedGs.skillCooldowns)) {
    const next = {};
    for (const [k, v] of Object.entries(loadedGs.skillCooldowns)) {
      const m = k.match(/^(skill_.+)_\d+$/);
      const nk = m ? m[1] : k;
      next[nk] = Math.max(next[nk] || 0, v || 0);
    }
    loadedGs.skillCooldowns = next;
  }

  // B-11：连携技冷却从「绝对回合号（gs.turn + n）」改为「剩余回合数」
  if (isPlainObject(loadedGs.linkSkillCooldowns)) {
    const t = loadedGs.turn || 0;
    for (const k of Object.keys(loadedGs.linkSkillCooldowns)) {
      loadedGs.linkSkillCooldowns[k] = Math.max(0, (loadedGs.linkSkillCooldowns[k] || 0) - t);
    }
  }

  // 连携技实例化：旧键 `skill_link_*` → 按当前放置地块生成实例键 `tileIdx|skillId`
  if (isPlainObject(loadedGs.linkSkillCooldowns)) {
    const tiles = loadedGs.map?.outerTiles || [];
    const next = {};
    for (const [k, v] of Object.entries(loadedGs.linkSkillCooldowns)) {
      if (k.includes('|')) { next[k] = v; continue; }
      tiles.forEach((tile, i) => {
        if (tile?.contentId === k) next[`${i}|${k}`] = Math.max(next[`${i}|${k}`] || 0, v || 0);
      });
    }
    loadedGs.linkSkillCooldowns = next;
  }

  // 连携技旧队列条目只有 skillId → 映射到当前放置实例；未放置的条目直接丢弃（不应有窗口）
  if (Array.isArray(loadedGs.linkSkillQueue)) {
    const tiles = loadedGs.map?.outerTiles || [];
    loadedGs.linkSkillQueue = loadedGs.linkSkillQueue.map((e) => {
      if (!e || e.key) return e;
      const idxs = [];
      tiles.forEach((tile, i) => { if (tile?.contentId === e.skillId) idxs.push(i); });
      if (idxs.length === 0) return null;
      return { ...e, key: `${idxs[0]}|${e.skillId}`, tileIdx: idxs[0] };
    }).filter(Boolean);
  }

  // B-10：道具冷却同样改为「剩余回合数」（旧存档存的是绝对回合号 gs.turn + cd）
  if (isPlainObject(loadedGs.itemCooldowns)) {
    const t = loadedGs.turn || 0;
    for (const k of Object.keys(loadedGs.itemCooldowns)) {
      loadedGs.itemCooldowns[k] = Math.max(0, (loadedGs.itemCooldowns[k] || 0) - t);
    }
  }

  // B-1：晴风攻击加成仅限本日内 —— 旧存档已把加成永久乘进 atk，
  //      按当日层数逆向回滚（每层 ÷1.08，与 BlessSystem 的 ×1.08 保留 1 位小数对应）
  if (isPlainObject(loadedGs.team) && isPlainObject(loadedGs.player)) {
    const bonus = loadedGs.team.dailyQingfengAtkBonus || 0;
    if (bonus > 0 && typeof loadedGs.player.atk === 'number') {
      let atk = loadedGs.player.atk;
      for (let i = 0; i < bonus; i++) atk = Math.round((atk / 1.08) * 10) / 10;
      devLog.info('[migrateGS] 晴风 atk 回滚', bonus, '层:', loadedGs.player.atk, '→', atk);
      loadedGs.player.atk = atk;
    }
  }

  // 空间几何（设计文档 §2.4）：旧存档生物补连续坐标/半径/朝向等字段。
  // 只补字段、不改存档策略；旧生物没有 pos 时按主格中心回填，保证几何查询可用。
  if (Array.isArray(loadedGs.creatures)) {
    for (const c of loadedGs.creatures) {
      if (!isPlainObject(c)) continue;
      const def = getCreatureDef(c.kind);
      if (typeof c.radius !== 'number' || c.radius <= 0) {
        c.radius = (def && def.radius) || DEFAULT_CREATURE_RADIUS;
      }
      // 阶段 2：speedPerTile 语义统一为「秒/格」（区间 3~6）。
      // 旧档（含阶段 1）存的是「格/秒」（0.2~0.3），小于 3 的一律按旧单位取倒数换算。
      const defSpeed = (def && def.speedPerTile) || 4.5;
      let speed = c.speedPerTile;
      if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
        speed = defSpeed;
      } else if (speed < 3) {
        speed = 1 / speed; // 旧语义 格/秒 → 秒/格
      }
      c.speedPerTile = Math.min(6, Math.max(3, speed));

      if (!isPlainObject(c.pos) || !Number.isFinite(c.pos.x) || !Number.isFinite(c.pos.y)) {
        const row = typeof c.row === 'number' ? c.row : 0;
        const col = typeof c.col === 'number' ? c.col : 0;
        c.pos = { x: FENCE_ORIGIN_X + col + 0.5, y: FENCE_ORIGIN_Y + row + 0.5 };
      }
      if (!isPlainObject(c.renderPos) || !Number.isFinite(c.renderPos.x) || !Number.isFinite(c.renderPos.y)) {
        c.renderPos = { x: c.pos.x, y: c.pos.y };
      }
      // 方向统一为弧度；旧档若是单位向量（阶段 1）转 atan2
      if (isPlainObject(c.dir) && Number.isFinite(c.dir.x) && Number.isFinite(c.dir.y)) {
        c.dir = Math.atan2(c.dir.y, c.dir.x);
      } else if (typeof c.dir !== 'number' || !Number.isFinite(c.dir)) {
        c.dir = 0;
      }
      if (!('targetPos' in c)) c.targetPos = null;

      // 阶段 3：走走停停行为状态机
      //   旧档（阶段 2）只有 pauseLeft/retargetLeft：
      //   - pauseLeft > 0 → 正处在停顿 → idle，剩余秒数沿用
      //   - 否则有 targetPos → walk；两者都没有 → idle（读档后先站一会儿）
      if (c.behaviorState !== 'idle' && c.behaviorState !== 'walk') {
        const legacyPause = typeof c.pauseLeft === 'number' ? c.pauseLeft : 0;
        const legacyTarget = isPlainObject(c.targetPos);
        if (legacyPause > 0) c.behaviorState = 'idle';
        else c.behaviorState = legacyTarget ? 'walk' : 'idle';
      }
      if (typeof c.stateLeft !== 'number' || !Number.isFinite(c.stateLeft) || c.stateLeft < 0) {
        const legacyPause = typeof c.pauseLeft === 'number' ? c.pauseLeft : 0;
        c.stateLeft = c.behaviorState === 'idle' ? Math.max(0, legacyPause) : 0;
      }
      if (typeof c.idleTurnLeft !== 'number' || !Number.isFinite(c.idleTurnLeft)) {
        c.idleTurnLeft = 0;
      }
      delete c.pauseLeft;
      delete c.retargetLeft;

      // 读档时半径可能已变大（或存档越界）：圆心夹回栅栏内合法区域
      const fRows = loadedGs.map?.fenceRows ?? loadedGs.map?.fenceRowCols ?? 0;
      const fCols = loadedGs.map?.fenceCols ?? loadedGs.map?.fenceRowCols ?? 0;
      if (fRows > 0 && fCols > 0) {
        const r = c.radius;
        const x0 = FENCE_ORIGIN_X + r, x1 = FENCE_ORIGIN_X + fCols - r;
        const y0 = FENCE_ORIGIN_Y + r, y1 = FENCE_ORIGIN_Y + fRows - r;
        for (const p of [c.pos, c.renderPos]) {
          p.x = Math.min(x1, Math.max(x0, p.x));
          p.y = Math.min(y1, Math.max(y0, p.y));
        }
      }
    }
  }

  // 存档口径归一化：旧实时档一次性提升为「当天开始」基线（新档重复执行结果不变）
  normalizeToDayStart(loadedGs);
  devLog.info('[migrateGS] 已归一化为日初基线 turn=', loadedGs.turn);

  return loadedGs;
}

export default migrateGS;
