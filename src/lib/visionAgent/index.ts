import type { InControl } from '../screens';

/** RASQ-owned DTOs. No runtime/vendor types may cross this boundary. */
export type VisionStep = { kind: 'query' | 'assert'; instruction: string; status: 'needs-review' | 'failed'; message: string; durationMs: number };
export type LiveScanSession = {
  id: string; targetUrl: string; model: string; width: number; height: number;
  imageDataUrl: string; controls: InControl[]; steps: VisionStep[];
};
export interface VisionAgentService {
  proposeControls(command: string): Promise<InControl[]>;
  runNaturalLanguageStep(assertion: string): Promise<VisionStep>;
  runNaturalLanguageScenario(steps: string[]): Promise<never>;
  exportArtifacts(): LiveScanSession;
}
export function unsupportedScenario(): never { throw new Error('Natural-language actions/scenarios are not enabled in Phase 1.'); }
