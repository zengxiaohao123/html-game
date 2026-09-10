/* ============================================================
   js/data.js —— 模块：数据与常量
   角色 / 敌人 / 技能 / 天赋 / 状态 / 词条 / 元素 / 资源 定义。
   ============================================================ */
"use strict";

/* 存档位上限 */
const MAX_SAVES = 8;

/* 元素枚举（着色 class 与中文名） */
const ELEM = {fire:{c:'e-fire',zh:'火'},water:{c:'e-water',zh:'水'},grass:{c:'e-grass',zh:'草'},
  thunder:{c:'e-thunder',zh:'雷'},ice:{c:'e-ice',zh:'冰'},wind:{c:'e-wind',zh:'风'},rock:{c:'e-rock',zh:'岩'}};
const AURA_ELEMS = ['fire','water','grass','thunder','ice'];

const RES_ZH = {wood:'木材', fruit:'果子', flax:'亚麻', rawMeat:'生肉', coin:'金币', emptyBottle:'空瓶子', iron:'铁块'};
const RES_DESC = {wood:'基础材料。可用于合成、交易',
  fruit:'可食用的野果。可用于合成、交易，可直接使用回复20生命值且有20%概率增加1点健康',
  flax:'基础材料。可用于合成、交易',
  rawMeat:'未处理的肉块。可用于合成、交易，可直接使用回复20生命值',
  coin:'通行的钱币，可在商店使用。',
  emptyBottle:'随处可见的空瓶子，可用于交易',
  iron:'相对罕见的基础材料。可用于合成、交易'};
const NATURAL_RESOURCES = ['wood','flax','fruit','rawMeat'];

const ITEMS = {
  cookedMeat:{name:'熟肉', desc:'香喷喷的肉排。可用于交易，可直接使用回复70点生命值'},
  campfire:{name:'篝火', desc:'食用食物后，使对应的此类食物可回复生命值永久增加（果子+1，生肉+2，熟肉+4）', permanent:true},
  club:{name:'木棒', desc:'使主角的【天赋·暴击】提升1级。可叠加', permanent:true},
  cloth:{name:'布衣', desc:'使主角的【天赋·格挡】提升1级。可叠加', permanent:true},
  tent:{name:'帐篷', desc:'探索时行动力上限+1。可叠加', permanent:true},
  trap:{name:'陷阱', desc:'睡觉时，有50%获得1个随机自然资源。可叠加', permanent:true},
  quilt:{name:'被子', desc:'睡觉时，主角回复30点生命值。可叠加', permanent:true},
  dagger:{name:'匕首', desc:'使主角的【天赋·嗜血】提升1级。可叠加', permanent:true},
  leather:{name:'皮衣', desc:'使主角的【天赋·坚守】提升1级。可叠加', permanent:true},
  ironSword:{name:'铁剑', desc:'使主角的【天赋·起势】提升1级。可叠加', permanent:true},
  armor:{name:'盔甲', desc:'使主角的【天赋·格挡】和【天赋·坚守】各提升1级。可叠加', permanent:true},
  roadmap:{name:'路线图', desc:'探索中，若地图上有稀有动物，会将其所在格用特殊颜色标记。每次进入被标记的格子后，消耗1张路线图', permanent:true},
  caiyunPendant:{name:'裁云挂件', desc:'半透晶石制成的薄片挂件，内部封存着被风儿裁出的浅白云纹，常作为赠予珍视之人的饰物。可赠予同伴，使其好感度+10', permanent:true},
  goodCard:{name:'好人卡', desc:'勿以善小而不为。睡觉时获得1金币。可叠加', permanent:true},
};
function itemName(k){ return RES_ZH[k] || (ITEMS[k]&&ITEMS[k].name) || k; }
function itemDesc(k){ return ITEMS[k]? ITEMS[k].desc : (RES_DESC[k]||''); }

const SHOP_ITEMS = [
  {key:'wood',         buy:2,  sellable:true},
  {key:'flax',         buy:3,  sellable:true},
  {key:'fruit',        buy:2,  sellable:true},
  {key:'rawMeat',      buy:4,  sellable:true},
  {key:'emptyBottle',  buy:5,  sellable:true},
  {key:'iron',         buy:6,  sellable:true},
  {key:'dagger',       buy:32, sellable:false, priceGrow:4, permanent:true},
  {key:'leather',      buy:20, sellable:false, priceGrow:4, permanent:true},
];
function itemBuyPrice(key){ const it=SHOP_ITEMS.find(x=>x.key===key); if(!it) return 0; const owned=(G&&G.inventory&&G.inventory[key])||0; return it.buy + (it.priceGrow? it.priceGrow*owned : 0); }

const FOOD = { fruit:{heal:20, healthChance:0.2}, rawMeat:{heal:20}, cookedMeat:{heal:70} };
function itemUsable(k){ return !!FOOD[k]; }
function foodHeal(k){ const camp=G && G.inventory && G.inventory.campfire>0; const base=FOOD[k]? FOOD[k].heal : 0; const add = camp ? (k==='fruit'?1 : k==='rawMeat'?2 : k==='cookedMeat'?4 : 0) : 0; let v = base+add; if(G && G.team && G.team.indexOf('luyouyou')>=0){ v = Math.round(v * (k==='cookedMeat'?1.75:1.25)); } return v; }

