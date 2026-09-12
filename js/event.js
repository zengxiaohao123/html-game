/* ============================================================
   js/event.js —— 模块：随机事件系统
   真正可选择的选项交互（选中→确认→2s淡出→结果）。
   事件标题/正文按自然段打字机逐段显示，段间点击剧情区推进；
   打完最后一段才显示选项。结果同样打字机显示。
   事件激活时：地图可缩放平移但不可移动；编队/商店/睡觉/合成禁用。
   随机值在事件生成时（进入事件格）决定并存于格子，读档不变。
   ============================================================ */
"use strict";

let eventState = null;

/* 基准售价（非商店品的参考价，用于流浪商人）。商店品直接用 SHOP_ITEMS 的买入价。 */
const TRADER_REF_PRICE = { club:12, cloth:14, wood:2, flax:3, dagger:32, leather:20,
  luckyCoin:40, deadwoodSprout:30, kuiZuo:35, windChime:25, broom:60, clearMind:15, amethyst:20 };
const TRADER_GOODS = [
  { key:'wood',   n:4, label:'木材×4' },
  { key:'flax',   n:4, label:'麻布×4' },
  { key:'club',   n:1, label:'木棒'    },
  { key:'cloth',  n:1, label:'布衣'    },
  { key:'dagger', n:1, label:'匕首'    },
  { key:'leather',n:1, label:'皮衣'    },
  /* === 新物品 === */
  { key:'clearMind', n:1, label:'明心浆' },
  { key:'amethyst', n:1, label:'紫水晶' },
  { key:'luckyCoin', n:1, label:'幸运硬币' },
  { key:'deadwoodSprout', n:1, label:'枯木新枝' },
  { key:'kuiZuo', n:1, label:'《愧怍》' },
  { key:'broom', n:1, label:'魔法扫帚' },
];

