import { DiffEditor as MonacoDiffEditor, Editor as MonacoEditor, type OnMount } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '../../state/session';
import { defineThemes, monaco, registerSchema } from './monaco-setup';

let themesDefined = false;

function useMonacoTheme(): string {
  const theme = useSession((s) => s.theme);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  // biome-ignore lint/correctness/useExhaustiveDependencies: the session theme is a trigger; the effect reads the DOM.
  useEffect(() => {
    if (!themesDefined) {
      defineThemes();
      themesDefined = true;
    }
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    setDark(document.documentElement.dataset.theme === 'dark');
    return () => observer.disconnect();
  }, [theme]);
  return dark ? 'nephoscope-dark' : 'nephoscope-light';
}

const baseOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: "'Martian Mono Variable', 'Martian Mono', ui-monospace, Consolas, monospace",
  fontSize: 12,
  lineHeight: 19,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line',
  tabSize: 2,
  automaticLayout: true,
  fixedOverflowWidgets: true,
  padding: { top: 8, bottom: 8 },
  scrollbar: { alwaysConsumeMouseWheel: false },
};

export interface EditorMarker {
  line: number;
  column?: number;
  message: string;
  severity?: 'error' | 'warning';
}

export interface CodeEditorProps {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: number | string;
  /** Model path; also selects the JSON or YAML schema that applies. */
  path?: string;
  markers?: EditorMarker[];
  /** Lines to select and reveal, 1-based and inclusive. */
  selection?: { startLine: number; endLine: number } | null;
  onCursorLine?: (line: number) => void;
  label: string;
  /** Validates and completes the text against this JSON Schema (YAML or JSON). */
  jsonSchema?: { uri: string; schema: unknown };
}

export function CodeEditorImpl({
  value,
  language,
  onChange,
  readOnly,
  height = 360,
  path,
  markers,
  selection,
  onCursorLine,
  label,
  jsonSchema,
}: CodeEditorProps) {
  const theme = useMonacoTheme();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  /**
   * Texts this editor reported recently. Its own edits come back as props, sometimes a render or
   * two late; reapplying one would reset the cursor and drop the keys typed since.
   */
  const emitted = useRef<string[]>([]);

  const [modelUri, setModelUri] = useState<string | null>(null);
  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    setModelUri(editor.getModel()?.uri.toString() ?? null);
    editor.onDidChangeCursorPosition((e) => onCursorLine?.(e.position.lineNumber));
  };

  useEffect(() => {
    if (!jsonSchema || !modelUri) return;
    return registerSchema(modelUri, jsonSchema.uri, jsonSchema.schema);
  }, [jsonSchema, modelUri]);

  // Outside changes (a new document, a format switch) replace the text; typing never round-trips.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === editor.getValue() || emitted.current.includes(value)) return;
    emitted.current = [];
    editor.setValue(value);
  }, [value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      'nephoscope',
      (markers ?? []).map((m) => ({
        startLineNumber: m.line,
        startColumn: m.column ?? 1,
        endLineNumber: m.line,
        endColumn: m.column ? m.column + 1 : model.getLineMaxColumn(Math.min(m.line, model.getLineCount())),
        message: m.message,
        severity: m.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
      })),
    );
  }, [markers]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !selection) return;
    const model = editor.getModel();
    if (!model) return;
    const end = Math.min(selection.endLine, model.getLineCount());
    const range = new monaco.Range(selection.startLine, 1, end, model.getLineMaxColumn(end));
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
  }, [selection]);

  return (
    <div className="overflow-hidden rounded-control border border-rule" aria-label={label} role="group">
      <MonacoEditor
        defaultValue={value}
        language={language}
        path={path}
        theme={theme}
        height={height}
        onMount={onMount}
        onChange={(v) => {
          emitted.current = [...emitted.current.slice(-49), v ?? ''];
          onChange?.(v ?? '');
        }}
        options={{ ...baseOptions, readOnly, domReadOnly: readOnly, ariaLabel: label }}
      />
    </div>
  );
}

export interface DiffEditorProps {
  original: string;
  modified: string;
  language: string;
  height?: number | string;
  label: string;
  /** Side by side when there is room; inline otherwise. */
  inline?: boolean;
}

export function DiffEditorImpl({ original, modified, language, height = 420, label, inline }: DiffEditorProps) {
  const theme = useMonacoTheme();
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  // The wrapper disposes the models before the widget lets go of them, which throws on unmount.
  // The models are kept here and released in order: detach the widget, then dispose them.
  useEffect(
    () => () => {
      const editor = diffRef.current;
      const models = editor?.getModel();
      editor?.setModel(null);
      models?.original.dispose();
      models?.modified.dispose();
    },
    [],
  );
  return (
    <div className="overflow-hidden rounded-control border border-rule" aria-label={label} role="group">
      <MonacoDiffEditor
        original={original}
        modified={modified}
        language={language}
        theme={theme}
        height={height}
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        onMount={(editor) => {
          diffRef.current = editor;
        }}
        options={{ ...baseOptions, readOnly: true, renderSideBySide: !inline, originalEditable: false, ignoreTrimWhitespace: false }}
      />
    </div>
  );
}
