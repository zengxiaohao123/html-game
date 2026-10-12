/**
 * core/Assets.js —— 资源清单与加载
 *
 * 所有美术 / 音频路径在此集中登记（给素材重命名后的规范命名）。
 * 优先使用本地素材库挑选的文件；未就绪的用 null 占位，UI 层降级绘制。
 *
 * 加载策略：浏览器原生，图片用 Image，音频用 AudioManager 懒加载。
 */

const IMG = {
  // 敌人：史莱姆（旧仓库保留的 7 张）
  slime: {
    fire: 'assets/images/enemies/slime_fire.png',
    grass: 'assets/images/enemies/slime_grass.png',
    ice: 'assets/images/enemies/slime_ice.png',
    rock: 'assets/images/enemies/slime_rock.png',
    thunder: 'assets/images/enemies/slime_thunder.png',
    water: 'assets/images/enemies/slime_water.png',
    wind: 'assets/images/enemies/slime_wind.png',
  },
  // 探索地块底板（来自 DemonLordJustABlock_Assets，Q 版手绘风）
  terrain: {
    none: 'assets/images/terrain/tile_plain.png',
    grass: 'assets/images/terrain/tile_grass.png',
    water: 'assets/images/terrain/tile_water.png',
    ice: 'assets/images/terrain/tile_ice.png',
    snow: 'assets/images/terrain/tile_snow.png',
    lava: 'assets/images/terrain/tile_lava.png',
    mountain: 'assets/images/terrain/tile_mountain.png',
    forest: 'assets/images/terrain/tile_grass.png',   // 森林以草地为底 + 草丛/蘑菇装饰
    mine: 'assets/images/terrain/tile_mine.png',
  },
  // 地块装饰散件
  deco: {
    bush: 'assets/images/terrain/deco/bush.png',
    snowman: 'assets/images/terrain/deco/snowman.png',
    mushroom: 'assets/images/terrain/deco/mushroom.png',
    starfish: 'assets/images/terrain/deco/starfish.png',
    bone: 'assets/images/terrain/deco/bone.png',
    stone: 'assets/images/terrain/deco/stone.png',
    cake: 'assets/images/terrain/deco/cake.png',
  },
  // 敌人通用 Q 版精灵（来自素材库 enemy/unit/dog 系列，风格统一）
  foe: {
    chuuni: 'assets/images/enemies/foe_chuuni.png',
    bladedart: 'assets/images/enemies/foe_bladedart.png',
    ironlump: 'assets/images/enemies/foe_ironlump.png',
    mech: 'assets/images/enemies/foe_mech.png',
    snake: 'assets/images/enemies/foe_snake.png',
    tree: 'assets/images/enemies/foe_tree.png',
    bear: 'assets/images/enemies/foe_bear.png',
    hound: 'assets/images/enemies/foe_hound.png',
  },
  // 角色
  character: {
    hero: 'assets/images/characters/hero.png',
  },
  // 设施（帐篷/抽水泵待同画风补图）
  facility: {
    campfire: 'assets/images/facilities/campfire.png',
    campfireOut: 'assets/images/facilities/campfire.png',
  },
  // 其余素材随开发从本地素材库挑选后补登记
};

const SND = {
  // 来自素材库 audio 的短音效（BGM 体积大，压缩后再上）
  click: 'assets/audio/sfx_click.wav',
  attack: 'assets/audio/sfx_attack.wav',
  hurt: 'assets/audio/sfx_hurt.wav',
  gold: 'assets/audio/sfx_gold.wav',
  reward: 'assets/audio/sfx_reward.wav',
  win: 'assets/audio/sfx_win.wav',
  open: 'assets/audio/sfx_open.wav',
  bgmHome: null,
  bgmBoss: null,
};

const cache = new Map();

export function img(path) {
  if (!path) return null;
  if (cache.has(path)) return cache.get(path);
  const el = new Image();
  el.src = path;
  cache.set(path, el);
  return el;
}

/** 预加载一批关键资源，allSettled 不因单张失败中断 */
export async function preload(list) {
  const tasks = list.map((p) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { cache.set(p, im); res([p, true]); };
    im.onerror = () => res([p, false]);
    im.src = p;
  }));
  return Promise.allSettled(tasks);
}

export const Assets = { IMG, SND, img, preload };
