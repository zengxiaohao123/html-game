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

const director = new GameDirector();
const ui = new UIController(director);

// 首次交互解锁音频
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
window.addEventListener('keydown', () => audio.unlock(), { once: true });

// 全屏特效（剧情打字引擎预留）
EventBus.on(GE.UI_FX, (p) => screenFx(p.kind));

// 全局错误兜底：记录到 devLog，避免白屏无信息
window.addEventListener('error', (e) => {
  devLog.error('window', e.message, e.error?.stack || '');
});

ui.boot();
devLog.info('boot', '《在成为勇者之前》启动');
