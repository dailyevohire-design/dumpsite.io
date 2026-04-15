/**
 * Phase 11 — A/B experiment infrastructure for Jesse's brain.
 *
 * Deterministic variant assignment: same (phone, experimentId) pair ALWAYS gets the
 * same variant. Uses MD5 hash bucketing so rollouts are stable across deploys.
 *
 * Experiment results are tracked in brain_decisions.experiment_id / experiment_variant
 * (Phase 10 schema) so you can query win rates by variant.
 */

import { createHash } from "crypto"

export interface ExperimentVariant {
  id: string
  weight: number          // 0-1, all variants must sum to 1.0
  promptModifier: string  // Appended to JESSE_PROMPT for this variant
}

export interface Experiment {
  id: string
  description: string
  variants: ExperimentVariant[]
  active: boolean
}

/**
 * Bucket a driver into one of the experiment's variants, weighted.
 * The same phone/experimentId pair always maps to the same variant.
 */
export function getVariantForDriver(phone: string, experiment: Experiment): string {
  if (!experiment.active || experiment.variants.length === 0) return "control"

  // Hash the pair to a 0-1 float
  const hash = createHash("md5").update(phone + experiment.id).digest("hex")
  const bucket = parseInt(hash.slice(0, 8), 16) / 0xffffffff // 0..1

  // Walk variants summing weights
  let cumulative = 0
  for (const v of experiment.variants) {
    cumulative += v.weight
    if (bucket < cumulative) return v.id
  }
  return experiment.variants[experiment.variants.length - 1].id
}

/** Append an experiment's variant prompt modifier to the system prompt. */
export function applyExperiment(systemPrompt: string, variantId: string, experiment: Experiment): string {
  const v = experiment.variants.find(v => v.id === variantId)
  if (!v || !v.promptModifier) return systemPrompt
  return systemPrompt + "\n\n[EXPERIMENT: " + experiment.id + " / " + variantId + "]\n" + v.promptModifier
}

/**
 * Lightweight in-code experiment registry. Use this pattern for simple prompt
 * experiments that don't warrant a DB table. Flip `.active` to deploy/retire.
 */
export const EXPERIMENTS: Record<string, Experiment> = {
  // Example: test whether explicit "never repeat yourself" instruction reduces rep rate.
  never_repeat: {
    id: "never_repeat",
    description: "Explicit anti-repetition instruction in system prompt",
    active: false, // off by default — flip to true to run
    variants: [
      { id: "control", weight: 0.5, promptModifier: "" },
      {
        id: "treatment",
        weight: 0.5,
        promptModifier: "CRITICAL: Never repeat the same opening word as your last message. Vary openings constantly.",
      },
    ],
  },
}
