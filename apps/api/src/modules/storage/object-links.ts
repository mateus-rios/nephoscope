import { randomBytes } from 'node:crypto';
import { type ObjectLink, type ObjectLinkRequest, type PreviewKind, previewKind } from '@nephoscope/contracts';
import { Injectable } from '@nestjs/common';

/**
 * Short-lived links to stream an object (SPEC-0006 D-11, D-12). <img>, <video> and download
 * links cannot send the x-nephoscope-client header, so the page asks for a link with the header
 * and the link itself carries an unguessable token instead. A link is bound to the profile, the
 * object and the disposition it was issued for; it is reusable until it expires, which range
 * requests of media need.
 */

export interface LinkTarget {
  profileId: string;
  projectId: string;
  bucket: string;
  name: string;
  generation: string | undefined;
  /** How the object is shown inline; null serves it as an attachment. */
  kind: PreviewKind | null;
  expires: number;
}

const INLINE_TTL_MS = 10 * 60 * 1000;
const ATTACHMENT_TTL_MS = 2 * 60 * 1000;
const MAX_LINKS = 2000;
export const LINK_PREFIX = '/api/o/';

@Injectable()
export class ObjectLinks {
  private readonly links = new Map<string, LinkTarget>();

  create(profileId: string, projectId: string, bucket: string, req: ObjectLinkRequest, contentType: string | null): ObjectLink {
    const now = Date.now();
    for (const [k, v] of this.links) if (v.expires < now) this.links.delete(k);
    while (this.links.size >= MAX_LINKS) {
      const oldest = this.links.keys().next().value;
      if (oldest === undefined) break;
      this.links.delete(oldest);
    }
    // Unknown types are never served inline; HTML, SVG and XML only as plain text (CA-73).
    const kind = req.disposition === 'inline' ? previewKind(contentType, req.name) : null;
    const expires = now + (kind ? INLINE_TTL_MS : ATTACHMENT_TTL_MS);
    const token = randomBytes(32).toString('base64url');
    this.links.set(token, { profileId, projectId, bucket, name: req.name, generation: req.generation, kind, expires });
    return { url: `${LINK_PREFIX}${token}`, expiresAt: new Date(expires).toISOString(), inline: kind !== null };
  }

  get(token: string): LinkTarget | undefined {
    const link = this.links.get(token);
    if (!link) return undefined;
    if (link.expires < Date.now()) {
      this.links.delete(token);
      return undefined;
    }
    return link;
  }
}
