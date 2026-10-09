import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { products, services, listings } from './seed.mjs';
export function openDatabase(path, { seedDemo = true } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,nickname TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,data TEXT NOT NULL,stock INTEGER NOT NULL CHECK(stock>=0));
 CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS addresses(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS cart(user_id TEXT NOT NULL REFERENCES users(id),product_id TEXT NOT NULL REFERENCES products(id),spec TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),PRIMARY KEY(user_id,product_id,spec));
 CREATE TABLE IF NOT EXISTS listings(id TEXT PRIMARY KEY,user_id TEXT,data TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'available');
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL,request_key TEXT,UNIQUE(user_id,request_key));
 CREATE TABLE IF NOT EXISTS identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(provider,subject));
 CREATE TABLE IF NOT EXISTS credentials(username TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),salt TEXT NOT NULL,password_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS consents(user_id TEXT PRIMARY KEY REFERENCES users(id),version TEXT NOT NULL,accepted TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),listing_id TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS moderation(id TEXT PRIMARY KEY,listing_id TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS catalog_contacts(kind TEXT NOT NULL,id TEXT NOT NULL,phone TEXT NOT NULL,PRIMARY KEY(kind,id));
 `);
  const mode = seedDemo ? 'demo' : 'production',
    saved = db.prepare("SELECT value FROM app_meta WHERE key='mode'").get();
  const hasOldData =
    db
      .prepare(
        'SELECT (SELECT count(*) FROM products)+(SELECT count(*) FROM users)+(SELECT count(*) FROM listings) AS n',
      )
      .get().n > 0;
  if ((saved && saved.value !== mode) || (!saved && !seedDemo && hasOldData)) {
    db.close();
    throw Error('正式与体验数据库必须分开，请配置独立 DB_PATH');
  }
  db.prepare("INSERT OR IGNORE INTO app_meta VALUES('mode',?)").run(mode);
  if (seedDemo) {
    const insert = db.prepare('INSERT OR IGNORE INTO products VALUES(?,?,?)');
    products.forEach((p) => insert.run(p.id, JSON.stringify(p), p.stock));
    const svc = db.prepare('INSERT OR IGNORE INTO services VALUES(?,?)');
    services.forEach((s) => svc.run(s.id, JSON.stringify(s)));
    const listing = db.prepare('INSERT OR IGNORE INTO listings(id,user_id,data) VALUES(?,NULL,?)');
    listings.forEach((l) => listing.run(l.id, JSON.stringify(l)));
  }
  return db;
}
