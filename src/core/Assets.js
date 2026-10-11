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
  // 其余素材随开发从本地素材库挑选后补登记
};

const SND = {
  // 从素材库 audio 中挑选的规范命名（复制进 assets/audio 后启用）
  uiClick: null,
  attack: null,
  hit: null,
  reward: null,
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
