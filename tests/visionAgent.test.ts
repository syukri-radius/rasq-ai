import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapProposals, VisionRequest, visionEnabled, assertSafeSdkEnvironment } from '../src/lib/visionAgent/validation';
import { normalizeControls } from '../src/lib/screens';
let guardRequest: typeof import('../src/lib/visionAgent/midscene')['guardRequest'];
let modelConfig: typeof import('../src/lib/visionAgent/midscene')['modelConfig'];
process.env.RASQ_DB_URL = `file:${path.join(mkdtempSync(path.join(os.tmpdir(), 'rasq-vision-test-')), 'test.db')}`;
before(async () => { ({ guardRequest, modelConfig } = await import('../src/lib/visionAgent/midscene')); });
import { unsupportedScenario } from '../src/lib/visionAgent';
import type { Route } from '../src/lib/ai';

const proposal = { type: 'button', label: 'Sign in', x: 10, y: 20, w: 90, h: 35, confidence: 0.99, evidence: 'Model identifies visible button' };
test('vision proposals normalize with distinct provenance, bounded geometry and honest evidence', () => {
  const mapped = mapProposals({ controls: [proposal, { ...proposal, x: 1270 }] }, 1280, 800, 'midscene:provider:model');
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].source, 'vision_agent');
  assert.equal(mapped[0].aiModel, 'midscene:provider:model');
  assert.equal(mapped[0].confidence, 0.6);
  assert.match(mapped[0].evidence, /unverified/);
  assert.equal(mapped[0].locatorHash, ''); // client computes an observed dHash, never a model hash
  assert.deepEqual(normalizeControls(mapped), mapped);
  assert.throws(() => mapProposals({ controls: [{ ...proposal, type: 'invented' }] }, 1280, 800, 'model'));
  assert.throws(() => mapProposals({ controls: [{ ...proposal, x: NaN }] }, 1280, 800, 'model'));
  assert.throws(() => mapProposals({ controls: [{ ...proposal, selector: '#invented' }] }, 1280, 800, 'model'));
});
test('legacy control provenance is not rewritten', () => {
  for (const source of ['ai', 'perception', 'vision_agent']) {
    const c = mapProposals({ controls: [proposal] }, 1280, 800, 'midscene:model')[0];
    assert.equal(normalizeControls([{ ...c, source }])[0].source, source);
  }
});
test('requests require explicit screenshot consent and bounded instructions; reject client secrets/config', () => {
  const request = { url: 'https://example.com', command: 'Find buttons', consent: true };
  assert.equal(VisionRequest.safeParse(request).success, true);
  for (const patch of [{ consent: false }, { command: '' }, { command: 'x'.repeat(1501) }, { modelConfig: { key: 'secret' } }]) {
    assert.equal(VisionRequest.safeParse({ ...request, ...patch }).success, false);
  }
  assert.throws(() => unsupportedScenario(), /Phase 1/);
});
test('feature flag defaults off and requires exact adapter opt-in', () => {
  const prev = process.env.RASQ_VISION_AGENT;
  try {
    for (const v of ['', '0', 'true', '1']) { process.env.RASQ_VISION_AGENT = v; assert.equal(visionEnabled(), false); }
    process.env.RASQ_VISION_AGENT = 'midscene'; assert.equal(visionEnabled(), true);
  } finally { if (prev === undefined) delete process.env.RASQ_VISION_AGENT; else process.env.RASQ_VISION_AGENT = prev; }
});
test('vision gate reuses target policy for navigation and subrequests, rejecting private/non-http targets', async () => {
  const prev = process.env.RASQ_TARGET_ALLOW_PRIVATE;
  process.env.RASQ_TARGET_ALLOW_PRIVATE = '0';
  try {
    for (const url of ['http://127.0.0.1/', 'http://10.0.0.1/', 'http://169.254.169.254/', 'file:///etc/passwd', 'ftp://8.8.8.8/', 'http://[::1]/']) assert.equal(await guardRequest(url), false, url);
    assert.equal(await guardRequest('https://8.8.8.8/'), true);
    process.env.RASQ_TARGET_ALLOW_PRIVATE = '1';
    assert.equal(await guardRequest('http://10.0.0.1/'), true);
    assert.equal(await guardRequest('http://169.254.169.254/'), false);
  } finally { if (prev === undefined) delete process.env.RASQ_TARGET_ALLOW_PRIVATE; else process.env.RASQ_TARGET_ALLOW_PRIVATE = prev; }
});
test('server config is derived only from supported governed routes and allowlisted env names', () => {
  const route = { local: false, model: 'test-model', provider: { kind: 'openai', name: 'test', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', config: {} } } as Extract<Route, { local: false }>;
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-server-secret';
  try {
    const c = modelConfig(route);
    assert.equal(c.MIDSCENE_MODEL_NAME, 'test-model');
    assert.equal(c.MIDSCENE_MODEL_API_KEY, 'test-only-server-secret');
    for (const patch of [{ kind: 'gemini' }, { apiKeyEnv: 'RASQ_DB_URL' }, { baseUrl: 'file:///etc/passwd' }, { config: { headers: { secret: 'value' } } }]) assert.throws(() => modelConfig({ ...route, provider: { ...route.provider, ...patch } }));
    for (const file of ['src/components/VisionAgentPanel.tsx', 'src/app/(app)/scan/page.tsx', 'src/lib/visionAgent/index.ts']) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /MIDSCENE_MODEL_API_KEY|visionAgent\/midscene/);
    }
  } finally { if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev; }
});

