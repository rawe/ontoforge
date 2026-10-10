import { Bot, ScanSearch, type LucideIcon } from 'lucide-react'
import type { AssistantKind } from '@/api/types'

/** Per assistant kind: its nouns and its icon, the same on every surface. */
export const ASSISTANT_KINDS: Record<AssistantKind, { one: string; many: string; icon: LucideIcon }> = {
  agents: { one: 'Agent', many: 'agents', icon: Bot },
  retrievers: { one: 'Retriever', many: 'retrievers', icon: ScanSearch },
}
