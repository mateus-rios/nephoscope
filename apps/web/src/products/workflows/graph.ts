import { isMap, isPair, isScalar, isSeq, LineCounter, parseDocument, type YAMLMap, type Node as YamlNode } from 'yaml';

/**
 * The workflow as a graph of steps (SPEC-0003 D-10): sequence, jumps, switch branches, loops,
 * parallel branches, try, retry and except, and subworkflow calls. Each step keeps its line
 * range, so selecting a node selects its lines in the editor.
 */

export type StepKind =
  | 'assign'
  | 'call'
  | 'switch'
  | 'for'
  | 'parallel'
  | 'try'
  | 'steps'
  | 'return'
  | 'raise'
  | 'next'
  | 'branch'
  | 'except'
  | 'other';

export interface StepNode {
  /** routine/path/to/step, unique in the graph. */
  id: string;
  routine: string;
  name: string;
  kind: StepKind;
  /** Short description, such as the called function. */
  detail: string | null;
  lines: { start: number; end: number } | null;
  children: StepNode[];
  /** Explicit jump target (`next`), or end/break/continue. */
  next: string | null;
  /** Switch branches: condition text and target step name or inline steps. */
  cases: { condition: string; next: string | null; body: StepNode[] }[];
  /** A call to a subworkflow of this source. */
  calls: string | null;
  terminal: 'return' | 'raise' | null;
}

export interface Routine {
  name: string;
  steps: StepNode[];
  lines: { start: number; end: number } | null;
}

export interface ParsedWorkflow {
  routines: Routine[];
  error: string | null;
}

function lineRange(node: YamlNode | null | undefined, counter: LineCounter): { start: number; end: number } | null {
  const range = (node as { range?: [number, number, number] } | undefined)?.range;
  if (!range) return null;
  const start = counter.linePos(range[0]).line;
  // range[1] is the end of the value; step back over the trailing newline.
  const end = counter.linePos(Math.max(range[0], range[1] - 1)).line;
  return { start, end: Math.max(start, end) };
}

function scalarText(v: unknown): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function getIn(map: YAMLMap, key: string): YamlNode | undefined {
  for (const item of map.items) {
    if (isPair(item) && isScalar(item.key) && item.key.value === key) return item.value as YamlNode;
  }
  return undefined;
}

class Builder {
  constructor(
    private readonly counter: LineCounter,
    private readonly routineNames: Set<string>,
  ) {}

  steps(seq: YamlNode | undefined, routine: string, prefix: string): StepNode[] {
    if (!isSeq(seq)) return [];
    const out: StepNode[] = [];
    for (const item of seq.items) {
      if (!isMap(item) || item.items.length === 0) continue;
      const pair = item.items[0];
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      const name = String(pair.key.value);
      out.push(this.step(name, pair.value as YamlNode, item, routine, prefix));
    }
    return out;
  }