function grantPermanentItem(key){ G.inventory[key]=(G.inventory[key]||0)+1; switch(key){ case 'club':bumpPro('crit');break; case 'cloth':bumpPro('block');break; case 'dagger':bumpPro('blood');break; case 'leather':bumpPro('hold');break; case 'ironSword':bumpPro('momentum');break; case 'armor':bumpPro('block');bumpPro('hold');break; case 'tent':G.hero.apCap=(G.hero.apCap||5)+1;G.hero.actionPoint=(G.hero.actionPoint||0)+1;break; } }
function bumpPro(talent){ G.proLevels=G.proLevels||{}; G.proLevels[talent]=(G.proLevels[talent]||1)+1; }

const ST = {
  burn:{id:'burn', name:'燃烧', kind:'debuff', turns:3, desc:'每回合开始时流失2%生命值（可致死，无伤害来源）。持续3回合。'},
  bind:{id:'bind', name:'束缚', kind:'debuff', desc:'无法移动，但可以攻击。'},
  atkUp:{id:'atkUp', name:'攻击提升', kind:'buff', turns:2, desc:'攻击力提升25%。'},
  shield:{id:'shield', name:'护盾', kind:'buff', desc:'抵消等量伤害（不抵流失类效果），每回合刷新。'},
  alert:{id:'alert', name:'重点目标', kind:'debuff', desc:'我方单位攻击时优先攻击该目标；场上至多存在1个。持续整场战斗。'},
  dr:{id:'dr', name:'伤害减免', kind:'buff', turns:1, desc:'本回合受到的伤害减少40%。'},
  crit:{id:'crit', name:'屏息', kind:'buff', turns:2, desc:'下一次攻击的暴击率提升100%。'},
  rage:{id:'rage', name:'狂躁', kind:'buff', turns:5, desc:'攻击力+80%、速度+60，每回合额外攻击1次，掌掴改为攻击周围8格。持续5回合。'},
  cage:{id:'cage', name:'禁锢', kind:'debuff', turns:2, desc:'无法行动。主角被禁锢时可移动但移动无实际效果（仅用于结束我方回合）。'},
  poison:{id:'poison', name:'中毒', kind:'debuff', desc:'回合开始时，流失等同层数的生命值（可致死，可叠加）。'},
  sleep:{id:'sleep', name:'睡眠', kind:'debuff', desc:'无法移动、无法攻击；受到伤害导致生命值降低时会提前醒来。'},
  frozen:{id:'frozen', name:'冰冻', kind:'debuff', turns:1, desc:'无法行动（包括移动、攻击等一切主动行为）。持续1回合。'},
  aggro:{id:'aggro', name:'激化', kind:'buff', turns:2, desc:'攻击力+15%，受到的雷元素伤害与草元素伤害+25%。持续2回合。'},
  superconduct:{id:'superconduct', name:'超导', kind:'debuff', turns:3, desc:'雷、冰、物理抗性均降低30%（最终结算限0%~90%）。持续3回合。'},
};
const TERMS = {
  alert:'【重点目标】主角天赋【战术布置】产生。我方单位攻击时优先攻击该目标；场上至多存在1个；主角用单体攻击新敌人时覆盖旧目标。',
  charge:'【蓄力】敌人进行强力攻击前的准备状态。蓄力期间不移动、不改变朝向。受到我方任意攻击即被打断。',
  bind:'【束缚】无法移动，但可以攻击。',
  burn:'【燃烧】每回合开始时流失2%生命值（可致死，没有伤害来源）。持续3回合。',
  aggro:'【激化】攻击力+15%；受到的雷元素伤害与草元素伤害+25%。持续2回合。',
  superconduct:'【超导】雷、冰、物理抗性均降低30%。持续3回合。抗性最终结算强制限定在0%~90%之间。',
  frozen:'【冰冻】无法行动（包括移动、攻击、蓄力等一切主动行为，不包括被动效果）。持续1回合。',
  cage:'【禁锢】无法行动。',
  zone:'【结界】技能形成的区域效果。持续时间内对范围内单位施加特定效果。',
  extraTurn:'【额外回合】许泠朦【秋水澄心】天赋触发。仅泠朦能释放技能，无移动。各类增益减益不计时。冷却不减少。',
  steal:'【偷取】对方的数值减少，自身的数值对应增加。',
  dodge:'【闪避】受到攻击时有概率使本次所受伤害降为0。对真实伤害、控制/状态类效果及生命流失类效果不生效。',
};
function termHTML(key, zh){ return `<span class="term" data-term="${key}">【${zh}】</span>`; }
const TERM_KEYS = {重点目标:'alert', 蓄力:'charge', 束缚:'bind', 燃烧:'burn', 激化:'aggro', 超导:'superconduct', 冰冻:'frozen', 禁锢:'cage', 结界:'zone', 额外回合:'extraTurn', 偷取:'steal', 闪避:'dodge'};

