import { ArrowsInIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon } from '@phosphor-icons/react';
import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { useEffect, useMemo, useState } from 'react';
import { IconButton } from '../../design/Button';
import { DelayedSkeleton } from '../../design/Feedback';
import { cn } from '../../lib/cn';
import { type GraphEdge, type GraphNode, parseWorkflow, workflowGraph } from './graph';

const elk = new ELK();

interface Placed {
  node: GraphNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

interface Routed {
  edge: GraphEdge;
  points: { x: number; y: number }[];
  label: { x: number; y: number; text: string } | null;
}

/** ELK fails on keys present with an undefined value, so absent fields are left out. */
export function toElk(n: GraphNode): ElkNode {
  if ((n.children?.length ?? 0) === 0) return { id: n.id, width: n.width, height: n.height };
  return {
    id: n.id,
    labels: [{ text: n.label, width: n.label.length * 7 + 60, height: 16 }],
    layoutOptions: { 'elk.padding': '[top=30,left=14,bottom=14,right=14]', 'elk.nodeLabels.placement': 'INSIDE V_TOP H_LEFT' },
    children: (n.children ?? []).map(toElk),
  };
}

async function layout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<{ placed: Placed[]; routed: Routed[]; width: number; height: number }> {
  const root: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '26',
      'elk.spacing.nodeNode': '22',
      'elk.spacing.edgeLabel': '4',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.padding': '[top=12,left=12,bottom=12,right=12]',
      // Edges cross containers; report them all in root coordinates.
      'elk.json.edgeCoords': 'ROOT',
    },
    children: nodes.map(toElk),
    edges: edges.map(
      (e): ElkExtendedEdge => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
        labels: e.label ? [{ text: e.label, width: Math.min(160, e.label.length * 6.2 + 6), height: 14 }] : [],
      }),
    ),
  };
  const out = await elk.layout(root);
  const byId = new Map<string, GraphNode>();
  const index = (n: GraphNode) => {
    byId.set(n.id, n);
    for (const c of n.children ?? []) index(c);
  };
  for (const n of nodes) index(n);

  const placed: Placed[] = [];
  const offsets = new Map<string, { x: number; y: number }>();
  const walk = (n: ElkNode, ox: number, oy: number, depth: number) => {
    const x = ox + (n.x ?? 0);
    const y = oy + (n.y ?? 0);
    offsets.set(n.id, { x, y });
    const g = byId.get(n.id);
    if (g) placed.push({ node: g, x, y, w: n.width ?? 0, h: n.height ?? 0, depth });
    for (const c of n.children ?? []) walk(c, x, y, depth + 1);
  };
  for (const c of out.children ?? []) walk(c, 0, 0, 0);

  const routed: Routed[] = [];
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const collectEdges = (n: ElkNode) => {
    for (const e of (n.edges ?? []) as ElkExtendedEdge[]) {
      const src = edgeById.get(e.id);
      const section = e.sections?.[0];
      if (!src || !section) continue;
      const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
      const l = e.labels?.[0];
      routed.push({ edge: src, points, label: l?.text ? { x: l.x ?? 0, y: l.y ?? 0, text: l.text } : null });
    }
    for (const c of n.children ?? []) collectEdges(c);
  };
  collectEdges(out);
  return { placed, routed, width: out.width ?? 0, height: out.height ?? 0 };
}

export interface GraphHighlight {
  /** routine/step names that ran. */
  ran: Set<string>;
  failed: Set<string>;
  current: Set<string>;
}

interface WorkflowGraphProps {
  source: string;
  highlight?: GraphHighlight;
  selected?: string | null;
  onSelect?: (node: GraphNode) => void;
  height?: number | string;
}

const keyOf = (n: GraphNode) => `${n.routine}/${n.step}`;

