import { type ProductDescriptor, type ProductGroup, products } from '@nephoscope/contracts';
import {
  BroadcastIcon,
  BrowserIcon,
  BugIcon,
  BuildingsIcon,
  CertificateIcon,
  ChartBarIcon,
  ChartLineIcon,
  ClockIcon,
  CloudIcon,
  CpuIcon,
  CubeIcon,
  CurrencyDollarIcon,
  DatabaseIcon,
  FlowArrowIcon,
  FunctionIcon,
  GaugeIcon,
  GlobeIcon,
  GraphIcon,
  HammerIcon,
  HardDrivesIcon,
  HouseIcon,
  type Icon,
  IdentificationCardIcon,
  KeyIcon,
  LightbulbIcon,
  LightningIcon,
  ListChecksIcon,
  LockKeyIcon,
  NetworkIcon,
  PackageIcon,
  PasswordIcon,
  PathIcon,
  PlugIcon,
  PlugsIcon,
  PulseIcon,
  QueueIcon,
  RocketIcon,
  RulerIcon,
  ShieldCheckIcon,
  ShieldIcon,
  StackIcon,
  TableIcon,
  TerminalWindowIcon,
  TreeStructureIcon,
  WindIcon,
} from '@phosphor-icons/react';

/** One monochrome glyph per product; never Google's product logos (SPEC-0002 D-13). */
export const productIcons: Record<string, Icon> = {
  home: HouseIcon,
  apis: PlugsIcon,
  activity: PulseIcon,
  run: RocketIcon,
  functions: FunctionIcon,
  workflows: FlowArrowIcon,
  scheduler: ClockIcon,
  tasks: QueueIcon,
  eventarc: LightningIcon,
  appengine: CloudIcon,
  apigateway: BrowserIcon,
  firestore: DatabaseIcon,
  bigquery: TableIcon,
  cloudsql: HardDrivesIcon,
  memorystore: GaugeIcon,
  spanner: GlobeIcon,
  bigtable: ChartBarIcon,
  alloydb: DatabaseIcon,
  storage: PackageIcon,
  artifactregistry: CubeIcon,
  filestore: HardDrivesIcon,
  storagetransfer: WindIcon,
  pubsub: BroadcastIcon,
  logging: ListChecksIcon,
  monitoring: ChartLineIcon,
  errorreporting: BugIcon,
  trace: PathIcon,
  iam: IdentificationCardIcon,
  secretmanager: PasswordIcon,
  kms: KeyIcon,
  armor: ShieldIcon,
  certmanager: CertificateIcon,
  orgpolicy: BuildingsIcon,
  scc: ShieldCheckIcon,
  iap: LockKeyIcon,
  cloudbuild: HammerIcon,
  clouddeploy: StackIcon,
  compute: CpuIcon,
  gke: TreeStructureIcon,
  batch: StackIcon,
  vpc: NetworkIcon,
  loadbalancing: GraphIcon,
  dns: GlobeIcon,
  connectivitytests: PlugIcon,
  dataflow: FlowArrowIcon,
  dataproc: CpuIcon,
  composer: RulerIcon,
  vertexai: LightbulbIcon,
  billing: CurrencyDollarIcon,
  quotas: GaugeIcon,
  recommender: LightbulbIcon,
  rawapi: TerminalWindowIcon,
};

export function iconFor(id: string): Icon {
  return productIcons[id] ?? CubeIcon;
}

/** Path of a product page inside a project. */
export function productPath(projectId: string, product: ProductDescriptor | string): string {
  const id = typeof product === 'string' ? product : product.id;
  const base = `/p/${encodeURIComponent(projectId)}`;
  return id === 'home' ? base : `${base}/${id}`;
}

export function productsByGroup(): [ProductGroup, ProductDescriptor[]][] {
  const map = new Map<ProductGroup, ProductDescriptor[]>();
  for (const p of products) {
    const list = map.get(p.group) ?? [];
    list.push(p);
    map.set(p.group, list);
  }
  return [...map.entries()];
}

export function availableProducts(): ProductDescriptor[] {
  return products.filter((p) => p.available);
}
