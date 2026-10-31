/**
 * The assistant module of the web client: the one import path for every
 * page and component outside it. Inside, the pure parts (`stream/`,
 * `conversation/` models, `steps/` models) import each other by relative
 * path, so `node --test` can load them; the API clients do the same for the
 * stream reader.
 */

export {
  chatErrorText,
  threadError,
  type ChatEvent,
  type ChatRequest,
  type KindReader,
  type SharedEvent,
  type StreamError,
} from './stream/chatStream'
export {
  DEFAULT_ASSISTANT,
  formatDuration,
  hasDetail,
  type Turn,
  type TurnModel,
  type TurnStatus,
} from './conversation/chatModel'
export type { ThreadOwner } from './conversation/threadStore'
export { useAssistantConversation } from './conversation/useAssistantConversation'
export {
  AssistantChat,
  Composer,
  InsightToggle,
  Intro,
  NewConversationDialog,
  TurnView,
  type InsightView,
} from './shell/AssistantChat'
export { ToolCallPanel, ToolCallsSummary } from './steps/ToolCallPanel'
export { agentTurns, type AgentEvent } from './steps/toolCallModel'
export { adapterOf, adapters, type AdapterKind } from './adapters'
export { StepList } from './adapters/navigators/StepList'
export type { AnyAdapter, Binding, Focus, PresentationAdapter, ToolCard } from './types'
export { AssistantPanelHost } from './panel/AssistantPanelHost'
export { AskAboutButton, AssistantPanelToggle } from './panel/entryPoints'
export { useAssistantPanel, usePublishFocus } from './panel/panelContext'
export { schemaFocus } from './panel/panelModel'
