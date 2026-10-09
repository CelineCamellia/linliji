import { randomUUID } from 'node:crypto';

export function moderate(db, id, decision, reason, { expectedStatus } = {}) {
  if (!['approve', 'reject', 'withdraw'].includes(decision))
    throw Error('审核操作须为 approve、reject 或 withdraw');
  if (typeof reason !== 'string' || reason.trim().length < 2 || reason.length > 300)
    throw Error('请填写 2–300 字审核理由，不填写个人信息');
  db.exec('BEGIN IMMEDIATE');
  try {
    const listing = db.prepare('SELECT status FROM listings WHERE id=?').get(id);
    if (!listing) throw Error('物品不存在');
    if (expectedStatus !== undefined && listing.status !== expectedStatus)
      throw Object.assign(Error('物品状态已改变，请刷新后重新核对'), { status: 409 });
    if (
      (decision !== 'withdraw' && listing.status !== 'pending') ||
      (decision === 'withdraw' && !['available', 'pending'].includes(listing.status))
    )
      throw Error('该物品状态不支持此操作');
    const status = { approve: 'available', reject: 'rejected', withdraw: 'withdrawn' }[decision];
    db.prepare('UPDATE listings SET status=? WHERE id=?').run(status, id);
    db.prepare('INSERT INTO moderation VALUES(?,?,?,?,?)').run(
      randomUUID(),
      id,
      decision,
      reason.trim(),
      new Date().toISOString(),
    );
    db.exec('COMMIT');
    return { id, status };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
