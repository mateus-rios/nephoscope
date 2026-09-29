import { CaretDownIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { useEffect, useMemo, useState } from 'react';
import { Legend } from '../design/Drafting';
import { Popover } from '../design/Overlays';
import { Spinner } from '../design/Status';
import { useProject, useProjectSearch, useRecentProjects } from '../state/queries';

const ID_LIKE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Swaps the project segment of the current path, keeping the product page (SPEC-0001 CA-21). */
function pathForProject(current: string, projectId: string): string {
  const m = /^\/p\/[^/]+(\/.*)?$/.exec(current);
  const rest = m?.[1] ?? '';
  return `/p/${encodeURIComponent(projectId)}${rest}`;
}

export function ProjectPicker({ projectId }: { projectId: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 200);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const project = useProject(projectId);
  const recents = useRecentProjects();
  const search = useProjectSearch(debounced, open);

  const results = search.data?.items ?? [];
  const recentIds = useMemo(() => (recents.data ?? []).filter((id) => id !== projectId), [recents.data, projectId]);
  const typedId = query.trim().toLowerCase();
  const offerTyped = ID_LIKE.test(typedId) && !results.some((p) => p.projectId === typedId);

  const go = (id: string) => {
    setOpen(false);
    setQuery('');
    void navigate({ to: pathForProject(pathname, id) });
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Choose a project"
      className="w-[min(480px,calc(100vw-32px))] p-0"
      trigger={
        <button
          type="button"
          className="flex h-full min-w-0 flex-col items-start justify-center gap-0 px-4 text-left hover:bg-hover"
          aria-label={projectId ? `Project ${projectId}. Change project` : 'Choose a project'}
        >
          <Legend>Project</Legend>
          <span className="flex max-w-[34ch] min-w-0 items-center gap-1.5 text-dense text-ink">
            <span className="truncate font-medium">{projectId ? project.data?.name || projectId : 'Choose a project'}</span>
            {projectId ? <span className="truncate font-mono text-[11px] text-ink-3">{projectId}</span> : null}
            <CaretDownIcon size={12} className="shrink-0 text-ink-3" aria-hidden />
          </span>
        </button>
      }
    >
      <Command shouldFilter={false} label="Projects" className="flex flex-col">
        <div className="flex items-center gap-2 border-b border-rule px-3">
          <MagnifyingGlassIcon size={14} className="text-ink-3" aria-hidden />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Find a project by name or id"
            className="h-10 w-full bg-transparent text-dense text-ink outline-none placeholder:text-ink-3"
          />
          {search.isFetching ? <Spinner label="Searching projects" /> : null}
        </div>
        <Command.List className="max-h-80 overflow-y-auto p-1">
          {search.isError ? (
            <div className="px-3 py-3 text-dense text-ink-2">This key cannot list projects. Type a project id to open it.</div>
          ) : null}
          {offerTyped ? (
            <Command.Group
              heading="Open by id"
              className="[&_[cmdk-group-heading]]:legend [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1"
            >
              <Command.Item
                value={`id:${typedId}`}
                onSelect={() => go(typedId)}
                className="flex h-9 items-center gap-2 rounded-control px-2 text-dense data-[selected=true]:bg-hover"
              >
                <span className="font-mono text-[12px] text-ink">{typedId}</span>
              </Command.Item>
            </Command.Group>
          ) : null}
          {!query && recentIds.length > 0 ? (
            <Command.Group
              heading="Recent"
              className="[&_[cmdk-group-heading]]:legend [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1"
            >
              {recentIds.map((id) => (
                <Command.Item
                  key={`r-${id}`}
                  value={`recent:${id}`}
                  onSelect={() => go(id)}
                  className="flex h-9 items-center gap-2 rounded-control px-2 text-dense data-[selected=true]:bg-hover"
                >
                  <span className="font-mono text-[12px] text-ink">{id}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {results.length > 0 ? (
            <Command.Group
              heading={query ? 'Matches' : 'Projects'}
              className="[&_[cmdk-group-heading]]:legend [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1"
            >
              {results.map((p) => (
                <Command.Item
                  key={p.projectId}
                  value={`p:${p.projectId}`}
                  onSelect={() => go(p.projectId)}
                  className="flex h-9 items-center justify-between gap-3 rounded-control px-2 text-dense data-[selected=true]:bg-hover"
                >
                  <span className="truncate text-ink">{p.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-3">{p.projectId}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {!search.isFetching && !search.isError && results.length === 0 && !offerTyped ? (
            <div className="px-3 py-3 text-dense text-ink-2">
              {query ? 'No project matches. Type a full project id to open it directly.' : 'No projects are visible to this key yet.'}
            </div>
          ) : null}
        </Command.List>
      </Command>
    </Popover>
  );
}
