import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { moderate } from '../server/moderation.mjs';

const path = process.env.DB_PATH;
if (!path || !existsSync(path))
  throw Error('请通过 DB_PATH 指定已经启动过的数据库；管理工具不会创建数据库');
const db = new DatabaseSync(path);
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
try {
  const [command, id, ...words] = process.argv.slice(2);
  if (command === 'pending') {
    console.log(
      JSON.stringify(
        db
          .prepare("SELECT id,data FROM listings WHERE status='pending' ORDER BY rowid")
          .all()
          .map((r) => ({ id: r.id, ...JSON.parse(r.data) })),
        null,
        2,
      ),
    );
  } else if (['approve', 'reject', 'withdraw'].includes(command)) {
    console.log(JSON.stringify(moderate(db, id, command, words.join(' '))));
  } else if (command === 'reports') {
    console.log(
      JSON.stringify(
        db
          .prepare(
            "SELECT id,listing_id,reason,created FROM reports WHERE status='open' ORDER BY created",
          )
          .all(),
        null,
        2,
      ),
    );
  } else if (command === 'close-report') {
    const result = db
      .prepare("UPDATE reports SET status='closed' WHERE id=? AND status='open'")
      .run(id || '');
    if (!result.changes) throw Error('未找到待处理举报');
    console.log('举报已处理');
  } else
    throw Error(
      '用法：node scripts/admin.mjs pending | approve/reject/withdraw <物品ID> <理由> | reports | close-report <举报ID>',
    );
} finally {
  db.close();
}
