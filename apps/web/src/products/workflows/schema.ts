import { workflowsSchema } from '@nephoscope/contracts/workflows-schema';

/** The Workflows syntax schema for the editor (SPEC-0003 D-10). */
export const WORKFLOW_SCHEMA = { uri: workflowsSchema.$id, schema: workflowsSchema };

/** JSON when the source starts like JSON, else YAML. */
export function sourceLanguage(source: string): 'json' | 'yaml' {
  const t = source.trimStart();
  return t.startsWith('{') || t.startsWith('[') ? 'json' : 'yaml';
}