const EVENTS = [
  {
    id:'coin', title:'无主之物',
    getBody:()=>'<p>在路上，你见到2枚遗落的金币，要不要捡起来呢？</p>',
    options:[
      { name:'捡起', desc:'没人看见……大概吧？', req:()=>true,
        resolve:()=>{ G.inventory.coin=(G.inventory.coin||0)+2; return '你获得了<b>2金币</b>。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  {
    id:'oldLady', title:'摔倒的老人',
    getBody:(slot)=>{ if(slot.case==null){ slot.case=Math.random()<0.85; const pool=['wood','flax','fruit','rawMeat']; slot.giftKey=slot.case? pool[Math.floor(Math.random()*pool.length)] : null; slot.giftN=slot.case? {wood:3,flax:3,fruit:3,rawMeat:2}[slot.giftKey] : 0; } return '<p>你见到一位跌倒在地的老奶奶。</p>'; },
    options:[
      { name:'扶', desc:'无', req:()=>true,
        resolve:(slot)=>{ G.records=G.records||{}; G.records.oldLadyHelped=(G.records.oldLadyHelped||0)+1; if(typeof afterQuestProgress==='function') afterQuestProgress(); if(slot.case){ const k=slot.giftKey, n=slot.giftN; G.inventory[k]=(G.inventory[k]||0)+n; return `老奶奶十分感激，送给你<b>${RES_ZH[k]}×${n}</b>。`; } G.inventory.coin=Math.floor((G.inventory.coin||0)/2); return '你被老奶奶摸走了一半的钱！你的金币减半。'; } },
      { name:'不扶', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  {
    id:'spring', title:'山野温泉',
    getBody:()=>'<p>在山中发现了一处隐秘的温泉，热气弥漫。</p>',
    options:[
      { name:'泡个温泉', desc:'无', req:()=>true,
        resolve:()=>{ const cap=heroineMaxHp(); const cur=G.hero.hp; if(cur<cap){ G.hero.hp=Math.min(cap, cur+Math.round(cap*0.75)); return '神清气爽，回复了<b>'+(G.hero.hp-cur)+'</b>点生命值。'; } return '你在温泉里泡了会，浑身舒畅。'; } },
      { name:'休息一下', desc:'无', req:()=>true,
        resolve:()=>{ G.hero.actionPoint=(G.hero.actionPoint||0)+2; return '整备了随身物品，行动力+<b>2</b>。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  {
    id:'bearQuest', title:'讨伐任务·暴躁的熊',
    getBody:(slot)=>{ const started=!!(G.records&&G.records.bearQuestStarted); slot.started=started;
      return started ? '<p>你再次从村民处听说了狗熊最近的行踪。你决定。</p>' : '<p>从附近村民的描述中，你得知附近山中蛰居着一头狗熊，此熊力大无穷且狂躁无比，让村民们十分头疼。好消息是，它最近在冬眠，稍微安分了点。</p>'; },
    options:(slot)=> slot.started ? [
      { name:'请村民领路找到狗熊', desc:'你在山洞里睡懒觉的日子结束了！', req:()=>true,
        resolve:()=>{ enterEventBattle('bear'); return ''; } },
      { name:'请村民标注地点但暂不前往', desc:'小心为上', req:()=>true,
        resolve:()=>{ G.inventory.roadmap=(G.inventory.roadmap||0)+1; return '村民给了你一张路线图，上面标注着狗熊最近栖息的位置。获得<b>路线图×1</b>。'; } },
    ] : [
      { name:'我了解了', desc:'贸然前去会被拍成肉饼吧？', req:()=>true,
        resolve:()=>{ G.records=G.records||{}; G.records.bearQuestStarted=true; return '你记下了信息后，离开了此地。接取了支线任务·讨伐暴躁的熊。'; } },
    ],
  },
  {
    id:'hounds', title:'穷追不舍',
    getBody:()=>'<p>在野外，几条狗一路狂吠追着你跑了一公里。你气喘吁吁……</p>',
    options:[
      { name:'别太嚣张', desc:'几条野狗，竟敢在我面前狺狺狂吠', req:()=>true,
        resolve:()=>{ enterEventBattle('houndPro'); return ''; } },
      { name:'丢块肉', desc:'试试人类的计谋（需要生肉×1）', req:()=>(G.inventory.rawMeat||0)>=1,
        resolve:()=>{ G.inventory.rawMeat-=1; return '野狗们马上抛下你，去争夺那块肉了。你趁此机会离开了。'; } },
    ],
  },
  {
    id:'trader', title:'流浪商人',
    getBody:()=>'<p>“瞧一瞧看一看哩！”，你在路上遇到一位流浪商人，要看看吗？</p>',
    options:(slot)=>{ if(!slot.good){ const g=TRADER_GOODS[Math.floor(Math.random()*TRADER_GOODS.length)]; const base=TRADER_REF_PRICE[g.key]; const total=Math.round(base*Math.max(0.2,Math.min(1.6,(0.2+Math.random()*1.4)))*g.n); slot.good=g; slot.price=total; } const g=slot.good, total=slot.price;
      return [
        { name:'看看货', desc:`花费<b>${total}</b>金币，购买<b>${g.label}</b>`, req:()=>(G.inventory.coin||0)>=total,
          resolve:()=>{ G.inventory.coin-=slot.price;
            /* broom/luckyCoin/deadwoodSprout/kuiZuo/windChime 走 grantPermanentItem 让它们生效 */
            const goGrant = ['club','cloth','dagger','leather','ironSword','broom','luckyCoin','deadwoodSprout','kuiZuo','windChime'].includes(g.key);
            if(g.n===1 && goGrant){ grantPermanentItem(g.key); }
            else if(g.key==='clearMind'){ G.inventory.clearMind=(G.inventory.clearMind||0)+1; }
            else { G.inventory[g.key]=(G.inventory[g.key]||0)+g.n; }
            return '“欢迎下次再来！”流浪商人笑眯眯地对你说。'; } },
        { name:'不感兴趣', desc:'路边摊不可信', req:()=>true,
          resolve:()=>{ G.hero.actionPoint=(G.hero.actionPoint||0)+1; return '你没有理会。趁此时间休息了会，行动力+<b>1</b>。'; } },
      ]; },
  },
  {
    id:'coinPurse', title:'临时起意·钱袋',
    getBody:(slot)=>{ if(slot.x==null){ slot.x=2+Math.floor(Math.random()*14); slot.y=10+Math.floor(Math.random()*86); } const x=slot.x, y=slot.y;
      return `<p>走在前面的路人，裤袋露出了钱袋（装有<b>${x}</b>金币），他似乎没注意到，你决定。</p>`; },
    options:(slot)=>[
      { name:`偷偷拿走（成功率${slot.y}%）`, desc:'这也是生存所迫……', req:()=>true,
        resolve:()=>{ if(Math.random()*100<slot.y){ G.inventory.coin=(G.inventory.coin||0)+slot.x; for(const k in ALLIES) gainAffinity(k,-2); return `你拿到了钱，但良心上受到了谴责，金币+<b>${slot.x}</b>，所有同伴好感度-2。`; } G.hero.hp=1; return '你被发现了！被围观群众痛殴一顿，生命值降为1。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  {
    id:'bread', title:'临时起意·面包',
    getBody:(slot)=>{ if(slot.y==null){ slot.y=10+Math.floor(Math.random()*86); } return '<p>走在前面的小孩手里攥着一长条面包，你决定。</p>'; },
    options:(slot)=>[
      { name:`抢了（成功率${slot.y}%）`, desc:'这也是生存所迫……', req:()=>true,
        resolve:()=>{ if(Math.random()*100<slot.y){ G.hero.actionPoint=(G.hero.actionPoint||0)+4; for(const k in ALLIES) gainAffinity(k,-2); return '你拿到了面包，但良心上受到了谴责，行动力+<b>4</b>，所有同伴好感度-2。'; } G.hero.hp=1; return '你被发现了！被围观群众痛殴一顿，生命值降为1。'; } },
      { name:'算了', desc:'多一事不如少一事', req:()=>true,
        resolve:()=>'你离开了此地。' },
    ],
  },
  /* === 6个新事件 === */
  /* 翻车现场 */
  {
    id:'flipCart', title:'翻车现场',
    getBody:()=>`<p>你遇见一位摔得人仰车翻的男人。将他救起后，他自称是售卖载具的商人。</p><p>"这是个意外中的意外。这些家伙平时吃的不多，干活又卖力。您是我的恩人，就打5折，不，2折，卖给您如何？"</p>`,
    options:(slot)=>{
      if(slot.show===undefined){ slot.show2=Math.random()<0.5; slot.show3=Math.random()<0.5; slot.show4=Math.random()<0.5; slot.show=true; }
      const list=[];
      list.push({ name:'花费3金币，买下地龙', desc:'', req:()=>(G.inventory.coin||0)>=3,
        resolve:()=>{ G.inventory.coin-=3; G.vehicles=G.vehicles||[]; G.vehicles.push({key:'dragon', uses:(VEHICLES.dragon&&VEHICLES.dragon.uses)||3});
          return '<p>买下了地龙。</p><p>希望下一个翻车的人不会是自己。（载具·地龙+1）</p>'; } });
      if(slot.show2) list.push({ name:'花费3金币，买下马车', desc:'', req:()=>(G.inventory.coin||0)>=3,
        resolve:()=>{ G.inventory.coin-=3; G.vehicles=G.vehicles||[]; G.vehicles.push({key:'carriage', uses:(VEHICLES.carriage&&VEHICLES.carriage.uses)||2});
          return '<p>买下了马车。</p><p>希望下一个翻车的人不会是自己。（载具·马车+1）</p>'; } });
      if(slot.show3) list.push({ name:'花费3金币，买下魔法扫帚', desc:'', req:()=>(G.inventory.coin||0)>=3,
        resolve:()=>{ G.inventory.coin-=3; G.vehicles=G.vehicles||[]; G.vehicles.push({key:'broom', uses:(VEHICLES.broom&&VEHICLES.broom.uses)||2});
          return '<p>买下了魔法扫帚。</p><p>希望下一个从天上摔下来的人不会是自己。（载具·魔法扫帚+1）</p>'; } });
      if(slot.show4) list.push({ name:'花费5金币，买下魔法飞毯', desc:'', req:()=>(G.inventory.coin||0)>=5,
        resolve:()=>{ G.inventory.coin-=5; G.vehicles=G.vehicles||[]; G.vehicles.push({key:'carpet', uses:(VEHICLES.carpet&&VEHICLES.carpet.uses)||1});
          return '<p>买下了魔法飞毯。</p><p>希望下一个从天上摔下来的人不会是自己。（载具·魔法飞毯+1）</p>'; } });
      list.push({ name:'我暂时用不上载具', desc:'刚翻车的人推销的载具，我可不敢买', req:()=>true,
        resolve:()=>'<p>你离开了此地。</p><p>留下男人在原处训斥着他的坐骑们。</p>' });
      return list;
    },
  },
  /* 常乐·猜大小 */
  {
    id:'changle', title:'常乐·猜大小',
    getBody:(slot)=>{
      if(slot.generated===undefined){
        let x,y,z;
        do{ x=4+Math.floor(Math.random()*5); y=Math.floor(Math.random()*8); z=Math.floor(Math.random()*8); }
        while(x+y+z!==12);
        slot.x=x; slot.y=y; slot.z=z; slot.generated=true;
      }
      return `<p>村口，几个流浪汉聚在树荫下赌博。你凑近瞧了瞧，桌上是一副与扑克牌类似的牌。其中一个流浪汉瞥了你一眼，随口问道："来加你一个不来？"</p>`;
    },
    options:(slot)=>[
      { name:'花费5金币，参与1次', desc:'', req:()=>(G.inventory.coin||0)>=5, resolve:()=>{ G.inventory.coin-=5; slot.a=5; return changleRound2(slot); } },
      { name:'花费10金币，参与1次', desc:'', req:()=>(G.inventory.coin||0)>=10, resolve:()=>{ G.inventory.coin-=10; slot.a=10; return changleRound2(slot); } },
      { name:'花费20金币，参与1次', desc:'', req:()=>(G.inventory.coin||0)>=20, resolve:()=>{ G.inventory.coin-=20; slot.a=20; return changleRound2(slot); } },
      { name:'花费所有金币，进行一次特殊的赌博', desc:'所有，或者一无所有', req:()=>(G.inventory.coin||0)>0,
        resolve:()=>{
          const all=G.inventory.coin; G.inventory.coin=0;
          if(Math.random()<0.5){ G.inventory.coin+=all*2; return `<p>你的金币数量翻倍！</p><p>盆满钵满，是时候离开了</p>`; }
          return `<p>你失去了所有金币！</p><p>晦气！早知道不该来的！</p>`;
        } },
      { name:'摇头拒绝', desc:'珍爱生命，远离赌博', req:()=>true, resolve:()=>'你离开了此地' },
    ],
  },
  /* 一塌糊涂的菜园 */
  {
    id:'messyGarden', title:'一塌糊涂的菜园',
    getBody:()=>`<p>村子边缘，一户人家的围栏被野猪撞塌，菜园被翻得一塌糊涂。</p><p>主人蹲在田边，垂头丧气。他看见你，开口求助：能不能帮忙把倒塌的木栅栏重新搭好。</p>`,
    options:[
      { name:'帮忙修补围栏', desc:'看着这片被毁的田地，实在没法视而不见', req:()=>true,
        resolve:()=>{
          G.hero.actionPoint=Math.max(0, (G.hero.actionPoint||0)-3);
          if(Math.random()<0.85){
            G.inventory.fruit=(G.inventory.fruit||0)+6; G.inventory.coin=(G.inventory.coin||0)+6;
            const cap=heroDisplayMaxHp(); G.hero.hp=cap;
            return '<p>你花了一整天修理栅栏。行动力-3。</p><p>村民送给你果子×6、金币×6，并邀你留下吃晚饭，回复全部生命值。</p>';
          }
          const cap=heroDisplayMaxHp(); G.hero.hp=cap;
          return '<p>你花了一整天修理栅栏。行动力-3。</p><p>村民家中本就拮据，拿不出像样报酬，但执意邀你留下吃晚饭，回复全部生命值。</p>';
        } },
      { name:'建议他设置陷阱', desc:'教他布置捕兽夹来防范野猪', req:()=>true,
        resolve:()=>{ G.hero.actionPoint=Math.max(0, (G.hero.actionPoint||0)-1); G.inventory.coin=(G.inventory.coin||0)+6;
          return '<p>你花了少许时间讲解布置捕兽夹的技巧。行动力-1。</p><p>获得金币×6。</p>'; } },
      { name:'多一事不如少一事', desc:'', req:()=>true, resolve:()=>'<p>你离开了此地。</p>' },
    ],
  },
  /* 废弃矿洞 */
  {
    id:'abandonMine', title:'废弃矿洞',
    getBody:()=>`<p>山坡上出现一处被碎石半掩埋的废弃矿洞入口。</p><p>黑暗的洞口隐隐能听见滴水声。</p>`,
    options:[
      { name:'进去简单探查一番', desc:'碰碰运气，或许有矿石', req:()=>true,
        resolve:()=>{
          const r=Math.random();
          if(r<0.6){
            const pick=Math.random(); let txt='';
            if(pick<0.33){ G.inventory.iron=(G.inventory.iron||0)+2; txt='挖到了铁块×2'; }
            else if(pick<0.66){ G.inventory.amethyst=(G.inventory.amethyst||0)+1; txt='挖到了紫水晶×1'; }
            else { G.inventory.diamond=(G.inventory.diamond||0)+1; txt='挖到了钻石×1'; }
            return `<p>${txt}。</p>`;
          } else if(r<0.9){
            const dmg=Math.floor(G.hero.hp*0.4); G.hero.hp=Math.max(1, G.hero.hp-dmg);
            return `<p>探索山洞时，一个趔趄，脚下碎石滑落，触发小型塌方。</p><p>失去 ${dmg} 点生命值。</p>`;
          } else { enterEventBattle('ironClump'); return ''; }
        } },
      { name:'仅在洞口张望，不深入', desc:'看看情况就走', req:()=>true,
        resolve:()=>{ G.inventory.blueStar=(G.inventory.blueStar||0)+2; return '<p>你在洞口捡到几块碎矿石。</p><p>获得蓝星石×2。</p>'; } },
    ],
  },
  /* 道旁的修女 */
  {
    id:'nunPath', title:'道旁的修女',
    getBody:(slot)=>{
      if(slot.successRate===undefined) slot.successRate=100;
      return `<p>林间岔路的旧石龛下，坐着一名灰袍修女。兜帽压得很低，大半张脸隐在阴影里。她身前摆着褪色的木雕圣像，安静垂首，见到你路过时，抬眼轻声呼唤。</p><p>"旅人，你心中可有重负？不妨在此忏悔，卸下你的罪孽与烦忧。只需一点供金。"</p>`;
    },
    options:(slot)=>[
      { name:'上前忏悔（消耗1金币，成功率'+slot.successRate+'%）', desc:'', req:()=>(G.inventory.coin||0)>=1,
        resolve:()=>{
          G.inventory.coin-=1;
          if(Math.random()*100 < slot.successRate){
            slot.successRate=Math.max(50, slot.successRate-5);
            G.hero.psyStress=Math.max(-100, (G.hero.psyStress||0)-1);
            return '<p>你付出一枚金币，向她诉说心底积压的焦躁。她静静聆听，低声诵念祷词。</p><p>心理压力-1</p>';
          } else {
            return '<p>你付出一枚金币，向她诉说心底积压的焦躁。片刻后她大惊失色，惶恐地喊道："你罪孽深重，主不会拯救你的！"</p>';
          }
        } },
      { name:'心生疑虑，转身离开', desc:'在野外遇到修女十分可疑', req:()=>true,
        resolve:()=>{ G.hero.actionPoint=(G.hero.actionPoint||0)+1;
          return '<p>你径直离开了。</p><p>用这段时间在树林中小憩了一会，行动力+1。</p>'; } },
    ],
  },
  /* 蘑菇迷境 */
  {
    id:'mushroomLand', title:'蘑菇迷境',
    getBody:()=>`<p>你找到了一片蘑菇。它们色彩鲜艳、形状各异</p>`,
    options:[
      { name:'吃几个试试', desc:'触发10次随机效果！', req:()=>true,
        resolve:()=>{
          const msgs=[];
          for(let i=0;i<10;i++){
            const t=Math.floor(Math.random()*8);
            if(t===0){
              const pct=Math.floor(Math.random()*199)-99;
              const cap=heroDisplayMaxHp(); const dlt=Math.floor(cap*pct/100);
              const before=G.hero.hp; G.hero.hp=Math.max(1, Math.min(cap, G.hero.hp+dlt));
              msgs.push('生命'+(G.hero.hp-before>0?'+':'')+(G.hero.hp-before));
            } else if(t===1){
              const before=G.inventory.coin||0;
              let pct=(Math.random()<0.5)? -(Math.random()*0.8):Math.random();
              const dlt=Math.round(before*pct);
              G.inventory.coin=Math.max(0, before+dlt);
              msgs.push('金币'+(dlt>0?'+':'')+dlt);
            } else if(t===2){
              const consumables=['wood','fruit','flax','rawMeat','blueStar','blueStarPowder'];
              const have=consumables.filter(k=>(G.inventory[k]||0)>0);
              if(have.length){ const n=1+Math.floor(Math.random()*3);
                for(let j=0;j<n;j++){ const pk=have[Math.floor(Math.random()*have.length)]; G.inventory[pk]--; }
                msgs.push('丢弃消耗品×'+Math.min(n,have.length)); } else msgs.push('无消耗品可丢');
            } else if(t===3){
              const n=1+Math.floor(Math.random()*4); const k=NATURAL_RESOURCES[Math.floor(Math.random()*NATURAL_RESOURCES.length)];
              G.inventory[k]=(G.inventory[k]||0)+n; msgs.push(RES_ZH[k]+'×'+n);
            } else if(t===4){
              const dlt=Math.floor(Math.random()*11)-5; G.hero.atk=(G.hero.atk||0)+dlt;
              msgs.push('基础攻击'+(dlt>0?'+':'')+dlt);
            } else if(t===5){
              const dlt=(Math.floor(Math.random()*11)-5)*10; G.hero.maxHp=(G.hero.maxHp||100)+dlt;
              msgs.push('最大生命'+(dlt>0?'+':'')+dlt);
            } else {
              const dlt=Math.floor(Math.random()*13)-6; G.hero.actionPoint=Math.max(0, (G.hero.actionPoint||0)+dlt);
              msgs.push('行动力'+(dlt>0?'+':'')+dlt);
            }
          }
          return '<p>一阵天旋地转后，你和蘑菇们手牵手围着篝火跳起了舞，跳啊跳啊跳……你获得了10个效果。</p><p>'+msgs.join('，')+'。</p>';
        } },
      { name:'有个蘑菇在动？', desc:'还没吃蘑菇就已经出幻觉了？', req:()=>true,
        resolve:()=>{ G.vehicles=G.vehicles||[];
          G.vehicles.push({key:'mushroom', uses:(VEHICLES.mushroom&&VEHICLES.mushroom.uses)||3});
          return '<p>你捉住了那只打算悄悄逃跑的大蘑菇。</p><p>获得载具·会走路的蘑菇×1。</p>'; } },
      { name:'明眼人都能看出来有毒', desc:'找点别的能吃的好了', req:()=>true,
        resolve:()=>{ G.inventory.fruit=(G.inventory.fruit||0)+2;
          return '<p>你离开了此地。</p><p>在树林里找到了果子×2。</p>'; } },
    ],
  },
];

/* 常乐辅助函数 */
function changleCardHTML(type){
  // S=小(1~5) B=大(6~40) K=王(JQK)
  const icon = type==='S' ? '🂡' : (type==='B' ? '🃞' : '🃏');
  const label = type==='S' ? '小' : (type==='B' ? '大' : '王');
  return `<div style="display:flex;flex-direction:column;align-items:center;width:32px;margin:0 1px;">
    <div style="width:30px;height:42px;border:1px solid #aaa;border-radius:3px;background:#fff;color:#222;font-size:16px;display:flex;align-items:center;justify-content:center;">${icon}</div>
    <span style="font-size:10px;color:#bbb;">${label}</span></div>`;
}
function changleCardsBlockHTML(picks){
  const cardsHTML = picks.map(c=>changleCardHTML(c)).join('');
  const s=picks.filter(c=>c==='S').length, b=picks.filter(c=>c==='B').length, k=picks.filter(c=>c==='K').length;
  // 用 float:right 独立卡片区块，紧贴剧情区右侧；不撑高正文
  return `<div style="float:right;width:96px;margin:-4px 0 6px 10px;padding:6px 4px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:4px;text-align:center;">
    <div style="font-size:11px;color:#bbb;margin-bottom:4px;">抽牌结果</div>
    <div style="display:flex;justify-content:center;">${cardsHTML}</div>
    <div style="font-size:10px;color:#aaa;margin-top:4px;">${s}小 · ${b}大 · ${k}王</div>
  </div>`;
}
function changleRound2(slot){
  const x=slot.x, y=slot.y, z=slot.z;
  return { __continue:true,
    body:`<p>他们给你讲了规则：1到5点是小，6到40点为大，JQK代表王。</p><p>每轮从12张牌中抽取3张，如果你预测对了结果，就能获得对应的奖励。</p><p>你观察到桌上摆着 ${x} 张小牌，${y} 张大牌，${z} 张王牌。</p><p>现在，请押一把：</p>`,
    options:[
      { name:'稳一手', desc:'结果中将至少有1张小牌', req:()=>true, resolve:()=> changleResolve(slot, 'atLeast1Small') },
      { name:'以小博大', desc:'结果中将至少有2张大牌', req:()=>true, resolve:()=> changleResolve(slot, 'atLeast2Big') },
      { name:'帝王之征', desc:'结果中将至少有2张王牌', req:()=>true, resolve:()=> changleResolve(slot, 'atLeast2King') },
    ],
  };
}
function changleResolve(slot, predType){
  const x=slot.x, y=slot.y, z=slot.z;
  // 玩家选完后才抽牌（关键：结果在选择后才生成）
  const pool=[];
  for(let i=0;i<x;i++) pool.push('S');
  for(let i=0;i<y;i++) pool.push('B');
  for(let i=0;i<z;i++) pool.push('K');
  const picks=[]; const p=pool.slice();
  for(let i=0;i<3;i++){ const idx=Math.floor(Math.random()*p.length); picks.push(p.splice(idx,1)[0]); }

  let hit=false;
  if(predType==='atLeast1Small') hit = picks.filter(c=>c==='S').length>=1;
  else if(predType==='atLeast2Big') hit = picks.filter(c=>c==='B').length>=2;
  else if(predType==='atLeast2King') hit = picks.filter(c=>c==='K').length>=2;

  const cardBlock = changleCardsBlockHTML(picks);

  if(!hit){ return `${cardBlock}<p>很遗憾，没中。</p><p>晦气！早知道不该来的！</p>`; }
  const a=slot.a;
  const mult = Math.max(1, Math.round(a/5));

  if(predType==='atLeast1Small'){
    const winCoin = Math.round(1.4*a);
    G.inventory.coin=(G.inventory.coin||0)+winCoin;
    return `${cardBlock}<p>中了！稳一手！</p><p>金币+${winCoin}。盆满钵满，是时候离开了。</p>`;
  }
  if(predType==='atLeast2Big'){
    const itemPool=['club','cloth','dagger','leather','deadwoodSprout','luckyCoin','kuiZuo','windChime'];
    const pickKey=itemPool[Math.floor(Math.random()*itemPool.length)];
    const n=Math.max(1, Math.round(0.2*a));
    if(['club','cloth','dagger','leather','ironSword','broom','luckyCoin','deadwoodSprout','kuiZuo','windChime'].includes(pickKey)&&n===1){ grantPermanentItem(pickKey); }
    else { G.inventory[pickKey]=(G.inventory[pickKey]||0)+n; }
    return `${cardBlock}<p>以小博大，成了！</p><p>流浪汉们没有钱，只能将随身物品给你。</p><p>获得了 ${itemName(pickKey)}×${n}。盆满钵满，是时候离开了。</p>`;
  }
  if(predType==='atLeast2King'){
    return { __continue:true,
      body:`${cardBlock}<p>卧槽，真抽到了两张王！</p><p>流浪汉们怔怔的望着桌上的几张王牌。他们不知道将什么物品抵给你了，干脆让你自己许愿。</p><p>你选择：</p>`,
      options:[
        { name:'要魔法秘籍', desc:'', req:()=>true,
          resolve:()=>{
            const atkGain = Math.round(1.2*a);
            G.hero.atk=(G.hero.atk||0)+atkGain;
            for(const k of G.team){ if(ALLIES[k]){ ALLIES[k].baseAtk=(ALLIES[k].baseAtk||0)+atkGain; } }
            return `<p>魔法啥子的俺们不会咧，干架本事倒是有点。</p><p>你学习了战斗技巧，你和编队中的队友各自基础攻击力+${atkGain}。</p><p>盆满钵满，是时候离开了。</p>`; } },
        { name:'要生存物资', desc:'', req:()=>true,
          resolve:()=>{
            const m = mult * 3;
            G.inventory.wood=(G.inventory.wood||0)+m; G.inventory.flax=(G.inventory.flax||0)+m;
            G.inventory.fruit=(G.inventory.fruit||0)+m; G.inventory.rawMeat=(G.inventory.rawMeat||0)+m;
            G.inventory.coin=(G.inventory.coin||0)+m;
            G.inventory.iron=(G.inventory.iron||0)+Math.max(1,Math.floor(m/3));
            G.inventory.blueStar=(G.inventory.blueStar||0)+m;
            return `<p>流浪汉把近日翻找到的东西交给了你。</p><p>获得：木材×${m}、亚麻×${m}、果子×${m}、生肉×${m}、金币×${m}、蓝星石×${m}、铁块×${Math.max(1,Math.floor(m/3))}。</p><p>盆满钵满，是时候离开了。</p>`; } },
        { name:'要远行装备', desc:'', req:()=>true,
          resolve:()=>{
            let txt='';
            if(a<=5){
              G.hero.actionPoint=(G.hero.actionPoint||0)+6;
              txt='本日行动力额外+6';
            } else if(a<=10){
              G.hero.apCap=(G.hero.apCap||5)+1;
              G.hero.actionPoint=(G.hero.actionPoint||0)+5;
              txt='行动力上限+1，本日行动力额外+5';
            } else {
              G.hero.apCap=(G.hero.apCap||5)+2;
              G.hero.actionPoint=(G.hero.actionPoint||0)+4;
              txt='行动力上限+2，本日行动力额外+4';
            }
            return `<p>流浪汉把几人手头的帐篷、家具凑了凑，交给了你。</p><p>${txt}。</p><p>盆满钵满，是时候离开了。</p>`; } },
      ],
    };
  }
  return '';
}



function startEvent(x, y, slotOverride){
  // 需求1：进入事件格即把该格变为空地（防止事件内战斗结束后格子残留）
  const gcell=G.map.cells[y*G.map.n+x];
  if(gcell && gcell.content) gcell.content={type:'empty'};
  let slot = slotOverride || (gcell && gcell.content.slot) || {};
  let ev;
  if(slot.evId){ ev=EVENTS.find(e=>e.id===slot.evId)||null; }
  else { ev=EVENTS[Math.floor(Math.random()*EVENTS.length)]; }
  if(!ev) ev=EVENTS[0];
  slot.evId=ev.id;
  // 先求值 body（内部会初始化随机值），再求值 options
  const body=typeof ev.getBody==='function' ? ev.getBody(slot) : ev.getBody;
  const options=typeof ev.options==='function' ? ev.options(slot) : ev.options;
  eventState={ ev, slot, body, options, selected:-1, resolving:false, cell:{x,y}, phase:'body' };
  // 事件状态存到 G.activeEvent，供读档恢复（格子已清空不影响重开）
  if(G){ G.activeEvent={ x, y, slot }; }
  lockEventUI();
  showEventBody();
}

function lockEventUI(){
  $('#bottom').classList.add('mode-event-lock');
  $('#goBtn').style.display='none';
  renderIconbar();
}
function unlockEventUI(){
  $('#bottom').classList.remove('mode-event-lock');
  renderIconbar();
}

/* 事件正文：按自然段打字机逐段，段间点击剧情区推进；打完最后一段才显示选项 */
function showEventBody(){
  const s=eventState; if(!s) return;
  storyClear();
  // 标题单独一行（不参与打字机，直接显示），正文随后逐段打字
  const box=$('#storyBody');
  box.insertAdjacentHTML('beforeend', `<div class="ev-title">${s.ev.title}</div>`);
  const paras=splitParas(s.body);
  s.bodyParas=paras;
  s.bodyIdx=0;
  typeNextBodyPara();
}
function typeNextBodyPara(){
  const s=eventState; if(!s) return;
  if(s.bodyIdx>=s.bodyParas.length){ s.phase='choose'; renderEventOptions(); return; }
  const seg=s.bodyParas[s.bodyIdx]; s.bodyIdx++;
  s.phase='body';
  // 段打完：若还有下一段，等待点击推进；若是最后一段，直接进入选择
  const isLast = s.bodyIdx>=s.bodyParas.length;
  storyPush(seg, ()=>{ if(eventState && isLast){ eventState.phase='choose'; renderEventOptions(); } });
}
function splitParas(html){
  const clean=String(html).trim();
  // 以 </p> 或 <br> 为段落结束，保留完整标签
  const paras=clean.split(/(?=<\/?p>|<br\s*\/?>)/).filter(x=>x&&x.trim());
  // 合并：将 "<p>正文" 与 "</p>" 重新拼成完整 "<p>正文</p>"
  const merged=[];
  for(let i=0;i<paras.length;i++){
    let seg=paras[i];
    if(/^<p[^>]*>/.test(seg) && !/<\/p>$/.test(seg) && i+1<paras.length){
      seg += paras[i+1]; i++;
    }
    if(seg && seg.trim()) merged.push(seg);
  }
  return merged.length? merged : [clean];
}

/* 渲染信息区选项 */
function renderEventOptions(){
  const s=eventState; if(!s||!s.options) return;
  const html=s.options.map((o,i)=>{
    const usable=o.req();
    const sel=i===s.selected;
    const descHtml = (o.desc==null||o.desc===''||o.desc==='无') ? '' : `<div class="ev-opt-desc">${o.desc}</div>`;
    const confirm = sel? '<span class="ev-confirm">你确定这么做？</span>' : '';
    return `<div class="ev-opt ${sel?'sel':''} ${usable?'':'dis'}" data-i="${i}">
      <div class="ev-opt-name"><span>${o.name}</span>${confirm}</div>
      ${descHtml}
    </div>`;
  }).join('');
  prompt(`<div class="ev-opt-wrap">${html}</div>`);
  $('#promptZone').querySelectorAll('.ev-opt').forEach(b=>{
    b.onclick=()=>{ if(s.resolving) return; const i=+b.dataset.i; if(!s.options[i].req()){ log('当前无法选择该选项。'); return; } selectEventOption(i); };
  });
}

function selectEventOption(i){
  const s=eventState; if(!s||s.resolving) return;
  if(s.selected===i){ confirmEventOption(i); }
  else { s.selected=i; renderEventOptions(); }
}

function confirmEventOption(i){
  const s=eventState; if(!s) return;
  const opt=s.options[i]; if(!opt) return;
  s.resolving=true;
  // 确认：选中项变金，其余淡化；整体 2s 内淡出
  const wrap=$('#promptZone .ev-opt-wrap');
  $('#promptZone').querySelectorAll('.ev-opt').forEach((el,j)=>{
    if(j===i) el.classList.add('confirmed');
    else el.classList.add('dim');
  });
  const result=opt.resolve(s.slot) || '';
  s.result=result;
  if(wrap) wrap.style.opacity='0';
  setTimeout(()=>{
    // === 多层级事件：__continue 标记表示继续推进而非结束 ===
    if(typeof result === 'object' && result.__continue){
      s.body = result.body;
      s.options = result.options;
      s.selected = -1;
      s.resolving = false;
      prompt('');
      showEventBody();
    } else {
      s.result = result;
      finishEvent(s.result);
    }
  }, 2000);
}

/* 事件结束：结果打字机显示，清空活动事件，恢复交互（格子已在进入时变空地） */
function finishEvent(result){
  const s=eventState; if(!s) return;
  const title=s.ev.title;
  // 格子进入事件时已清空；这里仅清除活动事件状态
  if(G) delete G.activeEvent;
  eventState=null;
  unlockEventUI();
  prompt('');
  $('#goBtn').style.display='none';
  renderMap(); refreshHUD();
  // 结果打字机显示；标题保留，正文为结果
  storyClear();
  const box=$('#storyBody');
  box.insertAdjacentHTML('beforeend', `<div class="ev-title">${title}</div>`);
  const paras=splitParas(result);
  let idx=0;
  const typeNext=()=>{
    if(idx>=paras.length){ /* 全部结果段打完，等点击清空 */ return; }
    const seg=paras[idx]; idx++;
    storyPush(seg, ()=>{ /* 段打完 */ if(idx<paras.length){ typeNext(); } });
  };
  typeNext();
}

/* 事件内进入战斗：把事件格转为战斗格再进入，战斗结束自动清空为空地 */
function enterEventBattle(enemyKey){
  const s=eventState;
  const cell=s? s.cell : null;
  const x=cell?cell.x:G.px, y=cell?cell.y:G.py;
  // 该格已为空地，转为战斗格；战斗结束 endCombat 会清空 entryCell(=当前格)
  if(G.map.cells[y*G.map.n+x]) G.map.cells[y*G.map.n+x].content={type:'battle', sub:'event', key:enemyKey};
  if(G) delete G.activeEvent;
  eventState=null;
  unlockEventUI();
  startCombat({ content:{ key:enemyKey } });
}

function inEvent(){ return !!eventState; }

/* 剧情区点击（全局，由 ui.js 绑定）：
   1) 正在打字 → 立即显示本段全部文字（不推进，符合要求10情况1）
   2) 已打完且事件正文还有下一段 → 推进到下一段（要求8：快速跳下一段）
   3) 已打完且是事件正文最后一段 / 结果 → 剧情区清空（要求8） */
function onStoryClick(){
  if(storyIsTyping()){ storySkipToEnd(); return; }
  // 已打完
  const s=eventState;
  if(s && s.phase==='body' && s.bodyIdx < s.bodyParas.length){
    typeNextBodyPara();
    return;
  }
  if(s && s.phase==='choose') return; // 等待选择，不可跳过（点击不处理）
  // 非事件普通剧情 / 结果：若有待打段落→推进到下一段；否则（最后一段）→清空
  if(storyHasMore()){ storyAdvance(); return; }
  storyClear();
}
document.addEventListener('click', ev=>{
  if(ev.target.closest('#storyBody')) onStoryClick();
  // 选中某选项后点击别处（非选项）→ 取消选中（要求3）
  const s=eventState;
  if(s && s.phase==='choose' && !s.resolving && s.selected>=0 && !ev.target.closest('.ev-opt')){
    s.selected=-1; renderEventOptions();
  }
});
