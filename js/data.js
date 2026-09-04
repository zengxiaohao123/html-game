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

/* 资源中文名（展示用） */
const RES_ZH = {wood:'木材', fruit:'果子', flax:'亚麻', rawMeat:'生肉', coin:'金币', emptyBottle:'空瓶子', iron:'铁块'};

/* 资源的效果描述（供配方点击预览）：描述为用户原稿，禁止改动。
   铁块不属于自然资源/城市资源，无法常规探索获得；仅特殊事件/特殊敌人/商店购买获得。 */
const RES_DESC = {wood:'基础材料。可用于合成、交易',
  fruit:'可食用的野果。可用于合成、交易，可直接使用回复20生命值且有20%概率增加1点健康',
  flax:'基础材料。可用于合成、交易',
  rawMeat:'未处理的肉块。可用于合成、交易，可直接使用回复20生命值',
  coin:'通行的钱币，可在商店使用。',
  emptyBottle:'随处可见的空瓶子，可用于交易',
  iron:'相对罕见的基础材料。可用于合成、交易'};

/* 自然资源集（陷阱随机池用；铁块非自然资源、不入池，空瓶子属城市资源也不入池） */
const NATURAL_RESOURCES = ['wood','flax','fruit','rawMeat'];

/* 制作产物 / 永久物品（desc 为用户原稿，禁止改动；【天赋·xx】为词条式写法，
   未入词条库时按粗体展示）。permanent=true 表示永久物品：效果持久、不可手动使用、不可消耗、不可出售。 */
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
};
function itemName(k){ return RES_ZH[k] || (ITEMS[k]&&ITEMS[k].name) || k; }
function itemDesc(k){ return ITEMS[k]? ITEMS[k].desc : (RES_DESC[k]||''); }

/* 商店物品：buy=基础购买价（金币/单位）；sellable=false=仅可购买不可出售。
   出售价 = 购买价 × 50%（向下取整）。名称/描述复用 itemName/itemDesc。
   匕首/皮衣为永久物品，仅购不可售；每获得1个，该物品售价+priceGrow（无上限）。 */
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

/* 该物品当前实际购买价：priceGrow 物品 = 基础价 + 递增价 × 已拥有数量 */
function itemBuyPrice(key){
  const it=SHOP_ITEMS.find(x=>x.key===key); if(!it) return 0;
  const owned=(G&&G.inventory&&G.inventory[key])||0;
  return it.buy + (it.priceGrow? it.priceGrow*owned : 0);
}

/* 可直接「使用」的食物：heal=基础回血；healthChance=果子 20% 概率 +1 健康。
   不在此表的（含永久物品）在背包无「使用」按钮。 */
const FOOD = { fruit:{heal:20, healthChance:0.2}, rawMeat:{heal:20}, cookedMeat:{heal:70} };
function itemUsable(k){ return !!FOOD[k]; }
/* 篝火（永久物品，至多1个）：食用食物后，对应食物回血永久提升（果子+1/生肉+2/熟肉+4） */
function foodHeal(k){
  const camp=G && G.inventory && G.inventory.campfire>0;
  const base=FOOD[k]? FOOD[k].heal : 0;
  const add = camp ? (k==='fruit'?1 : k==='rawMeat'?2 : k==='cookedMeat'?4 : 0) : 0;
  return base+add;
}

/* —— 永久物品：获得即生效，不可消耗/不可出售，效果随获得数量永久叠加 —— */
function grantPermanentItem(key){
  G.inventory[key]=(G.inventory[key]||0)+1;
  switch(key){
    case 'club':      bumpPro('crit'); break;      // 天赋·暴击 +1
    case 'cloth':     bumpPro('block'); break;     // 天赋·格挡 +1
    case 'dagger':    bumpPro('blood'); break;     // 天赋·嗜血 +1
    case 'leather':   bumpPro('hold'); break;      // 天赋·坚守 +1
    case 'ironSword': bumpPro('momentum'); break;  // 天赋·起势 +1
    case 'armor':     bumpPro('block'); bumpPro('hold'); break; // 格挡+1 且 坚守+1
    case 'tent':      // 探索时行动力上限+1，并补1点当前行动力
      G.hero.apCap=(G.hero.apCap||5)+1;
      G.hero.actionPoint=(G.hero.actionPoint||0)+1;
      break;
    // 篝火 / 陷阱 / 被子：无即时数值，效果分别在 食物回血(食) / 睡觉(陷阱·被子) 时结算
  }
}
/* 主角某天赋等级+1（默认1级，随永久物品叠加） */
function bumpPro(talent){
  G.proLevels=G.proLevels||{};
  G.proLevels[talent]=(G.proLevels[talent]||1)+1;
}

