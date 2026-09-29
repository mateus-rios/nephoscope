import type { QueryFilter, QuerySpec, WireValue } from '@nephoscope/contracts';

/** "Copy as code" (SPEC-0004 D-06, CA-08): the same read in the Node, Python and Go server SDKs. */

export type CodeLanguage = 'node' | 'python' | 'go';
export const codeLanguages: { value: CodeLanguage; label: string }[] = [
  { value: 'node', label: 'Node.js' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
];

const js = (s: string) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`;
const dq = (s: string) => JSON.stringify(s);
const relative = (ref: string) => ref.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, '');

function literal(v: WireValue, lang: CodeLanguage): string {
  switch (v.t) {
    case 'null':
      return lang === 'node' ? 'null' : lang === 'python' ? 'None' : 'nil';
    case 'boolean':
      return lang === 'python' ? (v.v ? 'True' : 'False') : String(v.v);
    case 'integer': {
      const safe = Math.abs(Number(v.v)) <= Number.MAX_SAFE_INTEGER;
      return lang === 'node' && !safe ? `${v.v}n` : lang === 'go' ? `int64(${v.v})` : v.v;
    }
    case 'double': {
      if (typeof v.v !== 'number') {
        const special = {
          NaN: ['NaN', "float('nan')", 'math.NaN()'],
          Infinity: ['Infinity', "float('inf')", 'math.Inf(1)'],
          '-Infinity': ['-Infinity', "float('-inf')", 'math.Inf(-1)'],
          '-0': ['-0', '-0.0', 'math.Copysign(0, -1)'],
        }[v.v];
        return special[lang === 'node' ? 0 : lang === 'python' ? 1 : 2] ?? '';
      }
      const s = String(v.v);
      return /[.eE]/.test(s) ? s : `${s}.0`;
    }
    case 'string':
      return lang === 'node' ? js(v.v) : dq(v.v);
    case 'timestamp':
      return lang === 'node'
        ? `Timestamp.fromDate(new Date(${js(v.v)}))`
        : lang === 'python'
          ? `datetime.fromisoformat(${dq(v.v.replace('Z', '+00:00'))})`
          : `mustTime(${dq(v.v)})`;
    case 'bytes':
      return lang === 'node'
        ? `Buffer.from(${js(v.v)}, 'base64')`
        : lang === 'python'
          ? `base64.b64decode(${dq(v.v)})`
          : `mustBase64(${dq(v.v)})`;
    case 'reference':
      return lang === 'node'
        ? `db.doc(${js(relative(v.v))})`
        : lang === 'python'
          ? `db.document(${dq(relative(v.v))})`
          : `client.Doc(${dq(relative(v.v))})`;
    case 'geopoint':
      return lang === 'node'
        ? `new GeoPoint(${v.v.latitude}, ${v.v.longitude})`
        : lang === 'python'
          ? `firestore.GeoPoint(${v.v.latitude}, ${v.v.longitude})`
          : `&latlng.LatLng{Latitude: ${v.v.latitude}, Longitude: ${v.v.longitude}}`;
    case 'vector':
      return lang === 'node'
        ? `FieldValue.vector([${v.v.join(', ')}])`
        : lang === 'python'
          ? `Vector([${v.v.join(', ')}])`
          : `firestore.Vector64{${v.v.join(', ')}}`;
    case 'array': {
      const items = v.v.map((x) => literal(x, lang)).join(', ');
      return lang === 'go' ? `[]interface{}{${items}}` : `[${items}]`;
    }
    case 'map':
    case 'special': {
      const entries = Object.entries(v.v).map(([k, x]) => `${lang === 'node' ? js(k) : dq(k)}: ${literal(x, lang)}`);
      return lang === 'go' ? `map[string]interface{}{${entries.join(', ')}}` : `{${entries.join(', ')}}`;
    }
  }
}

function fieldRef(path: string, lang: CodeLanguage): string {
  if (path === '__name__') return lang === 'node' ? 'FieldPath.documentId()' : lang === 'python' ? '"__name__"' : 'firestore.DocumentID';
  return lang === 'node' ? js(path) : dq(path);
}

const PY_OPS: Record<string, string> = { 'array-contains': 'array_contains', 'array-contains-any': 'array_contains_any' };

function unaryParts(f: Extract<QueryFilter, { kind: 'unary' }>, lang: CodeLanguage): [string, string] {
  const nan = lang === 'node' ? 'NaN' : lang === 'python' ? "float('nan')" : 'math.NaN()';
  const nul = lang === 'node' ? 'null' : lang === 'python' ? 'None' : 'nil';
  const op = f.op.startsWith('is-not') ? '!=' : '==';
  return [op, f.op.endsWith('nan') ? nan : nul];
}

function filterCode(f: QueryFilter, lang: CodeLanguage, indent: string): string {
  const inner = `${indent}  `;
  if (f.kind === 'and' || f.kind === 'or') {
    const parts = f.filters.map((x) => filterCode(x, lang, inner));
    if (lang === 'node') return `Filter.${f.kind}(\n${parts.map((p) => inner + p).join(',\n')},\n${indent})`;
    if (lang === 'python') return `${f.kind === 'and' ? 'And' : 'Or'}([\n${parts.map((p) => inner + p).join(',\n')},\n${indent}])`;
    return `firestore.${f.kind === 'and' ? 'AndFilter' : 'OrFilter'}{Filters: []firestore.EntityFilter{\n${parts.map((p) => inner + p).join(',\n')},\n${indent}}}`;
  }
  const [op, value] = f.kind === 'unary' ? unaryParts(f, lang) : [f.op, literal(f.value, lang)];
  if (lang === 'node') return `Filter.where(${fieldRef(f.field, lang)}, ${js(op)}, ${value})`;
  if (lang === 'python') return `FieldFilter(${fieldRef(f.field, lang)}, ${dq(PY_OPS[op] ?? op)}, ${value})`;
  return `firestore.PropertyFilter{Path: ${dq(f.field)}, Operator: ${dq(op)}, Value: ${value}}`;
}

function header(lang: CodeLanguage, projectId: string, databaseId: string): string {
  const named = databaseId !== '(default)';
  if (lang === 'node')
    return `const { Firestore, FieldPath, FieldValue, Filter, GeoPoint, Timestamp } = require('@google-cloud/firestore');\n\nconst db = new Firestore({ projectId: ${js(projectId)}${named ? `, databaseId: ${js(databaseId)}` : ''} });\n`;
  if (lang === 'python')
    return `import base64\nfrom datetime import datetime\nfrom google.cloud import firestore\nfrom google.cloud.firestore_v1.base_query import And, FieldFilter, Or\nfrom google.cloud.firestore_v1.vector import Vector\n\ndb = firestore.Client(project=${dq(projectId)}${named ? `, database=${dq(databaseId)}` : ''})\n`;
  return `// import "cloud.google.com/go/firestore"\nctx := context.Background()\nclient, err := firestore.NewClientWithDatabase(ctx, ${dq(projectId)}, ${dq(databaseId)})\nif err != nil {\n\tlog.Fatal(err)\n}\ndefer client.Close()\n`;
}

