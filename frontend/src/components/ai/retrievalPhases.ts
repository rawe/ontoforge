/** Display names of retriever chat phases and timings. */
export const phaseNames: Record<string, string> = {
  prepare: 'Prepare search texts', plan: 'Plan question', validation: 'Validate plan', retrieve: 'Find and rank results',
  context: 'Build answer context', answer: 'Write answer', firstDelta: 'First answer text', total: 'Total',
  schemaRead: 'Read schema', dataRead: 'Read data', planModel: 'Planner model', queryEmbedding: 'Embed queries',
  candidateEmbedding: 'Embed result texts / cache', scoring: 'Calculate similarities', answerModel: 'Response model',
}
