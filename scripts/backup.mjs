import { DatabaseSync, backup } from 'node:sqlite';
import {
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const source = process.env.DB_PATH;
if (!source || !existsSync(source)) throw Error('DB_PATH 必须指向已存在的数据库');
const target = resolve(process.env.BACKUP_DIR || 'server/backups');
mkdirSync(target, { recursive: true, mode: 0o700 });
const name = 'linliji-backup-' + randomUUID(),
  directory = join(target, name);
mkdirSync(directory, { mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true });
try {
  // SQLite's online backup includes committed WAL records.
  await backup(db, join(directory, 'linliji.sqlite'));
  const snapshot = new DatabaseSync(join(directory, 'linliji.sqlite'));
  try {
    snapshot.exec('PRAGMA journal_mode=DELETE');
    if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
      throw Error('备份完整性检查失败');
    const photos = snapshot.prepare("SELECT name FROM sqlite_master WHERE name='uploads'").get()
      ? snapshot.prepare('SELECT id FROM uploads').all()
      : [];
    mkdirSync(join(directory, 'uploads'));
    for (const { id } of photos) {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('照片编号异常');
      copyFileSync(
        join(dirname(resolve(source)), 'uploads', id + '.webp'),
        join(directory, 'uploads', id + '.webp'),
      );
    }
    const files = ['linliji.sqlite', ...photos.map((p) => 'uploads/' + p.id + '.webp')];
    const manifest = {
      created: new Date().toISOString(),
      files: files.map((path) => ({
        path,
        sha256: createHash('sha256')
          .update(readFileSync(join(directory, path)))
          .digest('hex'),
      })),
    };
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  } finally {
    snapshot.close();
  }
  for (const file of readdirSync(target)) {
    if (!/^linliji-backup-[a-f0-9-]{36}$/.test(file)) continue;
    const path = join(target, file);
    if (statSync(path).isDirectory() && Date.now() - statSync(path).mtimeMs > 7 * 86400000)
      rmSync(path, { recursive: true });
  }
  console.log('数据库、照片与校验清单已备份：' + directory);
} catch (error) {
  rmSync(directory, { recursive: true, force: true });
  throw error;
} finally {
  db.close();
}
