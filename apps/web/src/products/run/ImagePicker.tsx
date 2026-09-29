import type { DockerImage } from '@nephoscope/contracts';
import { PackageIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { DelayedSkeleton, ProblemState } from '../../design/Feedback';
import { Field, Input, Select } from '../../design/Form';
import { Popover } from '../../design/Overlays';
import { Timestamp } from '../../design/Values';
import { ApiError } from '../../lib/api';
import { useDockerImages, useRepositories } from './api';

export interface PickedImage {
  reference: string;
  /** The same image by digest, for "Pin by digest" (SPEC-0003 D-17). */
  byDigest: string;
}

/** Chooses an image from the project's Docker repositories (SPEC-0003 D-17). */
export function ImagePicker({ projectId, onPick }: { projectId: string; onPick: (picked: PickedImage) => void }) {
  const [open, setOpen] = useState(false);
  const repos = useRepositories(projectId, open);
  const [repo, setRepo] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const images = useDockerImages(projectId, repo);
  const registry = repos.data?.items.find((r) => r.name === repo)?.registryUri ?? '';

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const byImage = new Map<string, DockerImage[]>();
    for (const img of images.data?.items ?? []) {
      if (q && !img.image.toLowerCase().includes(q) && !img.tags.some((t) => t.toLowerCase().includes(q))) continue;
      byImage.set(img.image, [...(byImage.get(img.image) ?? []), img]);
    }
    return [...byImage.entries()];
  }, [images.data, filter]);

  const pick = (img: DockerImage, tag: string | null) => {
    const path = `${registry}/${img.image}`;
    onPick({ reference: tag ? `${path}:${tag}` : `${path}@${img.digest}`, byDigest: `${path}@${img.digest}` });
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Choose an image"
      align="end"
      trigger={
        <Button icon={PackageIcon} type="button">
          Choose an image
        </Button>
      }
    >
      <div className="flex w-[34rem] max-w-[90vw] flex-col gap-3 p-3">
        {repos.isPending ? (
          <DelayedSkeleton rows={2} />
        ) : repos.error instanceof ApiError ? (
          <ProblemState problem={repos.error.problem} onRetry={() => void repos.refetch()} className="p-0" />
        ) : (repos.data?.items.length ?? 0) === 0 ? (
          <p className="m-0 text-dense text-ink-2">
            This project has no Docker repositories in Artifact Registry. Type an image reference instead.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Repository">
                <Select<string>
                  value={repo ?? ''}
                  onValueChange={(v) => setRepo(v || null)}
                  options={[
                    { value: '', label: 'Choose a repository' },
                    ...(repos.data?.items ?? []).map((r) => ({ value: r.name, label: `${r.id} (${r.location})` })),
                  ]}
                />
              </Field>
              <Field label="Filter">
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Image or tag" />
              </Field>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-control border border-rule">
              {!repo ? (
                <p className="m-0 p-3 text-dense text-ink-3">Choose a repository to see its images.</p>
              ) : images.isPending ? (
                <DelayedSkeleton rows={4} />
              ) : images.error instanceof ApiError ? (
                <ProblemState problem={images.error.problem} className="p-3" />
              ) : grouped.length === 0 ? (
                <p className="m-0 p-3 text-dense text-ink-3">No images match.</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {grouped.map(([name, versions]) => (
                    <li key={name} className="border-b border-rule px-3 py-2 last:border-b-0">
                      <p className="m-0 mb-1 font-mono text-[12px] text-ink">{name}</p>
                      <ul className="m-0 flex list-none flex-col gap-1 p-0">
                        {versions.slice(0, 8).map((v) => (
                          <li key={v.digest} className="flex flex-wrap items-center gap-2 text-meta">
                            {v.tags.length > 0 ? (
                              v.tags.map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={() => pick(v, t)}
                                  className="rounded-[2px] border border-rule-strong px-1.5 font-mono text-[11px] text-ink hover:bg-hover"
                                >
                                  {t}
                                </button>
                              ))
                            ) : (
                              <span className="text-ink-3">untagged</span>
                            )}
                            <button
                              type="button"
                              onClick={() => pick(v, null)}
                              className="font-mono text-[11px] text-ink-2 underline underline-offset-2 hover:text-ink"
                            >
                              {v.digest.slice(0, 19)}
                            </button>
                            <span className="ml-auto text-ink-3">
                              <Timestamp iso={v.updateTime ?? v.uploadTime} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}
