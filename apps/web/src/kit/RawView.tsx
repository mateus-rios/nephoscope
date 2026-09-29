import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { stringify } from 'yaml';
import { Button } from '../design/Button';
import { CodeEditor } from '../design/code/CodeEditor';
import { DelayedSkeleton, ProblemState } from '../design/Feedback';
import { CopyButton } from '../design/Values';
import { ApiError } from '../lib/api';
import { download } from '../lib/download';
import { useSearchState } from './urlState';

interface RawViewProps {
  value: unknown;
  /** File name without extension, for downloads. */
  fileName: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/** The raw resource, read-only, as YAML or JSON with copy and download (SPEC-0001 CA-64). */
export function RawView({ value, fileName, loading, error, onRetry }: RawViewProps) {
  const [format, setFormat] = useSearchState<'yaml' | 'json'>('format', 'yaml', ['yaml', 'json']);
  const text = useMemo(() => {
    if (value === undefined) return '';
    return format === 'yaml' ? stringify(value, { lineWidth: 0 }) : JSON.stringify(value, null, 2);
  }, [value, format]);
  if (loading) return <DelayedSkeleton rows={10} />;
  if (error instanceof ApiError) return <ProblemState problem={error.problem} onRetry={onRetry} />;
  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label="Format" className="flex overflow-hidden rounded-control border border-rule-strong">
          {(['yaml', 'json'] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={format === f}
              onClick={() => setFormat(f)}
              className={format === f ? 'bg-ink px-3 py-1 text-meta text-ink-inverse' : 'px-3 py-1 text-meta text-ink-2 hover:bg-hover'}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-1">
          <CopyButton value={text} label={`Copy ${format.toUpperCase()}`} />
          <Button
            size="sm"
            variant="ghost"
            icon={DownloadSimpleIcon}
            onClick={() =>
              download(
                `${fileName}.${format === 'yaml' ? 'yaml' : 'json'}`,
                text,
                format === 'yaml' ? 'application/yaml' : 'application/json',
              )
            }
          >
            Download
          </Button>
        </span>
      </div>
      <CodeEditor value={text} language={format} readOnly height="70vh" label={`Raw resource as ${format.toUpperCase()}`} />
    </div>
  );
}
