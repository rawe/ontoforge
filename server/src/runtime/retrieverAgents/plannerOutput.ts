import { ValidationError } from '../../core/exceptions.js';

/** Accept a JSON value or one whole JSON code fence, never extract JSON from prose. */
export function parsePlannerOutput(output: string, finishReason?: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new ValidationError(finishReason === 'length'
      ? 'Planning model reached its output limit without a visible plan. See model diagnostics.'
      : 'Planning model returned an empty plan. See model diagnostics.');
  }
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  const source = fence ? fence[1]! : trimmed;
  try {
    return JSON.parse(source);
  } catch {
    throw new ValidationError(finishReason === 'length'
      ? 'Planning model output was truncated at its token limit and is not valid JSON. See model diagnostics.'
      : 'Planning model returned invalid JSON. See model diagnostics.');
  }
}
