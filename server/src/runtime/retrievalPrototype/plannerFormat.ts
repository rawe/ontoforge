/** Provider-enforced plan shape; provenance and scope still require independent validation. */
const nullableString = { type: ['string', 'null'] };
const stringArray = { type: 'array', items: { type: 'string' } };
export const PLANNER_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'retrieval_plan',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['buckets', 'unsupportedReason'],
      properties: {
        unsupportedReason: nullableString,
        buckets: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['entityTypeKey', 'all', 'semanticQuery', 'softConditionIds', 'variants', 'previous', 'filters'],
            properties: {
              entityTypeKey: { type: 'string' },
              all: { type: 'boolean' },
              semanticQuery: nullableString,
              softConditionIds: stringArray,
              variants: stringArray,
              previous: {
                anyOf: [
                  { type: 'null' },
                  {
                    type: 'object', additionalProperties: false, required: ['conditionId', 'quote'],
                    properties: { conditionId: nullableString, quote: { type: 'string' } },
                  },
                ],
              },
              filters: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false, required: ['conditionId', 'value', 'quote'],
                  properties: {
                    conditionId: { type: 'string' }, quote: { type: 'string' },
                    value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
