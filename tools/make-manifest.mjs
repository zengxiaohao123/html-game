/**
 * 生成推送 manifest：收集工程中需要上传到仓库的文件。
 * 用法：node tools/make-manifest.mjs > push-manifest.json
 * 包含：index.html、README、src/**、docs/**、assets 图片/字体/音频。
 * 排除：tools（推送脚本与测试不必上线，但保留也无害——这里仅排除 node_modules/.git）
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const include = ['index.html', 'README.md', 'src', 'docs', 'assets'];
const files = [];

function walk(rel) {
  const abs = path.join(root, rel);
  const st = statSync(abs);
  if (st.isDirectory()) {
    for (const name of readdirSync(abs)) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(path.join(rel, name).split(path.sep).join('/'));
    }
  } else {
    files.push({ path: rel, local: rel, encoding: 'utf-8' });
  }
}

for (const item of include) {
  try { walk(item); } catch { /* 不存在则跳过 */ }
}

// tools 也保留（方便其他 AI 知道如何推送/测试）
walk('tools');

const manifest = { root, replaceAll: true, files, deletes: [] };
process.stdout.write(JSON.stringify(manifest, null, 1));
