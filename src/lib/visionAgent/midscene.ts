import { devNull } from 'node:os';
import { runWithConsoleLogHandler, setLogDirectoryResolver } from '@midscene/shared/logger';
import { chromium, type Browser, type Page, type Route as BrowserRoute } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import { assertSafeUrl } from '../runner';
import { redact, untrusted, type Route } from '../ai';
import { allowedBaseUrl, allowedEnvName } from '../providerPolicy';
import { CONTROL_TYPES } from '../types';
import type { LiveScanSession, VisionAgentService, VisionStep } from './index';
import { unsupportedScenario } from './index';
import { assertSafeSdkEnvironment, mapProposals } from './validation';

/** Only plain OpenAI-compatible routes are supported by the Phase 1 pilot. Fail closed otherwise. */
export function modelConfig(route: Extract<Route, { local: false }>) {
  const p = route.provider;
  if (p.kind !== 'openai' || (p.config && Object.keys(p.config).length)) throw new Error('Vision Agent requires a plain OpenAI-compatible visual_scan route (no custom configuration).');
  const base = p.baseUrl || 'https://api.openai.com/v1';
  const gate = allowedBaseUrl(base);
  if (!gate.ok || !/^https?:$/.test(new URL(base).protocol) || new URL(base).username || new URL(base).password) throw new Error('Vision provider URL is not approved.');
  if (p.apiKeyEnv && !allowedEnvName(p.apiKeyEnv).ok) throw new Error('Vision provider credential name is not approved.');
  return {
    MIDSCENE_MODEL_NAME: route.model, MIDSCENE_MODEL_BASE_URL: base,
    MIDSCENE_MODEL_API_KEY: p.apiKeyEnv ? process.env[p.apiKeyEnv] ?? '' : '',
    MIDSCENE_MODEL_TIMEOUT: 45000, MIDSCENE_MODEL_RETRY_COUNT: 0,
  };
}

/** Guard every HTTP request, including redirects, frames, scripts and images; no service-worker bypass. */
export async function guardRequest(url: string): Promise<boolean> {
  try { await assertSafeUrl(url); return true; } catch { return false; }
}
/** Redirect following in the HTTP client is disabled: validate Location before the browser sees it. */
export async function routeSafeRequest(r: BrowserRoute) {
  try {
    if (!await guardRequest(r.request().url())) return await r.abort('blockedbyclient');
    const response = await r.fetch({ maxRedirects: 0, timeout: 15000 });
    const location = response.headers().location;
    if (location && !await guardRequest(new URL(location, r.request().url()).href)) return await r.abort('blockedbyclient');
    await r.fulfill({ response });
  } catch { await r.abort().catch(() => {}); }
}
// The SDK logs raw prompts/responses by default. A device is deliberately not a
// directory: SDK log streams fail closed (ENOTDIR), with no sensitive file output.
// Only this optional adapter uses Midscene in RASQ. Do not enable SDK debug logging.
setLogDirectoryResolver(() => devNull);
export class MidsceneVisionAgentAdapter implements VisionAgentService {
  private constructor(private browser: Browser, private page: Page, private agent: PlaywrightAgent, private session: LiveScanSession, private signal: AbortSignal) {}
  static async start(url: string, route: Extract<Route, { local: false }>, system: string, signal: AbortSignal) {
    assertSafeSdkEnvironment();
    const config = modelConfig(route);
    const safe = await assertSafeUrl(url);
    const browser = await chromium.launch({ headless: true });
    const abort = () => { void browser.close(); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { await browser.close(); throw new Error('Cancelled'); }
    browser.on('disconnected', () => signal.removeEventListener('abort', abort));
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: false });
      await context.route('**/*', routeSafeRequest);
      await context.routeWebSocket('**/*', socket => socket.close());
      const page = await context.newPage();
      context.on('page', p => { if (p !== page) void p.close(); });
      await page.goto(safe.toString(), { waitUntil: 'load', timeout: 20000 });
      // Freeze navigation after load so proposals and evidence share the same viewport.
      await page.route('**/*', async r => { if (r.request().isNavigationRequest()) await r.abort(); else await r.fallback(); });
      const agent = new PlaywrightAgent(page, { modelConfig: config, generateReport: false, persistExecutionDump: false, autoPrintReportMsg: false, aiContexts: { default: system }, cache: false });
      return new MidsceneVisionAgentAdapter(browser, page, agent, { id: crypto.randomUUID(), targetUrl: safe.origin + safe.pathname, model: `midscene:${route.provider.name}:${route.model}`, width: 1280, height: 800, imageDataUrl: '', controls: [], steps: [] }, signal);
    } catch (e) { await browser.close(); throw e; }
  }
  async proposeControls(command: string) {
    const start = Date.now();
    const result = await runWithConsoleLogHandler(() => {}, () => this.agent.aiQuery(`Return {controls: [{type: string, label: string, x: number, y: number, w: number, h: number, confidence: number, evidence: string}]}. Only visible controls; integer pixel boxes in 1280x800 screenshot. Types: ${CONTROL_TYPES.join(', ')}. At most 60. No invented behavior or text. Prefer general control types; a static screenshot does not prove hover, hold, realtime, gesture behavior or OS-window semantics. Use specialized types only with explicit visible evidence. ${untrusted('discovery_request', redact(command).text)}`, { domIncluded: false, abortSignal: this.signal }));
    this.session.controls = mapProposals(result, 1280, 800, this.session.model);
    this.session.steps.push({ kind: 'query', instruction: redact(command).text, status: 'needs-review', message: `${this.session.controls.length} unverified proposals`, durationMs: Date.now() - start });
    return this.session.controls;
  }
  async runNaturalLanguageStep(assertion: string): Promise<VisionStep> {
    const start = Date.now();
    const result = await runWithConsoleLogHandler(() => {}, () => this.agent.aiAssert(untrusted('assertion', redact(assertion).text), undefined, { domIncluded: false, keepRawResponse: true, abortSignal: this.signal }));
    const step: VisionStep = { kind: 'assert', instruction: redact(assertion).text, status: result?.pass ? 'needs-review' : 'failed', message: result?.pass ? 'Model supports assertion; requires human review, not a test pass.' : 'Model did not support assertion.', durationMs: Date.now() - start };
    this.session.steps.push(step); return step;
  }
  async snapshot() {
    const png = await this.page.screenshot({ type: 'png', animations: 'disabled' });
    if (png.length > 8 * 1024 * 1024) throw new Error('Vision screenshot exceeds 8 MB limit.');
    this.session.imageDataUrl = `data:image/png;base64,${png.toString('base64')}`;
  }
  async runNaturalLanguageScenario(): Promise<never> { return unsupportedScenario(); }
  exportArtifacts() { return this.session; }
  async close() { await this.browser.close(); }
}