const PROTAGONIST = {
  key:'pro', name:'主角', element:null, color:null,
  base:{atk:10, maxHp:100, def:0, escapeSpeed:100, hp:100},
  passives:[
    {id:'tactic', name:'战术布置', desc:'攻击时设置【重点目标】，我方优先攻击该目标（持续至该敌人被击败）。'},
    {id:'crit', name:'暴击', level:1, scal:{atk:{base:10,grow:10}, crit:{base:3,grow:2,pct:true}}, desc:'攻击力+{atk}，暴击率+{crit}。'},
    {id:'blood', name:'嗜血', level:1, scal:{atk:{base:20,grow:20}, prob:{base:3,grow:3,pct:true}}, desc:'攻击力+{atk}，使用攻击型技能后有{prob}概率回复生命值，回复量相当于本次伤害的50%。'},
    {id:'momentum', name:'起势', level:1, scal:{atk:{base:30,grow:30}, dmg:{base:4,grow:4,pct:true}}, desc:'攻击力+{atk}，使用攻击型技能后获得{dmg}伤害加成。'},
    {id:'block', name:'格挡', level:1, scal:{hp:{base:50,grow:50}, prob:{base:2,grow:2,pct:true}}, desc:'最大生命+{hp}，受到攻击时有{prob}概率使本次伤害降为0。'},
    {id:'hold', name:'坚守', level:1, scal:{def:{base:20,grow:20}, prob:{base:3,grow:3,pct:true}}, desc:'防御力+{def}，受到攻击时有{prob}概率回复12%生命值。'},
  ],
  skills:[
    {id:'slash', name:'斩击', kind:'attack', type:'physical', range:1, effect:atk=>atk*1.00, target:'front', alert:true, formula:'攻击力×100%', desc:'对前方一格的敌人造成{DMG}的物理伤害。'},
    {id:'blade', name:'万刃斩', kind:'attack', type:'physical', range:1, effect:atk=>atk*0.85, target:'adj', formula:'攻击力×85%', desc:'对周围四格的所有敌人造成{DMG}的物理伤害。'},
    {id:'despair', name:'拼命', kind:'attack', type:'physical', range:1, effect:atk=>atk*1.40, target:'front', selfDrainPct:0.20, formula:'攻击力×140%', desc:'对前方一格的敌人造成{DMG}的物理伤害，自身流失20%生命值（可致死）。'},
    {id:'balance', name:'均衡', kind:'attack', type:'physical', range:1, effect:atk=>atk*0.70, target:'front', selfHeal:0.08, dr:1, formula:'攻击力×70%', desc:'对前方一格造成{DMG}的物理伤害，回复自身8%最大生命，本回合受伤害-40%。'},
    {id:'guerrilla', name:'游击', kind:'attack', type:'physical', range:2, effect:atk=>atk*0.70, target:'nearest', alert:true, formula:'攻击力×70%', desc:'对两格距离内最近的一名敌人造成{DMG}的物理伤害。'},
  ],
  selectedSkillIds:['slash','blade','guerrilla']
};

