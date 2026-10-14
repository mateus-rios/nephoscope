import type {
  AlertConditionView,
  AlertPolicyView,
  ChannelDescriptorView,
  CreateAlertPolicy,
  DashboardSummary,
  MetricDescriptorView,
  NotificationChannelView,
  SeriesView,
  UptimeCheckView,
} from '@nephoscope/contracts';

// biome-ignore lint/suspicious/noExplicitAny: Monitoring REST resources are read field by field.
type Any = any;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const short = (name: string): string => name.split('/').pop() ?? name;
const seconds = (d: unknown): number | null => {
  const m = typeof d === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(d) : null;
  return m ? Number(m[1]) : null;
};

export function mapDescriptor(d: Any): MetricDescriptorView {
  return {
    type: String(d?.type ?? ''),
    displayName: String(d?.displayName ?? d?.type ?? ''),
    description: String(d?.description ?? ''),
    metricKind: (d?.metricKind ?? 'METRIC_KIND_UNSPECIFIED') as MetricDescriptorView['metricKind'],
    valueType: String(d?.valueType ?? ''),
    unit: String(d?.unit ?? ''),
    labels: Array.isArray(d?.labels)
      ? d.labels.map((l: Any) => ({ key: String(l?.key ?? ''), description: String(l?.description ?? '') }))
      : [],
    resourceTypes: Array.isArray(d?.monitoredResourceTypes) ? d.monitoredResourceTypes.map(String) : [],
    launchStage: str(d?.launchStage),
  };
}

function pointValue(v: Any): number | null {
  if (!v) return null;
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  if (v.int64Value !== undefined && v.int64Value !== null) return Number(v.int64Value);
  if (typeof v.boolValue === 'boolean') return v.boolValue ? 1 : 0;
  if (v.distributionValue && typeof v.distributionValue.mean === 'number') return v.distributionValue.mean;
  return null;
}

/** Cloud Monitoring REST time series to chart series. */
export function mapTimeSeries(list: Any[]): SeriesView[] {
  return list.map((s) => {
    const labels: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries((s?.resource?.labels ?? {}) as Record<string, string>).map(([k, v]) => [`resource.${k}`, String(v)]),
      ),
      ...Object.fromEntries(
        Object.entries((s?.metric?.labels ?? {}) as Record<string, string>).map(([k, v]) => [`metric.${k}`, String(v)]),
      ),
    };
    const points = ((s?.points ?? []) as Any[])
      .map((p): [number, number | null] => [Date.parse(p?.interval?.endTime ?? ''), pointValue(p?.value)])
      .filter(([t]) => Number.isFinite(t))
      .sort((a, b) => a[0] - b[0]);
    return { labels, points };
  });
}

/** Prometheus HTTP API matrix to chart series. */
export function mapPrometheus(data: Any): SeriesView[] {
  const result = (data?.data?.result ?? []) as Any[];
  return result.map((r) => ({
    labels: Object.fromEntries(Object.entries((r?.metric ?? {}) as Record<string, string>).map(([k, v]) => [k, String(v)])),
    points: ((r?.values ?? (r?.value ? [r.value] : [])) as [number, string][]).map(([t, v]): [number, number | null] => {
      const n = Number(v);
      return [Math.round(Number(t) * 1000), Number.isFinite(n) ? n : null];
    }),
  }));
}

/** MQL `timeSeries:query` results to chart series. */
export function mapMql(data: Any): SeriesView[] {
  const labelKeys = ((data?.timeSeriesDescriptor?.labelDescriptors ?? []) as Any[]).map((l) => String(l?.key ?? ''));
  return ((data?.timeSeriesData ?? []) as Any[]).map((d) => {
    const labels: Record<string, string> = {};
    ((d?.labelValues ?? []) as Any[]).forEach((v, i) => {
      labels[labelKeys[i] ?? `label${i}`] = String(v?.stringValue ?? v?.int64Value ?? v?.boolValue ?? '');
    });
    const points = ((d?.pointData ?? []) as Any[])
      .map((p): [number, number | null] => [Date.parse(p?.timeInterval?.endTime ?? ''), pointValue(p?.values?.[0])])
      .filter(([t]) => Number.isFinite(t))
      .sort((a, b) => a[0] - b[0]);
    return { labels, points };
  });
}