/** Read-only step graph, laid out with ELK (SPEC-0003 D-10, NFR-03). */
export function WorkflowGraph({ source, highlight, selected, onSelect, height = '70vh' }: WorkflowGraphProps) {
  const parsed = useMemo(() => parseWorkflow(source), [source]);
  const graph = useMemo(() => workflowGraph(parsed), [parsed]);
  const [result, setResult] = useState<Awaited<ReturnType<typeof layout>> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setFailed(null);
    layout(graph.nodes, graph.edges)
      .then((r) => !cancelled && setResult(r))
      .catch((err) => !cancelled && setFailed(String(err)));
    return () => {
      cancelled = true;
    };
  }, [graph]);

  if (parsed.error) return <p className="m-0 px-6 py-4 text-dense text-redline-ink">The source does not parse: {parsed.error}</p>;
  if (failed) return <p className="m-0 px-6 py-4 text-dense text-redline-ink">The graph could not be laid out: {failed}</p>;
  if (!result) return <DelayedSkeleton rows={6} />;

  return (
    <div className="relative border-t border-rule">
      <div className="absolute top-2 right-3 z-10 flex gap-1 rounded-control border border-rule bg-sheet p-0.5">
        <IconButton icon={MagnifyingGlassMinusIcon} label="Zoom out" size="sm" onClick={() => setScale((s) => Math.max(0.3, s - 0.15))} />
        <IconButton icon={ArrowsInIcon} label="Actual size" size="sm" onClick={() => setScale(1)} />
        <IconButton icon={MagnifyingGlassPlusIcon} label="Zoom in" size="sm" onClick={() => setScale((s) => Math.min(2, s + 0.15))} />
      </div>
      <div className="overflow-auto bg-film" style={{ height }}>
        <svg
          width={result.width * scale}
          height={result.height * scale}
          viewBox={`0 0 ${result.width} ${result.height}`}
          role="group"
          aria-label="Workflow step graph"
          className="block"
        >
          <defs>
            <marker id="nb-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="fill-ink-3" />
            </marker>
            <marker id="nb-arrow-red" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="fill-redline" />
            </marker>
          </defs>
          {result.placed
            .filter((p) => (p.node.children?.length ?? 0) > 0)
            .map((p) => {
              const n = p.node;
              const label = n.kind === 'routine' ? n.label : `${n.label} · ${n.detail ?? n.kind}`;
              if (n.kind === 'routine' || n.kind === 'branch' || n.kind === 'except') {
                return (
                  <g key={n.id}>
                    <rect
                      x={p.x}
                      y={p.y}
                      width={p.w}
                      height={p.h}
                      rx={3}
                      className={cn('fill-none', n.kind === 'routine' ? 'stroke-rule-strong' : 'stroke-rule')}
                      strokeDasharray={n.kind === 'routine' ? undefined : '4 3'}
                    />
                    <text x={p.x + 10} y={p.y + 18} className="fill-ink-2 font-mono text-[11px]">
                      {label}
                    </text>
                  </g>
                );
              }
              // Container steps (for, parallel, try, steps) are steps too: selectable, and marked when they ran.
              const k = keyOf(n);
              const bad = highlight?.failed.has(k);
              const ran = highlight?.ran.has(k);
              const isSelected = selected === n.id;
              return (
                <g
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Step ${n.label}, ${n.detail ?? n.kind}${bad ? ', failed' : ran ? ', ran' : ''}`}
                  onClick={(e) => {
                    if (e.target === e.currentTarget.firstChild || e.target === e.currentTarget.lastChild) onSelect?.(n);
                  }}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onSelect?.(n);
                    }
                  }}
                  className="outline-none focus-visible:[&>rect]:stroke-focus"
                >
                  <rect
                    x={p.x}
                    y={p.y}
                    width={p.w}
                    height={p.h}
                    rx={3}
                    className={cn('fill-none', bad ? 'stroke-redline' : ran ? 'stroke-ink-2' : 'stroke-rule', isSelected && 'stroke-focus')}
                    strokeWidth={bad || isSelected ? 2 : 1}
                    strokeDasharray={bad || ran ? undefined : '4 3'}
                  />
                  <text
                    x={p.x + 10}
                    y={p.y + 18}
                    className={cn('cursor-pointer font-mono text-[11px]', bad ? 'fill-redline-ink' : 'fill-ink-2')}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          {result.routed.map((r) => (
            <g key={r.edge.id}>
              <polyline
                points={r.points.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                className={cn(
                  'fill-none',
                  r.edge.style === 'error' ? 'stroke-redline' : r.edge.style === 'jump' ? 'stroke-ink-2' : 'stroke-ink-3',
                )}
                strokeWidth={r.edge.style === 'jump' ? 1.4 : 1}
                strokeDasharray={r.edge.style === 'call' || r.edge.style === 'loop' || r.edge.style === 'error' ? '4 3' : undefined}
                markerEnd={r.edge.style === 'error' ? 'url(#nb-arrow-red)' : 'url(#nb-arrow)'}
              />
              {r.label ? (
                <text x={r.label.x} y={r.label.y + 10} className="fill-ink-2 font-mono text-[10px]">
                  {r.label.text.length > 26 ? `${r.label.text.slice(0, 25)}…` : r.label.text}
                </text>
              ) : null}
            </g>
          ))}
          {result.placed
            .filter((p) => (p.node.children?.length ?? 0) === 0)
            .map((p) => {
              const n = p.node;
              if (n.kind === 'start' || n.kind === 'end') {
                const r = Math.min(p.w, p.h) / 2;
                return (
                  <circle
                    key={n.id}
                    cx={p.x + p.w / 2}
                    cy={p.y + p.h / 2}
                    r={r}
                    className={n.kind === 'end' ? 'fill-ink-2 stroke-ink-2' : 'fill-sheet stroke-ink-2'}
                    strokeWidth={1.2}
                  />
                );
              }
              const k = keyOf(n);
              const ran = highlight?.ran.has(k);
              const bad = highlight?.failed.has(k);
              const now = highlight?.current.has(k);
              const isSelected = selected === n.id;
              return (
                <g
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Step ${n.label}${n.detail ? `, ${n.detail}` : ''}${bad ? ', failed' : ran ? ', ran' : ''}`}
                  onClick={() => onSelect?.(n)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect?.(n);
                    }
                  }}
                  className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-focus"
                >
                  <rect
                    x={p.x}
                    y={p.y}
                    width={p.w}
                    height={p.h}
                    rx={3}
                    className={cn(
                      bad
                        ? 'fill-redline-tint stroke-redline'
                        : now
                          ? 'fill-construct-tint stroke-ink'
                          : ran
                            ? 'fill-construct-tint stroke-ink-2'
                            : 'fill-sheet stroke-rule-strong',
                      isSelected && 'stroke-focus',
                    )}
                    strokeWidth={isSelected || now ? 2 : 1}
                  />
                  <text x={p.x + 10} y={p.y + 17} className="fill-ink font-mono text-[12px]">
                    {n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label}
                  </text>
                  {n.detail ? (
                    <text x={p.x + 10} y={p.y + 31} className="fill-ink-3 text-[10px]">
                      {n.detail.length > 38 ? `${n.detail.slice(0, 37)}…` : n.detail}
                    </text>
                  ) : null}
                </g>
              );
            })}
        </svg>
      </div>
    </div>
  );
}