  private step(name: string, body: YamlNode, whole: YamlNode, routine: string, prefix: string): StepNode {
    const id = `${prefix}/${name}`;
    const node: StepNode = {
      id,
      routine,
      name,
      kind: 'other',
      detail: null,
      lines: lineRange(whole, this.counter),
      children: [],
      next: null,
      cases: [],
      calls: null,
      terminal: null,
    };
    if (!isMap(body)) return node;
    const next = getIn(body, 'next');
    if (isScalar(next)) node.next = String(next.value);
    const has = (k: string) => getIn(body, k) !== undefined;

    if (has('switch')) {
      node.kind = 'switch';
      const sw = getIn(body, 'switch');
      if (isSeq(sw)) {
        sw.items.forEach((c, i) => {
          if (!isMap(c)) return;
          const cond = getIn(c, 'condition');
          const cnext = getIn(c, 'next');
          const inner = this.steps(getIn(c, 'steps'), routine, `${id}/case${i + 1}`);
          const terminal = getIn(c, 'return') !== undefined ? 'return' : getIn(c, 'raise') !== undefined ? 'raise' : null;
          node.cases.push({
            condition: isScalar(cond) ? scalarText(cond.value) : `case ${i + 1}`,
            next: isScalar(cnext) ? String(cnext.value) : terminal === 'return' ? 'end' : null,
            body: inner,
          });
        });
      }
    } else if (has('for')) {
      node.kind = 'for';
      const f = getIn(body, 'for');
      if (isMap(f)) {
        const value = getIn(f, 'value');
        const range = getIn(f, 'range');
        const inList = getIn(f, 'in');
        node.detail = `${isScalar(value) ? value.value : 'item'} in ${range ? 'range' : isScalar(inList) ? scalarText(inList.value) : 'list'}`;
        node.children = this.steps(getIn(f, 'steps'), routine, id);
      }
    } else if (has('parallel')) {
      node.kind = 'parallel';
      const par = getIn(body, 'parallel');
      if (isMap(par)) {
        const branches = getIn(par, 'branches');
        const loop = getIn(par, 'for');
        if (isSeq(branches)) {
          for (const b of branches.items) {
            if (!isMap(b) || !isPair(b.items[0]) || !isScalar(b.items[0].key)) continue;
            const bname = String(b.items[0].key.value);
            const bbody = b.items[0].value as YamlNode;
            const branch: StepNode = {
              id: `${id}/${bname}`,
              routine,
              name: bname,
              kind: 'branch',
              detail: 'branch',
              lines: lineRange(b, this.counter),
              children: isMap(bbody) ? this.steps(getIn(bbody, 'steps'), routine, `${id}/${bname}`) : [],
              next: null,
              cases: [],
              calls: null,
              terminal: null,
            };
            node.children.push(branch);
          }
          node.detail = `${node.children.length} branches`;
        } else if (isMap(loop)) {
          node.detail = 'parallel for';
          node.children = this.steps(getIn(loop, 'steps'), routine, id);
        }
      }
    } else if (has('try')) {
      node.kind = 'try';
      const t = getIn(body, 'try');
      const retry = getIn(body, 'retry');
      node.detail = retry ? 'try with retry' : 'try';
      if (isMap(t)) {
        const inner = getIn(t, 'steps');
        node.children = inner ? this.steps(inner, routine, id) : [this.step('call', t, t, routine, id)];
      }
      const ex = getIn(body, 'except');
      if (isMap(ex)) {
        node.children.push({
          id: `${id}/except`,
          routine,
          name: 'except',
          kind: 'except',
          detail: 'on error',
          lines: lineRange(ex, this.counter),
          children: this.steps(getIn(ex, 'steps'), routine, `${id}/except`),
          next: null,
          cases: [],
          calls: null,
          terminal: null,
        });
      }
    } else if (has('steps')) {
      node.kind = 'steps';
      node.children = this.steps(getIn(body, 'steps'), routine, id);
    } else if (has('call')) {
      node.kind = 'call';
      const call = getIn(body, 'call');
      const fn = isScalar(call) ? String(call.value) : '';
      node.detail = fn;
      if (this.routineNames.has(fn)) node.calls = fn;
    } else if (has('assign')) {
      node.kind = 'assign';
      const a = getIn(body, 'assign');
      node.detail = isSeq(a) ? `${a.items.length} ${a.items.length === 1 ? 'variable' : 'variables'}` : null;
    } else if (has('return')) {
      node.kind = 'return';
    } else if (has('raise')) {
      node.kind = 'raise';
    } else if (has('next')) {
      node.kind = 'next';
    }
    if (has('return')) node.terminal = 'return';
    if (has('raise')) node.terminal = 'raise';
    return node;
  }
}

/** Parses YAML or JSON source (JSON is YAML) into routines and steps. */
export function parseWorkflow(source: string): ParsedWorkflow {
  const counter = new LineCounter();
  const doc = parseDocument(source, { lineCounter: counter, keepSourceTokens: false });
  if (doc.errors.length > 0) return { routines: [], error: doc.errors[0]?.message ?? 'Invalid YAML' };
  const root = doc.contents;
  if (isSeq(root)) {
    const b = new Builder(counter, new Set(['main']));
    return { routines: [{ name: 'main', steps: b.steps(root, 'main', 'main'), lines: lineRange(root, counter) }], error: null };
  }
  if (!isMap(root)) return { routines: [], error: 'The source must be a list of steps or a map of subworkflows.' };
  const names = new Set(root.items.filter(isPair).map((p) => String(isScalar(p.key) ? p.key.value : '')));
  const b = new Builder(counter, names);
  const routines: Routine[] = [];
  for (const pair of root.items) {
    if (!isPair(pair) || !isScalar(pair.key) || !isMap(pair.value)) continue;
    const name = String(pair.key.value);
    routines.push({ name, steps: b.steps(getIn(pair.value, 'steps'), name, name), lines: lineRange(pair.value as YamlNode, counter) });
  }
  // main first, then subworkflows in source order.
  routines.sort((a, z) => (a.name === 'main' ? -1 : z.name === 'main' ? 1 : 0));
  return { routines, error: null };
}

