/* ============================================================
   main_story/index.js —— 主线剧情汇总 & 触发引擎
   ============================================================
   目录约定：
     main_story/
       index.js                 ← 本文件：汇总所有片段 + 触发引擎
       act01_分道扬镳/
         seg_001_intro.js       ← 每段主线剧情一个独立 JS 文件
         seg_002_xxx.js
       act02_xxx/
       act03_xxx/
       ...

   每个片段文件 export 一个对象，结构见下文「片段模板」。
   本文件维护 MAIN_STORY_SEGMENTS 数组，后续新增片段只需：
     1) 在对应幕目录下新建 seg_XXX_*.js
     2) 在本文件顶部 import 并 push 进数组
   —— 这样任何 AI Agent 接手工作时，只需看本文件就能知道
      当前有哪些片段、它们在哪个幕、触发条件是什么。

   片段模板（复制修改即可）：
   ──────────────────────────────────────────────────────
   export default {
     id: 'main_act01_seg001',   // 唯一 id，触发后存 G.records.mainStoryDone[id]=true
     act: 1,                     // 属于第几幕
     title: '这里写片段标题（仅供人看）',

     // 触发条件：返回 true 则立即触发（主线剧情会抢占事件格）
     // 常见条件：day>=3, hasQuest('bear'), bond('xiayang')>=3
     condition: ()=> G.day>=1 && !G.records.mainStoryDone?.['main_act01_seg001'],

     // 正文：段落数组。每段 {speaker, html}
     //   speaker 为字符串时，名字行显示该名字并自动处理彩色（白名单人物）
     //   speaker 为 null / undefined 时，名字行清空（旁白 / 场景描写）
     //   html 支持 <p>...</p> 包裹，也支持纯文字；自动解析 【元指令】
     body: [
       { speaker: null,    html: '<p>这里是旁白。夜色褪去……</p>' },
       { speaker: '我',    html: '<p>我握紧了手中的匕首。</p>' },
       { speaker: '夏阳',  html: '<p>阳字会自动变红。我没事……</p>' },
       { speaker: null,    html: '<p>【shake】一阵剧烈的摇晃……</p>' },
     ],

     // 选项（可选）：如果有，会在正文所有段落打完后显示在右侧信息区
     // 每段 options 前引擎会插入一个 __choiceMarker 供「跳过」定位
     options: [
       { name: '选项A', desc: '...', onPick: ()=>{ /* 执行效果 */ nextSeg('main_act01_seg002'); } },
       { name: '选项B', desc: '...', onPick: ()=>{ /* ... */ } },
     ],

     // 线性接续（可选）：若没有 options，写完正文后自动播放下一段
     nextSeg: null,  // 比如 'main_act01_seg002'
   };
   ──────────────────────────────────────────────────────
   ============================================================ */

// --- import 所有片段（按需要添加） ---
import segTemplate_act01_seg001 from './act01_分道扬镳/seg_001_template.js';

// --- 汇总数组 ---
const MAIN_STORY_SEGMENTS = [
  segTemplate_act01_seg001,
  // ↑ 后续新增片段 push 进这里
];

/* ============================================================
   触发引擎：由 explore.js / map.js 在玩家每次移动后调用
   扫描 segments，找出第一个满足 condition 且尚未触发的片段并播放
   返回 true 表示刚触发了一段剧情，false 表示这次没触发
   ============================================================ */
let currentMainStorySeg = null;
let mainStoryPlaying = false;
function triggerMainStorySeg(){
  if(!G) return false;
  if(mainStoryPlaying) return false;
  // 事件中不触发（事件格优先）
  if(eventState) return false;

  // 遍历所有片段，condition 为真即触发
  for(const seg of MAIN_STORY_SEGMENTS){
    if(G.records && G.records.mainStoryDone && G.records.mainStoryDone[seg.id]) continue;
    if(typeof seg.condition === 'function' && seg.condition()){
      playMainStorySeg(seg);
      return true;
    }
  }
  return false;
}

/* 播放一段主线剧情：按 body 顺序推送，最后处理 options 或 nextSeg */
function playMainStorySeg(seg){
  if(!seg) return;
  currentMainStorySeg = seg;
  mainStoryPlaying = true;
  // 标记已触发
  G.records = G.records || {};
  G.records.mainStoryDone = G.records.mainStoryDone || {};
  G.records.mainStoryDone[seg.id] = true;
  // 剧情区清空，切 story 模式
  switchMode('story');
  clearStory();  // storyClear
  prompt('');    // 清空右侧信息区

  // 按 body 数组逐段推送到引擎
  let i=0;
  const pushNext = ()=>{
    if(i>=seg.body.length){ /* 正文结束 */
      // 1) 若有 options -> 插入 choice marker，然后渲染选项到右侧信息区
      if(seg.options && seg.options.length){
        storyMarkChoice();
        setTimeout(()=>renderMainStoryOptions(seg.options), 0);
        return;
      }
      // 2) 否则 -> nextSeg 线性接续
      if(seg.nextSeg){
        const nextSegObj = MAIN_STORY_SEGMENTS.find(s=>s.id===seg.nextSeg);
        setTimeout(()=>{ mainStoryPlaying=false; triggerMainStorySeg(); }, 600);
        return;
      }
      // 3) 无 options 无 nextSeg -> 本段结束
      mainStoryPlaying=false;
      currentMainStorySeg=null;
      return;
    }
    const para = seg.body[i]; i++;
    storySetSpeaker(para.speaker || null);
    storyPush(para.html, { onDone: pushNext });
  };
  pushNext();
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
      opts[i].onPick && opts[i].onPick();
      prompt('');
    };
  });
  mainStoryPlaying=false;
}

/* 给外部调用（比如选项 onPick 里串下一段） */
function mainStoryNextSeg(id){
  mainStoryPlaying=false;
  setTimeout(()=>triggerMainStorySeg(), 50);
}

/* —— 挂载到 window（供 main.js / explore.js 普通脚本调用）—— */
window.triggerMainStorySeg = triggerMainStorySeg;
window.mainStoryNextSeg = mainStoryNextSeg;
window.showActTitle = showActTitle;   // 幕标题也可以被普通脚本直接调用
