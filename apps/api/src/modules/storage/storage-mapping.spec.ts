import { servedType } from '@nephoscope/contracts';
import { describe, expect, it } from 'vitest';
import { ObjectLinks } from './object-links.js';
import { emulatorEndpoint } from './storage.service.js';
import { contentDisposition, parseRange, updatePatch } from './storage-mapping.js';

describe('parseRange', () => {
  it('reads single byte ranges against the size', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
  });

  it('refuses ranges it cannot satisfy', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=5-1', 100)).toBe('invalid');
    expect(parseRange('bytes=-', 100)).toBe('invalid');
    expect(parseRange('bytes=0-1,4-5', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });
});

describe('contentDisposition', () => {
  it('keeps only the base name, in ASCII and UTF-8 forms', () => {
    expect(contentDisposition('attachment', 'a/b/relatório "final".pdf')).toBe(
      `attachment; filename="relat_rio _final_.pdf"; filename*=UTF-8''relat%C3%B3rio%20%22final%22.pdf`,
    );
  });
});

describe('updatePatch', () => {
  it('sends removed labels as null so the patch drops them', () => {
    const current = { labels: { env: 'prod', team: 'a' } } as never;
    expect(updatePatch({ labels: { env: 'dev' } }, current).labels).toEqual({ env: 'dev', team: null });
  });
});

describe('emulatorEndpoint', () => {
  it('accepts a host, a URL, or the URL with /storage/v1', () => {
    expect(emulatorEndpoint(null)).toBeNull();
    expect(emulatorEndpoint('127.0.0.1:8088')).toBe('http://127.0.0.1:8088');
    expect(emulatorEndpoint('http://gcs:4443/storage/v1/')).toBe('http://gcs:4443');
  });
});

describe('ObjectLinks', () => {
  it('serves unknown types only as downloads, and HTML, SVG and XML only as text (SPEC-0001 CA-73)', () => {
    const links = new ObjectLinks();
    const kind = (type: string | null, name: string) => {
      const url = links.create('env', 'p', 'b', { name, disposition: 'inline' }, type).url;
      return links.get(url.slice('/api/o/'.length))?.kind;
    };
    expect(kind('image/png', 'a.png')).toBe('image');
    expect(kind('text/plain', 'a.txt')).toBe('text');
    expect(kind('text/html', 'a.html')).toBe('source');
    expect(kind('image/svg+xml', 'a.svg')).toBe('source');
    expect(kind('application/xml', 'a.xml')).toBe('source');
    expect(kind('application/octet-stream', 'blob')).toBeNull();
  });

  it('serves anything that is not a raster image or media as plain text', () => {
    expect(servedType('source', 'image/svg+xml', 'a.svg')).toBe('text/plain; charset=utf-8');
    expect(servedType('json', 'application/json', 'a.json')).toBe('text/plain; charset=utf-8');
    expect(servedType('image', 'image/png', 'a.png')).toBe('image/png');
    expect(servedType('image', 'application/octet-stream', 'a.jpg')).toBe('image/jpeg');
    expect(servedType('video', 'video/mp4', 'a.mp4')).toBe('video/mp4');
    expect(servedType('pdf', 'binary/octet-stream', 'a.pdf')).toBe('application/pdf');
  });

  it('issues unguessable tokens that resolve to their target', () => {
    const links = new ObjectLinks();
    const link = links.create('env', 'p', 'b', { name: 'x.txt', generation: '7', disposition: 'attachment' }, 'text/plain');
    const token = link.url.slice('/api/o/'.length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(links.get(token)).toMatchObject({ bucket: 'b', name: 'x.txt', generation: '7', kind: null });
    expect(links.get('x'.repeat(43))).toBeUndefined();
  });
});
