import { z } from 'zod';

/** Compute Engine serial output and load balancing topology (SPEC-0008 D-07, D-09). */

/** `compute.serial` live channel: port 1 of an instance, polled from the last offset every 2 s. */
export const SerialParamsSchema = z.object({
  zone: z.string().regex(/^[a-z]+-[a-z]+\d+-[a-z]$/),
  instance: z.string().regex(/^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/),
});
export type SerialParams = z.infer<typeof SerialParamsSchema>;

export interface SerialMessage {
  text: string;
  /** Bytes Google no longer kept between two reads (its buffer holds about 1 MB). */
  skipped: number;
}

// ---- Load balancing topology ---------------------------------------------------------------

export const lbNodeKinds = [
  'forwardingRule',
  'targetProxy',
  'urlMap',
  'backendService',
  'backendBucket',
  'targetPool',
  'instanceGroup',
  'neg',
] as const;
export type LbNodeKind = (typeof lbNodeKinds)[number];

export interface LbAnnotation {
  kind: 'healthCheck' | 'certificate' | 'certificateMap' | 'armor' | 'edgeArmor';
  name: string;
  /** Nephoscope route of the annotated resource, when it has one. */
  href: string | null;
}

export interface LbNode {
  /** Compute path after the project, such as `global/urlMaps/web`. */
  id: string;
  kind: LbNodeKind;
  name: string;
  /** `global` or the region or zone. */
  scope: string;
  /** Short facts shown on the node, such as `34.1.2.3:443` or `HTTPS`. */
  facts: string[];
  annotations: LbAnnotation[];
  /** Nephoscope route the node opens; a serverless NEG opens its Cloud Run service or function. */
  href: string | null;
}

export interface LbEdge {
  from: string;
  to: string;
  /** Host and path rule of a URL map edge, such as `api.example.com /v1/*`. */
  label: string | null;
}

export interface LoadBalancerView {
  /** Id of the node the load balancer is named after: its URL map, backend service or target pool. */
  id: string;
  name: string;
  /** Such as `EXTERNAL_MANAGED`, `INTERNAL_MANAGED`, `EXTERNAL`. */
  scheme: string;
  /** Such as `HTTPS`, `HTTP`, `TCP`, `UDP`. */
  protocols: string[];
  addresses: string[];
  nodes: LbNode[];
  edges: LbEdge[];
}

export interface LbTopology {
  loadBalancers: LoadBalancerView[];
  /** Scopes Compute could not read. */
  unreachable: string[];
}
