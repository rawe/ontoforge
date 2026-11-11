/**
 * The language model as the assistants call it: the one FEATURE_DISABLED
 * refusal every assistant route gives without a configured model; and, for
 * a fixed pipeline, a turn's model never retried, one JSON call for a step
 * that decides (structured output — Anthropic's own output format, the
 * OpenAI-compatible `response_format` elsewhere; never a forced tool
 * choice, which current Claude models reject), and one streamed call for
 * the answer.
 */

import type { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage, type UsageMetadata } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";

import { messageEnd, type ModelCall } from "../../../assistants/index.js";
import { settings } from "../../../config.js";
import { createAiModel, cutOff, finishReason, getAiModel, modelFailure } from "../../../core/ai.js";
import { type ModelError, ValidationError } from "../../../core/exceptions.js";
import { largerUsage } from "../../../core/usage.js";

function disabled(): ValidationError {
  return new ValidationError("AI feature is disabled (AI_PROVIDER not configured)", { code: "FEATURE_DISABLED" });
}

/** The configured language model, else the FEATURE_DISABLED refusal —
 * before anything is read or streamed. */
export function requireLanguageModel(): BaseChatModel {
  const model = getAiModel();
  if (model === null) throw disabled();
  return model;
}

/** A model instance for one turn, never retried. */
export function turnModel(): BaseChatModel {
  const provider = settings.AI_PROVIDER;
  if (!provider) throw disabled();
  return createAiModel(provider, settings.AI_MODEL, settings.AI_BASE_URL, { maxRetries: 0 });
}

/** The text of a message's content. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } =>
      !!part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/** A JSON schema object for structured output: every property required,
 * no others — what both output formats accept. */
export type JsonSchema = Record<string, unknown>;

/**
 * One structured call, recorded as `call`: the model answers with JSON of
 * the schema, which is parsed and returned. A failed call fails the step
 * with the reason the provider gave (`modelFailure`), unparsable output as
 * a validation error; there is no automatic retry.
 */
export async function decide(
  model: BaseChatModel,
  call: ModelCall,
  name: string,
  schema: JsonSchema,
  system: string,
  input: string,
  signal: AbortSignal,
): Promise<unknown> {
  const bound = settings.AI_PROVIDER === "anthropic"
    ? (model as ChatAnthropic).withConfig({ outputConfig: { format: { type: "json_schema", schema } } })
    : (model as ChatOpenAI).withConfig({
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      });
  let response;
  try {
    response = await bound.invoke([new SystemMessage(system), new HumanMessage(input)], { signal });
  } catch (error) {
    await call.failed();
    signal.throwIfAborted();
    console.warn(`${name} model call failed: ${error instanceof Error ? error.message : String(error)}`);
    throw modelFailure(error);
  }
  await call.done(messageEnd(response));
  const output = contentText(response.content);
  try {
    // Some providers wrap JSON in a fence despite the format.
    return JSON.parse(output.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    throw new ValidationError(`The language model answered no readable JSON (${name}).`);
  }
}

/** One streamed call, recorded as `call` with the usage of the whole call;
 * every text delta goes to `onDelta`, and the whole text is returned. A
 * failed call fails with the reason the provider gave (`modelFailure`);
 * there is no automatic retry. An answer the model ended early fails too
 * (`cutOff`), once its stream has ended: its text was streamed, but it is
 * no answer. `detail` adds fields to the call's entry from the whole text
 * (the retriever's). */
export async function streamAnswer(
  model: BaseChatModel,
  call: ModelCall,
  system: string,
  input: string,
  signal: AbortSignal,
  onDelta: (text: string) => Promise<void>,
  detail?: (text: string) => Record<string, unknown>,
): Promise<string> {
  let output = "";
  let usage: UsageMetadata | undefined;
  let reason: string | undefined;
  let cut: ModelError | undefined;
  try {
    const stream = await model.stream([new SystemMessage(system), new HumanMessage(input)], { signal });
    for await (const chunk of stream) {
      signal.throwIfAborted();
      const delta = contentText(chunk.content);
      // A provider may report usage in parts: Anthropic the input with the
      // first chunk and the output, as a running total, with later ones.
      if (chunk.usage_metadata) usage = usage === undefined ? chunk.usage_metadata : largerUsage(usage, chunk.usage_metadata);
      // The reason an answer ended is on one chunk, not always the last: the
      // OpenAI protocol's among the chunk's response metadata, Anthropic's
      // among its additional fields.
      reason ??= finishReason(chunk.response_metadata) ?? finishReason(chunk.additional_kwargs);
      cut ??= cutOff(chunk.response_metadata) ?? cutOff(chunk.additional_kwargs);
      if (delta) {
        output += delta;
        await onDelta(delta);
      }
    }
  } catch (error) {
    await call.failed(detail?.(output));
    signal.throwIfAborted();
    console.warn(`Answer model failed: ${error instanceof Error ? error.message : String(error)}`);
    throw modelFailure(error);
  }
  // Cancelled while the last text was handed on: a cancellation, not a cut-off answer.
  signal.throwIfAborted();
  await call.done({ usage, finishReason: reason }, detail?.(output));
  if (cut !== undefined) throw cut;
  return output;
}
