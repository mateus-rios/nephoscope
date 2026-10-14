import type * as Monaco from 'monaco-editor';
import { queryHints } from './hints';

type M = typeof Monaco;

const LQL_FIELDS = [
  'resource.type',
  'resource.labels.',
  'logName',
  'severity',
  'textPayload',
  'jsonPayload.',
  'jsonPayload.message',
  'protoPayload.',
  'protoPayload.methodName',
  'protoPayload.serviceName',
  'protoPayload.resourceName',
  'protoPayload.authenticationInfo.principalEmail',
  'protoPayload.status.code',
  'httpRequest.status',
  'httpRequest.requestMethod',
  'httpRequest.requestUrl',
  'httpRequest.latency',
  'httpRequest.remoteIp',
  'httpRequest.userAgent',
  'labels.',
  'timestamp',
  'receiveTimestamp',
  'trace',
  'spanId',
  'insertId',
  'operation.id',
  'sourceLocation.file',
];
const SEVERITIES = ['DEFAULT', 'DEBUG', 'INFO', 'NOTICE', 'WARNING', 'ERROR', 'CRITICAL', 'ALERT', 'EMERGENCY'];

const PROM_FUNCTIONS = [
  'rate',
  'irate',
  'increase',
  'delta',
  'idelta',
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'stddev',
  'topk',
  'bottomk',
  'quantile',
  'histogram_quantile',
  'avg_over_time',
  'max_over_time',
  'min_over_time',
  'sum_over_time',
  'count_over_time',
  'quantile_over_time',
  'absent',
  'clamp_min',
  'clamp_max',
  'label_replace',
  'abs',
  'ceil',
  'floor',
  'round',
  'by',
  'without',
  'offset',
];

const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP',
  'BY',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'HAVING',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'FULL',
  'CROSS',
  'ON',
  'USING',
  'AS',
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS',
  'NULL',
  'LIKE',
  'BETWEEN',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'WITH',
  'UNION',
  'ALL',
  'DISTINCT',
  'EXCEPT',
  'INTERSECT',
  'UNNEST',
  'STRUCT',
  'ARRAY',
  'QUALIFY',
  'WINDOW',
  'OVER',
  'PARTITION',
  'ROWS',
  'RANGE',
  'TRUE',
  'FALSE',
  'DESC',
  'ASC',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'MERGE',
  'CREATE',
  'REPLACE',
  'TABLE',
  'VIEW',
  'DROP',
  'ALTER',
  'DECLARE',
  'IF',
  'EXISTS',
  'CAST',
  'SAFE_CAST',
  'EXTRACT',
  'INTERVAL',
  'TIMESTAMP',
  'DATE',
  'DATETIME',
  'TIME',
  'NUMERIC',
  'BIGNUMERIC',
  'INT64',
  'FLOAT64',
  'STRING',
  'BYTES',
  'BOOL',
  'JSON',
  'GEOGRAPHY',
];

/** Registers LQL (Logging), PromQL and GoogleSQL with completion from `queryHints` (SPEC-0005 D-04, D-08; SPEC-0008 D-02). */
export function registerQueryLanguages(monaco: M): void {
  // ---- LQL ---------------------------------------------------------------------------------------
  monaco.languages.register({ id: 'lql' });
  monaco.languages.setLanguageConfiguration('lql', {
    comments: { lineComment: '--' },
    brackets: [['(', ')']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
    ],
  });
  monaco.languages.setMonarchTokensProvider('lql', {
    keywords: ['AND', 'OR', 'NOT'],
    severities: SEVERITIES,
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/\d+(\.\d+)?/, 'number'],
        [/[=!<>:~]+/, 'delimiter'],
        [/[A-Za-z_][\w.]*/, { cases: { '@keywords': 'keyword', '@severities': 'type', '@default': 'identifier' } }],
        [/[()]/, 'delimiter'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage);
  monaco.languages.registerCompletionItemProvider('lql', {
    triggerCharacters: ['.', '"', '='],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const K = monaco.languages.CompletionItemKind;
      const { project, logNames, resourceTypes } = queryHints.lql;
      return {
        suggestions: [
          ...LQL_FIELDS.map((f) => ({ label: f, kind: K.Field, insertText: f, range })),
          ...SEVERITIES.map((s) => ({ label: `severity>=${s}`, kind: K.EnumMember, insertText: `severity>=${s}`, range })),
          ...resourceTypes.map((t) => ({ label: `resource.type="${t}"`, kind: K.Value, insertText: `resource.type="${t}"`, range })),
          ...logNames.map((l) => ({
            label: `logName: ${l}`,
            kind: K.Value,
            insertText: `logName="projects/${project}/logs/${encodeURIComponent(l)}"`,
            range,
          })),
          ...['AND', 'OR', 'NOT'].map((k) => ({ label: k, kind: K.Keyword, insertText: `${k} `, range })),
        ],
      };
    },
  });

  // ---- PromQL ----------------------------------------------------------------------------------------
  monaco.languages.register({ id: 'promql' });
  monaco.languages.setLanguageConfiguration('promql', {
    comments: { lineComment: '#' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
    ],
  });
  monaco.languages.setMonarchTokensProvider('promql', {
    functions: PROM_FUNCTIONS,
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/\[\d+[smhdwy]\]/, 'number'],
        [/\d+(\.\d+)?/, 'number'],
        [/[A-Za-z_:][\w:]*/, { cases: { '@functions': 'keyword', '@default': 'identifier' } }],
        [/[{}()[\],]/, 'delimiter'],
        [/[=!~<>+\-*/^%]+/, 'delimiter'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage);
  monaco.languages.registerCompletionItemProvider('promql', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const K = monaco.languages.CompletionItemKind;
      return {
        suggestions: [
          ...PROM_FUNCTIONS.map((f) => ({ label: f, kind: K.Function, insertText: f, range })),
          ...queryHints.promql.metrics.map((m) => ({ label: m, kind: K.Variable, insertText: m, range })),
          ...queryHints.promql.labels.map((l) => ({ label: l, kind: K.Field, insertText: l, range })),
        ],
      };
    },
  });

  // ---- GoogleSQL ----------------------------------------------------------------------------------------
  monaco.languages.register({ id: 'googlesql' });
  monaco.languages.setLanguageConfiguration('googlesql', {
    comments: { lineComment: '--', blockComment: ['/*', '*/'] },
    brackets: [
      ['(', ')'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: "'", close: "'", notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
      { open: '`', close: '`', notIn: ['string'] },
    ],
  });
  monaco.languages.setMonarchTokensProvider('googlesql', {
    ignoreCase: true,
    keywords: SQL_KEYWORDS,
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/#.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/`[^`]*`/, 'type'],
        [/'([^'\\]|\\.)*'/, 'string'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/@@?[A-Za-z_]\w*/, 'type'],
        [/\d+(\.\d+)?/, 'number'],
        [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/[(),;.[\]]/, 'delimiter'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage);
  monaco.languages.registerCompletionItemProvider('googlesql', {
    triggerCharacters: ['.', '`'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const K = monaco.languages.CompletionItemKind;
      return {
        suggestions: [
          ...SQL_KEYWORDS.map((k) => ({ label: k, kind: K.Keyword, insertText: k, range })),
          ...queryHints.sql.tables.map((t) => ({ label: t, kind: K.Class, insertText: `\`${t}\``, range })),
          ...queryHints.sql.columns.map((c) => ({ label: c, kind: K.Field, insertText: c, range })),
        ],
      };
    },
  });
}
