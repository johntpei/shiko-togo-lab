import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DB_PATH = path.join(process.cwd(), "data", "app.db");

type AppDb = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  sqlite?: Database.Database;
  db?: AppDb;
};

function resolveMigrationsFolder() {
  const candidates = [
    path.join(process.cwd(), "drizzle"),
    path.join(process.cwd(), "web/drizzle"),
  ];

  const found = candidates.find((dir) =>
    fs.existsSync(path.join(dir, "meta/_journal.json")),
  );

  if (!found) {
    throw new Error("drizzle のマイグレーションフォルダが見つかりません。");
  }

  return found;
}

export function applySqlMigrations(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY NOT NULL
    )
  `);

  const applied = new Set(
    sqlite
      .prepare("SELECT filename FROM schema_migrations")
      .all()
      .map((row) => (row as { filename: string }).filename),
  );

  const sessionsExists = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
    )
    .get();

  if (sessionsExists && !applied.has("0000_crazy_amazoness.sql")) {
    sqlite
      .prepare("INSERT INTO schema_migrations (filename) VALUES (?)")
      .run("0000_crazy_amazoness.sql");
    applied.add("0000_crazy_amazoness.sql");
  }

  const folder = resolveMigrationsFolder();
  const files = fs
    .readdirSync(folder)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  sqlite.pragma("foreign_keys = OFF");
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(folder, file), "utf8");
    const apply = sqlite.transaction(() => {
      for (const statement of sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed) {
          sqlite.exec(trimmed);
        }
      }
      sqlite
        .prepare("INSERT INTO schema_migrations (filename) VALUES (?)")
        .run(file);
    });
    apply();
  }
  sqlite.pragma("foreign_keys = ON");
}

function openSqlite() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  return sqlite;
}

export function getDb() {
  if (!globalForDb.sqlite) {
    globalForDb.sqlite = openSqlite();
  }
  applySqlMigrations(globalForDb.sqlite);
  globalForDb.sqlite.pragma("foreign_keys = ON");
  if (!globalForDb.db) {
    globalForDb.db = drizzle(globalForDb.sqlite, { schema });
  }
  return globalForDb.db;
}

export function getDbPath() {
  return DB_PATH;
}