test('request interception blocks unsafe subresources and redirect destinations before dispatch', async () => {
  const { routeSafeRequest } = await import('../src/lib/visionAgent/midscene');
  type BrowserRoute = Parameters<typeof routeSafeRequest>[0];
  const prev = process.env.RASQ_TARGET_ALLOW_PRIVATE;
  process.env.RASQ_TARGET_ALLOW_PRIVATE = '0';
  try {
    for (const [url, location, fetches, fulfilled] of [
      ['http://10.0.0.1/secret', '', 0, false],
      ['https://8.8.8.8/', 'http://169.254.169.254/latest/meta-data', 1, false],
      ['https://8.8.8.8/', 'file:///etc/passwd', 1, false],
      ['https://8.8.8.8/', '/next', 1, true],
    ] as const) {
      let requests = 0; let allowed = false; let aborted = false;
      const r = {
        request: () => ({ url: () => url }),
        fetch: async (opts: { maxRedirects: number }) => { assert.equal(opts.maxRedirects, 0); requests++; return { headers: () => ({ location }) }; },
        abort: async () => { aborted = true; },
        fulfill: async () => { allowed = true; },
      } as unknown as BrowserRoute;
      await routeSafeRequest(r);
      assert.equal(requests, fetches);
      assert.equal(allowed, fulfilled);
      assert.equal(aborted, !fulfilled);
    }
  } finally { if (prev === undefined) delete process.env.RASQ_TARGET_ALLOW_PRIVATE; else process.env.RASQ_TARGET_ALLOW_PRIVATE = prev; }
});

test('flag-off API is inert and malformed/agent requests do not start a browser', async () => {
  const { GET, POST } = await import('../src/app/api/vision-agent/route');
  const prev = process.env.RASQ_VISION_AGENT;
  try {
    delete process.env.RASQ_VISION_AGENT;
    assert.deepEqual(await (await GET(new Request('http://rasq/api/vision-agent'))).json(), { enabled: false });
    assert.equal((await POST(new Request('http://rasq/api/vision-agent', { method: 'POST', body: '{}' }))).status, 404);
    process.env.RASQ_VISION_AGENT = 'midscene';
    assert.equal((await POST(new Request('http://rasq/api/vision-agent', { method: 'POST', body: '{}' }))).status, 400);
    const machine = await POST(new Request('http://rasq/api/vision-agent', { method: 'POST', headers: { Authorization: 'Bearer invalid' } }));
    assert.ok([401, 403].includes(machine.status));
  } finally { if (prev === undefined) delete process.env.RASQ_VISION_AGENT; else process.env.RASQ_VISION_AGENT = prev; }
});

test('confirmed screen artifacts persist with vision provenance, retry safely, and feed visual test drafts', async () => {
  const { getDb, schema } = await import('../src/db');
  const { eq } = await import('drizzle-orm');
  const sharp = (await import('sharp')).default;
  const { dhash } = await import('../src/lib/perception');
  const db = await getDb();
  const [project] = await db.insert(schema.projects).values({ name: 'Vision integration fixture' }).returning();
  const cs = mapProposals({ controls: [proposal] }, 1280, 800, 'midscene:test:mock');
  cs[0].locatorHash = dhash(() => 255, cs[0].x, cs[0].y, cs[0].w, cs[0].h);
  const image = await sharp({ create: { width: 1280, height: 800, channels: 3, background: 'white' } }).png().toBuffer();
  const payload = { projectId: project.id, name: 'Synthetic vision fixture', source: 'vision_agent', width: 1280, height: 800, imageDataUrl: `data:image/png;base64,${image.toString('base64')}`, controls: cs };
  const screenRoute = await import('../src/app/api/screens/route');
  const request = (body: unknown) => new Request('http://test/api/screens', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'vision-confirmed-fixture' }, body: JSON.stringify(body) });
  const created = await screenRoute.POST(request(payload));
  assert.equal(created.status, 201);
  const screen = await created.json();
  try {
    assert.equal(screen.controls[0].source, 'vision_agent');
    assert.equal(screen.controls[0].locatorHash, cs[0].locatorHash);
    const replay = await screenRoute.POST(request(payload));
    assert.equal(replay.headers.get('idempotent-replay'), 'true');
    assert.equal((await replay.json()).id, screen.id);
    assert.equal((await screenRoute.POST(request({ ...payload, name: 'Changed body' }))).status, 409);
    const rows = await db.select().from(schema.screens).where(eq(schema.screens.projectId, project.id));
    assert.equal(rows.length, 1);
    const fetched = await (await screenRoute.GET(new Request(`http://test/api/screens?projectId=${project.id}`))).json();
    assert.equal(fetched[0].controls[0].aiModel, 'midscene:test:mock');
    const testsRoute = await import('../src/app/api/tests/route');
    const draft = await testsRoute.POST(new Request('http://test/api/tests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id, source: 'visual', screenIds: [screen.id], replace: false }) }));
    assert.equal(draft.status, 201);
    assert.ok((await draft.json()).count > 0);
    const cases = await db.select().from(schema.testCases).where(eq(schema.testCases.projectId, project.id));
    assert.ok(cases.some(c => c.steps.some(s => s.controlId === screen.controls[0].id)));
  } finally {
    unlinkSync(path.join(process.cwd(), 'data/screens', screen.imagePath));
    await db.delete(schema.projects).where(eq(schema.projects.id, project.id));
  }
});

test('SDK diagnostic modes are refused before optional runtime loading', () => {
  const prev = process.env.MIDSCENE_DANGEROUSLY_PRINT_ALL_CONFIG;
  try { process.env.MIDSCENE_DANGEROUSLY_PRINT_ALL_CONFIG = '1'; assert.throws(() => assertSafeSdkEnvironment(), /debug logging/); }
  finally { if (prev === undefined) delete process.env.MIDSCENE_DANGEROUSLY_PRINT_ALL_CONFIG; else process.env.MIDSCENE_DANGEROUSLY_PRINT_ALL_CONFIG = prev; }
});
