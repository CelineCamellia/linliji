import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Busboy from 'busboy';
import sharp from 'sharp';

const MAX_BYTES = 5 * 1024 * 1024;
const idPattern = /^[a-f0-9-]{36}$/;
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

function readPhoto(req) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 2 },
      });
    } catch {
      req.resume();
      reject(Object.assign(new Error('请通过照片上传表单提交文件'), { status: 400 }));
      return;
    }
    let buffer, type, problem;
    const invalid = (message) => {
      problem = Object.assign(new Error(message), { status: 400 });
    };
    parser.on('file', (name, file, info) => {
      const chunks = [];
      type = info.mimeType;
      if (name !== 'photo' || !['image/jpeg', 'image/png', 'image/webp'].includes(type))
        invalid('仅支持 JPG、PNG、WebP 照片');
      file.on('limit', () => {
        problem = Object.assign(new Error('每张照片不能超过 5 MB'), { status: 413 });
      });
      file.on('data', (chunk) => {
        if (!problem) chunks.push(chunk);
      });
      file.on('end', () => {
        buffer = Buffer.concat(chunks);
      });
      file.on('error', reject);
    });
    for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'])
      parser.on(event, () => invalid('每次只上传一张照片'));
    parser.on('error', () =>
      reject(Object.assign(new Error('照片上传不完整，请重试'), { status: 400 })),
    );
    parser.on('close', () =>
      problem
        ? reject(problem)
        : buffer?.length
          ? resolve({ buffer, type })
          : reject(Object.assign(new Error('请选择照片'), { status: 400 })),
    );
    req.on('aborted', () => parser.destroy());
    req.pipe(parser);
  });
}

export function createMediaStore(db, directory) {
  mkdirSync(directory, { recursive: true });
  db.exec(`CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id TEXT REFERENCES listings(id) ON DELETE CASCADE,
    width INTEGER NOT NULL, height INTEGER NOT NULL, created TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS uploads_listing ON uploads(listing_id);`);
  const signingKey = randomBytes(32);
  let active = 0;
  const signature = (id, expires) =>
    createHmac('sha256', signingKey)
      .update(id + ':' + expires)
      .digest('hex');
  const preview = (id) => {
    const expires = Date.now() + 10 * 60_000;
    return `/api/media/${id}?expires=${expires}&signature=${signature(id, expires)}`;
  };
  return {
    directory,
    async upload(req, uid) {
      if (active >= 2) {
        req.resume();
        fail(429, '照片处理繁忙，请稍后重试');
      }
      if (
        db.prepare('SELECT count(*) n FROM uploads WHERE user_id=? AND listing_id IS NULL').get(uid)
          .n >= 32
      ) {
        req.resume();
        fail(400, '尚未发布的照片过多，请先完成发布');
      }
      active++;
      try {
        const { buffer, type } = await readPhoto(req);
        let image;
        try {
          const decoder = sharp(buffer, { limitInputPixels: 20_000_000, failOn: 'warning' });
          const metadata = await decoder.metadata();
          if (
            { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[metadata.format] !==
              type ||
            (metadata.pages || 1) !== 1
          )
            fail(400, '请上传静态 JPG、PNG 或 WebP 照片');
          image = await decoder
            .rotate()
            .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer({ resolveWithObject: true });
        } catch (error) {
          if (error.status) throw error;
          fail(400, '照片无法读取或尺寸过大，请换一张');
        }
        const id = randomUUID(),
          file = join(directory, id + '.webp');
        writeFileSync(file, image.data, { flag: 'wx', mode: 0o600 });
        try {
          db.prepare('INSERT INTO uploads VALUES(?,?,NULL,?,?,?)').run(
            id,
            uid,
            image.info.width,
            image.info.height,
            new Date().toISOString(),
          );
        } catch (error) {
          unlinkSync(file);
          throw error;
        }
        return { id, url: preview(id), width: image.info.width, height: image.info.height };
      } finally {
        active--;
      }
    },
    validate(ids = [], uid, listingId) {
      if (!Array.isArray(ids) || ids.length > 4 || new Set(ids).size !== ids.length)
        fail(400, '每条信息最多 4 张不同的照片');
      for (const id of ids) {
        if (typeof id !== 'string' || !idPattern.test(id)) fail(400, '照片编号无效');
        const photo = db.prepare('SELECT user_id,listing_id FROM uploads WHERE id=?').get(id);
        if (!photo || photo.user_id !== uid || (photo.listing_id && photo.listing_id !== listingId))
          fail(403, '只能使用自己上传且未用于其他发布的照片');
      }
      return ids;
    },
    attach(ids, uid, listingId) {
      this.validate(ids, uid, listingId);
      db.prepare('UPDATE uploads SET listing_id=NULL WHERE listing_id=?').run(listingId);
      for (const id of ids)
        db.prepare('UPDATE uploads SET listing_id=? WHERE id=? AND user_id=?').run(
          listingId,
          id,
          uid,
        );
    },
    photos(item, owner = false) {
      return (item.photos || []).flatMap((id) => {
        const photo = db
          .prepare('SELECT width,height FROM uploads WHERE id=? AND listing_id=?')
          .get(id, item.id);
        return photo ? [{ id, ...photo, url: owner ? preview(id) : '/api/media/' + id }] : [];
      });
    },
    serve(req, res, id, { admin = false } = {}) {
      if (!idPattern.test(id)) fail(404, '照片不存在');
      const row = db
        .prepare(
          'SELECT l.status FROM uploads u LEFT JOIN listings l ON l.id=u.listing_id WHERE u.id=?',
        )
        .get(id);
      if (!row) fail(404, '照片不存在');
      if (!admin && row.status !== 'available') {
        const query = new URL(req.url, 'http://localhost').searchParams;
        const expires = Number(query.get('expires')),
          supplied = query.get('signature') || '';
        if (
          !Number.isSafeInteger(expires) ||
          expires < Date.now() ||
          expires > Date.now() + 10 * 60_000 ||
          !/^[a-f0-9]{64}$/.test(supplied) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(signature(id, expires)))
        )
          fail(404, '照片未公开或已下架');
      }
      let bytes;
      try {
        bytes = readFileSync(join(directory, id + '.webp'));
      } catch {
        fail(404, '照片不存在');
      }
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': bytes.length,
      });
      res.end(bytes);
    },
    prune(now = Date.now()) {
      const cutoff = new Date(now - 86400_000).toISOString();
      db.prepare('DELETE FROM uploads WHERE listing_id IS NULL AND created<?').run(cutoff);
      let removed = 0;
      for (const filename of readdirSync(directory)) {
        const id = filename.replace(/\.webp$/, '');
        if (filename !== id + '.webp' || !idPattern.test(id)) continue;
        const file = join(directory, filename);
        if (
          statSync(file).mtimeMs < now - 86400_000 &&
          !db.prepare('SELECT id FROM uploads WHERE id=?').get(id)
        ) {
          unlinkSync(file);
          removed++;
        }
      }
      return removed;
    },
  };
}
