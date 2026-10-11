// 逻辑冒烟测试（Node，无 DOM）：验证核心规则可运行
import { GameState } from '../src/state/GameState.js';
import { ExploreSystem } from '../src/systems/ExploreSystem.js';
import { CombatEngine } from '../src/systems/battle/CombatEngine.js';
import { getSkill } from '../src/data/skills.js';
import { recomputePermanent } from '../src/systems/Permanent.js';
import { EventBus } from '../src/core/EventBus.js';
import { BattleResult } from '../src/core/Const.js';
import { writeSave, readSave } from '../src/core/Storage.js';

// localStorage stub
globalThis.localStorage = { _m: new Map(), getItem(k){return this._m.has(k)?this._m.get(k):null;}, setItem(k,v){this._m.set(k,String(v));}, removeItem(k){this._m.delete(k);} };

let pass=0, fail=0;
function assert(cond, msg){ if(cond){pass++; console.log('  ✓', msg);} else {fail++; console.log('  ✗', msg);} }

console.log('— 新游戏初始化 —');
const gs = new GameState();
gs.inventory.add('tent',1);
recomputePermanent(gs);
const ex = new ExploreSystem(gs, {});
assert(gs.map.has(0,0), '初始 3×3 中心存在');
assert(gs.ap===5 && gs.health===30 && gs.heroHp===100, '初始 AP5/健康30/HP100');
assert(gs.inventory.count('tent')===1, '初始背包 1 帐篷');
assert(gs.party.members.length===3, '初始编队 3 人');

console.log('— 移动 & AP —');
const before=gs.ap;
// 找一个可进入的相邻格
const nb=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,y])=>({x,y,t:gs.map.get(x,y)})).find(c=>c.t && gs.map.enterable(c.x,c.y));
if(nb){ ex.goTo(nb.x,nb.y); assert(gs.ap===before-1, '移动成功扣 1 AP'); }
else console.log('  - 无相邻可进入格（被地形阻挡），跳过');

console.log('— 每日刷新 —');
gs.day=1; ex.sleep();
assert(gs.day===2 && gs.ap===5, '睡觉进第 2 天 AP 回满');
let contents=new Set();
for(const [,t] of gs.map.tiles) contents.add(t.content);
assert(contents.size>=1, '刷新产生了 content 类型');

console.log('— 存档/读档 —');
writeSave(2, gs.serialize(), {kind:'manual',label:'test',day:gs.day});
const rec=readSave(2);
assert(rec && rec.snapshot.day===gs.day, '存档读档天数一致');

console.log('— 战斗：史莱姆时间 —');
const eng = new CombatEngine(gs);
const S = eng.startBattle('slimeTime');
assert(S!==null, '战斗成功创建');
assert(S.enemies(false).length===3, '开局 3 只原生史莱姆');
assert(S.leader.pos===2, '主角在左排中央 pos2');
assert(S.hand.length<=5, '元素手牌≤5（前期为空）');
// 主角斩击最左敌人
const target = S.enemies()[0];
const r1 = eng.castActive('hero_slash','hero',{side:'enemy',pos:target.pos,uid:target.uid});
assert(r1.ok, '斩击可释放');
// 结束玩家阶段，跑若干回合直到胜负
let guard=0;
let result=null;
const off = EventBus.on('battle:end',(p)=>{result=p.result;});
while(!result && guard++<60){
  if(S.phase==='player'){
    // 用所有可用主动打最左敌人
    let acted=true;
    while(acted){
      acted=false;
      for(const mid of gs.party.members){
        if((S.activeUses[mid]||0)>0){
          const sk = gs.party.skillSet.active.map(id=>getSkill(id)).find(s=>s&&s.owner===mid);
          if(sk){ const tgt=S.enemies()[0]; if(tgt){ eng.castActive(sk.id,mid,{side:'enemy',pos:tgt.pos,uid:tgt.uid}); acted=true; } }
        }
      }
    }
    eng.endPlayerPhase();
  }
  if(S.result){ result=S.result; break; }
}
off();
assert(result!==null && [BattleResult.VICTORY,BattleResult.DEFEAT].includes(result), `战斗在 ${guard} 轮内分出胜负（${result}）`);

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail?1:0);
