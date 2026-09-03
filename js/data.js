/* ============================================================
   js/data.js —— 模块：数据与常量
   角色 / 敌人 / 技能 / 天赋 / 状态 / 词条 / 元素 / 资源 定义。
   本文件只做定义，被其它模块在运行时读取。
   ============================================================ */
"use strict";

/* 存档位上限 */
const MAX_SAVES = 8;

/* 元素枚举（着色 class 与中文名） */
const ELEM = {fire:{c:'e-fire',zh:'火'},water:{c:'e-water',zh:'水'},grass:{c:'e-grass',zh:'草'},
  thunder:{c:'e-thunder',zh:'雷'},ice:{c:'e-ice',zh:'冰'},wind:{c:'e-wind',zh:'风'},rock:{c:'e-rock',zh:'岩'}};
const AURA_ELEMS = ['fire','water','grass','thunder','ice'];

/* 资源中文名（展示用） */
const RES_ZH = {wood:'木材', fruit:'果子', flax:'亚麻', rawMeat:'生肉', coin:'金币', emptyBottle:'空瓶子'};

/* 状态（buff/debuff）定义：kind: buff=正面(黄) debuff=负面(红) neutral=中性(灰) */
const ST = {
  burn:{id:'burn', name:'燃烧', kind:'debuff', desc:'每回合开始时流失2%生命值（可致死，无伤害来源）。持续3回合。'},
  bind:{id:'bind', name:'束缚', kind:'debuff', desc:'无法移动，但可以攻击。'},
  atkUp:{id:'atkUp', name:'攻击提升', kind:'buff', desc:'攻击力提升25%。'},
  shield:{id:'shield', name:'护盾', kind:'buff', desc:'抵消等量伤害（不抵流失类效果），每回合刷新。'},
  alert:{id:'alert', name:'重点目标', kind:'debuff', desc:'我方单位攻击时优先攻击该目标；场上至多存在1个。'},
  dr:{id:'dr', name:'伤害减免', kind:'buff', desc:'本回合受到的伤害减少40%。'},
  crit:{id:'crit', name:'屏息', kind:'buff', desc:'下一次攻击的暴击率提升100%。'},
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
  return `<span class="term" data-term="${key}" title="${TERMS[key]||zh}">【${zh}】</span>`;
}

/* 主角（当前唯一可控制单位） */
const PROTAGONIST = {
  key:'pro', name:'主角', element:null, color:null,
  base:{atk:10, maxHp:100, def:0, escapeSpeed:100, hp:100},
  passives:[
    {name:'战术布置', desc:'攻击时设置【重点目标】，我方优先攻击该目标（持续至该敌人被击败）。'},
    {name:'暴击', desc:'攻击力+10，暴击率+3%。'},
    {name:'嗜血', desc:'攻击力+20，攻击型技能3%概率回复自身=本次伤害的50%。'},
    {name:'起势', desc:'攻击力+30，使用攻击型技能后获得4%伤害加成。'},
    {name:'格挡', desc:'最大生命+50，受攻击3%概率使本次伤害归零。'},
    {name:'坚守', desc:'回合开始获得30护盾，受攻击6%概率回复12%生命。'},
  ],
  skills:[
    {id:'slash', name:'斩击', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*1.00, target:'front', alert:true,
     desc:'对前方一格的敌人造成物理伤害（当前约{X}点）。'},
    {id:'blade', name:'万刃斩', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*0.85, target:'adj',
     desc:'对周围四格的所有敌人造成物理伤害（当前约{X}点）。'},
    {id:'despair', name:'拼命', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*1.40, target:'front', selfDrain:0.20,
     desc:'对前方一格的敌人造成物理伤害（当前约{X}点），自身流失20%最大生命（可致死）。'},
    {id:'balance', name:'均衡', kind:'attack', type:'physical', range:1,
     effect:atk=>atk*0.70, target:'front', selfHeal:0.08, dr:1,
     desc:'对前方一格造成物理伤害（当前约{X}点），回复自身8%最大生命，本回合受伤害-40%。'},
    {id:'guerrilla', name:'游击', kind:'attack', type:'physical', range:2,
     effect:atk=>atk*0.70, target:'nearest', alert:true,
     desc:'对两格距离内最近的一名敌人造成物理伤害（当前约{X}点）。'},
  ],
  selectedSkillIds:['slash','blade','guerrilla']
};

