# 在成为勇者之前

走格子 + 回合制 + 经营 + 轻度 Roguelike 的**纯前端网页游戏**。无后端、无构建步骤、零第三方运行时依赖。

## 在线游玩

部署网址（Cloudflare Pages 由本仓库自动部署，唯一可信入口）：

**https://html-game-ap9.pages.dev/**

> 本地 `index.html` 仅作调试入口，线上内容以部署网址为准。

## 运行方式

- **直接访问**上面的网址即可游玩，无需安装。
- 本地调试：在仓库根目录起任意静态服务器，例如
  `npx serve .`，然后浏览器打开（ES Module 需经 http 访问，不要用 file:// 双击）。

## 技术栈

- 原生 HTML + CSS + ES2022 JavaScript（ES Modules），**零依赖、零打包**。
- 数据驱动：所有规则数值集中在 `src/data/`，系统逻辑在 `src/systems/`，UI 在 `src/ui/`。
- 字体：[霞鹜文楷 LXGW WenKai TC](https://fonts.google.com/)（在线）+ 本地阿里巴巴普惠体等（`assets/fonts`）。

## 目录结构

```
index.html               入口
src/
  core/      事件总线、随机数、常量枚举、日志、存档、资源、音频
  data/      物品 / 设施 / 配方 / 技能 / buff与元素反应 / 敌人 / 战斗节点 / 掉落池
  state/     GameState 中央状态、地图、背包、编队
  systems/   探索系统、战斗引擎、顶层导演、永久物品、商店/合成
  ui/        屏幕（菜单/探索/战斗）、全局面板、样式
assets/      图片 / 字体 / 音频（按需从本地素材库挑选）
docs/        设计与开发文档（含 legacy 旧剧情原案）
tools/       GitHub API 推送脚本、逻辑冒烟测试
```

## 文档

- `docs/ARCHITECTURE.md`：架构与规则实现索引（给后续开发者/AI）。
- `docs/DEVLOG.md`：开发日志与每次推送记录。
- `docs/legacy/`：旧版开场剧情原案（仅供理解世界观，暂不接入游戏）。

## 给后续 AI

- 唯一玩法权威是**设计文档 v0.8**（由项目所有者持有）；`docs/ARCHITECTURE.md` 是代码侧索引。
- 所有 UI 文本使用中文。
- 不要用 emoji 替代美术；美术素材优先从本地素材库挑选（识图核对），见 ARCHITECTURE。
- 改完跑 `node tools/smoke.mjs` 做逻辑冒烟，再在真实浏览器验证。