/* 地形中文名：空地=可通行；山脉/地图外=不可通行 */
const TERRAIN_ZH = {ground:'空地', obstacle:'山脉', void:'不可通行'};

/* 状态（buff/debuff）定义：kind: buff=正面(黄) debuff=负面(红) neutral=中性(灰)。
   未注明 turns（null）= 持续整场战斗，无需标时长。 */
const ST = {
  burn:{id:'burn', name:'燃烧', kind:'debuff', turns:3, desc:'每回合开始时流失2%生命值（可致死，无伤害来源）。持续3回合。'},
  bind:{id:'bind', name:'束缚', kind:'debuff', desc:'无法移动，但可以攻击。'},
  atkUp:{id:'atkUp', name:'攻击提升', kind:'buff', turns:2, desc:'攻击力提升25%。'},
  shield:{id:'shield', name:'护盾', kind:'buff', desc:'抵消等量伤害（不抵流失类效果），每回合刷新。'},
  alert:{id:'alert', name:'重点目标', kind:'debuff', desc:'我方单位攻击时优先攻击该目标；场上至多存在1个。持续整场战斗。'},
  dr:{id:'dr', name:'伤害减免', kind:'buff', turns:1, desc:'本回合受到的伤害减少40%。'},
  crit:{id:'crit', name:'屏息', kind:'buff', turns:2, desc:'下一次攻击的暴击率提升100%。'},
};

/* 词条库（悬浮弹窗文案） */
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
  dodge:'【闪避】在敌人即将攻击前从攻击范围内撤出。',
};
function termHTML(key, zh){
  return `<span class="term" data-term="${key}">【${zh}】</span>`; // 词条：悬浮查看（data-term 供悬浮弹窗）
}
/* 词条中文名 → 键 的反查（供 terms() 把【词条】转成悬浮） */
const TERM_KEYS = {重点目标:'alert', 蓄力:'charge', 束缚:'bind', 燃烧:'burn', 激化:'aggro',
  超导:'superconduct', 冰冻:'frozen', 禁锢:'cage', 结界:'zone', 额外回合:'extraTurn', 偷取:'steal', 闪避:'dodge'};

/* 主角（当前唯一可控制单位） */
const PROTAGONIST = {
  key:'pro', name:'主角', element:null, color:null,
  base:{atk:10, maxHp:100, def:0, escapeSpeed:100, hp:100},
  passives:[
    {id:'tactic', name:'战术布置', desc:'攻击时设置【重点目标】，我方优先攻击该目标（持续至该敌人被击败）。'},
    {id:'crit', name:'暴击', level:1, scal:{atk:{base:10,grow:5}, crit:{base:3,grow:1,pct:true}},
     desc:'攻击力+{atk}，暴击率+{crit}。'},
    {id:'blood', name:'嗜血', level:1, scal:{atk:{base:20,grow:4}},
     desc:'攻击力+{atk}，攻击型技能3%概率回复自身=本次伤害的50%。'},
    {id:'momentum', name:'起势', level:1, scal:{atk:{base:30,grow:5}},
     desc:'攻击力+{atk}，使用攻击型技能后获得4%伤害加成。'},
    {id:'block', name:'格挡', level:1, scal:{hp:{base:50,grow:20}},
     desc:'最大生命+{hp}，受攻击3%概率使本次伤害归零。'},
    {id:'hold', name:'坚守', level:1, scal:{shield:{base:30,grow:8}},
     desc:'回合开始获得{shield}护盾，受攻击6%概率回复12%生命。'},
  ],
  skills:[
    {id:'slash', name:'斩击', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*1.00, target:'front', alert:true, formula:'攻击力×100%',
     desc:'对前方一格的敌人造成{DMG}的物理伤害。'},
    {id:'blade', name:'万刃斩', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*0.85, target:'adj', formula:'攻击力×85%',
     desc:'对周围四格的所有敌人造成{DMG}的物理伤害。'},
    {id:'despair', name:'拼命', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*1.40, target:'front', selfDrain:0.20, formula:'攻击力×140%',
     desc:'对前方一格的敌人造成{DMG}的物理伤害，自身流失20%最大生命（可致死）。'},
    {id:'balance', name:'均衡', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*0.70, target:'front', selfHeal:0.08, dr:1, formula:'攻击力×70%',
     desc:'对前方一格造成{DMG}的物理伤害，回复自身8%最大生命，本回合受伤害-40%。'},
    {id:'guerrilla', name:'游击', kind:'attack', type:'physical', range:2,
     effect:atk=>atk*0.70, target:'nearest', alert:true, formula:'攻击力×70%',
     desc:'对两格距离内最近的一名敌人造成{DMG}的物理伤害。'},
  ],
  selectedSkillIds:['slash','blade','guerrilla']
};