const ALLIES = {
  xiayang:{ key:'xiayang', name:'夏阳', element:'fire', atk:10,
    passives:[
      {id:'fearless', name:'无所畏惧', level:1, scal:{pro:{base:25,grow:15}, self:{base:35,grow:20}}, desc:'主角攻击力+{pro}，自身攻击力+{self}。'},
      {id:'vigor', name:'活力满满', desc:'睡觉时回复的生命值和健康值翻倍（本天赋不提供回复，本身不具备回复）。'},
      {id:'curious', name:'好奇心', desc:'战斗胜利时有30%概率额外获得1次本场战斗的奖励（仅复制物品与金钱，不含属性升级），有50%概率额外获得1金币。'},
      {id:'lucky', name:'心想事成', desc:'可在载具页切换为【巧遇】，移动至场上任意一格，每天限1次。'},
      {id:'rebirth', name:'涅槃', desc:'战斗中主角受到致命伤害时不倒下，回复50%生命值并使所有我方角色攻击力+25%。每天限1次。'},
    ],
    skills:[
      {id:'quhuo', name:'淬火', kind:'attack', type:'fire', range:1, target:'adj', randTarget:true, effect:atk=>atk*1.20, formula:'攻击力×120%', desc:'对周围四格随机一名敌人造成{DMG}的火元素伤害。'},
      {id:'zhongyuan', name:'众愿', kind:'attack', type:'fire', range:1, target:'adj', randTarget:true, effect:atk=>atk*1.90, stealAtk:0.20, cd:2, formula:'攻击力×190%', desc:'【偷取】其余我方角色各20%的攻击力（本场持续、多次可叠加），然后对周围四格随机一名敌人造成{DMG}的火元素伤害。冷却：2回合。'},
      {id:'liaoyuan', name:'燎原', kind:'attack', type:'fire', range:4, target:'frontline', effect:atk=>atk*1.50, burn:3, cd:5, formula:'攻击力×150%', desc:'对前方一线四格内的所有敌人造成{DMG}的火元素伤害，并施加【燃烧】3回合。冷却：5回合。'},
      {id:'guwu', name:'鼓舞', kind:'support', type:'buff', range:0, target:'self', effect:null, healPct:0.20, atkFlat:25, level:1, scal:{buff:{base:25,grow:15}, heal:{base:20,grow:10,pct:true}}, desc:'主角回复夏阳攻击力{heal}的生命（约{Y}），并使攻击力最高的我方角色攻击力+{buff}。'},
    ],
    selectedSkillIds:['quhuo','liaoyuan','guwu']
  },
  luyouyou:{ key:'luyouyou', name:'陆悠悠', element:'wind', atk:10,
    passives:[
      {id:'skillful', name:'巧手', level:1, scal:{sleep:{base:40,grow:5,pct:true}, craft:{base:25,grow:5,pct:true}}, desc:'睡觉时有{sleep}概率获得1个随机资源；合成时有{craft}概率获得1个随机资源。'},
      {id:'cook', name:'烹饪', desc:'食物回复效果提升：果子/生肉+25%、熟肉+75%；主角最大生命值+100。'},
      {id:'flutter', name:'蹁跹', level:1, scal:{dodge:{base:32,pct:true}, move:{base:30,grow:10}, combat:{base:30,grow:20}}, desc:'主角获得{dodge}闪避；探索每次移动后主角回复{move}生命；战斗中主角每次【闪避】后回复{combat}生命。'},
      {id:'wind', name:'风息', level:1, scal:{atk:{base:60,grow:6}, crit:{base:30,grow:3,pct:true}}, desc:'自身攻击力+{atk}，暴击率+{crit}；暴击时本次技能伤害由物理转为风元素。'},
      {id:'duo', name:'比翼', desc:'自身暴击后，其余我方角色下一次攻击暴击率+100%。'},
    ],
    skills:[
      {id:'jingqiao', name:'精巧射击', kind:'attack', type:'physical', range:3, target:'nearest', randTarget:true, effect:atk=>atk*0.90, formula:'攻击力×90%', desc:'对三格距离内的随机一名敌人造成{DMG}的物理伤害。'},
      {id:'tuoshen', name:'脱身矢', kind:'attack', type:'physical', range:3, target:'frontline', effect:atk=>atk*1.00, knockback:1, cd:4, formula:'攻击力×100%', desc:'对前方三格内的所有敌人造成{DMG}的物理伤害，并将其击退1格。冷却：4回合。'},
      {id:'bixi', name:'屏息瞄准', kind:'support', type:'buff', range:0, target:'self', effect:null, critBuff:1, desc:'屏息瞄准：下一次攻击的暴击率+100%（不可叠加，未被消耗前持续整场）。'},
      {id:'fengzhi', name:'风止', kind:'attack', type:'physical', range:3, target:'nearest', multTarget:2, effect:atk=>atk*0.70, bindTurns:1, cd:3, formula:'攻击力×70%', desc:'对三格距离内随机2名敌人造成{DMG}的物理伤害，并施加【束缚】1回合。冷却：3回合。'},
      {id:'ruodian', name:'弱点击破', kind:'attack', type:'physical', range:3, target:'nearest', effect:atk=>atk*1.30, burstBias:true, cd:5, formula:'攻击力×130%', desc:'对三格距离内随机1名敌人造成{DMG}的物理伤害，优先选择正处于【蓄力】的敌人；若目标处于【蓄力】，则本次攻击暴击率+100%并【束缚】3回合。冷却：5回合。'},
    ],
    selectedSkillIds:['jingqiao','tuoshen','bixi']
  }
};
const CHARACTERS = Object.assign({ pro:PROTAGONIST }, ALLIES);
function getChar(key){ return CHARACTERS[key] || PROTAGONIST; }
function getTeamChars(){ return (G&&G.team||['pro']).map(k=>getChar(k)).filter(Boolean); }
function getBond(key){ if(!G) return {level:1,affinity:0}; if(!G.bonds) G.bonds={}; if(!G.bonds[key]) G.bonds[key]={level:0,affinity:0}; return G.bonds[key]; }
function bondLevel(key){ return (getBond(key).level)||0; }
function gainAffinity(key, amount){
  const b=getBond(key); if(!b) return;
  const before=b.affinity; b.affinity=Math.max(-999, Math.min(999, (b.affinity||0)+amount));
  const target=Math.floor((b.affinity||0)/10);
  if(target>b.level){ const old=b.level; b.level=Math.max(0,Math.min(10,target)); if(G&&old!==b.level) log(`${getChar(key).name} 好感度提升，羁绊等级升到 <b>${b.level}</b> 级！`); }
  if(amount!==0 && G) log(`${getChar(key).name} 好感度 ${amount>0?`+${amount}`:amount}（当前 ${b.affinity}）。`);
}
function entryLevel(ownerKey, entry){ if(!entry || !entry.scal) return 1; if(ownerKey==='pro'){ const m=(G&&G.proLevels); return (m && m[entry.id])? m[entry.id] : 1; } const b=(G&&G.bonds&&G.bonds[ownerKey]); return b ? (b.level||1) : 1; }
function tierValue(entry, level, key){ const s=entry.scal[key]; if(!s) return 0; return s.base + (s.grow||0) * Math.max(0, (level||1)-1); }
function lvDescText(entry, level, ext){ let d=entry.desc||''; if(entry.scal){ for(const key in entry.scal){ const s=entry.scal[key]; const v=tierValue(entry, level, key); d=d.split('{'+key+'}').join(`<span class="lvlup">${v}${s.pct?'%':''}</span>`); } } if(ext){ for(const key in ext){ d=d.split('{'+key+'}').join(`<span class="lvlup">${ext[key]}</span>`); } } return terms(d); }

