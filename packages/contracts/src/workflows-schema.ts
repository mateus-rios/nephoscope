/**
 * JSON Schema of the Workflows syntax, written by Nephoscope from the official syntax reference,
 * since Google publishes none (SPEC-0003 D-10, R-03). The editor validates and completes with it;
 * the deploy call stays the final check.
 */
export const WORKFLOWS_SCHEMA_VERSION = 1;

const expression = { type: 'string', pattern: '^\\$\\{[\\s\\S]*\\}$', description: 'An expression: ${...}' } as const;

export const workflowsSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://nephoscope.local/schemas/workflows.json',
  title: 'Workflows source',
  description: 'A list of steps, or a map of subworkflows where `main` is the entry point.',
  anyOf: [{ $ref: '#/definitions/steps' }, { $ref: '#/definitions/routines' }],
  definitions: {
    routines: {
      type: 'object',
      description: 'Subworkflows by name. `main` runs first and receives the execution argument.',
      properties: { main: { $ref: '#/definitions/routine' } },
      additionalProperties: { $ref: '#/definitions/routine' },
      minProperties: 1,
    },
    routine: {
      type: 'object',
      properties: {
        params: {
          type: 'array',
          description: 'Parameter names. `main` takes one, the execution argument. A map entry sets a default: - name: value',
          items: { anyOf: [{ type: 'string' }, { type: 'object', minProperties: 1, maxProperties: 1 }] },
        },
        steps: { $ref: '#/definitions/steps' },
      },
      required: ['steps'],
      additionalProperties: false,
    },
    steps: {
      type: 'array',
      description: 'Steps run in order unless a step jumps with `next`.',
      items: { $ref: '#/definitions/namedStep' },
    },
    namedStep: {
      type: 'object',
      description: 'A step: its name, then what it does.',
      minProperties: 1,
      maxProperties: 1,
      additionalProperties: { $ref: '#/definitions/step' },
    },
    step: {
      type: 'object',
      properties: {
        assign: {
          type: 'array',
          description: 'Sets variables in order. Each entry is one `name: value`.',
          items: { type: 'object', minProperties: 1, maxProperties: 1 },
        },
        call: {
          type: 'string',
          description: 'A function such as http.get, sys.log, googleapis.run.v2..., or a subworkflow name.',
        },
        args: { type: 'object', description: 'Arguments of the call.' },
        result: { type: 'string', description: 'Variable that receives the call result.' },
        next: {
          type: 'string',
          description: 'The step to run next. `end` stops the workflow; `break` and `continue` apply inside for loops.',
        },
        return: { description: 'Ends the subworkflow and returns this value.' },
        raise: { description: 'Raises an error with this value, a string or a map.' },
        switch: {
          type: 'array',
          description: 'Conditions checked in order; the first true one runs.',
          items: { $ref: '#/definitions/switchCondition' },
          minItems: 1,
        },
        for: { $ref: '#/definitions/for' },
        parallel: { $ref: '#/definitions/parallel' },
        try: {
          description: 'Steps, or a single call, whose errors go to `except` or are retried by `retry`.',
          anyOf: [{ $ref: '#/definitions/step' }],
        },
        retry: {
          description: 'A predefined policy such as ${http.default_retry}, or a custom one.',
          anyOf: [
            expression,
            {
              type: 'object',
              properties: {
                predicate: expression,
                max_retries: { anyOf: [{ type: 'integer', minimum: 0 }, expression] },
                backoff: {
                  type: 'object',
                  properties: {
                    initial_delay: { type: 'number', minimum: 0 },
                    max_delay: { type: 'number', minimum: 0 },
                    multiplier: { type: 'number', minimum: 1 },
                  },
                  additionalProperties: false,
                },
              },
              required: ['predicate', 'max_retries'],
              additionalProperties: false,
            },
          ],
        },
        except: {
          type: 'object',
          description: 'Handles an error raised in `try`.',
          properties: { as: { type: 'string', description: 'Variable that receives the error.' }, steps: { $ref: '#/definitions/steps' } },
          required: ['as', 'steps'],
          additionalProperties: false,
        },
        steps: { $ref: '#/definitions/steps' },
      },
      additionalProperties: false,
    },
    switchCondition: {
      type: 'object',
      properties: {
        condition: { anyOf: [expression, { type: 'boolean' }], description: 'An expression that is true or false.' },
        next: { type: 'string' },
        steps: { $ref: '#/definitions/steps' },
        assign: { $ref: '#/definitions/step/properties/assign' },
        return: {},
        raise: {},
        call: { type: 'string' },
        args: { type: 'object' },
        result: { type: 'string' },
      },
      required: ['condition'],
      additionalProperties: false,
    },
    for: {
      type: 'object',
      description: 'Runs its steps once per item of `in`, or per number in `range`.',
      properties: {
        value: { type: 'string', description: 'Variable with the current item.' },
        index: { type: 'string', description: 'Variable with the current position.' },
        in: { description: 'A list or an expression that gives one.' },
        range: { anyOf: [{ type: 'array', minItems: 2, maxItems: 2 }, expression], description: 'Inclusive [start, end].' },
        steps: { $ref: '#/definitions/steps' },
      },
      required: ['value', 'steps'],
      additionalProperties: false,
    },
    parallel: {
      type: 'object',
      description: 'Runs branches, or loop iterations, at the same time.',
      properties: {
        shared: { type: 'array', items: { type: 'string' }, description: 'Variables the branches may write.' },
        exception_policy: { type: 'string', enum: ['continueAll'] },
        concurrency_limit: { anyOf: [{ type: 'integer', minimum: 1 }, expression] },
        branches: {
          type: 'array',
          items: {
            type: 'object',
            minProperties: 1,
            maxProperties: 1,
            additionalProperties: {
              type: 'object',
              properties: { steps: { $ref: '#/definitions/steps' } },
              required: ['steps'],
              additionalProperties: false,
            },
          },
        },
        for: { $ref: '#/definitions/for' },
      },
      additionalProperties: false,
    },
  },
} as const;

/**
 * Line and column of a deploy error, when Google's message carries them (SPEC-0003 D-10, T-11).
 * Seen shapes: "main.yaml:5:3: ...", "(line 5, column 3)" and "at line 5 column 3".
 */
export function deployErrorPosition(message: string): { line: number; column: number | null } | null {
  const patterns = [/:(\d+):(\d+):/, /line[:\s]+(\d+),?\s*(?:col(?:umn)?[:\s]+(\d+))?/i, /\[(\d+):(\d+)\]/];
  for (const re of patterns) {
    const m = re.exec(message);
    if (m?.[1]) return { line: Number(m[1]), column: m[2] ? Number(m[2]) : null };
  }
  return null;
}