/* 队友（占位，用于测试3槽角色技能区；后续按规格书补齐） */
const ALLIES = {
  xiayang:{ key:'xiayang', name:'夏阳', element:'fire', atk:70,
    passives:[
      {name:'无所畏惧', desc:'主角攻击力+30，自身攻击力+45。'},
      {name:'活力满满', desc:'睡觉时回复的生命值和健康值翻倍。'},
      {name:'好奇心', desc:'战斗胜利30%概率额外获一次奖励，50%概率额外获1金币。'},
      {name:'心想事成', desc:'可切换行动方式为【巧遇】，移动至场上任意一格，每天限1次。'},
      {name:'涅槃', desc:'战斗中主角受致命伤时不倒下，回复50%生命并使全体我方攻击+25%（每天限1次）。'},
    ],
    skills:[
      {id:'quhuo', name:'淬火', kind:'attack', type:'fire', range:1, target:'adj',
       effect:atk=>atk*1.20,
       desc:'对周围四格随机一名敌人造成火元素伤害（当前约{X}点）。'},
      {id:'liaoyuan', name:'燎原', kind:'attack', type:'fire', range:4, target:'frontline',
       effect:atk=>atk*1.50, burn:3,
       desc:'对前方一线四格内的所有敌人造成火元素伤害（当前约{X}点），并施加【燃烧】3回合。'},
      {id:'guwu', name:'鼓舞', kind:'support', type:'buff', range:0, target:'self',
       effect:null, atkBuffPct:0.25, healPct:0.15,
       desc:'主角回复夏阳攻击力15%的生命（约{Y}点），并使攻击力最高的我方角色攻击力+25%（持续2回合）。'},
    ],
    selectedSkillIds:['quhuo','liaoyuan','guwu']
  },
  luyouyou:{ key:'luyouyou', name:'陆悠悠', element:'wind', atk:75,
    passives:[
      {name:'巧手', desc:'睡觉40%概率获1随机资源；合成25%概率获1随机资源。'},
      {name:'烹饪', desc:'食物效果更好；主角最大生命+100。'},
      {name:'蹁跹', desc:'探索每移动后主角回复30生命；战斗闪避时主角回复30生命。'},
      {name:'风息', desc:'自身攻击力+60，暴击率+30%；暴击时本次技能伤害由物理转为风元素。'},
      {name:'比翼', desc:'自身暴击后，其余我方角色下一次攻击暴击率+100%。'},
    ],
    skills:[
      {id:'jingqiao', name:'精巧射击', kind:'attack', type:'physical', range:3, target:'nearest',
       effect:atk=>atk*1.00,
       desc:'对三格距离内最近的一名敌人造成物理伤害（当前约{X}点）。'},
      {id:'qiangli', name:'强力射击', kind:'attack', type:'physical', range:2, target:'frontline',
       effect:atk=>atk*0.90,
       desc:'对前方一线两格内的所有敌人造成物理伤害（当前约{X}点）。'},
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

/* 敌人库（含技能/行为说明；普通攻击也算一种技能）。数值按3人队伍多回合调整。 */
const ENEMIES = {
  slime:{name:'哥布林', icon:'👺', hp:420, atk:8, dmgReduc:0, speed:20,
    skillMult:1.2, failureHealthPenalty:5, color:'#c05bff',
    skills:[
      {name:'挥击', kind:'attack', desc:'对面前一格的敌人造成物理伤害（攻击力×1.2）。'},
      {name:'怒吼', kind:'special', desc:'发出怒吼震慑对手，使自身攻击力小幅提升。'},
    ]},
  bat:{name:'毒蛾', icon:'🦋', hp:330, atk:6, dmgReduc:0, speed:30,
    skillMult:1.1, failureHealthPenalty:4, color:'#5fd96b', aura:'grass',
    skills:[
      {name:'毒咬', kind:'attack', desc:'对面前一格的敌人造成物理伤害（攻击力×1.1），并施加草元素附着。'},
      {name:'磷粉', kind:'special', desc:'洒出磷粉，使周围敌人附着草元素。'},
    ]},
  wolf:{name:'岩狼', icon:'🐺', hp:520, atk:10, dmgReduc:0.1, speed:25,
    skillMult:1.3, failureHealthPenalty:6, color:'#b09a73',
    skills:[
      {name:'撕咬', kind:'attack', desc:'对面前一格的敌人造成物理伤害（攻击力×1.3）。'},
      {name:'岩突', kind:'special', desc:'掀起岩块攻击，造成岩元素伤害并略微降低目标防御。'},
    ]},
};

/* 战斗状态栏按 key 查定义（词条/状态） */
function statusMeta(id){ return ST[id]||{id, name:id, kind:'neutral', desc:''}; }
