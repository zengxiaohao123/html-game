/* ============================================================
   main_story/index.js —— 主线剧情汇总 & 触发引擎
   ============================================================

   目录约定：
     main_story/
       index.js                 ← 本文件：汇总所有片段 + 触发引擎
       act00/
         seg_000_opening.js     ← 第 0 幕（无标题）：醒来回忆穿越
       act01_分道扬镳/
         seg_001_template.js    ← 模板示例（仅作参考，不会真触发）
       act02_xxx/ act03_xxx/ ...  预留目录

   每个片段文件 export default 一个对象：
     {
       id: 'main_act01_seg001',   // 唯一 id，触发后存 G.records.mainStoryDone[id]=true
       act: 1,                     // 属于第几幕
       title: '片段标题（仅供人看）',
       condition: ()=> true,       // 触发条件
       body: [                     // 正文，每段 {speaker, html}
         { speaker: null,   html: '<p>旁白。</p>' },
         { speaker: '我',   html: '<p>我握紧匕首。</p>' },
         { speaker: '夏阳', html: '<p>别怕……</p>' },  // 阳自动变红
       ],
       options: [                  // 可选
         { name:'A', desc:'...', onPick:()=>{} },
       ],
       nextSeg: null,              // 可选，线性接续的下一段 id
       afterPlayed: null,          // 可选，正文结束后的收尾 hook
     }

   【元指令】语法：剧情文本里直接写，不显示给玩家
     【屏幕抖动】 / 【轻微抖动】 / 【shake】 / 【shake-dull】
     【屏幕闪白】 / 【闪白】 / 【flash】
     【屏幕黑屏】 / 【黑屏】 / 【black】
     【回忆开始】 / 【进入回忆】 / 【flashback-on】
     【回忆结束】 / 【退出回忆】 / 【变回正常】 / 【flashback-off】
     【act:第一幕 分道扬镳】

   主线 vs 事件：
     - 事件（event.js）内部调 storyPush(html, cb) 走两参旧签名，
       storyRunNext 里识别 eventState===true 时 speaker 区保持为空。
     - 主线剧情用 storyPush(html, {speaker, onDone, onEnd}) 三参新签名。
     - 二者共用同一个 typing engine，但互不干扰。

   触发点：
     - loadIntoWorld()：进世界时调用（第 0 幕在这里触发）
     - moveExplore()：玩家每次移动后调用（后续幕在这里触发）
     - eventState / combatState 时一律跳过
   ============================================================ */

// --- import 所有片段（按顺序注册到 MAIN_STORY_SEGMENTS） ---
import seg000_opening from './act00/seg_000_opening.js';

// --- 汇总数组（顺序=优先级：越靠前先触发） ---
const MAIN_STORY_SEGMENTS = [
  seg000_opening,            // 第 0 幕：day=0 立即触发
  // ↑ 后续剧情片段按"越早触发越靠前"的原则 push 进来
];

/* ============================================================
   触发引擎
   ============================================================ */
let currentMainStorySeg = null;
let mainStoryPlaying = false;

function triggerMainStorySeg(){
  if(!G) return false;
  if(mainStoryPlaying) return false;
  // 事件中不触发
  if(eventState) return false;

  for(const seg of MAIN_STORY_SEGMENTS){
    if(G.records?.mainStoryDone?.[seg.id]) continue;
    if(typeof seg.condition === 'function' && seg.condition()){
      playMainStorySeg(seg);
      return true;
    }
  }
  return false;
}

/* 播放一段主线剧情：按 body 顺序推送 */
function playMainStorySeg(seg){
  if(!seg) return;
  currentMainStorySeg = seg;
  mainStoryPlaying = true;

  // 标记已触发（立即标记，防止重入）
  G.records = G.records || {};
  G.records.mainStoryDone = G.records.mainStoryDone || {};
  G.records.mainStoryDone[seg.id] = true;

  // 剧情区清空 + 切 story 模式 + 刷新 iconbar（lock 编队/睡觉/商店/合成）
  switchMode('story');
  prompt('');
  // 保险：mainStoryPlaying 刚变成 true，switchMode 里的 renderIconbar 可能还没拿到最新状态
  renderIconbar();

  // 一次性灌进完整 body —— 引擎自动分页、自动打字、自动停住等点击
  // skipBlockedWhenChoice: 该段带 options → 玩家不能在选项出现前跳过（会丢失语境）
  const hasChoices = !!(seg.options && seg.options.length);
  storyStartFragment(seg.body, ()=> finishMainStorySeg(seg), { skipBlockedWhenChoice: hasChoices });
}

