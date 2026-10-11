/**
 * data/battleNodes.js —— 作战 / 紧急作战节点（§4.14）
 *
 * 节点配置：战败健康惩罚、胜利奖励、敌人入场时间表。
 * wave 入场：
 *   atRound: 第几回合开始时生成；enemies: [{id, pos?}] 或 {randomSlimes:n}
 */

import { SLIME_IDS } from './enemies.js';

export const BATTLE_NODES = {
  slimeTime: {
    id: 'slimeTime', name: '史莱姆时间', kind: 'battle',
    healthOnLose: -1,
    rewards: [{ item: 'fruit', count: 3 }, { xp: 5 }, { item: 'randomTile', count: 1 }],
    waves: [{ atRound: 1, randomSlimes: 3 }],
  },
  slimeRampage: {
    id: 'slimeRampage', name: '史莱姆暴走！', kind: 'elite',
    healthOnLose: -1,
    rewards: [{ item: 'fruit', count: 3 }, { item: 'wood', count: 1 }, { item: 'linen', count: 1 }, { xp: 7 }, { item: 'tilePlain', count: 1 }],
    // 开局 3 个进攻点（避免重叠）；前 3 回合每回合再生成 1 只
    waves: [
      { atRound: 1, randomSlimes: 3 },
      { atRound: 2, randomSlimes: 1 },
      { atRound: 3, randomSlimes: 1 },
      { atRound: 4, randomSlimes: 1 },
    ],
  },
  villageDuel: {
    id: 'villageDuel', name: '村头决斗', kind: 'battle',
    healthOnLose: 0,
    rewards: [{ item: 'fruit', count: 1 }, { xp: 5 }, { item: 'tilePlain', count: 1 }],
    waves: [{ atRound: 1, enemies: ['chuuniBoy'] }],
  },
  strangeSlimeNode: {
    id: 'strangeSlimeNode', name: '奇怪的史莱姆', kind: 'battle',
    healthOnLose: 0,
    rewards: [{ xp: 1 }, { item: 'randomTileWaterGrass', count: 1 }],
    waves: [{ atRound: 1, enemies: ['strangeSlime'] }],
  },
  snakeWalk: {
    id: 'snakeWalk', name: '蛇行', kind: 'battle',
    healthOnLose: -1,
    rewards: [{ item: 'rawMeat', count: 1 }, { item: 'linen', count: 1 }, { xp: 5 }, { item: 'tileGrass', count: 1 }],
    waves: [
      { atRound: 1, enemies: ['littleSnake'] },
      { atRound: 4, enemies: ['littleSnake'] },
      { atRound: 7, enemies: ['littleSnake'], chance: 0.10, decideAtStart: true },
    ],
  },
  snakeNo: {
    id: 'snakeNo', name: '蛇不行', kind: 'battle',
    healthOnLose: -1,
    rewards: [{ item: 'rawMeat', count: 1 }, { item: 'fruit', count: 2 }, { xp: 5 }, { item: 'tileGrass', count: 1 }],
    waves: [
      { atRound: 1, enemies: ['littleSnake', 'bambooViper'], randomSlimes: 2, also: ['strangeSlime'] },
      { atRound: 4, enemies: ['strangeSlime'] },
      { atRound: 7, enemies: ['strangeSlime'] },
    ],
  },
  twinSnakes: {
    id: 'twinSnakes', name: '双蛇戏', kind: 'elite',
    healthOnLose: -1,
    rewards: [{ item: 'rawMeat', count: 2 }, { item: 'linen', count: 2 }, { xp: 8 }, { item: 'tileGrass', count: 1 }],
    waves: [{ atRound: 1, enemies: ['bambooViper', 'littleSnake'] }],
  },
  justATree: {
    id: 'justATree', name: '只是一棵树', kind: 'battle',
    healthOnLose: -1,
    // 特殊奖励：古树逃跑按剩余生命分档；被击败额外木材/经验/森林地块；玩家逃跑无奖励
    specialReward: 'ancientTree',
    waves: [{ atRound: 1, enemies: ['ancientTree'] }],
  },
  relentless: {
    id: 'relentless', name: '穷追不舍', kind: 'battle',
    healthOnLose: -1,
    rewards: [{ item: 'rawMeat', count: 2 }, { xp: 5 }, { item: 'tilePlain', count: 1 }],
    waves: [
      { atRound: 1, enemies: ['hound'] },
      { atRound: 3, enemies: ['hound'] },
    ],
  },
  bigDog: {
    id: 'bigDog', name: '大狗嚼嚼嚼', kind: 'elite',
    healthOnLose: -1,
    rewards: [{ item: 'rawMeat', count: 3 }, { xp: 8 }, { item: 'tilePlain', count: 1 }, { item: 'gold', count: 5, chance: 0.50 }],
    waves: [
      { atRound: 1, enemies: ['houndPro'] },
      { atRound: 3, enemies: ['hound', 'hound'] },
    ],
  },
  elegantDart: {
    id: 'elegantDart', name: '潇洒镖客', kind: 'battle',
    healthOnLose: -1,
    rewards: [{ item: 'rawMeat', count: 1 }, { item: 'gold', count: 1 }, { xp: 6 }, { item: 'tilePlain', count: 1 }],
    waves: [
      { atRound: 1, enemies: ['blueDart'] },
      { atRound: 3, enemies: ['blueDart'] },
    ],
  },
  redCrown: {
    id: 'redCrown', name: '怒发冲冠', kind: 'elite',
    healthOnLose: -1,
    rewards: [{ item: 'rawMeat', count: 2 }, { item: 'gold', count: 2 }, { xp: 8 }, { item: 'tilePlain', count: 1 }, { xp: 8, chance: 0.50 }],
    waves: [{ atRound: 1, enemies: ['redDart', 'redDart'] }],
  },
  bearAppears: {
    id: 'bearAppears', name: '熊出没', kind: 'elite', rare: true,
    healthOnLose: -1,
    rewards: [{ item: 'rawMeat', count: 5 }, { xp: 25 }, { item: 'tileSnow', count: 1 }],
    waves: [{ atRound: 1, enemies: ['angryBear'] }],
  },
  ruinGuardian: {
    id: 'ruinGuardian', name: '遗迹守卫者', kind: 'elite',
    healthOnLose: -1,
    rewards: [{ item: 'iron', count: 1 }, { xp: 10 }, { item: 'tileMine', count: 1 }, { item: 'iron', count: 1, chance: 0.20 }],
    waves: [{ atRound: 1, enemies: ['abandonedMech'], randomSlimes: 1, also: ['hound'] }],
  },
  ironTeeth: {
    id: 'ironTeeth', name: '铜牙铁嘴', kind: 'elite',
    healthOnLose: -1,
    rewards: [{ item: 'iron', count: 1 }, { xp: 10 }, { item: 'tileMine', count: 1 }, { item: 'tileMine', count: 1, chance: 0.20 }],
    waves: [
      { atRound: 1, enemies: ['ironLump'] },
      { atRound: 2, enemies: ['slimeRock'] },
      { atRound: 3, enemies: ['slimeRock'] },
      { atRound: 4, enemies: ['slimeRock'] },
      { atRound: 5, enemies: ['slimeRock'] },
    ],
  },
};

export function getNode(id) { return BATTLE_NODES[id] ?? null; }
export const ALL_NODE_IDS = Object.keys(BATTLE_NODES);
export { SLIME_IDS };
