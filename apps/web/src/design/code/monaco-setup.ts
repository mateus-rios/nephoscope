import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { configureMonacoYaml } from 'monaco-yaml';
import { tokenHex as token } from '../../lib/color';
import YamlWorker from './yaml.worker?worker';

/**
 * Monaco from the local package: the default loader fetches it from a CDN, which the CSP blocks
 * (SPEC-0001 D-20). Workers are bundled by Vite. This module loads only with the first editor.
 */
function createWorker(label: string): Worker {
  const worker =
    label === 'json'
      ? new JsonWorker()
      : label === 'yaml'
        ? new YamlWorker()
        : label === 'typescript' || label === 'javascript'
          ? new TsWorker()
          : new EditorWorker();
  // Monaco falls back to the main thread on a worker error and only logs a generic warning.
  worker.addEventListener('error', (e) => console.error(`Monaco ${label} worker failed: ${e.message || 'unknown error'}`));
  return worker;
}

self.MonacoEnvironment = { getWorker: (_workerId: string, label: string) => createWorker(label) };

loader.config({ monaco });

// Monaco rejects its own pending work with a "Canceled" error when an editor closes mid-computation
// (a diff, a hover). That is expected; any other rejection still surfaces.
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { name?: string; message?: string } | undefined;
  if (reason?.name === 'Canceled' && reason.message === 'Canceled') e.preventDefault();
});

export const yaml = configureMonacoYaml(monaco, { enableSchemaRequest: false, schemas: [] });

/** Firestore Security Rules, a small grammar written for Nephoscope (SPEC-0004 D-12). */
monaco.languages.register({ id: 'firestore-rules' });
monaco.languages.setLanguageConfiguration('firestore-rules', {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: "'", close: "'", notIn: ['string'] },
    { open: '"', close: '"', notIn: ['string'] },
  ],
});
monaco.languages.setMonarchTokensProvider('firestore-rules', {
  keywords: ['rules_version', 'service', 'match', 'allow', 'if', 'function', 'let', 'return', 'in', 'is', 'true', 'false', 'null'],
  methods: ['read', 'write', 'get', 'list', 'create', 'update', 'delete'],
  types: [
    'bool',
    'bytes',
    'float',
    'int',
    'latlng',
    'list',
    'map',
    'number',
    'path',
    'string',
    'timestamp',
    'duration',
    'constraint',
    'set',
  ],
  builtins: [
    'request',
    'resource',
    'exists',
    'existsAfter',
    'get',
    'getAfter',
    'debug',
    'math',
    'timestamp',
    'duration',
    'hashing',
    'latlng',
  ],
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/'([^'\\]|\\.)*'/, 'string'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/\{[a-zA-Z_][\w]*(=\*\*)?\}/, 'type'],
      [/\d+(\.\d+)?/, 'number'],
      [/[a-zA-Z_][\w.]*/, { cases: { '@keywords': 'keyword', '@methods': 'keyword', '@types': 'type', '@default': 'identifier' } }],
      [/[{}()[\],;:]/, 'delimiter'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
  },
} as monaco.languages.IMonarchLanguage);

/** Defines the two Nephoscope themes from the current token values (SPEC-0002 D-07). */
export function defineThemes(): void {
  for (const mode of ['light', 'dark'] as const) {
    const probe = document.createElement('div');
    probe.dataset.theme = mode;
    probe.hidden = true;
    document.body.appendChild(probe);
    const t = (n: string) => token(n, probe).slice(1);
    const hex = (n: string) => token(n, probe);
    monaco.editor.defineTheme(`nephoscope-${mode}`, {
      base: mode === 'dark' ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: t('ink-3'), fontStyle: 'italic' },
        { token: 'keyword', foreground: t('ink'), fontStyle: 'bold' },
        { token: 'string', foreground: t('ok-ink') },
        { token: 'string.key.json', foreground: t('construct-ink') },
        { token: 'type', foreground: t('construct-ink') },
        { token: 'number', foreground: t('warn-ink') },
        { token: 'delimiter', foreground: t('ink-2') },
      ],
      colors: {
        'editor.background': hex('sheet'),
        'editor.foreground': hex('ink'),
        'editorLineNumber.foreground': hex('ink-3'),
        'editorLineNumber.activeForeground': hex('ink'),
        'editor.lineHighlightBackground': hex('hover'),
        'editor.selectionBackground': hex('construct-tint'),
        'editorCursor.foreground': hex('ink'),
        'editorGutter.background': hex('sheet'),
        'editorWidget.background': hex('panel'),
        'editorWidget.border': hex('rule-strong'),
        'editorIndentGuide.background1': hex('rule'),
        focusBorder: hex('focus'),
        'diffEditor.insertedTextBackground': `${hex('ok-tint')}`,
        'diffEditor.removedTextBackground': `${hex('redline-tint')}`,
        'diffEditor.insertedLineBackground': `${hex('ok-tint')}`,
        'diffEditor.removedLineBackground': `${hex('redline-tint')}`,
      },
    });
    probe.remove();
  }
}

export { monaco };

const schemas = new Map<string, { uri: string; schema: unknown }>();

/** Validates one model against a JSON Schema, in YAML and in JSON (SPEC-0003 D-10). */
export function registerSchema(modelUri: string, uri: string, schema: unknown): () => void {
  schemas.set(modelUri, { uri, schema });
  apply();
  return () => {
    schemas.delete(modelUri);
    apply();
  };
}

function apply() {
  const list = [...schemas.entries()].map(([model, s]) => ({ uri: s.uri, fileMatch: [model], schema: s.schema as never }));
  yaml.update({ enableSchemaRequest: false, validate: true, completion: true, hover: true, schemas: list });
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: true, enableSchemaRequest: false, schemas: list });
}
