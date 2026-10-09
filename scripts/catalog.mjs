import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { importCatalog } from '../server/catalog.mjs';
const [command, file] = process.argv.slice(2);
if (command !== 'import' || !file)
  throw Error('用法：设置 DB_PATH 后运行 node scripts/catalog.mjs import <商家资料.json>');
if (!process.env.DB_PATH || !existsSync(process.env.DB_PATH))
  throw Error('DB_PATH 必须指向已启动的正式数据库');
const db = new DatabaseSync(process.env.DB_PATH);
try {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  if (db.prepare("SELECT value FROM app_meta WHERE key='mode'").get()?.value !== 'production')
    throw Error('商家资料只能导入正式数据库');
  console.log(
    JSON.stringify(
      importCatalog(db, JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))),
    ),
  );
} finally {
  db.close();
}
