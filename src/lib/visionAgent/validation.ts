import { z } from 'zod';
import { redact } from '../ai';
import { CONTROL_TYPES } from '../types';
import { normalizeControls } from '../screens';
export const VisionRequest = z.object({
  url: z.string().min(1).max(2048), command: z.string().trim().min(1).max(1500),
  assertion: z.string().trim().max(1500).default(''), consent: z.literal(true),
}).strict();
export const ProposalSchema = z.object({ controls: z.array(z.object({
  type: z.enum(CONTROL_TYPES), label: z.string().max(120), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
  w: z.number().int().positive(), h: z.number().int().positive(), confidence: z.number().min(0).max(1), evidence: z.string().max(300),
}).strict()).max(60) }).strict();
export function mapProposals(value: unknown, width: number, height: number, model: string) {
  return normalizeControls(ProposalSchema.parse(value).controls.filter(c => c.x + c.w <= width && c.y + c.h <= height).map(c => ({
    ...c, label: redact(c.label).text, confidence: Math.min(c.confidence, 0.6), evidence: `Agent proposal (unverified): ${redact(c.evidence).text}`,
    source: 'vision_agent', aiModel: model, perceptionLabel: 'midscene:proposal', locatorHash: '',
  })));
}
export const visionEnabled = () => process.env.RASQ_VISION_AGENT === 'midscene';

/** Call before loading the optional SDK: its import-time debug hooks are not governed. */
export function assertSafeSdkEnvironment() {
  if (['DEBUG', 'MIDSCENE_DEBUG_MODEL_RESPONSE', 'MIDSCENE_DEBUG_MODEL_PROFILE', 'MIDSCENE_RECORD_MODEL_CALL', 'MIDSCENE_DANGEROUSLY_PRINT_ALL_CONFIG'].some(key => Boolean(process.env[key]))) {
    throw new Error('Disable SDK debug logging for governed Vision Agent sessions.');
  }
}