/* ===== 任务系统数据（id 作存档键，记录进度与奖励发放状态） ===== */
/* rewards：{key,text} 为可点击查看的物品奖励；{simple} 为纯文本奖励（不显示为可点击物品）。
   hook：接取钩子，对应 G.records 中的字段名，为真后才在任务界面显示（如讨伐熊需先遇事件）。 */
const TASKS = [
  { id:'m1', cat:'main', name:'第一幕·分道扬镳', goals:['存活下去，保证自己的健康大于 0','探索野外，推进剧情'], last:null, rewards:[{key:'caiyunPendant', text:'裁云挂件×1'}] },
  { id:'s1', cat:'side', name:'讨伐任务·暴躁的熊', goals:['击败一头暴躁的熊'], last:1, hook:'bearQuestStarted', rewards:[{simple:'金币+5'},{simple:'主角防御力+10'}] },
  { id:'s2', cat:'side', name:'日常任务·日行一善', goals:['累计扶起摔倒的老奶奶'], last:10, rewards:[{key:'goodCard', text:'好人卡×1'}] },
];
function taskVisible(t){ if(t.hook && !(G&&G.records&&G.records[t.hook])) return false; return true; }
function taskProgress(t){ if(t.last==null) return null; if(t.id==='s1') return Math.min((G&&G.records&&G.records.bearSlain)||0, t.last); if(t.id==='s2') return Math.min((G&&G.records&&G.records.oldLadyHelped)||0, t.last); return null; }
function taskDone(t){ const p=taskProgress(t); if(p==null) return false; return p>=t.last; }
function taskDoneMarked(t){ return !!(G&&G.records&&G.records.questDone&&G.records.questDone[t.id]); }
function taskRewardHTML(rw){ if(rw.key) return `<span class="craftlink" data-key="${rw.key}">${rw.text||itemName(rw.key)}</span>`; return `<span>${rw.simple||''}</span>`; }

/* ===== 羁绊等级效果（预设文本，测试期仍全解锁） ===== */
const BOND_TEXT = {
  xiayang:{
    0:'不可入队', 1:'可以加入编队，解锁技能【攻击·淬火】【辅助·鼓舞】【天赋·无所畏惧】',
    2:'解锁技能【天赋·活力满满】', 3:'解锁技能【攻击·燎原】', 4:'解锁技能【天赋·好奇心】',
    5:'解锁技能【攻击·众愿】', 6:'攻击力+25', 7:'解锁技能【天赋·心想事成】',
    8:'攻击力+25', 9:'攻击力+25', 10:'解锁技能【天赋·涅槃】',
  },
  luyouyou:{
    0:'不可入队', 1:'可以加入编队，解锁技能【攻击·精准射击】【辅助·屏息瞄准】【天赋·烹饪】',
    2:'解锁技能【天赋·巧手】', 3:'解锁技能【攻击·脱身矢】【攻击·弱点击破】', 4:'解锁技能【天赋·蹁跹】',
    5:'解锁技能【攻击·风止】', 6:'解锁技能【天赋·风息】', 7:'解锁技能【天赋·比翼】',
    8:'攻击力+25', 9:'攻击力+25', 10:'攻击力+25',
  },
};

/* ===== 物品喜好度（隐藏属性，玩家不可见） =====
   0级=大部分未说明物品(-1)；1级=one列表(+1)；2级=two映射(按物品描述增加值)；3级=three映射(按描述值再加+5)。 */
