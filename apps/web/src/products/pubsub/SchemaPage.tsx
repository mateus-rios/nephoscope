import { ArrowCounterClockwiseIcon, CheckIcon, GitCommitIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '../../design/Button';
import { ConfirmDestructive } from '../../design/ConfirmDestructive';
import { CodeEditor, DiffEditor } from '../../design/code/CodeEditor';
import { Section } from '../../design/Drafting';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select, Textarea } from '../../design/Form';
import { Dialog, MenuItem, Sheet } from '../../design/Overlays';
import { StatusGlyph } from '../../design/Status';
import { Mono, Timestamp } from '../../design/Values';
import { DetailLayout } from '../../kit/DetailLayout';
import { ApiError } from '../../lib/api';
import {
  commitSchema,
  createSchema,
  deleteRevision,
  deleteSchema,
  failed,
  rollbackSchema,
  useInvalidatePubSub,
  useSchema,
  useSchemaRevisions,
  validateMessage,
  validateSchema,
} from './api';
import { toBase64 } from './Messages';
import { usePubSubReadOnly } from './PubSubPage';

type SchemaType = 'AVRO' | 'PROTOCOL_BUFFER';
const STARTERS: Record<SchemaType, string> = {
  AVRO: '{\n  "type": "record",\n  "name": "Order",\n  "fields": [\n    { "name": "id", "type": "string" },\n    { "name": "total", "type": "double" }\n  ]\n}\n',
  PROTOCOL_BUFFER: 'syntax = "proto3";\n\nmessage Order {\n  string id = 1;\n  double total = 2;\n}\n',
};
const language = (t: string) => (t === 'AVRO' ? 'json' : 'plaintext');

function Validation({ result }: { result: { valid: boolean; message: string | null } | null }) {
  if (!result) return null;
  return result.valid ? <StatusGlyph kind="ok" label="Valid" /> : <span className="text-meta text-redline-ink">{result.message}</span>;
}

