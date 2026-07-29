/**
 * Unit-test support for the AI slice: a scripted tool-calling chat model
 * (the "mock the model" seam — installed via `setAiModel`) plus the
 * canonical loaded-schema fixture used by the ported Python AI tests.
 */

import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { Runnable } from "@langchain/core/runnables";

/**
 * A fake chat model for driving agent runs: answers the scripted
 * `responses` in order (the last one repeats), records every batch of
 * messages it is invoked with, and serves a scripted structured output.
 */
export class FakeToolCallingModel extends BaseChatModel {
  responses: AIMessage[];
  /** Message batches received, one per model call. */
  calls: BaseMessage[][] = [];
  /** Tool batches bound, one per `bindTools` call. */
  boundTools: unknown[][] = [];
  /** Returned verbatim by `withStructuredOutput(...).invoke(...)`. */
  structuredOutput: unknown = null;
  private index = 0;

  constructor(responses: AIMessage[], params: BaseChatModelParams = {}) {
    super(params);
    this.responses = responses;
  }

  _llmType(): string {
    return "fake-tool-calling";
  }

  override bindTools(tools: unknown[]): this {
    this.boundTools.push(tools);
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    const message = this.responses[Math.min(this.index, this.responses.length - 1)]!;
    this.index += 1;
    return { generations: [{ text: "", message }] };
  }

  override withStructuredOutput(): Runnable<never, unknown> {
    const output = () => this.structuredOutput;
    const record = (messages: never) => {
      this.calls.push(messages as unknown as BaseMessage[]);
    };
    return {
      invoke: async (input: never) => {
        record(input);
        return output();
      },
    } as unknown as Runnable<never, unknown>;
  }
}

/** An assistant turn that calls one tool. */
export function toolCallMessage(
  name: string,
  args: Record<string, unknown>,
  id = "call-1",
): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ name, args, id, type: "tool_call" }],
  });
}