const ITEM_LOVE = {
  xiayang:{ one:['cookedMeat','roadmap'], two:{caiyunPendant:10}, three:{} },
  luyouyou:{ one:['cookedMeat','roadmap'], two:{}, three:{caiyunPendant:10} },
};
const GIFT_TALK = {
  xiayang:{ lv0:'夏阳：“啊哈哈……快点交代，这是啥新型冷笑话？”', lv1:'夏阳：“谢啦，这玩意有点意思。”', lv2:'夏阳：“哇，你怎么知道我想要这个？！”' },
  luyouyou:{ lv0:'陆悠悠：“我要把这个做到今天的晚饭里，你不会介意的吧～”', lv1:'陆悠悠：“不错不错，未来应该能派上用场。那我就不客气了。”', lv2:'陆悠悠：“啊……看着它，突然灵感涌现啊。得赶快记下来……”', lv3_caiyun:'陆悠悠：“据说远古的魔法师在万米高空之上的云雾中穿行，地上的人们见了，纷纷以为天上的飓刃裁断了云朵，还制作了饰品祈求云层不要砸下来。但云不会掉下来，这里面只是棉絮做成的云团——很失望？恰恰相反，我很喜欢。云无定踪风无定向，若是被捉进瓶子里反而无趣了。带上这个挂饰，坐在最高的悬崖边上，听风铃声声，看云卷云舒……现在就去如何？”' },
};
function itemLoveLevel(ck, itemKey){ const L=ITEM_LOVE[ck]||{}; if(L.three&&L.three[itemKey]!=null) return 3; if(L.two&&L.two[itemKey]!=null) return 2; if(L.one&&L.one.includes(itemKey)) return 1; return 0; }