function countWidgets(d: Any): number {
  if (d?.gridLayout) return (d.gridLayout.widgets ?? []).length;
  if (d?.mosaicLayout) return (d.mosaicLayout.tiles ?? []).length;
  if (d?.rowLayout) return ((d.rowLayout.rows ?? []) as Any[]).reduce((n, r) => n + (r?.widgets ?? []).length, 0);
  if (d?.columnLayout) return ((d.columnLayout.columns ?? []) as Any[]).reduce((n, c) => n + (c?.widgets ?? []).length, 0);
  return 0;
}

export function mapDashboard(d: Any): DashboardSummary {
  const name = String(d?.name ?? '');
  return {
    name,
    id: short(name),
    displayName: String(d?.displayName ?? short(name)),
    etag: str(d?.etag),
    layout: d?.gridLayout ? 'grid' : d?.mosaicLayout ? 'mosaic' : d?.rowLayout ? 'row' : d?.columnLayout ? 'column' : 'none',
    widgets: countWidgets(d),
    labels: (d?.labels ?? {}) as Record<string, string>,
  };
}

function mapCondition(c: Any): AlertConditionView {
  const base = {
    name: String(c?.name ?? ''),
    displayName: String(c?.displayName ?? ''),
    aggregations: [] as AlertConditionView['aggregations'],
  };
  if (c?.conditionThreshold) {
    const t = c.conditionThreshold;
    return {
      ...base,
      kind: 'threshold',
      filter: str(t.filter),
      query: null,
      comparison: str(t.comparison),
      threshold: typeof t.thresholdValue === 'number' ? t.thresholdValue : null,
      duration: str(t.duration),
      aggregations: Array.isArray(t.aggregations) ? t.aggregations : [],
    };
  }
  if (c?.conditionAbsent) {
    return {
      ...base,
      kind: 'absent',
      filter: str(c.conditionAbsent.filter),
      query: null,
      comparison: null,
      threshold: null,
      duration: str(c.conditionAbsent.duration),
      aggregations: Array.isArray(c.conditionAbsent.aggregations) ? c.conditionAbsent.aggregations : [],
    };
  }
  if (c?.conditionPrometheusQueryLanguage) {
    const q = c.conditionPrometheusQueryLanguage;
    return { ...base, kind: 'promql', filter: null, query: str(q.query), comparison: null, threshold: null, duration: str(q.duration) };
  }
  if (c?.conditionMonitoringQueryLanguage) {
    const q = c.conditionMonitoringQueryLanguage;
    return { ...base, kind: 'mql', filter: null, query: str(q.query), comparison: null, threshold: null, duration: str(q.duration) };
  }
  if (c?.conditionMatchedLog) {
    return {
      ...base,
      kind: 'log',
      filter: str(c.conditionMatchedLog.filter),
      query: null,
      comparison: null,
      threshold: null,
      duration: null,
    };
  }
  return { ...base, kind: 'other', filter: null, query: null, comparison: null, threshold: null, duration: null };
}

export function mapPolicy(p: Any): AlertPolicyView {
  const name = String(p?.name ?? '');
  return {
    name,
    id: short(name),
    displayName: String(p?.displayName ?? short(name)),
    enabled: p?.enabled !== false,
    combiner: String(p?.combiner ?? 'OR'),
    severity: str(p?.severity),
    conditions: Array.isArray(p?.conditions) ? p.conditions.map(mapCondition) : [],
    channels: Array.isArray(p?.notificationChannels) ? p.notificationChannels.map(String) : [],
    documentation: str(p?.documentation?.content),
    userLabels: (p?.userLabels ?? {}) as Record<string, string>,
    createTime: str(p?.creationRecord?.mutateTime),
    updateTime: str(p?.mutationRecord?.mutateTime),
  };
}

