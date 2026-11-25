import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell } from "../src/lib/csv";
import { blockedReason, isPrivateHostname, isPrivateIp, privatePolicy } from "../src/lib/netGuard";
import { allowedBaseUrl, allowedEnvName } from "../src/lib/providerPolicy";
import { assertSafeUrl } from "../src/lib/runner";

// --- CSV formula injection (finding #4) ---

test("csvCell prefixes formula-leading values with a single quote", () => {
  for (const hostile of ["=cmd|'/c calc'!A1", "+SUM(A1:A2)", "-1+1", "@cmd", "\t=1+1"]) {
    const out = csvCell(hostile);
    assert.ok(out.startsWith("\"'"), `expected single-quote prefix for ${JSON.stringify(hostile)}, got ${out}`);
  }
});

test("csvCell doubles embedded quotes and handles null/undefined", () => {
  assert.equal(csvCell('she said "hi"'), '"she said ""hi"""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
  assert.equal(csvCell(42), '"42"');
});

// --- IP/host range detection (findings #1/#2) ---

test("private and reserved IP literals are detected", () => {
  for (const ip of ["10.0.0.1", "127.5.5.5", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "::ffff:192.168.0.1", "64:ff9b::1"]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private/reserved`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

test("private hostnames and well-known metadata names are detected", () => {
  assert.equal(isPrivateHostname("localhost"), true);
  assert.equal(isPrivateHostname("foo.localhost"), true);
  assert.equal(isPrivateHostname("printer.local"), true);
  assert.equal(isPrivateHostname("db.internal"), true);
  assert.equal(isPrivateHostname("metadata.google.internal"), true);
  assert.equal(isPrivateHostname("example.com"), false);
});

test("privatePolicy tri-state and loopback-only default", () => {
  assert.equal(privatePolicy(undefined), "loopback-only");
  assert.equal(privatePolicy("1"), "allow-all");
  assert.equal(privatePolicy("true"), "allow-all");
  assert.equal(privatePolicy("0"), "block-all");
  // loopback-only: loopback OK, RFC1918 blocked
  assert.equal(blockedReason("127.0.0.1", ["127.0.0.1"], undefined), null);
  assert.match(blockedReason("192.168.0.9", ["192.168.0.9"], undefined) ?? "", /private/);
  assert.match(blockedReason("10.1.2.3", ["10.1.2.3"], undefined) ?? "", /private/);
  // block-all blocks even loopback
  assert.match(blockedReason("127.0.0.1", ["127.0.0.1"], "0") ?? "", /private/);
  // allow-all permits LAN staging
  assert.equal(blockedReason("192.168.0.9", ["192.168.0.9"], "1"), null);
});

// --- Provider credential env-name policy (finding #1) ---

test("well-known provider key names are accepted; infrastructure secrets are not", () => {
  assert.equal(allowedEnvName("OPENAI_API_KEY").ok, true);
  assert.equal(allowedEnvName("ANTHROPIC_API_KEY").ok, true);
  assert.equal(allowedEnvName("OPENCODE_API_KEY").ok, true);
  for (const bad of ["AWS_SECRET_ACCESS_KEY", "RASQ_DB_URL", "DATABASE_URL", "AWS_ACCESS_KEY_ID", "AZURE_CLIENT_SECRET", "GITHUB_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS"]) {
    const verdict = allowedEnvName(bad);
    assert.equal(verdict.ok, false, `${bad} must be rejected`);
  }
  assert.equal(allowedEnvName("TOTALLY_RANDOM_PRIVATE_KEY").ok, false);
});

test("RASQ_PROVIDER_KEY_ENVS extends the allowlist but never overrides denials", () => {
  process.env.RASQ_PROVIDER_KEY_ENVS = "ACME_MODEL_KEY";
  try {
    assert.equal(allowedEnvName("ACME_MODEL_KEY").ok, true);
    assert.equal(allowedEnvName("AWS_SECRET_ACCESS_KEY").ok, false);
  } finally {
    delete process.env.RASQ_PROVIDER_KEY_ENVS;
  }
});

test("provider base URLs to private hosts are rejected unless RASQ_PROVIDERS_ALLOW_PRIVATE=1", () => {
  assert.equal(allowedBaseUrl("").ok, true);
  assert.equal(allowedBaseUrl("https://api.openai.com/v1").ok, true);
  assert.equal(allowedBaseUrl("http://127.0.0.1:11434/v1", undefined).ok, true); // loopback OK by default (Ollama)
  assert.equal(allowedBaseUrl("http://192.168.1.50:8080/v1", undefined).ok, false); // LAN blocked by default
  assert.equal(allowedBaseUrl("http://192.168.1.50:8080/v1", "1").ok, true);
  assert.equal(allowedBaseUrl("http://127.0.0.1:11434/v1", "0").ok, false);
  assert.equal(allowedBaseUrl("http://169.254.169.254/latest/meta-data", "1").ok, true); // allow-all is explicit; metadata via link-local otherwise default-blocked
  assert.equal(allowedBaseUrl("http://169.254.169.254/latest/meta-data", undefined).ok, false);
});

// --- Playwright target gate (finding #2) ---

test("assertSafeUrl enforces scheme, metadata endpoints and private ranges", async () => {
  await assert.rejects(() => assertSafeUrl("file:///etc/passwd"), /http/);
  await assert.rejects(() => assertSafeUrl("ftp://example.com/x"), /http/);
  await assert.rejects(() => assertSafeUrl("http://169.254.169.254/latest/meta-data"), /blocked|169\.254/);
  await assert.rejects(() => assertSafeUrl("http://metadata.google.internal/"), /blocked|metadata/);
  await assert.rejects(() => assertSafeUrl("http://192.168.1.10/admin"), /blocked|private/);
  await assert.rejects(() => assertSafeUrl("http://10.0.0.8/"), /blocked|private/);
  await assert.rejects(() => assertSafeUrl("http://100.64.0.1/"), /blocked|private/);
  // default policy permits loopback (local /demo-target)
  const u = await assertSafeUrl("http://127.0.0.1:3000/demo-target");
  assert.equal(u.hostname, "127.0.0.1");
});
