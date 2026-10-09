import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const [, , snapshot, target] = process.argv;
if (!snapshot || !target) throw Error('用法：node scripts/restore.mjs 备份目录 新的数据目录');
const source = resolve(snapshot),
  destination = resolve(target);
if (existsSync(destination)) throw Error('恢复目标必须是尚不存在的新目录，不覆盖现有数据');
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
if (
  !Array.isArray(manifest.files) ||
  !manifest.files.some((file) => file.path === 'linliji.sqlite')
)
  throw Error('备份清单无效');
for (const file of manifest.files) {
  if (!/^(linliji\.sqlite|uploads\/[a-f0-9-]{36}\.webp)$/.test(file.path))
    throw Error('备份文件路径无效');
  if (
    createHash('sha256')
      .update(readFileSync(join(source, file.path)))
      .digest('hex') !== file.sha256
  )
    throw Error('备份校验失败：' + file.path);
}
const db = new DatabaseSync(join(source, 'linliji.sqlite'), { readOnly: true });
try {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
    throw Error('数据库完整性检查失败');
} finally {
  db.close();
}
mkdirSync(join(destination, 'uploads'), { recursive: true, mode: 0o700 });
for (const file of manifest.files) {
  mkdirSync(dirname(join(destination, file.path)), { recursive: true });
  copyFileSync(join(source, file.path), join(destination, file.path));
}
console.log('已恢复到新目录：' + destination + '。切换服务前请核对备份之后的注销与下架记录。');
