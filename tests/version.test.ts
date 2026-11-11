import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { APP_VERSION } from "../src/lib/version";

const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), file), "utf8")) as { version?: string; packages?: Record<string, { version?: string }> };

test("the version shown in the UI is the package version", () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(readJson("package.json").version, APP_VERSION);
  const lock = readJson("package-lock.json");
  assert.equal(lock.version, APP_VERSION);
  assert.equal(lock.packages?.[""]?.version, APP_VERSION);
});