// ---- ELK graph ----------------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  label: string;
  detail: string | null;
  kind: StepKind | 'start' | 'end' | 'routine';
  width: number;
  height: number;
  children?: GraphNode[];
  lines: { start: number; end: number } | null;
  routine: string;
  step: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  style: 'flow' | 'jump' | 'call' | 'error' | 'loop';
}

const CHAR = 7.2;
const width = (label: string, detail: string | null) =>
  Math.min(280, Math.max(120, Math.max(label.length, (detail ?? '').length) * CHAR + 28));

function leaf(s: StepNode): GraphNode {
  return {
    id: s.id,
    label: s.name,
    detail: s.detail ?? (s.kind === 'other' ? null : s.kind),
    kind: s.kind,
    width: width(s.name, s.detail ?? s.kind),
    height: 40,
    lines: s.lines,
    routine: s.routine,
    step: s.name,
  };
}

/** Builds nodes and edges for one routine, with start and end markers. */
export function routineGraph(r: Routine): { node: GraphNode; edges: GraphEdge[] } {
  const edges: GraphEdge[] = [];
  const start = `${r.name}::start`;
  const end = `${r.name}::end`;
  let counter = 0;
  const edge = (source: string, target: string, style: GraphEdge['style'], label?: string) => {
    edges.push({ id: `${r.name}-e${++counter}`, source, target, style, label });
  };

  /**
   * Lays out a block of steps. `exit` is where control goes after the block; `loop` is the for
   * node that `break` and `continue` refer to. Returns graph nodes of the block.
   */
  const block = (steps: StepNode[], entry: string, exit: string, loop: string | null, byName: Map<string, string>): GraphNode[] => {
    const nodes: GraphNode[] = [];
    if (steps.length === 0) {
      edge(entry, exit, 'flow');
      return nodes;
    }
    for (const s of steps) byName.set(s.name, s.id);
    edge(entry, steps[0]?.id ?? exit, 'flow');
    steps.forEach((s, i) => {
      const following = steps[i + 1]?.id ?? exit;
      const target = (name: string | null): string | null => {
        if (!name) return null;
        if (name === 'end') return end;
        if (name === 'break') return loop ? `${loop}::done` : end;
        if (name === 'continue') return loop ?? end;
        return byName.get(name) ?? null;
      };
      const container = s.children.length > 0 && (s.kind === 'for' || s.kind === 'parallel' || s.kind === 'try' || s.kind === 'steps');
      if (container) {
        const inner: GraphNode[] = [];
        const innerStart = `${s.id}::in`;
        const innerDone = `${s.id}::done`;
        inner.push({
          id: innerStart,
          label: '',
          detail: null,
          kind: 'start',
          width: 10,
          height: 10,
          lines: null,
          routine: s.routine,
          step: s.name,
        });
        if (s.kind === 'parallel' && s.children.every((c) => c.kind === 'branch')) {
          for (const branch of s.children) {
            const bnode: GraphNode = { ...leaf(branch), children: [], width: 0, height: 0 };
            const bStart = `${branch.id}::in`;
            const bDone = `${branch.id}::done`;
            bnode.children = [
              {
                id: bStart,
                label: '',
                detail: null,
                kind: 'start',
                width: 10,
                height: 10,
                lines: null,
                routine: s.routine,
                step: branch.name,
              },
              ...block(branch.children, bStart, bDone, null, new Map(byName)),
              {
                id: bDone,
                label: '',
                detail: null,
                kind: 'end',
                width: 10,
                height: 10,
                lines: null,
                routine: s.routine,
                step: branch.name,
              },
            ];
            inner.push(bnode);
            edge(innerStart, bStart, 'flow');
            edge(bDone, innerDone, 'flow');
          }
        } else if (s.kind === 'try') {
          const exceptBlock = s.children.find((c) => c.kind === 'except');
          const tryBody = s.children.filter((c) => c.kind !== 'except');
          inner.push(...block(tryBody, innerStart, innerDone, loop, byName));
          if (exceptBlock) {
            const enode: GraphNode = { ...leaf(exceptBlock), children: [], width: 0, height: 0 };
            const eStart = `${exceptBlock.id}::in`;
            enode.children = [
              {
                id: eStart,
                label: '',
                detail: null,
                kind: 'start',
                width: 10,
                height: 10,
                lines: null,
                routine: s.routine,
                step: 'except',
              },
              ...block(exceptBlock.children, eStart, innerDone, loop, byName),
            ];
            inner.push(enode);
            edge(innerStart, eStart, 'error', 'on error');
          }
        } else {
          inner.push(...block(s.children, innerStart, innerDone, s.kind === 'for' ? s.id : loop, byName));
          if (s.kind === 'for') edge(innerDone, innerStart, 'loop', 'next item');
        }
        inner.push({
          id: innerDone,
          label: '',
          detail: null,
          kind: 'end',
          width: 10,
          height: 10,
          lines: null,
          routine: s.routine,
          step: s.name,
        });
        nodes.push({ ...leaf(s), children: inner, width: 0, height: 0 });
        const jump = target(s.next);
        edge(s.id, jump ?? following, jump ? 'jump' : 'flow');
        return;
      }
      nodes.push(leaf(s));
      if (s.calls) edge(s.id, `${s.calls}::start`, 'call', 'calls');
      if (s.kind === 'switch') {
        s.cases.forEach((c, ci) => {
          if (c.body.length > 0) {
            const caseEntry = `${s.id}::case${ci}`;
            nodes.push({
              id: caseEntry,
              label: '',
              detail: null,
              kind: 'start',
              width: 10,
              height: 10,
              lines: null,
              routine: s.routine,
              step: s.name,
            });
            edge(s.id, caseEntry, 'jump', c.condition);
            nodes.push(...block(c.body, caseEntry, target(c.next) ?? following, loop, byName));
          } else {
            const t = target(c.next);
            if (t) edge(s.id, t, 'jump', c.condition);
          }
        });
      }
      if (s.terminal) {
        edge(s.id, end, s.terminal === 'raise' ? 'error' : 'flow', s.terminal === 'raise' ? 'raises' : undefined);
        return;
      }
      const jump = target(s.next);
      edge(s.id, jump ?? following, jump ? 'jump' : 'flow');
    });
    return nodes;
  };

  const children: GraphNode[] = [
    { id: start, label: r.name, detail: 'start', kind: 'start', width: 16, height: 16, lines: r.lines, routine: r.name, step: '' },
    ...block(r.steps, start, end, null, new Map()),
    { id: end, label: 'end', detail: null, kind: 'end', width: 16, height: 16, lines: null, routine: r.name, step: '' },
  ];
  return {
    node: {
      id: `routine:${r.name}`,
      label: r.name,
      detail: 'subworkflow',
      kind: 'routine',
      width: 0,
      height: 0,
      children,
      lines: r.lines,
      routine: r.name,
      step: '',
    },
    edges,
  };
}

export function workflowGraph(parsed: ParsedWorkflow): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const r of parsed.routines) {
    const g = routineGraph(r);
    nodes.push(g.node);
    edges.push(...g.edges);
  }
  // Calls to routines that do not exist would point nowhere.
  const ids = new Set<string>();
  const collect = (n: GraphNode) => {
    ids.add(n.id);
    for (const c of n.children ?? []) collect(c);
  };
  for (const n of nodes) collect(n);
  return { nodes, edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

/** Step names (per routine) whose lines contain `line`, innermost first. */
export function stepAtLine(parsed: ParsedWorkflow, line: number): StepNode | null {
  let found: StepNode | null = null;
  const visit = (steps: StepNode[]) => {
    for (const s of steps) {
      if (s.lines && s.lines.start <= line && line <= s.lines.end) {
        found = s;
        visit(s.children);
        for (const c of s.cases) visit(c.body);
      }
    }
  };
  for (const r of parsed.routines) visit(r.steps);
  return found;
}
