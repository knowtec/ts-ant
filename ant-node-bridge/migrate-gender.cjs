// migrate-gender.cjs — razširi CHECK constraint z 'U' brez izgube podatkov
const Database = require('better-sqlite3');
const db = new Database('./ant.db');
const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get();

if (!row) {
  console.log('Ni tabele sessions — nič za migrirati.');
  process.exit(0);
}
const ddl = row.sql || '';
if (ddl.includes("CHECK (gender IN ('M','F','U'))")) {
  console.log('Shema že podpira U — končano.');
  process.exit(0);
}

console.log('Migriram CHECK constraint (gender: M,F -> M,F,U)…');
db.exec(`
  BEGIN;
  CREATE TABLE sessions_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('M','F','U')),
    date TEXT NOT NULL,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER,
    peak_w REAL DEFAULT 0,
    best_wh60 REAL DEFAULT 0,
    total_wh REAL DEFAULT 0
  );
  INSERT INTO sessions_new (id,name,gender,date,start_ts,end_ts,peak_w,best_wh60,total_wh)
    SELECT id,name,
           CASE WHEN gender IN ('M','F') THEN gender ELSE 'U' END,
           date,start_ts,end_ts,peak_w,best_wh60,total_wh
    FROM sessions;
  DROP TABLE sessions;
  ALTER TABLE sessions_new RENAME TO sessions;
  CREATE INDEX IF NOT EXISTS idx_sessions_date   ON sessions(date);
  CREATE INDEX IF NOT EXISTS idx_sessions_gender ON sessions(gender);
  COMMIT;
`);
console.log('Migracija OK.');