export type EtaInput = {
  phase: "queued" | "sampling";
  ahead: number;
  step: number | null;
  total: number | null;
  samplingSamples: number[];
  samplingElapsedMs: number | null;
};

export function estimateEta(input: EtaInput): number | null {
  if (input.phase !== "sampling") return null;
  if (input.total && input.step != null && input.step >= input.total) return 0;
  if (
    input.step &&
    input.total &&
    input.step > 0 &&
    input.step < input.total &&
    input.samplingElapsedMs &&
    input.samplingElapsedMs > 0
  ) {
    return Math.round((input.samplingElapsedMs / input.step) * (input.total - input.step));
  }
  return null;
}
