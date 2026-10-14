import type { LbAnnotation, LbNode, LbNodeKind, LbTopology, LoadBalancerView } from '@nephoscope/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { useEffect, useState } from 'react';
import { Section, TitleBlock } from '../../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../../design/Feedback';
import { type ResourceColumn, ResourceTable } from '../../design/ResourceTable';
import { Mono } from '../../design/Values';
import { Notes, partialNote } from '../../kit/ListControls';
import { useSearchState } from '../../kit/urlState';
import { ApiError, api } from '../../lib/api';
import { useSession } from '../../state/session';

const elk = new ELK();

const KIND_LABEL: Record<LbNodeKind, string> = {
  forwardingRule: 'Forwarding rule',
  targetProxy: 'Target proxy',
  urlMap: 'URL map',
  backendService: 'Backend service',
  backendBucket: 'Backend bucket',
  targetPool: 'Target pool',
  instanceGroup: 'Instance group',
  neg: 'Network endpoint group',
};

const ANNOTATION_LABEL: Record<LbAnnotation['kind'], string> = {
  healthCheck: 'Health check',
  certificate: 'Certificate',
  certificateMap: 'Certificate map',
  armor: 'Cloud Armor',
  edgeArmor: 'Cloud Armor (edge)',
};

const NODE_W = 230;
const nodeHeight = (n: LbNode) => 44 + n.facts.length * 16 + n.annotations.length * 20;

interface Layout {
  nodes: { node: LbNode; x: number; y: number; h: number }[];
  edges: { id: string; points: { x: number; y: number }[]; label: { x: number; y: number; text: string } | null }[];
  width: number;
  height: number;
}

async function layout(lb: LoadBalancerView): Promise<Layout> {
  const edges: ElkExtendedEdge[] = lb.edges.map((e, i) => ({
    id: `e${i}`,
    sources: [e.from],
    targets: [e.to],
    labels: e.label ? [{ text: e.label, width: Math.min(200, e.label.length * 6.2 + 6), height: 14 }] : [],
  }));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.spacing.nodeNode': '20',
      'elk.spacing.edgeLabel': '4',
      'elk.padding': '[top=12,left=12,bottom=12,right=12]',
    },
    children: lb.nodes.map((n) => ({ id: n.id, width: NODE_W, height: nodeHeight(n) })),
    edges,
  };
  const out = await elk.layout(graph);
  const byId = new Map(lb.nodes.map((n) => [n.id, n]));
  return {
    nodes: (out.children ?? []).flatMap((c) => {
      const node = byId.get(c.id);
      return node ? [{ node, x: c.x ?? 0, y: c.y ?? 0, h: c.height ?? 0 }] : [];
    }),
    edges: ((out.edges ?? []) as ElkExtendedEdge[]).flatMap((e) => {
      const s = e.sections?.[0];
      if (!s) return [];
      const l = e.labels?.[0];
      return [
        {
          id: e.id,
          points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint],
          label: l?.text ? { x: l.x ?? 0, y: l.y ?? 0, text: l.text } : null,
        },
      ];
    }),
    width: out.width ?? 0,
    height: out.height ?? 0,
  };
}

