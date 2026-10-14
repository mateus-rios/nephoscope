/**
 * Completion words for the query editors. Pages fill them from what they loaded (log names,
 * metric types, tables); the language providers read them. No Monaco import, so pages can set
 * hints without loading the editor.
 */
export const queryHints = {
  lql: { project: '', logNames: [] as string[], resourceTypes: [] as string[] },
  promql: { metrics: [] as string[], labels: [] as string[] },
  sql: { tables: [] as string[], columns: [] as string[] },
};
