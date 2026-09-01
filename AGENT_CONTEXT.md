# AGENT_CONTEXT.md

> **这是给后续 AI Agent 看的锚点文件。新对话直接读本文件即可完整继承上下文，无需追溯历史。**
> ⚠️ 本文件仅包含已明确确认的客观事实，不含推测或未经验证的内容。

## 项目元信息

| Field | Value |
|---|---|
| GitHub 仓库 | `zengxiaohao123/html-game` |
| 部署网址 | `https://html-game-ap9.pages.dev/` |
| 默认分支 | `main` |
| 构建工具 | 纯静态 HTML/JS（无构建步骤） |
| CDN | Cloudflare Pages（已绑定该仓库，main 分支有新 commit 时自动部署） |
| 游戏引擎 | Phaser 3（纯前端单机，待用户确认后可调整） |

## 约束条件（已明确）

- 单机游戏：**没有后端服务器**。存档用浏览器 `localStorage` 或 `IndexedDB`，纯本地保存。
- 不做排行榜、不读取其他玩家数据、不向任何外部服务发送用户游戏数据。
- 所有资源文件放 GitHub 仓库里直接由 Cloudflare Pages 托管加载，不引用需要翻墙的 CDN。
- 代码全部静态文件，Cloudflare Pages 的 Build command 留空，输出目录填 `/`。

## 设计偏好（⚠️ 未确认，等用户明确告知后填写）

> 下面这块是占位，**不要凭空猜**。只有当用户在某次对话里亲口说过、并且我确认无误时，才写进来。

- 沟通语言：中文 ✅
- 其他偏好：**待定，等用户后续明确指定**

## 连接状态（2026-09-01 实测通过）

- GitHub MCP 读写权限 ✅（create / delete / get 全部可用）
- Cloudflare Pages ↔ GitHub webhook ✅（main 分支 commit 触发自动部署，约 10 秒生效）
- 部署网址国内直连 ✅（三大运营商均无需翻墙）

## 当前进度

- [x] GitHub 仓库 `zengxiaohao123/html-game` 创建完成
- [x] Cloudflare Pages 绑定完成，网址可访问
- [x] MCP 读写链路实测通过
- [x] 本锚点文件写入仓库
- [ ] **游戏本体尚未开始开发**（当前仓库只有 Cloudflare 自动创建的占位 `index.html`）
- [ ] 游戏类型、玩法、美术风格 —— **完全待定，未讨论**

## 给后续 Agent 的操作建议

```javascript
// 第一步：先读本文件，掌握元信息和约束
// 第二步：读仓库当前状态（确认游戏开发到哪一步）
get_file_contents({ owner: "zengxiaohao123", repo: "html-game", path: "" })

// 第三步：有新文件直接用 create_or_update_file 推到 main
// 注意参数必填：owner / repo / path / content / message / branch（固定 main）

// 第四步：Cloudflare 会自动部署，改完后用 WebFetch 访问部署网址验证
WebFetch({ url: "https://html-game-ap9.pages.dev/" })
```

## 部署故障排查

如果 Cloudflare 网址打不开但 GitHub 有文件：
1. 检查 Cloudflare Pages 控制台 → html-game → Deployments，看最新构建是否成功
2. 如失败，查看构建日志里的错误信息（常见：路径写错、main 分支未选中、index.html 不在根目录）
3. 修复后重新 commit 即可触发自动重部署