function NodeBox({ node }: { node: LbNode }) {
  const title = (
    <span className="flex flex-col">
      <span className="text-meta text-ink-2">{KIND_LABEL[node.kind]}</span>
      <span className="truncate font-mono text-[12px] font-medium text-ink">{node.name}</span>
    </span>
  );
  return (
    <div className="flex h-full flex-col gap-1 rounded-control border border-rule-strong bg-sheet px-2.5 py-2">
      {node.href ? (
        <Link to={node.href as string} className="rounded-control hover:underline">
          {title}
        </Link>
      ) : (
        title
      )}
      {node.facts.map((f) => (
        <span key={f} className="truncate font-mono text-[11px] text-ink-2">
          {f}
        </span>
      ))}
      {node.annotations.map((a) => (
        <span key={`${a.kind} ${a.name}`} className="flex min-h-5 items-center gap-1 truncate text-[11px] text-ink-2">
          <span className="shrink-0">{ANNOTATION_LABEL[a.kind]}:</span>
          {a.href ? (
            <Link to={a.href as string} className="truncate font-mono text-ink hover:underline">
              {a.name}
            </Link>
          ) : (
            <span className="truncate font-mono text-ink">{a.name}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/** The chain of one load balancer, drawn left to right with elkjs (SPEC-0008 D-09, NFR-03). */
export function TopologyGraph({ lb }: { lb: LoadBalancerView }) {
  const [result, setResult] = useState<Layout | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setResult(null);
    layout(lb)
      .then((r) => live && setResult(r))
      .catch((e: unknown) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [lb]);
  if (error) return <p className="m-0 px-6 text-dense text-redline-ink">The diagram could not be drawn: {error}</p>;
  if (!result) return <DelayedSkeleton rows={4} className="px-6" />;
  return (
    <div className="overflow-auto px-6">
      <div className="relative" style={{ width: result.width, height: result.height }}>
        <svg width={result.width} height={result.height} className="absolute inset-0" aria-hidden="true">
          <defs>
            <marker id="lb-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className="fill-ink-3" />
            </marker>
          </defs>
          {result.edges.map((e) => (
            <g key={e.id}>
              <polyline
                points={e.points.map((p) => `${p.x},${p.y}`).join(' ')}
                className="fill-none stroke-ink-3"
                markerEnd="url(#lb-arrow)"
              />
              {e.label ? (
                <text x={e.label.x} y={e.label.y + 11} className="fill-ink-2 font-mono text-[11px]">
                  {e.label.text}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
        {result.nodes.map(({ node, x, y, h }) => (
          <div key={node.id} className="absolute" style={{ left: x, top: y, width: NODE_W, height: h }}>
            <NodeBox node={node} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The same chain as text: each node and where it leads, for reading without the diagram. */
function ChainList({ lb }: { lb: LoadBalancerView }) {
  const byId = new Map(lb.nodes.map((n) => [n.id, n]));
  return (
    <ol className="m-0 flex list-decimal flex-col gap-1 pr-6 pl-12 text-dense">
      {lb.nodes.map((n) => {
        const out = lb.edges.filter((e) => e.from === n.id);
        return (
          <li key={n.id}>
            {KIND_LABEL[n.kind]} <span className="font-mono text-[12px]">{n.name}</span>
            {n.facts.length ? ` (${n.facts.join(', ')})` : ''}
            {n.annotations.length ? `; ${n.annotations.map((a) => `${ANNOTATION_LABEL[a.kind]} ${a.name}`).join(', ')}` : ''}
            {out.length
              ? `; leads to ${out.map((e) => `${byId.get(e.to)?.name ?? e.to}${e.label ? ` for ${e.label}` : ''}`).join(', ')}`
              : ''}
          </li>
        );
      })}
    </ol>
  );
}

/** Load balancers of the project and the chain behind each (SPEC-0008 D-09, L1). */
export function LoadBalancingPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const profileId = useSession((s) => s.profileId);
  const q = useQuery({
    queryKey: ['loadbalancing', profileId, projectId, 'topology'],
    queryFn: ({ signal }) => api<LbTopology>(`/api/projects/${encodeURIComponent(projectId)}/loadbalancing/topology`, { signal }),
    enabled: !!profileId,
  });
  const [selected, setSelected] = useSearchState<string>('lb', '');
  useEffect(() => {
    document.title = 'Load balancing · Nephoscope';
  }, []);
  const lbs = q.data?.loadBalancers ?? [];
  const lb = lbs.find((l) => l.id === selected) ?? lbs[0] ?? null;
  const columns: ResourceColumn<LoadBalancerView>[] = [
    {
      id: 'name',
      header: 'Load balancer',
      hideable: false,
      sortValue: (l) => l.name,
      cell: (l) => <span className={l.id === lb?.id ? 'font-semibold text-ink' : 'text-ink'}>{l.name}</span>,
    },
    { id: 'scheme', header: 'Scheme', width: '11rem', cell: (l) => l.scheme },
    { id: 'protocols', header: 'Protocols', width: '8rem', cell: (l) => l.protocols.join(', ') },
    { id: 'addresses', header: 'Front end', cell: (l) => <Mono value={l.addresses.join(', ')} /> },
    {
      id: 'backends',
      header: 'Backends',
      width: '7rem',
      align: 'right',
      cell: (l) => l.nodes.filter((n) => n.kind === 'backendService' || n.kind === 'backendBucket').length,
    },
  ];
  return (
    <div className="pb-16">
      <TitleBlock
        title="Load balancing"
        subtitle="Each load balancer from its forwarding rules to its backends, with health checks, certificates and Cloud Armor policies."
      />
      <Notes notes={partialNote(q.data?.unreachable)} />
      {q.isPending ? (
        <DelayedSkeleton />
      ) : q.error instanceof ApiError ? (
        <ProblemState problem={q.error.problem} onRetry={() => void q.refetch()} />
      ) : lbs.length === 0 ? (
        <EmptyState title="No load balancers">The project has no forwarding rules that lead to a backend.</EmptyState>
      ) : (
        <>
          <div className="pt-3">
            <ResourceTable
              tableId="lb-list"
              label="Load balancers"
              rows={lbs}
              columns={columns}
              getRowId={(l) => l.id}
              onOpen={(l) => setSelected(l.id)}
              emptyTitle="No load balancers"
            />
          </div>
          {lb ? (
            <>
              <Section
                title={lb.name}
                description="Click a resource to open it. Serverless backends open their Cloud Run service or function."
              >
                <TopologyGraph lb={lb} />
              </Section>
              <Section title="Chain as text">
                <ChainList lb={lb} />
              </Section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
