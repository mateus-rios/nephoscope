import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { parseWorkflow, stepAtLine, workflowGraph } from './graph';
import { toElk } from './WorkflowGraph';

const SOURCE = `main:
  params: [args]
  steps:
    - init:
        assign:
          - total: 0
    - check:
        switch:
          - condition: \${args.n > 10}
            next: big
          - condition: \${args.n < 0}
            raise: "negative"
        next: small
    - big:
        for:
          value: item
          in: \${args.items}
          steps:
            - add:
                assign:
                  - total: \${total + item}
    - fanout:
        parallel:
          shared: [total]
          branches:
            - left:
                steps:
                  - callLeft:
                      call: http.get
                      args:
                        url: https://example.com/left
            - right:
                steps:
                  - callRight:
                      call: helper
    - safe:
        try:
          call: http.get
          args:
            url: https://example.com
        retry: \${http.default_retry}
        except:
          as: e
          steps:
            - report:
                call: sys.log
    - small:
        return: \${total}
helper:
  steps:
    - done:
        return: 1
`;

describe('parseWorkflow', () => {
  const parsed = parseWorkflow(SOURCE);

  it('reads routines with main first', () => {
    expect(parsed.error).toBeNull();
    expect(parsed.routines.map((r) => r.name)).toEqual(['main', 'helper']);
    expect(parsed.routines[0]?.steps.map((s) => `${s.name}:${s.kind}`)).toEqual([
      'init:assign',
      'check:switch',
      'big:for',
      'fanout:parallel',
      'safe:try',
      'small:return',
    ]);
  });

  it('keeps switch conditions and their targets', () => {
    const check = parsed.routines[0]?.steps[1];
    expect(check?.cases.map((c) => [c.condition, c.next])).toEqual([
      ['${args.n > 10}', 'big'],
      ['${args.n < 0}', null],
    ]);
    expect(check?.next).toBe('small');
  });

  it('nests loop bodies, parallel branches and except blocks', () => {
    const [, , big, fanout, safe] = parsed.routines[0]?.steps ?? [];
    expect(big?.children.map((c) => c.name)).toEqual(['add']);
    expect(fanout?.children.map((c) => `${c.name}:${c.kind}`)).toEqual(['left:branch', 'right:branch']);
    expect(fanout?.children[1]?.children[0]?.calls).toBe('helper');
    expect(safe?.detail).toBe('try with retry');
    expect(safe?.children.map((c) => c.kind)).toEqual(['call', 'except']);
  });

  it('maps lines to steps, innermost first', () => {
    expect(stepAtLine(parsed, 5)?.name).toBe('init');
    expect(stepAtLine(parsed, 20)?.name).toBe('add');
    expect(stepAtLine(parsed, 1)).toBeNull();
  });

  it('parses a plain list of steps and JSON', () => {
    expect(parseWorkflow('- a:\n    return: 1\n').routines[0]?.steps[0]?.name).toBe('a');
    expect(parseWorkflow('{"main":{"steps":[{"a":{"return":1}}]}}').routines[0]?.steps[0]?.kind).toBe('return');
    expect(parseWorkflow('main: [').error).not.toBeNull();
  });
});

describe('workflowGraph', () => {
  it('connects jumps, subworkflow calls and returns to real nodes only', () => {
    const { nodes, edges } = workflowGraph(parseWorkflow(SOURCE));
    const ids = new Set<string>();
    const collect = (n: { id: string; children?: { id: string }[] }) => {
      ids.add(n.id);
      for (const c of n.children ?? []) collect(c as never);
    };
    for (const n of nodes) collect(n);
    for (const e of edges) {
      expect(ids.has(e.source), e.source).toBe(true);
      expect(ids.has(e.target), e.target).toBe(true);
    }
    expect(edges.some((e) => e.source === 'main/check' && e.target === 'main/big' && e.label === '${args.n > 10}')).toBe(true);
    expect(edges.some((e) => e.style === 'call' && e.target === 'helper::start')).toBe(true);
    expect(edges.some((e) => e.source === 'main/small' && e.target === 'main::end')).toBe(true);
  });

  it('lays out 300 steps in under a second (SPEC-0003 NFR-03)', async () => {
    const steps = Array.from({ length: 300 }, (_, i) =>
      i % 25 === 0
        ? `    - s${i}:\n        switch:\n          - condition: \${x > ${i}}\n            next: s${Math.min(299, i + 5)}\n`
        : `    - s${i}:\n        assign:\n          - x: ${i}\n`,
    ).join('');
    const { nodes, edges } = workflowGraph(parseWorkflow(`main:\n  steps:\n${steps}`));
    const started = performance.now();
    await new ELK().layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.edgeRouting': 'ORTHOGONAL',
      },
      children: nodes.map(toElk) as never,
      edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