/* 队友（占位，用于测试3槽角色技能区；后续按规格书补齐） */
const ALLIES = {
  xiayang:{ key:'xiayang', name:'夏阳', element:'fire', atk:70,
    passives:[
      {id:'fearless', name:'无所畏惧', level:1, scal:{pro:{base:30,grow:5}, self:{base:45,grow:5}},
       desc:'主角攻击力+{pro}，自身攻击力+{self}。'},
      {id:'vigor', name:'活力满满', desc:'睡觉时回复的生命值和健康值翻倍。'},
      {id:'curious', name:'好奇心', desc:'战斗胜利30%概率额外获一次奖励，50%概率额外获1金币。'},
      {id:'lucky', name:'心想事成', desc:'可切换行动方式为【巧遇】，移动至场上任意一格，每天限1次。'},
      {id:'rebirth', name:'涅槃', desc:'战斗中主角受致命伤时不倒下，回复50%生命并使全体我方攻击+25%（每天限1次）。'},
    ],
    skills:[
      {id:'quhuo', name:'淬火', kind:'attack', type:'fire', range:1, target:'adj',
       effect:atk=>atk*1.20, formula:'攻击力×120%',
       desc:'对周围四格随机一名敌人造成{DMG}的火元素伤害。'},
      {id:'liaoyuan', name:'燎原', kind:'attack', type:'fire', range:4, target:'frontline',
       effect:atk=>atk*1.50, burn:3, formula:'攻击力×150%',
       desc:'对前方一线四格内的所有敌人造成{DMG}的火元素伤害，并施加【燃烧】3回合。'},
      {id:'guwu', name:'鼓舞', kind:'support', type:'buff', range:0, target:'self',
       effect:null, atkBuffPct:0.25, healPct:0.15, level:1,
       scal:{buff:{base:25,grow:2,pct:true}, heal:{base:15,grow:1,pct:true}},
       desc:'主角回复夏阳攻击力{heal}的生命（约{Y}点），并使攻击力最高的我方角色攻击力+{buff}（持续2回合）。'},
    ],
    selectedSkillIds:['quhuo','liaoyuan','guwu']
  },
  luyouyou:{ key:'luyouyou', name:'陆悠悠', element:'wind', atk:75,
    passives:[
      {id:'skillful', name:'巧手', level:1, scal:{wood:{base:1,grow:1}},
       desc:'睡觉40%概率获{wood}随机资源；合成25%概率获{wood}随机资源。'},
      {id:'cook', name:'烹饪', desc:'食物效果更好；主角最大生命+100。'},
      {id:'flutter', name:'蹁跹', level:1, scal:{hp:{base:30,grow:6}},
       desc:'探索每移动后主角回复{hp}生命；战斗闪避时主角回复{hp}生命。'},
      {id:'wind', name:'风息', level:1, scal:{atk:{base:60,grow:6}, crit:{base:30,grow:2,pct:true}},
       desc:'自身攻击力+{atk}，暴击率+{crit}；暴击时本次技能伤害由物理转为风元素。'},
      {id:'duo', name:'比翼', desc:'自身暴击后，其余我方角色下一次攻击暴击率+100%。'},
    ],
    skills:[
      {id:'jingqiao', name:'精巧射击', kind:'attack', type:'physical', range:3, target:'nearest',
       effect:atk=>atk*1.00, formula:'攻击力×100%',
       desc:'对三格距离内最近的一名敌人造成{DMG}的物理伤害。'},
      {id:'qiangli', name:'强力射击', kind:'attack', type:'physical', range:2, target:'frontline',
       effect:atk=>atk*0.90, formula:'攻击力×90%',
       desc:'对前方一线两格内的所有敌人造成{DMG}的物理伤害。'},
      {id:'bixi', name:'屏息瞄准', kind:'support', type:'buff', range:0, target:'self',
       effect:null, critBuff:1,
       desc:'陆悠悠下一次攻击的暴击率+100%（不可叠加）。'},
    ],
    selectedSkillIds:['jingqiao','qiangli','bixi']
  }
};

