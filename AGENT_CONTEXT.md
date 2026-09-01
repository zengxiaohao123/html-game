# AGENT_CONTEXT.md

> 给后续 AI Agent 看的锚点文件。新对话直接读本文件即可完整继承上下文。
> ⚠️ 本文件的每一条内容**只能来自本次对话（用户亲口说过的 + Agent 亲身验证过的）**，禁止引用其他会话的记忆或用户画像标签。

---

## 一、项目元信息（已确认）

| Field | Value |
|---|---|
| GitHub 仓库 | `zengxiaohao123/html-game` |
| GitHub 主页 | `https://github.com/zengxiaohao123` |
| Cloudflare 部署网址 | `https://html-game-ap9.pages.dev/` |
| 默认分支 | `main` |
| 构建方式 | 纯静态 HTML/JS，无构建步骤，Build command 留空，输出目录填 `/` |
| Cloudflare 绑定 | ✅ 已绑定本仓库，main 分支有新 commit 时自动部署（约 10 秒生效） |
| 部署网址国内直连 | ✅ 移动/联通/电信均无需翻墙 |

## 二、已明确的约束条件（用户说过的原话）

- 单机游戏，**没有后端服务器**。存档用浏览器 localStorage 或 IndexedDB，纯本地保存。
- 不考虑排行榜，不读取其他玩家数据，不向任何外部服务发送用户游戏数据。
- 代码全部存 GitHub 仓库，Cloudflare Pages 自动托管。
- 不引用需要翻墙的外部 CDN（国内能访问的 jsDelivr / unpkg 可以）。

## 三、连接状态（Agent 2026-09-01 实际测过）

- GitHub MCP **写入权限已实测**：create / update / delete / get 全部成功，且已验证临时文件写入后删除，仓库干净复原。
- GitHub → Cloudflare Pages webhook **已绑定**：改 GitHub main 分支 → CF 自动构建部署。

## 四、当前进度

- [x] GitHub 仓库创建，Cloudflare Pages 绑定
- [x] MCP 读写链路实测通过
- [x] 本锚点文件写入仓库
- [ ] **游戏本体尚未开始开发**
- [ ] 游戏类型、玩法、美术风格 —— **未讨论**

## 五、游戏引擎

> 仅作为 Agent 的默认选择建议，**最终由用户确认**。
> Phaser 3（纯前端单机 2D 游戏引擎，CDN 引入即可，适合国内访问）。

## 六、Agent 操作规范（用户明确要求，必须遵守）

1. **所有锚点文件内容，只能来自本次对话**。禁止从其他会话的记忆、用户画像标签、经验回顾里搬运任何未经用户再次确认的信息。如果某项偏好或规则想写进来，先让用户口头确认，再落档。
2. **每次修改代码或修改网页后，必须同步更新本锚点文件**。更新时不要把新内容堆在末尾 —— 要整理分类，删除已过时的旧条目，在合适位置插入新的修改记录。空间有限，不要让文件变成垃圾场。必要时可以拆分，新建子文件（如 `CHANGELOG.md`、`GAME_SPEC.md`）来存放不同类别的工作记录。
3. **修改代码时，直接删除旧内容，不要保留"删除线 + 新内容"这种双写结构**。代码仓库的每个文件只保留最新版本，历史通过 GitHub commit 可以查。锚点文件也一样：删除旧内容，不要划线。这样节省空间，避免误导。

## 七、给后续 Agent 的快速上手流程

```javascript
// 1) 先读本文件
// 2) 再读仓库当前状态，确认游戏开发到哪一步
get_file_contents({ owner: "zengxiaohao123", repo: "html-game", path: "" })

// 3) 改代码：用 create_or_update_file 推 main 分支
//    必填参数：owner / repo / path / content / message / branch（固定 main）
//    注意：更新已有文件必须先 get_file_contents 拿到当前 SHA 再带上

// 4) Cloudflare 自动部署后，用 WebFetch 验证
WebFetch({ url: "https://html-game-ap9.pages.dev/" })

// 5) 改完代码不要忘了：回到本文件（AGENT_CONTEXT.md）按第六条规则同步更新
```

## 八、部署故障排查

如果 Cloudflare 网址打不开但 GitHub 有文件：
1. Cloudflare Pages 控制台 → html-game → Deployments，看最新构建是否成功
2. 如失败，查看构建日志错误（常见：路径写错、main 分支未选中、index.html 不在根目录）
3. 修复后重新 commit 触发自动重部署