const SLIME_TEMPLATE = { forwards12:{id:'newbie', name:'新手之友', desc:'前12天，最大生命值-60。'}, jp:{id:'slimejp', name:'蹦蹦跳跳', kind:'move', desc:'向着目标，移动1格。'}, bang:{id:'slimebang', name:'撞击', kind:'attack', type:'physical', target:'front', mult:1.0, formula:'攻击力×100%', desc:'对前方1格造成相当于100%攻击力的物理伤害。'} };
const ENEMIES = {
  slime:{ name:'草史莱姆', icon:'🟢', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}, bonus:'属性升级随机二选一'}, passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_grass', name:'草元素亲和', desc:'免疫草元素伤害。身上总是附着草元素（任意单位使用技能后重新附着）。'} ], skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang, {id:'slimeburst', name:'破土而出', kind:'attack', type:'grass', target:'self-area4', teleport:true, onlyTurn1:true, mult:1.0, desc:'只在战斗开始的第1回合使用：瞬移到目标周围4格随机1格，然后对周围4格造成相当于攻击力100%的草元素伤害。瞬移后本回合不再主动移动。'} ] },
  fireSlime:{ name:'火史莱姆', icon:'🔴', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}, bonus:'属性升级随机二选一'}, passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_fire', name:'火元素亲和', desc:'免疫火元素伤害。身上总是附着火元素。'} ], skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang, {id:'firespit', name:'吐火', kind:'attack', type:'fire', target:'line', shots:2, cd:4, mult:0.5, desc:'对前方3格喷出2颗火球。对遇到的第一个我方单位造成50%攻击力火伤后消失；遇到障碍或地图外消失。冷却：4回合。'} ] },
  waterSlime:{ name:'水史莱姆', icon:'🔵', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}, bonus:'属性升级随机二选一'}, passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_water', name:'水元素亲和', desc:'免疫水元素伤害。身上总是附着水元素。'} ], skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang, {id:'waterbubble', name:'水泡', kind:'support', target:'cell', cd:4, desc:'对目标当前位置投掷水泡。2回合后落下，【禁锢】该格单位2回合。冷却：4回合。'} ] },
  thunderSlime:{ name:'雷史莱姆', icon:'🟣', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}, bonus:'属性升级随机二选一'}, passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_thunder', name:'雷元素亲和', desc:'免疫雷元素伤害。身上总是附着雷元素。'}, {id:'conduct', name:'导电', desc:'每回合结束时，有10%概率对周围8格造成不分敌我的40%攻击力雷伤。'} ], skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang ] },
  iceSlime:{ name:'冰史莱姆', icon:'🩵', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}, bonus:'属性升级随机二选一'}, passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_ice', name:'冰元素亲和', desc:'免疫冰元素伤害。身上总是附着冰元素。'} ], skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang, {id:'icemist', name:'冰雾', kind:'attack', type:'ice', target:'line-multi', sustain:2, cd:5, mult:0.8, desc:'向前方3格所有我方单位喷射冰雾，造成80%攻击力冰伤。持续2回合。冷却：5回合。'} ] },
  windSlime:{ name:'风史莱姆', icon:'💨', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}, bonus:'属性升级随机二选一'}, passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_wind', name:'风元素亲和', desc:'免疫风元素伤害。'}, {id:'windswirl', name:'风旋', desc:'被击败时，若战斗未结束，将2格内随机1单位传送至自身格；若是我方则造成40%攻击力风伤。'} ], skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang ] },
  rockSlime:{ name:'岩史莱姆', icon:'🪨', tier:'ordinary', atk:10, def:0, maxHp:100, speed:4, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2}, bonus:'属性升级随机二选一'}, passives:[ SLIME_TEMPLATE.forwards12, {id:'affin_rock', name:'岩元素亲和', desc:'免疫岩元素伤害。'}, {id:'rockshield', name:'岩盾', desc:'最大生值-10%，防御力+10。每次被攻击防御力-1。'} ], skills:[ SLIME_TEMPLATE.jp, SLIME_TEMPLATE.bang ] },
  slimeSwarm:{ name:'史莱姆集群', icon:'🟩', tier:'elite', atk:0, def:0, maxHp:0, speed:12, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:3, wood:1, flax:1}, bonus:'属性升级随机二选一', attrChoices:2}, passives:[ {id:'swarm', name:'集群行动', desc:'战斗开始时直接退场，在随机位置生成3个级别的普通随机史莱姆。'} ], skills:[] },
  chunibyo:{ name:'中二病男孩', icon:'🧒', tier:'ordinary', atk:15, def:0, maxHp:20, speed:10, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:0, reward:{items:{fruit:2, coin:1}, attrUp:2}, passives:[ {id:'comeback', name:'我一定会回来的', desc:'每次被击败后，攻击力永久+15、最大生命永久+40、速度永久+5，至多叠加5次。'}, {id:'dodge', name:'帅气闪避', desc:'受到攻击时，有20%概率使本次伤害降为0。'}, {id:'amaterasu', name:'阿玛特拉斯', desc:'攻击命中时，40%概率减少目标15防御、20%概率整场燃烧。'} ], skills:[ {id:'cbyjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'cbyatk', name:'稻草剑法', kind:'attack', type:'physical', target:'adj-rand', mult:1.0, desc:'对周围8格的1名我方单位造成100%攻击力物理伤害。'} ] },
  weirdSlime:{ name:'奇怪史莱姆', icon:'🟩', tier:'ordinary', atk:0, def:0, maxHp:599, speed:0, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:0, reward:{items:{}}, passives:[], skills:[ {id:'wjp', name:'蹦蹦跳跳', kind:'move', desc:'向着目标，移动1格。'}, {id:'woju', name:'吐果子', kind:'attack', type:'real', target:'front', healTarget:200, selfDrainAbs:200, desc:'使前方1格的我方单位回复200点生命。自身流失200点生命（可致死）。'} ] },
  littleSnake:{ name:'小小蛇', icon:'🐍', tier:'ordinary', atk:15, def:0, maxHp:150, speed:4, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{rawMeat:1}, rate:{rawMeat:0.3}, attrUp:2}, passives:[ {id:'scare', name:'恐吓', desc:'战斗第一回合开始时【束缚】主角并瞬移至主角周围4格随机1格。'} ], skills:[ {id:'lsjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'snakebite', name:'蛇咬', kind:'attack', type:'physical', target:'front', mult:1.0, poison:14, desc:'对前方1格造成100%攻击力物理伤害，50%概率施加14层【中毒】。'} ] },
  bambooSnake:{ name:'竹叶青', icon:'🐍', tier:'elite', atk:20, def:0, maxHp:300, speed:13, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{rawMeat:2, flax:2}, rate:{fruit:2, prob:0.5}, attrUp:3}, passives:[ {id:'scare2', name:'恐吓+', desc:'每2个回合（战斗开始为第1回合），在对应回合开始时【束缚】主角1回合。'} ], skills:[ {id:'bsjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'snakebite2', name:'蛇咬+', kind:'attack', type:'physical', target:'front', mult:1.2, poison:19, desc:'对前方1格造成120%攻击力物理伤害且施加19层【中毒】。'} ] },
  oldTree:{ name:'古树', icon:'🌳', tier:'ordinary', atk:20, def:0, maxHp:799, speed:0, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{fruitByHp:[800,600,400,200], bonusItems:{wood:4}, attrUp:3}, passives:[ {id:'counter', name:'反击', desc:'受到主角攻击的伤害时，对主角造成40%攻击力真实伤害，并使自身攻击力+15%（至多+150%）。'}, {id:'runaway', name:'长脚就跑！', desc:'第8个回合结束时，自身逃跑（视为战斗胜利）。'} ], skills:[] },
  hound:{ name:'猎犬', icon:'🐕', tier:'ordinary', atk:10, def:0, maxHp:60, speed:15, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{rawMeat:1}, attrUp:2}, passives:[ {id:'growth', name:'成长', desc:'每进入新的一天，该种敌人攻击力永久+5%、最大生命永久+5%、速度永久+1。'}, {id:'dogpal', name:'狗友', desc:'战斗开始时，80%/15%/5%概率在随机1/2/3格生成新猎犬。'} ], skills:[ {id:'hchase', name:'追逐', kind:'move', range2:true, desc:'向着目标，移动到2格距离内的一个格子。每次移动后速度+5。'}, {id:'hbite', name:'撕咬', kind:'attack', type:'physical', target:'front', mult:1.0, desc:'对前方1格造成100%攻击力物理伤害。'} ] },
  houndPro:{ name:'猎犬Pro', icon:'🐕‍🦺', tier:'elite', atk:35, def:0, maxHp:150, speed:25, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{rawMeat:2}, coin5:true, attrUp:3}, passives:[ {id:'growth2', name:'成长+', desc:'每进入新的一天，该种敌人攻击力永久+8%、最大生命永久+10%、速度永久+1，至多20次。'}, {id:'dogpal2', name:'狗友+', desc:'战斗开始时，80%/20%概率在随机1格生成猎犬/猎犬Pro。'} ], skills:[ {id:'hpchase', name:'追逐', kind:'move', range2:true, desc:'向着目标，移动到2格距离内的一个格子。每次移动后速度+5。'}, {id:'hpbite', name:'撕咬', kind:'attack', type:'physical', target:'front', mult:1.0, desc:'对前方1格造成100%攻击力物理伤害。'} ] },
  blueRacer:{ name:'蓝羽镖客', icon:'🦤', tier:'ordinary', atk:12, def:0, maxHp:100, speed:4, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:1, rawMeat:1}, attrUp:2}, passives:[ {id:'drift', name:'飘忽不定', desc:'每3次攻击后，瞬移至周围3格随机空格。'}, {id:'lethal', name:'致命节奏', desc:'每攻击1次，攻击力+8。'} ], skills:[ {id:'brujp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'feather', name:'飞羽', kind:'attack', type:'physical', target:'amid-2', mult:1.0, desc:'对2格距离内随机1名我方单位造成100%攻击力物理伤害。'} ] },
  redRacer:{ name:'红羽镖客', icon:'🦃', tier:'elite', atk:16, def:0, maxHp:200, speed:12, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{fruit:2, rawMeat:1}, attrUp:3, doubleUp:true}, passives:[ {id:'drift2', name:'飘忽不定', desc:'每3次攻击后，瞬移至周围5格随机空格。'}, {id:'lethal', name:'致命节奏', desc:'每攻击1次，攻击力+8。'} ], skills:[ {id:'rrjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'feather', name:'飞羽', kind:'attack', type:'physical', target:'amid-2', mult:1.0, desc:'对2格距离内随机1名我方单位造成100%攻击力物理伤害。'} ] },
  bear:{ name:'暴躁的熊', icon:'🐻', tier:'elite', atk:40, def:0, maxHp:800, speed:0, res:{physical:20,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{rawMeat:10}, attrUp:3}, passives:[ {id:'hiber', name:'冬眠', desc:'战斗开始时进入持续3回合的【睡眠】。若被攻击导致生命降低则立即醒来，但本回合无法行动（打哈欠）；未被攻击则睡眠3回合后醒来，下一回合直接行动。'}, {id:'rage', name:'狂躁', desc:'在【睡眠】首次结束后的下一回合开始时，攻击力+80%、每回合额外攻击1次、速度+60，持续5回合。攻击力与状态栏同步显示。'}, {id:'rare', name:'稀有生物', desc:'本次战斗如未被击败，不回复生命，可多次战斗击败。'} ], skills:[ {id:'bearjp', name:'逼近', kind:'move', desc:'向着目标，移动1格。'}, {id:'slap', name:'掌掴', kind:'attack', type:'physical', target:'front', mult:1.0, rageAoe:true, desc:'对前方1格造成100%攻击力物理伤害。狂躁期间改为周围8格随机1名。'} ] },
  mechanism:{ name:'遗弃机关', icon:'🤖', tier:'elite', atk:40, def:10, maxHp:260, speed:4, res:{physical:0,fire:0,water:0,grass:0,thunder:0,ice:0,wind:0,rock:0}, healthPenalty:1, reward:{items:{coin:3}, rate:{iron:1, prob:0.25}, attrUp:3}, passives:[ {id:'patrol', name:'巡逻', desc:'生命值为满时，不主动攻击，每回合向随机方向移动1格。'} ], skills:[ {id:'mcjp', name:'逼近', kind:'move', desc:'生命值不为满时，向着主角移动1格。'}, {id:'trample', name:'践踏', kind:'attack', type:'physical', target:'front6', mult:1.0, desc:'对前方6格造成100%攻击力物理伤害。'}, {id:'missile', name:'飞弹', kind:'attack', type:'physical', target:'missile', shots:3, mult:0.4, desc:'朝前方发射3枚飞弹，飞行无限远，碰到我方造成40%攻击力物理伤害并消失。'}, {id:'cleanse', name:'大清扫', kind:'attack', type:'physical', target:'adj8', mult:1.4, sustain:3, cd:6, desc:'对周围8格造成140%攻击力物理伤害。连续使用3回合。冷却：6回合。'} ] },
};
function statusMeta(id){ return ST[id]||{id, name:id, kind:'neutral', desc:''}; }
function randEnemyKey(){ const pool=Object.keys(ENEMIES); return pool[Math.floor(Math.random()*pool.length)]; }
function rollCombatEvent(day){ const hard=Math.random()<0.30; const tier=hard?'elite':'ordinary'; const pool=Object.keys(ENEMIES).filter(k=>ENEMIES[k].tier===tier); const key=pool.length? pool[Math.floor(Math.random()*pool.length)] : Object.keys(ENEMIES)[0]; return {type:'battle', sub:hard?'hard':'normal', key}; }
function isRareEnemy(key){ const e=ENEMIES[key]; return !!(e&&e.passives&&e.passives.some(p=>p.id==='rare')); }
function isSlimeKey(k){ return ['slime','fireSlime','waterSlime','thunderSlime','iceSlime','windSlime','rockSlime'].includes(k); }