import { Route } from 'lucide-react'
import type { GraphEvent } from '@/api/graphEvents'
import { chatNavigator } from '@/api/navigators'
import { graphTurns, type GraphInsight } from '@/components/assistants/graph/graphTurnModel'
import { formatDuration } from '../../conversation/chatModel'
import type { PresentationAdapter } from '../../types'
import { lensOf } from '../lens'
import { StepList } from './StepList'

/** Navigators: a fixed pipeline that follows relations and answers only from what it found, citing it. */
export const navigators: PresentationAdapter<GraphEvent, GraphInsight> = {
  kind: 'navigators',
  nouns: { one: 'Navigator', many: 'navigators' },
  icon: Route,
  send: (at, key, body, onEvent, signal) => chatNavigator(at.ontologyKey, lensOf(at), key, body, onEvent, signal),
  model: graphTurns,
  cites: true,
  details: {
    label: (turn) => {
      if (!graphTurns.hasInsight(turn.insight)) return null
      const ms = turn.insight.summary?.durationMs
      return <>Steps{ms !== undefined && <span className="text-muted-foreground/70">· {formatDuration(ms)}</span>}</>
    },
    content: (turn) => <div className="rounded-lg border p-3"><StepList turn={turn} /></div>,
  },
}
