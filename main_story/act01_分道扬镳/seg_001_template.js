/*
 * 主线剧情片段模板 —— 仅作示例，正式剧情写入后删除本文件
 * 触发条件示例：day>=2 且没被标记过
 * 正文演示了 speaker 字段 / 旁白 / 名字彩色 / 元指令 的用法
 */
export default {
  id: 'main_act01_seg001',
  act: 1,
  title: '模板片段（示例，不会真的触发）',

  // 实际条件应精确到某个 day 或某个任务状态
  condition: ()=> false,  // 永久 false，不会触发

  body: [
    { speaker: null,    html: '<p>这里是旁白示例。夜色渐深，篝火噼啪作响。</p>' },
    { speaker: '我',    html: '<p>我望着跳动的火苗，心下一片茫然。</p>' },
    { speaker: '夏阳',  html: '<p>阳字自动变红。……别太担心，总会有办法的。</p>' },
    { speaker: null,    html: '<p>【flash】一道白光划过天空。</p>' },
    { speaker: '？？？', html: '<p>（？？？ 直接白字）……你是来送死的吗？</p>' },
  ],

  options: [
    { name: '站出来应战', desc: '尽管实力悬殊', onPick: ()=>{ log('主线剧情：选择应战'); } },
    { name: '先观察再动', desc: '等待时机', onPick: ()=>{ log('主线剧情：选择观察'); } },
  ],

  nextSeg: null,
};
