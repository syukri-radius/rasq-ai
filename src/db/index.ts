import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const url = process.env.RASQ_DB_URL ?? "file:./data/rasq.db";

function make() {
  if (url.startsWith("file:")) {
    fs.mkdirSync(path.dirname(path.resolve(url.slice("file:".length))), { recursive: true });
  }
  return drizzle(createClient({ url }), { schema });
}

export type Db = ReturnType<typeof make>;

const g = globalThis as typeof globalThis & { __rasqDb?: Db; __rasqReady?: Promise<Db> };

export const db: Db = g.__rasqDb ?? (g.__rasqDb = make());

/** Applies drizzle migrations and seed data once per process, then returns the db. */
export function getDb(): Promise<Db> {
  if (!g.__rasqReady) {
    g.__rasqReady = (async () => {
      await db.run(sql`PRAGMA foreign_keys = ON`);
      await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
      const { seed } = await import("./seed");
      await seed(db);
      return db;
    })().catch((e) => {
      g.__rasqReady = undefined;
      throw e;
    });
  }
  return g.__rasqReady;
}

export { schema };