/* 统一角色表：'pro'=主角，其余=队友 */
const CHARACTERS = Object.assign({ pro:PROTAGONIST }, ALLIES);
/* 取角色定义 */
function getChar(key){ return CHARACTERS[key] || PROTAGONIST; }
/* 当前队伍的角色定义列表（按 G.team 顺序） */
function getTeamChars(){ return (G&&G.team||['pro']).map(k=>getChar(k)).filter(Boolean); }

/* —— 等级 / 羁绊：技能等级计算 —— */
/* 返回某条目的当前等级：主角走自身技能等级（G.proLevels），队友走羁绊等级（G.bonds）。
   无 scal（固定效果）的条目无等级，此函数不被调用。 */
function entryLevel(ownerKey, entry){
  if(!entry || !entry.scal) return 1;
  if(ownerKey==='pro'){ const m=(G&&G.proLevels); return (m && m[entry.id])? m[entry.id] : 1; }
  const b=(G&&G.bonds&&G.bonds[ownerKey]); return b ? (b.level||1) : 1;
}
/* 计算某等级条目的一个可升级数值 */
function tierValue(entry, level, key){
  const s=entry.scal[key]; if(!s) return 0;
  return s.base + (s.grow||0) * Math.max(0, (level||1)-1);
}
/* 渲染带等级的描述：{key} 占位符替换为黄色高亮数值（可升级数值一律黄字）。
   pct=true 的数值会在末尾补「%」。ext 可补充额外占位符（如 {Y} 治疗量）。 */
function lvDescText(entry, level, ext){
  let d=entry.desc||'';
  if(entry.scal){
    for(const key in entry.scal){
      const s=entry.scal[key];
      const v=tierValue(entry, level, key);
      d=d.split('{'+key+'}').join(`<span class="lvlup">${v}${s.pct?'%':''}</span>`);
    }
  }
  if(ext){ for(const key in ext){ d=d.split('{'+key+'}').join(`<span class="lvlup">${ext[key]}</span>`); } }
  return terms(d);
}

/* 敌人库（含技能/行为说明；普通攻击也算一种技能；含移动方式）。数值按3人队伍多回合调整。 */
const ENEMIES = {
  slime:{name:'哥布林', icon:'👺', hp:420, atk:8, dmgReduc:0, speed:20,
    skillMult:1.2, failureHealthPenalty:5, color:'#c05bff',
    move:'移动：缓步向主角逼近，每次移动一格，贴身后再攻击。',
    skills:[
      {name:'挥击', kind:'attack', desc:'对面前一格的敌人造成物理伤害（攻击力×1.2）。'},
      {name:'怒吼', kind:'special', desc:'发出怒吼震慑对手，使自身攻击力小幅提升。'},
    ]},
  bat:{name:'毒蛾', icon:'🦋', hp:330, atk:6, dmgReduc:0, speed:30,
    skillMult:1.1, failureHealthPenalty:4, color:'#5fd96b', aura:'grass',
    move:'移动：扑扇翅膀向主角靠近，每次移动一格。',
    skills:[
      {name:'毒咬', kind:'attack', desc:'对面前一格的敌人造成物理伤害（攻击力×1.1），并施加草元素附着。'},
      {name:'磷粉', kind:'special', desc:'洒出磷粉，使周围敌人附着草元素。'},
    ]},
  wolf:{name:'岩狼', icon:'🐺', hp:520, atk:10, dmgReduc:0.1, speed:25,
    skillMult:1.3, failureHealthPenalty:6, color:'#b09a73',
    move:'移动：压低身形向主角奔袭，每次移动一格。',
    skills:[
      {name:'撕咬', kind:'attack', desc:'对面前一格的敌人造成物理伤害（攻击力×1.3）。'},
      {name:'岩突', kind:'special', desc:'掀起岩块攻击，造成岩元素伤害并略微降低目标防御。'},
    ]},
};

/* 战斗状态栏按 key 查定义（词条/状态） */
function statusMeta(id){ return ST[id]||{id, name:id, kind:'neutral', desc:''}; }
