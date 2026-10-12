/**
 * main.js —— 入口：组装导演与 UI，启动标题界面。
 */

import { GameDirector } from './systems/GameDirector.js';
import { UIController } from './ui/UIController.js';
import { audio } from './core/Audio.js';
import { EventBus } from './core/EventBus.js';
import { GE } from './core/GameEvents.js';
import { screenFx } from './ui/dom.js';
import { devLog } from './core/Logger.js';
import { Assets } from './core/Assets.js';

const director = new GameDirector();
const ui = new UIController(director);

// 首次交互解锁音频
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
window.addEventListener('keydown', () => audio.unlock(), { once: true });

// 全屏特效（剧情打字引擎预留）
EventBus.on(GE.UI_FX, (p) => screenFx(p.kind));

// 音效：由事件总线集中驱动（BGM 待压缩后接入）
EventBus.on(GE.BATTLE_SKILL, () => audio.playSfx(Assets.SND.attack, { volume: 0.7 }));
EventBus.on(GE.BATTLE_DAMAGE, (p) => { if (p && p.amount > 0) audio.playSfx(Assets.SND.hurt, { volume: 0.5 }); });
EventBus.on(GE.ITEM_TOAST, (p) => {
  if (/金币|奖励/.test(p && p.text)) audio.playSfx(Assets.SND.gold, { volume: 0.6 });
});
EventBus.on(GE.EXPLORE_LOG, (e) => { if (e.kind === 'good') audio.playSfx(Assets.SND.reward, { volume: 0.5 }); });
EventBus.on(GE.BATTLE_END, (p) => {
  if (p && p.result === 'victory') audio.playSfx(Assets.SND.win, { volume: 0.7 });
});

// 全局错误兜底：记录到 devLog，避免白屏无信息
window.addEventListener('error', (e) => {
  devLog.error('window', e.message, e.error?.stack || '');
});

ui.boot();
devLog.info('boot', '《在成为勇者之前》启动');
