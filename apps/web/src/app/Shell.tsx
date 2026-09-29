import { WarningIcon } from '@phosphor-icons/react';
import { Outlet, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ScrollParentContext } from '../design/ScrollParent';
import { ViewScope } from '../design/ViewScope';
import { useInstance } from '../state/queries';
import { ProductIndex } from './ProductIndex';
import { TitleStrip } from './TitleStrip';

function InstanceNotices() {
  const instance = useInstance();
  const data = instance.data;
  useEffect(() => {
    for (const notice of data?.notices ?? []) toast.warning(notice, { duration: 8000 });
  }, [data?.notices]);
  if (!data) return null;
  const strips: string[] = [];
  // SPEC-0001 CA-17: a persistent warning whenever Nephoscope is reached through a non-loopback host.
  if (!data.host.isLoopback) strips.push(`Nephoscope has no login. Anyone who can reach ${data.host.name} can use the keys stored here.`);
  // SPEC-0001 CA-55.
  if (!data.dataDir.writable)
    strips.push(
      'The data directory is not writable. Preferences and profiles last only until Nephoscope restarts, and new keys cannot be saved.',
    );
  if (strips.length === 0) return null;
  return (
    <div role="status" className="border-b border-redline bg-redline-tint">
      {strips.map((s) => (
        <p key={s} className="m-0 flex items-center gap-2 px-4 py-1.5 text-dense text-redline-ink">
          <WarningIcon size={16} weight="fill" aria-hidden />
          {s}
        </p>
      ))}
    </div>
  );
}

/** The sheet frame: title strip, product index and the scrolling content (SPEC-0001 CA-56). */
export function Shell() {
  const params = useParams({ strict: false }) as { projectId?: string };
  const instance = useInstance();
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  return (
    <div className="grid h-dvh grid-rows-[auto_1fr] bg-film text-ink">
      <div>
        <TitleStrip projectId={params.projectId} instance={instance.data} />
        <InstanceNotices />
      </div>
      <div className="grid min-h-0 grid-cols-[auto_1fr]">
        <ProductIndex projectId={params.projectId} />
        <main ref={setScroller} id="main" className="min-w-0 overflow-y-auto bg-sheet">
          <ScrollParentContext.Provider value={scroller}>
            <ViewScope name="page">
              <Outlet />
            </ViewScope>
          </ScrollParentContext.Provider>
        </main>
      </div>
    </div>
  );
}
