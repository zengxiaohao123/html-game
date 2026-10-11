/**
 * GitHub Git Data API 批量提交工具（不依赖 git 协议）
 *
 * 背景：本机 github.com:443 被网络阻断，但 api.github.com 可达，
 * 且 gh CLI 已登录（token 存于 keyring）。本脚本通过 `gh api` 取得 token，
 * 然后直接调用 REST 的 blobs/tree/commits/ref 接口完成提交，
 * 完全绕开 git smart-http 通道。
 *
 * 用法（Node 24，内置 fetch）：
 *   node tools/gh-push.mjs <repo> <branch> <commit-message> <manifest.json>
 *
 * manifest.json 结构：
 *   {
 *     "root": "要上传的本地根目录绝对路径",
 *     "files": [ { "path": "仓库内相对路径", "local": "本地相对 root 的路径或绝对路径",
 *                  "encoding": "utf-8|base64" }, ... ],
 *     "deletes": [ "要删除的仓库路径", ... ]
 *   }
 *
 * 策略：以远端分支当前 commit 为父，构造一棵新的完整 tree。
 *   - 先取远端已有 tree（递归），作为基底；
 *   - deletes 中的路径、以及被 files 覆盖的路径从基底移除；
 *   - files 逐个创建 blob，挂入 tree；
 *   - 创建 tree → commit → 更新 ref。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [repo, branch, message, manifestPath] = process.argv.slice(2);
if (!repo || !branch || !message || !manifestPath) {
  console.error('参数缺失：repo branch message manifest.json');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
const root = manifest.root || process.cwd();

// 从 gh CLI 取 token（Windows 下 .cmd 需要 shell）
function ghToken() {
  // gh auth token 输出当前活动账号 token
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', shell: true }).trim();
}
const TOKEN = ghToken();
const api = `https://api.github.com/repos/${repo}`;

async function gh(method, urlPath, body) {
  const url = urlPath.startsWith('http') ? urlPath : `${api}${urlPath}`;
  const opt = {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gh-push-tool',
    },
  };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(url, opt);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${method} ${urlPath}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

// 1. 取分支当前 commit
const ref = await gh('GET', `/git/ref/heads/${branch}`).catch(async (e) => {
  // 分支不存在时返回 404：尝试空仓库初始化
  if (String(e.message).includes('404')) return null;
  throw e;
});

let baseCommitSha = null;
let baseTree = [];
if (ref) {
  baseCommitSha = ref.object.sha;
  const commit = await gh('GET', `/git/commits/${baseCommitSha}`);
  const treeSha = commit.tree.sha;
  // 递归取整棵树
  let treeResp = await gh('GET', `/git/trees/${treeSha}?recursive=1`);
  if (treeResp.truncated) {
    throw new Error('远端 tree 被截断，文件过多，需要分页处理（当前规模不会触发）');
  }
  baseTree = treeResp.tree.filter((t) => t.type === 'blob');
}

// 2. 构造基底 path->sha 映射
//    replaceAll=true：以空树为起点（旧文件全部删除），仅保留本次 files。
const treeMap = new Map();
if (!manifest.replaceAll) {
  for (const it of baseTree) treeMap.set(it.path, it.sha);
}

// 3. 删除
const deletes = new Set(manifest.deletes || []);
for (const p of deletes) treeMap.delete(p);

// 4. 为每个本地文件创建 blob
const fileEntries = manifest.files || [];
let created = 0;
for (const f of fileEntries) {
  const local = path.isAbsolute(f.local) ? f.local : path.join(root, f.local);
  const buf = readFileSync(local);
  const content = buf.toString('base64');
  const blob = await gh('POST', '/git/blobs', { content, encoding: 'base64' });
  treeMap.set(f.path, blob.sha);
  created += 1;
  if (created % 20 === 0) console.log(`已上传 blob ${created}/${fileEntries.length}`);
}

// 5. 构造完整 tree（全量引用既有 blob sha，无需重传）
const newTreeEntries = [];
for (const [p, sha] of treeMap.entries()) {
  newTreeEntries.push({ path: p, mode: '100644', type: 'blob', sha });
}
// GitHub 单次 tree 条目上限 10000，当前工程远不到；分批保护
const chunk = 5000;
// replaceAll：首批绝不带 base_tree（tree 数组即完整快照，旧文件自然全部移除）；
// 增量模式：首批基于远端 tree，后续批次基于上一批结果。
let currentBaseTree = (!manifest.replaceAll && baseCommitSha)
  ? (await gh('GET', `/git/commits/${baseCommitSha}`)).tree.sha
  : undefined;
for (let i = 0; i < newTreeEntries.length; i += chunk) {
  const part = newTreeEntries.slice(i, i + chunk);
  const body = { tree: part };
  if (i === 0) {
    if (currentBaseTree) body.base_tree = currentBaseTree;
  } else {
    body.base_tree = currentBaseTree; // 后续批次接在前一批之后
  }
  const t = await gh('POST', '/git/trees', body);
  currentBaseTree = t.sha;
}

// 6. commit
const commitBody = {
  message,
  tree: currentBaseTree,
};
if (baseCommitSha) commitBody.parents = [baseCommitSha];
const newCommit = await gh('POST', '/git/commits', commitBody);

// 7. 更新 ref
if (ref) {
  await gh('PATCH', `/git/refs/heads/${branch}`, {
    sha: newCommit.sha,
    force: false,
  });
} else {
  await gh('POST', '/git/refs', {
    ref: `refs/heads/${branch}`,
    sha: newCommit.sha,
  });
}

console.log('OK 提交成功');
console.log('commit:', newCommit.sha);
console.log(`新增/更新 blob ${created} 个，删除 ${deletes.size} 个，tree 总条目 ${newTreeEntries.length}`);
