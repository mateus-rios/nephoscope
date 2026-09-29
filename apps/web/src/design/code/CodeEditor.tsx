import { lazy, Suspense } from 'react';
import { DelayedSkeleton } from '../Feedback';
import type { CodeEditorProps, DiffEditorProps } from './MonacoEditors';

// Monaco is a few megabytes: it loads with the first editor on screen, never with the shell.
const LazyCode = lazy(() => import('./MonacoEditors').then((m) => ({ default: m.CodeEditorImpl })));
const LazyDiff = lazy(() => import('./MonacoEditors').then((m) => ({ default: m.DiffEditorImpl })));

export type { CodeEditorProps, DiffEditorProps, EditorMarker } from './MonacoEditors';

export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<DelayedSkeleton rows={4} />}>
      <LazyCode {...props} />
    </Suspense>
  );
}

export function DiffEditor(props: DiffEditorProps) {
  return (
    <Suspense fallback={<DelayedSkeleton rows={4} />}>
      <LazyDiff {...props} />
    </Suspense>
  );
}

/** Extension to Monaco language id for source files. */
export function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    mts: 'typescript',
    tsx: 'typescript',
    jsx: 'javascript',
    py: 'python',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    rb: 'ruby',
    php: 'php',
    cs: 'csharp',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sh: 'shell',
    toml: 'ini',
    ini: 'ini',
    xml: 'xml',
    html: 'html',
    css: 'css',
    sql: 'sql',
    txt: 'plaintext',
    mod: 'go',
    sum: 'plaintext',
    gradle: 'java',
  };
  if (path.endsWith('Dockerfile')) return 'dockerfile';
  return map[ext] ?? 'plaintext';
}
