import { z } from "zod";
import { CATEGORIES, CONTROL_TYPES, PRIORITIES, STEP_ACTIONS } from "./types";

export const AiScanSchema = z.object({
  controls: z
    .array(
      z.object({
        candidateId: z.string(),
        type: z.enum(CONTROL_TYPES).nullable(),
        label: z.string().max(120).catch(""),
        confidence: z.number().min(0).max(1).catch(0.5),
        evidence: z.string().max(400).catch(""),
      }),
    )
    .catch([]),
  missed: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        h: z.number().positive(),
        type: z.enum(CONTROL_TYPES),
        label: z.string().max(120).catch(""),
        confidence: z.number().min(0).max(1).catch(0.4),
        evidence: z.string().max(400).catch(""),
      }),
    )
    .catch([]),
});

export const AiRequirementsSchema = z.object({
  requirements: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string().min(1),
      acceptance: z.array(z.string()).catch([]),
      category: z.string().catch("functional"),
      ambiguity: z.string().nullable().catch(null),
    }),
  ),
});

export const StepSchema = z.object({
  order: z.number().int().catch(1),
  action: z.enum(STEP_ACTIONS),
  target: z.string().catch(""),
  controlId: z.string().nullable().catch(null),
  data: z.string().nullable().catch(null),
  expected: z.string().nullable().catch(null),
});

export const AiTestCaseSchema = z.object({
  title: z.string().min(3),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  requirementIds: z.array(z.string()).min(1),
  preconditions: z.array(z.string()).catch([]),
  testData: z.record(z.string(), z.string()).catch({}),
  steps: z.array(StepSchema).min(1),
  expected: z.string().min(3),
  assumptions: z.array(z.string()).catch([]),
});
export const AiVisualTestCaseSchema = AiTestCaseSchema.extend({
  // Visual evidence supports interaction smoke cases, not inferred business variants.
  category: z.literal("positive"),
  priority: z.literal("P2"),
  requirementIds: z.array(z.string()).max(0).catch([]),
});
export const AiTestsSchema = z.object({ testCases: z.array(z.unknown()) });

export const AiBindingsSchema = z.object({
  bindings: z
    .array(
      z.object({
        caseKey: z.string(),
        order: z.number().int(),
        controlId: z.string().nullable(),
        assertKind: z.enum(["manualReview", "screenshotChanged", "urlContains", "textVisible"]).nullable().catch(null),
        assertValue: z.string().nullable().catch(null),
      }),
    )
    .catch([]),
  notes: z.string().catch(""),
});

export const AiReportSchema = z.object({
  executiveSummary: z.string(),
  risks: z.array(z.string()).catch([]),
  recommendations: z.array(z.string()).catch([]),
});
