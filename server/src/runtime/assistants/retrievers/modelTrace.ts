/** Trace-only projection. Never pass these shortened strings back to the model. */
export const MODEL_INPUT_TRACE_CHARACTERS = 24_000;
export function modelInputTrace(systemPrompt: string, input: string) {
  const remaining = Math.max(0, MODEL_INPUT_TRACE_CHARACTERS - systemPrompt.length);
  return {
    systemPrompt,
    input: input.slice(0, remaining),
    inputTruncated: input.length > remaining,
  };
}