/* 一段剧情结束时的收尾 */
function finishMainStorySeg(seg){
  // 1) 有 options → 选项叠加在最后一页文字上，不清正文
  if(seg.options && seg.options.length){
    storyMarkChoice();
    setTimeout(()=>{
      renderMainStoryOptions(seg.options);
      if(typeof seg.afterPlayed === 'function') seg.afterPlayed();
    }, 0);
    mainStoryPlaying=false;
    return;
  }
  // 2) 无 options → 执行 afterPlayed hook + 清 speaker
  if(typeof seg.afterPlayed === 'function') seg.afterPlayed();
  storySetSpeaker(null);

  // 3) 等 0.8s 再查下一段，让玩家看完最后一屏
  //    真结束时（无下一段、无更多触发）：自动模式额外等 4s 让玩家看清结果文本，手动模式立即清
  //    期间 mainStoryPlaying 继续保持 true → isInFlow() 锁 UI（编队/睡觉/移动等仍禁用）
  const autoWait = (typeof storyAutoMode !== 'undefined' && storyAutoMode) ? 4000 : 0;
  const next = seg.nextSeg ? MAIN_STORY_SEGMENTS.find(s=>s.id===seg.nextSeg) : null;
  const mainMainStoryPlaying = mainStoryPlaying;  // 暂存一下（防止 4s 内有新剧情打断）
  setTimeout(()=>{
    if(mainMainStoryPlaying!==mainStoryPlaying) return;  // 已被新剧情接管，放弃本次收尾
    if(next && !G.records?.mainStoryDone?.[next.id]){
      mainStoryPlaying=false;  // 这段有后续，立即解除锁（playMainStorySeg 会立即重新锁）
      playMainStorySeg(next);
    } else if(!triggerMainStorySeg()){
      // 真结束：自动模式等 4s 让玩家看清结果，手动模式立即清
      if(autoWait){
        setTimeout(()=>{
          finishCurrentFragment();
          mainStoryPlaying=false;
          renderIconbar();
        }, autoWait);
      } else {
        finishCurrentFragment();
        mainStoryPlaying=false;
        renderIconbar();
      }
    } else {
      mainStoryPlaying=false;
    }
  }, 800);
}

/* 渲染主线剧情选项（复用事件选项 UI） */
function renderMainStoryOptions(opts){
  if(!opts||!opts.length) return;
  const html = opts.map((o,i)=>{
    const descHtml = (o.desc==null||o.desc===''||o.desc==='无') ? '' : `<div class="ev-opt-desc">${o.desc}</div>`;
    return `<div class="ev-opt" data-i="${i}"><div class="ev-opt-name"><span>${o.name}</span></div>${descHtml}</div>`;
  }).join('');
  prompt(`<div class="ev-opt-wrap">${html}</div>`);
  $('#promptZone').querySelectorAll('.ev-opt').forEach(b=>{
    b.onclick=()=>{
      const i=+b.dataset.i;
      prompt('');
      opts[i].onPick && opts[i].onPick();
    };
  });
}

/* —— 挂载到 window（供 main.js / explore.js 普通脚本调用）—— */
window.triggerMainStorySeg = triggerMainStorySeg;
window.mainStoryNextSeg = (id)=>{ mainStoryPlaying=false; setTimeout(()=>triggerMainStorySeg(), 50); };
window.showActTitle = showActTitle;

/* —— 第 0 幕播完后把 day 推到 1 —— */
window.storyAdvanceDayToOne = ()=>{
  if(!G) return;
  if(G.day < 1) G.day = 1;
  try{ refreshHUD(); }catch(e){}
};
