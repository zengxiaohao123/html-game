// GitHub API 原子 force push 脚本
// 用法：node tools/force-push-api.mjs <directory> <commit-msg>
// 依赖环境变量：GH_TOKEN（gh auth token 可用）
// 工作原理：读本地目录所有文件 → 创建 blob → 构建 tree → 创建 commit → force 更新 refs/heads/main
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, posix } from 'node:path';

const REPO = 'zengxiaohao123/html-game';
const BRANCH = 'main';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const WORKDIR = process.argv[2];
const COMMIT_MSG = process.argv[3] || 'feat(phase0): EventBus + HookDispatcher + GS schema + storage';

if (!WORKDIR) { console.error('用法: node force-push-api.mjs <directory> [commit-msg]'); process.exit(1); }
if (!TOKEN) { console.error('缺少 GH_TOKEN'); process.exit(1); }

async function ghApi(method, path, body) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`https://api.github.com${path}`, opts);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GitHub API ${method} ${path} 失败 ${r.status}: ${txt}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

// 递归收集目录下所有文件，排除 .git、node_modules 等
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.trae']);

function collectFiles(dir, baseDir) {
  const result = [];
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const fullPath = join(dir, name);
    const st = statSync(fullPath);
    const rel = posix.join(...relative(baseDir, fullPath).split(/\\/g)); // 统一用 posix 路径
    if (st.isDirectory()) {
      result.push(...collectFiles(fullPath, baseDir));
    } else {
      result.push({ path: rel, fullPath });
    }
  }
  return result;
}

async function main() {
  const baseDir = join(process.cwd(), WORKDIR);
  console.log(`📂 扫描目录: ${baseDir}`);
  const files = collectFiles(baseDir, baseDir);
  console.log(`✅ 找到 ${files.length} 个文件`);

  // 1. 获取现有 main 的 commit sha（作为 parent）
  let parentSha = null;
  try {
    const ref = await ghApi('GET', `/repos/${REPO}/git/refs/heads/${BRANCH}`);
    parentSha = ref.object.sha;
    console.log(`🌿 现有 main commit: ${parentSha}`);
  } catch {
    console.log('🌿 无现有 main commit，创建根 commit');
  }

  // 2. 对每个文件创建 blob
  const treeEntries = [];
  for (const f of files) {
    const raw = readFileSync(f.fullPath);
    const b64 = raw.toString('base64');
    const blob = await ghApi('POST', `/repos/${REPO}/git/blobs`, { content: b64, encoding: 'base64' });
    treeEntries.push({
      path: f.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
    process.stdout.write(`  📦 blob ${f.path} (${(raw.length / 1024).toFixed(1)}KB, sha=${blob.sha.slice(0, 7)})\n`);
  }

  // 3. 创建 tree
  const tree = await ghApi('POST', `/repos/${REPO}/git/trees`, { tree: treeEntries });
  console.log(`🌳 Tree 创建成功: ${tree.sha}`);

  // 4. 创建 commit
  const commitBody = {
    message: COMMIT_MSG,
    tree: tree.sha,
    author: { name: 'trae-solo-agent', email: 'solo-agent@trae.ai', date: new Date().toISOString() },
    committer: { name: 'trae-solo-agent', email: 'solo-agent@trae.ai', date: new Date().toISOString() },
  };
  if (parentSha) commitBody.parents = [parentSha];
  const commit = await ghApi('POST', `/repos/${REPO}/git/commits`, commitBody);
  console.log(`📝 Commit 创建成功: ${commit.sha}`);

  // 5. Force 更新 refs/heads/main
  const ref = await ghApi('PATCH', `/repos/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
  console.log(`🚀 refs/heads/${BRANCH} 已更新 -> ${ref.object.sha}`);

  console.log(`\n✅ Force push 完成！`);
  console.log(`   commit: ${commit.sha}`);
  console.log(`   分支: ${BRANCH}`);
  console.log(`   预览: https://html-game-ap9.pages.dev/`);
}

main().catch(e => { console.error('❌ 失败:', e.message); process.exit(1); });