export function documentCode(lang: CodeLanguage, projectId: string, databaseId: string, path: string): string {
  const h = header(lang, projectId, databaseId);
  if (lang === 'node')
    return `${h}\nconst snap = await db.doc(${js(path)}).get();\nconsole.log(snap.exists ? snap.data() : 'No such document');\n`;
  if (lang === 'python')
    return `${h}\nsnap = db.document(${dq(path)}).get()\nprint(snap.to_dict() if snap.exists else "No such document")\n`;
  return `${h}\nsnap, err := client.Doc(${dq(path)}).Get(ctx)\nif err != nil {\n\tlog.Fatal(err)\n}\nfmt.Println(snap.Data())\n`;
}

export function queryCode(lang: CodeLanguage, projectId: string, databaseId: string, spec: QuerySpec): string {
  const h = header(lang, projectId, databaseId);
  const src = spec.source;
  const lines: string[] = [];
  if (lang === 'node') {
    let base =
      src.kind === 'collection'
        ? `db.collection(${js(src.path)})`
        : src.parent
          ? `db.doc(${js(src.parent)}).collection(${js(src.collectionId)}) /* group queries under a document need Firestore's REST API */`
          : `db.collectionGroup(${js(src.collectionId)})`;
    if (spec.where) base += `\n  .where(${filterCode(spec.where, lang, '  ')})`;
    for (const o of spec.orderBy) base += `\n  .orderBy(${fieldRef(o.field, lang)}, '${o.direction}')`;
    if (spec.start)
      base += `\n  .${spec.start.mode === 'at' ? 'startAt' : 'startAfter'}(${spec.start.values.map((v) => literal(v, lang)).join(', ')})`;
    if (spec.end)
      base += `\n  .${spec.end.mode === 'at' ? 'endAt' : 'endBefore'}(${spec.end.values.map((v) => literal(v, lang)).join(', ')})`;
    if (spec.select) base += `\n  .select(${spec.select.map((s) => js(s)).join(', ')})`;
    if (spec.offset) base += `\n  .offset(${spec.offset})`;
    if (spec.limit) base += `\n  .limit(${spec.limit})`;
    if (spec.findNearest) {
      const n = spec.findNearest;
      base += `\n  .findNearest({ vectorField: ${js(n.field)}, queryVector: [${n.vector.join(', ')}], limit: ${n.limit}, distanceMeasure: '${n.measure}'${n.distanceField ? `, distanceResultField: ${js(n.distanceField)}` : ''}${n.threshold !== undefined ? `, distanceThreshold: ${n.threshold}` : ''} })`;
    }
    lines.push(`const snap = await ${base}\n  .get();`, 'snap.forEach((doc) => console.log(doc.id, doc.data()));');
  } else if (lang === 'python') {
    let base = src.kind === 'collection' ? `db.collection(${dq(src.path)})` : `db.collection_group(${dq(src.collectionId)})`;
    if (spec.where) base += `\n    .where(filter=${filterCode(spec.where, lang, '    ')})`;
    for (const o of spec.orderBy)
      base += `\n    .order_by(${fieldRef(o.field, lang)}${o.direction === 'desc' ? ', direction=firestore.Query.DESCENDING' : ''})`;
    const cursorDict = (values: WireValue[]) =>
      `{${spec.orderBy.map((o, i) => `${dq(o.field)}: ${values[i] ? literal(values[i], lang) : 'None'}`).join(', ')}}`;
    if (spec.start) base += `\n    .${spec.start.mode === 'at' ? 'start_at' : 'start_after'}(${cursorDict(spec.start.values)})`;
    if (spec.end) base += `\n    .${spec.end.mode === 'at' ? 'end_at' : 'end_before'}(${cursorDict(spec.end.values)})`;
    if (spec.select) base += `\n    .select([${spec.select.map(dq).join(', ')}])`;
    if (spec.offset) base += `\n    .offset(${spec.offset})`;
    if (spec.limit) base += `\n    .limit(${spec.limit})`;
    if (spec.findNearest) {
      const n = spec.findNearest;
      base += `\n    .find_nearest(vector_field=${dq(n.field)}, query_vector=Vector([${n.vector.join(', ')}]), limit=${n.limit}, distance_measure=firestore.DistanceMeasure.${n.measure})`;
    }
    lines.push(`query = (\n    ${base}\n)`, 'for doc in query.stream():\n    print(doc.id, doc.to_dict())');
  } else {
    let base = src.kind === 'collection' ? `client.Collection(${dq(src.path)})` : `client.CollectionGroup(${dq(src.collectionId)})`;
    let q = `q := ${base}`;
    if (spec.where) q += `.\n\tWhereEntity(${filterCode(spec.where, lang, '\t')})`;
    for (const o of spec.orderBy) q += `.\n\tOrderBy(${dq(o.field)}, firestore.${o.direction === 'desc' ? 'Desc' : 'Asc'})`;
    if (spec.start)
      q += `.\n\t${spec.start.mode === 'at' ? 'StartAt' : 'StartAfter'}(${spec.start.values.map((v) => literal(v, lang)).join(', ')})`;
    if (spec.end) q += `.\n\t${spec.end.mode === 'at' ? 'EndAt' : 'EndBefore'}(${spec.end.values.map((v) => literal(v, lang)).join(', ')})`;
    if (spec.select) q += `.\n\tSelect(${spec.select.map(dq).join(', ')})`;
    if (spec.offset) q += `.\n\tOffset(${spec.offset})`;
    if (spec.limit) q += `.\n\tLimit(${spec.limit})`;
    base = q;
    lines.push(
      base,
      'docs, err := q.Documents(ctx).GetAll()\nif err != nil {\n\tlog.Fatal(err)\n}\nfor _, d := range docs {\n\tfmt.Println(d.Ref.ID, d.Data())\n}',
    );
  }
  return `${h}\n${lines.join('\n')}\n`;
}