/** An alert policy body from the threshold form (SPEC-0005 D-10). */
export function policyFromForm(f: Extract<CreateAlertPolicy, { mode: 'threshold' }>): Any {
  const duration = `${f.durationSeconds}s`;
  let condition: Any;
  if (f.source.kind === 'promql') {
    condition = {
      displayName: f.displayName,
      conditionPrometheusQueryLanguage: {
        query: `${f.source.query} ${f.comparison === 'COMPARISON_GT' ? '>' : f.comparison === 'COMPARISON_GE' ? '>=' : f.comparison === 'COMPARISON_LT' ? '<' : '<='} ${f.threshold}`,
        duration,
        evaluationInterval: `${f.alignmentSeconds}s`,
      },
    };
  } else {
    const clauses = [`metric.type = "${f.source.metricType}"`];
    if (f.source.resourceType) clauses.push(`resource.type = "${f.source.resourceType}"`);
    if (f.source.extraFilter?.trim()) clauses.push(f.source.extraFilter.trim());
    condition = {
      displayName: f.displayName,
      conditionThreshold: {
        filter: clauses.join(' AND '),
        comparison: f.comparison,
        thresholdValue: f.threshold,
        duration,
        aggregations: [{ alignmentPeriod: `${f.alignmentSeconds}s`, perSeriesAligner: f.source.aligner }],
        trigger: { count: 1 },
      },
    };
  }
  return {
    displayName: f.displayName,
    combiner: 'OR',
    enabled: true,
    conditions: [condition],
    notificationChannels: f.channels,
    ...(f.documentation ? { documentation: { content: f.documentation, mimeType: 'text/markdown' } } : {}),
    ...(f.severity ? { severity: f.severity } : {}),
  };
}

export function mapUptime(c: Any, passRates: Map<string, number>): UptimeCheckView {
  const name = String(c?.name ?? '');
  const id = short(name);
  const http = c?.httpCheck;
  const protocol = c?.tcpCheck ? 'TCP' : http ? (http.useSsl ? 'HTTPS' : 'HTTP') : 'OTHER';
  return {
    name,
    id,
    displayName: String(c?.displayName ?? id),
    protocol,
    target: String(c?.monitoredResource?.labels?.host ?? c?.resourceGroup?.groupId ?? ''),
    path: str(http?.path),
    port: typeof (http?.port ?? c?.tcpCheck?.port) === 'number' ? (http?.port ?? c?.tcpCheck?.port) : null,
    periodSeconds: seconds(c?.period),
    timeoutSeconds: seconds(c?.timeout),
    regions: Array.isArray(c?.selectedRegions) ? c.selectedRegions.map(String) : [],
    passRate: passRates.get(id) ?? null,
  };
}

export function mapChannel(c: Any): NotificationChannelView {
  const name = String(c?.name ?? '');
  return {
    name,
    id: short(name),
    type: String(c?.type ?? ''),
    displayName: String(c?.displayName ?? short(name)),
    labels: (c?.labels ?? {}) as Record<string, string>,
    enabled: c?.enabled !== false,
    verificationStatus: str(c?.verificationStatus),
  };
}

export function mapChannelDescriptor(d: Any): ChannelDescriptorView {
  return {
    type: String(d?.type ?? ''),
    displayName: String(d?.displayName ?? d?.type ?? ''),
    description: String(d?.description ?? ''),
    labels: Array.isArray(d?.labels)
      ? d.labels.map((l: Any) => ({ key: String(l?.key ?? ''), description: String(l?.description ?? '') }))
      : [],
  };
}

/** Step for a PromQL range: about 1,500 points per series, at least 15 seconds (SPEC-0005 D-08). */
export function promStep(sinceMs: number, untilMs: number): number {
  return Math.max(15, Math.ceil((untilMs - sinceMs) / 1000 / 1500));
}
