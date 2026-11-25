import { analyze } from '../perception';
import type { InControl } from '../screens';
import type { LiveScanSession, VisionAgentService } from './index';
import { unsupportedScenario } from './index';

/** Client-only bridge to the existing optical pipeline; AI enrichment remains /api/ai/scan. */
export class ExistingPerceptionAdapter implements VisionAgentService {
  constructor(private session: LiveScanSession, private pixels: CanvasImageSource) {}
  async proposeControls(): Promise<InControl[]> {
    this.session.controls = analyze(this.pixels, this.session.width, this.session.height).candidates.filter(c => c.type !== 'unknown').map(c => ({
      ...c, label: '', evidence: c.evidence, locatorHash: c.hash, perceptionLabel: 'rasq-perception-v1', aiModel: null, source: 'perception',
    }));
    return this.session.controls;
  }
  async runNaturalLanguageStep(): Promise<never> { throw new Error('Perception does not execute natural-language instructions.'); }
  async runNaturalLanguageScenario(): Promise<never> { return unsupportedScenario(); }
  exportArtifacts() { return this.session; }
}
