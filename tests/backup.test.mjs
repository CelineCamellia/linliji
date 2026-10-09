import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createMediaStore } from '../server/media.mjs';
import { openDatabase } from '../server/db.mjs';

test('在线备份含未检查点的 WAL 提交，并能在独立数据库恢复读取', async () => {
  mkdirSync('.cache/tests', { recursive: true });
  const dir = mkdtempSync(resolve('.cache/tests/backup-')),
    path = join(dir, 'source.sqlite'),
    target = join(dir, 'backups');
  const db = openDatabase(path, { seedDemo: false });
  try {
    db.exec('PRAGMA wal_autocheckpoint=0');
    db.prepare('INSERT INTO users VALUES(?,?,?)').run(
      'backup-test',
      '备份测试',
      new Date().toISOString(),
    );
    const media = createMediaStore(db, join(dir, 'uploads'));
    const photo = '11111111-1111-1111-1111-111111111111';
    db.prepare('INSERT INTO uploads VALUES(?,?,NULL,?,?,?)').run(
      photo,
      'backup-test',
      10,
      10,
      new Date().toISOString(),
    );
    writeFileSync(join(media.directory, photo + '.webp'), 'test-photo-bytes');
    await promisify(execFile)(process.execPath, ['scripts/backup.mjs'], {
      cwd: resolve('.'),
      env: { ...process.env, DB_PATH: path, BACKUP_DIR: target },
    });
    const files = readdirSync(target);
    assert.equal(files.length, 1);
    const restored = new DatabaseSync(join(target, files[0], 'linliji.sqlite'), { readOnly: true });
    try {
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(
        restored.prepare('SELECT nickname FROM users WHERE id=?').get('backup-test').nickname,
        '备份测试',
      );
    } finally {
      restored.close();
    }
    const restore = join(dir, 'restored');
    await promisify(execFile)(process.execPath, [
      'scripts/restore.mjs',
      join(target, readdirSync(target)[0]),
      restore,
    ]);
    assert.equal(
      readFileSync(join(restore, 'uploads', photo + '.webp'), 'utf8'),
      'test-photo-bytes',
    );
    assert.ok(existsSync(join(restore, 'linliji.sqlite')));
    await assert.rejects(
      promisify(execFile)(process.execPath, [
        'scripts/restore.mjs',
        join(target, readdirSync(target)[0]),
        restore,
      ]),
    );
  } finally {
    db.close();
  }
});
