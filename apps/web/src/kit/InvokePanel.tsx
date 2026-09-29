import { type InvokeRequest, type InvokeResponse, invokeMethods } from '@nephoscope/contracts';
import { PaperPlaneRightIcon } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button } from '../design/Button';
import { CodeEditor } from '../design/code/CodeEditor';
import { Legend, type Note, Notes, Section } from '../design/Drafting';
import { ProblemState } from '../design/Feedback';
import { Field, Input, Select, Switch } from '../design/Form';
import { ApiError } from '../lib/api';
import { bytes } from '../lib/format';
import { EquivalentCommand, sh } from './EquivalentCommand';
import { KeyValueEditor } from './KeyValueEditor';

type Method = (typeof invokeMethods)[number];

interface InvokePanelProps {
  /** The resource URL, shown and used for the curl command. */
  baseUrl: string | null;
  tags: { tag: string; url: string | null }[];
  send: (req: InvokeRequest) => Promise<InvokeResponse>;
  readOnlyReason: string | null;
}

function prettyBody(res: InvokeResponse): { text: string; language: string } {
  const type = res.contentType ?? '';
  if (/json/.test(type)) {
    try {
      return { text: JSON.stringify(JSON.parse(res.body), null, 2), language: 'json' };
    } catch {
      return { text: res.body, language: 'json' };
    }
  }
  if (/html/.test(type)) return { text: res.body, language: 'html' };
  if (/xml/.test(type)) return { text: res.body, language: 'xml' };
  if (/yaml/.test(type)) return { text: res.body, language: 'yaml' };
  return { text: res.body, language: 'plaintext' };
}

function statusTone(status: number): string {
  if (status >= 500) return 'text-redline-ink';
  if (status >= 400) return 'text-warn-ink';
  if (status >= 200 && status < 300) return 'text-ok-ink';
  return 'text-ink';
}

/** Test requests to the resource's own URL (SPEC-0003 D-08, CA-16). */
export function InvokePanel({ baseUrl, tags, send, readOnlyReason }: InvokePanelProps) {
  const [method, setMethod] = useState<Method>('GET');
  const [path, setPath] = useState('/');
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const [body, setBody] = useState('');
  const [authenticate, setAuthenticate] = useState(true);
  const [tag, setTag] = useState<string>('none');
  const mutation = useMutation({ mutationFn: send });

  const hasBody = method !== 'GET' && method !== 'HEAD';
  const request: InvokeRequest = {
    method,
    path: path.startsWith('/') ? path : `/${path}`,
    headers: headers.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value })),
    body: hasBody ? body : '',
    tag: tag === 'none' ? null : tag,
    authenticate,
  };
  const target = tag === 'none' ? baseUrl : (tags.find((t) => t.tag === tag)?.url ?? null);
  const hasContentType = request.headers.some((h) => h.name.toLowerCase() === 'content-type');

  const curl = useMemo(() => {
    if (!target) return null;
    const parts = ['curl', '-i', '-X', method, sh(`${target.replace(/\/$/, '')}${request.path}`)];
    if (authenticate) parts.push('-H', `"Authorization: Bearer $(gcloud auth print-identity-token)"`);
    for (const h of request.headers) parts.push('-H', sh(`${h.name}: ${h.value}`));
    if (hasBody && body) {
      if (!hasContentType) parts.push('-H', sh('Content-Type: application/json'));
      parts.push('--data-raw', sh(body));
    }
    return parts.join(' ');
  }, [target, method, request.path, request.headers, authenticate, hasBody, body, hasContentType]);

  const res = mutation.data;
  const notes: Note[] = [];
  if (res?.authNote) notes.push({ id: 'auth', tone: 'warn', text: res.authNote });
  if (res?.truncated) notes.push({ id: 'trunc', tone: 'info', text: `The body was cut at 5 MiB of ${bytes(res.bodyBytes)} read.` });
  const pretty = res ? prettyBody(res) : null;

  return (
    <div className="flex flex-col">
      <Section title="Request" description={target ? `Sent to ${target}` : 'This resource has no URL to test.'}>
        <form
          className="flex max-w-4xl flex-col gap-4 px-6"
          onSubmit={(e) => {
            e.preventDefault();
            const withType =
              hasBody && body && !hasContentType
                ? { ...request, headers: [...request.headers, { name: 'Content-Type', value: 'application/json' }] }
                : request;
            mutation.mutate(withType);
          }}
        >
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Field label="Method">
              <Select<Method> value={method} onValueChange={setMethod} options={invokeMethods.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label="Path and query">
              <Input mono value={path} onChange={(e) => setPath(e.target.value)} placeholder="/api/items?limit=10" />
            </Field>
          </div>
          {tags.length > 0 ? (
            <Field label="Send to" className="max-w-xs">
              <Select<string>
                value={tag}
                onValueChange={setTag}
                options={[{ value: 'none', label: 'The main URL' }, ...tags.map((t) => ({ value: t.tag, label: `Tag ${t.tag}` }))]}
              />
            </Field>
          ) : null}
          <KeyValueEditor label="Headers" keyLabel="Header" rows={headers} onChange={setHeaders} />
          {hasBody ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-dense font-medium text-ink">Body</span>
              <CodeEditor value={body} onChange={setBody} language="json" height={200} label="Request body" />
              <span className="text-meta text-ink-3">Up to 1 MiB. Sent as application/json unless you set Content-Type.</span>
            </div>
          ) : null}
          <Switch
            checked={authenticate}
            onCheckedChange={setAuthenticate}
            label="Send an ID token"
            description="Nephoscope creates a token for this URL with the active profile. Needed unless the resource allows public access."
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="commit"
              icon={PaperPlaneRightIcon}
              loading={mutation.isPending}
              disabled={!target || !!readOnlyReason}
              disabledReason={readOnlyReason}
            >
              Send request
            </Button>
          </div>
          <EquivalentCommand gcloud={curl} />
        </form>
      </Section>
      {mutation.error instanceof ApiError ? <ProblemState problem={mutation.error.problem} /> : null}
      {res && pretty ? (
        <Section title="Response">
          <div className="flex flex-col gap-3 px-6">
            <p className="m-0 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-dense">
              <span className={`tnum font-mono text-[14px] font-semibold ${statusTone(res.status)}`}>
                {res.status} {res.statusText}
              </span>
              <span className="text-ink-2">
                {res.timings.totalMs} ms total, headers after {res.timings.headersMs} ms
              </span>
              <span className="text-ink-2">{bytes(res.bodyBytes)}</span>
            </p>
            <Notes notes={notes} title="Notes" />
            <details className="group">
              <summary className="cursor-pointer text-dense text-ink-2">{res.headers.length} response headers</summary>
              <dl className="m-0 mt-2 grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-4 gap-y-0.5">
                {res.headers.map(([k, v]) => (
                  <div key={`${k}:${v}`} className="contents">
                    <Legend as="dt">{k}</Legend>
                    <dd className="m-0 font-mono text-[11px] break-all text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
            {res.body ? (
              <CodeEditor value={pretty.text} language={pretty.language} readOnly height={360} label="Response body" />
            ) : (
              <p className="m-0 text-dense text-ink-3">Empty body.</p>
            )}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