/** Create a schema (D-08), validated before it is saved. */
export function SchemaSheet({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [id, setId] = useState('');
  const [type, setType] = useState<SchemaType>('AVRO');
  const [definition, setDefinition] = useState(STARTERS.AVRO);
  const [result, setResult] = useState<{ valid: boolean; message: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidatePubSub(projectId);
  const navigate = useNavigate();
  const readOnly = usePubSubReadOnly();
  useEffect(() => {
    if (open) {
      setId('');
      setType('AVRO');
      setDefinition(STARTERS.AVRO);
      setResult(null);
    }
  }, [open]);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create schema"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="commit"
            icon={PlusIcon}
            loading={busy}
            disabled={!/^[A-Za-z][A-Za-z0-9\-_.~+%]{2,254}$/.test(id) || !!readOnly}
            disabledReason={readOnly}
            onClick={async () => {
              setBusy(true);
              try {
                const s = await createSchema(projectId, { id, type, definition });
                toast.success(`Created ${s.id}`);
                void invalidate();
                onOpenChange(false);
                void navigate({ to: `/p/${projectId}/pubsub/schemas/${encodeURIComponent(s.id)}` as string });
              } catch (err) {
                failed('Creating the schema')(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create schema
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Schema id" required>
            <Input mono value={id} onChange={(e) => setId(e.target.value)} autoFocus />
          </Field>
          <Field label="Type">
            <Select<SchemaType>
              value={type}
              onValueChange={(t) => {
                setType(t);
                setDefinition(STARTERS[t]);
                setResult(null);
              }}
              options={[
                { value: 'AVRO', label: 'Avro' },
                { value: 'PROTOCOL_BUFFER', label: 'Protocol Buffers' },
              ]}
            />
          </Field>
        </div>
        <CodeEditor value={definition} onChange={setDefinition} language={language(type)} height={320} label="Schema definition" />
        <div className="flex items-center gap-3">
          <Button
            icon={CheckIcon}
            onClick={async () =>
              setResult(
                await validateSchema(projectId, type, definition).catch((e) => ({
                  valid: false,
                  message: e instanceof ApiError ? e.problem.detail : String(e),
                })),
              )
            }
          >
            Validate definition
          </Button>
          <Validation result={result} />
        </div>
      </div>
    </Sheet>
  );
}

const TABS = [
  { key: 'definition', label: 'Definition' },
  { key: 'revisions', label: 'Revisions' },
  { key: 'validate', label: 'Validate a message' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function SchemaPage() {
  const { projectId, schema: id } = useParams({ strict: false }) as { projectId: string; schema: string };
  const schema = useSchema(projectId, id);
  const revisions = useSchemaRevisions(projectId, id);
  const readOnly = usePubSubReadOnly();
  const invalidate = useInvalidatePubSub(projectId);
  const navigate = useNavigate();
  const [committing, setCommitting] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftResult, setDraftResult] = useState<{ valid: boolean; message: string | null } | null>(null);
  const [message, setMessage] = useState('{\n  "id": "o-1",\n  "total": 12.5\n}');
  const [encoding, setEncoding] = useState<'JSON' | 'BINARY'>('JSON');
  const [messageResult, setMessageResult] = useState<{ valid: boolean; message: string | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  if (schema.isPending) return <DelayedSkeleton rows={8} className="p-6" />;
  if (schema.error instanceof ApiError || !schema.data)
    return schema.error instanceof ApiError ? <ProblemState problem={schema.error.problem} onRetry={() => void schema.refetch()} /> : null;
  const s = schema.data;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      void invalidate();
    } catch (err) {
      failed(done)(err);
    }
  };
  return (
    <>
      <DetailLayout<Tab>
        crumbs={[{ label: 'Pub/Sub', to: `/p/${projectId}/pubsub?tab=schemas` }, { label: s.id }]}
        title={s.id}
        actions={
          <Button
            variant="commit"
            icon={GitCommitIcon}
            disabled={!!readOnly}
            disabledReason={readOnly}
            onClick={() => {
              setDraft(s.definition);
              setDraftResult(null);
              setCommitting(true);
            }}
          >
            Commit a revision
          </Button>
        }
        menu={
          <MenuItem onClick={() => setDeleting(true)} disabled={!!readOnly}>
            <TrashIcon size={14} aria-hidden /> Delete schema
          </MenuItem>
        }
        cells={[
          { label: 'Type', value: s.type === 'AVRO' ? 'Avro' : 'Protocol Buffers' },
          { label: 'Revision', value: s.revisionId ?? '', mono: true },
          { label: 'Revised', value: <Timestamp iso={s.revisionCreateTime} /> },
          { label: 'Revisions', value: String(revisions.data?.length ?? '') },
        ]}
        tabs={TABS}
        defaultTab="definition"
      >
        {(tab) => {
          switch (tab) {
            case 'definition':
              return (
                <div className="px-6 pt-3">
                  <CodeEditor value={s.definition} language={language(s.type)} readOnly height="60vh" label={`Definition of ${s.id}`} />
                </div>
              );
            case 'revisions':
              return (
                <Section title="Revisions" description="Rolling back commits a copy of the older revision as the newest one.">
                  <ul className="m-0 list-none border-t border-rule p-0">
                    {(revisions.data ?? []).map((r, i) => (
                      <li key={r.revisionId ?? i} className="flex items-center gap-3 border-b border-rule px-6 py-1.5 text-dense">
                        <Mono value={r.revisionId ?? ''} />
                        <span className="text-meta text-ink-3">
                          <Timestamp iso={r.revisionCreateTime} />
                        </span>
                        {i === 0 ? <span className="text-meta text-construct-ink">Latest</span> : null}
                        <span className="ml-auto flex gap-1">
                          {i > 0 && r.revisionId ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={ArrowCounterClockwiseIcon}
                              disabled={!!readOnly}
                              onClick={() =>
                                void act(() => rollbackSchema(projectId, s.id, r.revisionId ?? ''), `Rolled back to ${r.revisionId}`)
                              }
                            >
                              Roll back to this
                            </Button>
                          ) : null}
                          {(revisions.data?.length ?? 0) > 1 && r.revisionId ? (
                            <IconButton
                              icon={TrashIcon}
                              label={`Delete revision ${r.revisionId}`}
                              size="sm"
                              disabled={!!readOnly}
                              onClick={() =>
                                void act(() => deleteRevision(projectId, s.id, r.revisionId ?? ''), `Deleted revision ${r.revisionId}`)
                              }
                            />
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
              );
            case 'validate':
              return (
                <div className="flex max-w-3xl flex-col gap-3 px-6 pt-3">
                  <Field label="Encoding">
                    <Select<'JSON' | 'BINARY'>
                      value={encoding}
                      onValueChange={setEncoding}
                      options={[
                        { value: 'JSON', label: 'JSON' },
                        { value: 'BINARY', label: 'Binary (base64)' },
                      ]}
                    />
                  </Field>
                  <Field label={encoding === 'JSON' ? 'Message as JSON' : 'Message as base64'}>
                    <Textarea mono rows={8} value={message} onChange={(e) => setMessage(e.target.value)} />
                  </Field>
                  <div className="flex items-center gap-3">
                    <Button
                      icon={CheckIcon}
                      onClick={async () =>
                        setMessageResult(
                          await validateMessage(projectId, s.id, {
                            encoding,
                            data: encoding === 'JSON' ? toBase64(message) : message.trim(),
                          }).catch((e) => ({
                            valid: false,
                            message: e instanceof ApiError ? e.problem.detail : String(e),
                          })),
                        )
                      }
                    >
                      Validate message
                    </Button>
                    <Validation result={messageResult} />
                  </div>
                </div>
              );
          }
        }}
      </DetailLayout>
      <Dialog
        open={committing}
        onOpenChange={setCommitting}
        title={`Commit a revision of ${s.id}`}
        width="xl"
        footer={
          <>
            <Button onClick={() => setCommitting(false)}>Cancel</Button>
            <Button
              icon={CheckIcon}
              onClick={async () =>
                setDraftResult(
                  await validateSchema(projectId, s.type, draft).catch((e) => ({
                    valid: false,
                    message: e instanceof ApiError ? e.problem.detail : String(e),
                  })),
                )
              }
            >
              Validate
            </Button>
            <Button
              variant="commit"
              icon={GitCommitIcon}
              disabled={draft === s.definition}
              disabledReason={draft === s.definition ? 'Nothing changed' : null}
              onClick={async () => {
                await act(() => commitSchema(projectId, s.id, s.type, draft), 'Committed a new revision');
                setCommitting(false);
              }}
            >
              Commit revision
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <CodeEditor value={draft} onChange={setDraft} language={language(s.type)} height="38vh" label="New definition" />
          <Validation result={draftResult} />
          {draft !== s.definition ? (
            <DiffEditor
              original={s.definition}
              modified={draft}
              language={language(s.type)}
              height="24vh"
              label="Changes from the latest revision"
            />
          ) : null}
        </div>
      </Dialog>
      <ConfirmDestructive
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete schema"
        consequence="Topics that use it keep their setting, but publishing to them fails until they use another schema."
        expected={s.id}
        confirmLabel="Delete schema"
        onConfirm={async (confirm) => {
          await deleteSchema(projectId, s.id, confirm);
          toast.success(`Deleted ${s.id}`);
          void invalidate();
          void navigate({ to: `/p/${projectId}/pubsub?tab=schemas` as string });
        }}
      />
    </>
  );
}
