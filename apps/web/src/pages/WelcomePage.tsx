import type { ProjectSummary } from '@nephoscope/contracts';
import { KeyIcon } from '@phosphor-icons/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button, buttonClass } from '../design/Button';
import { Legend, Section, TitleBlock } from '../design/Drafting';
import { DelayedSkeleton, EmptyState, ProblemState } from '../design/Feedback';
import { Input } from '../design/Form';
import { type ResourceColumn, ResourceTable } from '../design/ResourceTable';
import { StatusGlyph } from '../design/Status';
import { Kbd, Mono, Timestamp } from '../design/Values';
import { ApiError } from '../lib/api';
import { useActiveProfile, useProjectSearch, useRecentProjects } from '../state/queries';

/** First run: no key anywhere yet (SPEC-0001 CA-02). */
function FirstRun() {
  return (
    <div className="pb-16">
      <TitleBlock title="Nephoscope" subtitle="A console for Google Cloud that runs on your machine, with your own keys." />
      <section className="max-w-[75ch] px-6 py-6">
        <Legend as="h2" className="mt-0 mb-3">
          To start
        </Legend>
        <ol className="m-0 flex list-none flex-col gap-4 p-0">
          <li className="grid grid-cols-[1.5rem_1fr] gap-x-2">
            <span className="tnum font-mono text-[12px] text-ink-3">1.</span>
            <span className="flex flex-col items-start gap-2 text-dense text-ink">
              Add a key: a service account JSON key, the gcloud credentials file, or a workload identity configuration.
              <Link to="/connections" className={buttonClass({ variant: 'commit' })}>
                <KeyIcon size={16} aria-hidden />
                Add a key
              </Link>
            </span>
          </li>
          <li className="grid grid-cols-[1.5rem_1fr] gap-x-2">
            <span className="tnum font-mono text-[12px] text-ink-3">2.</span>
            <span className="text-dense text-ink">Pick a project. Nephoscope lists the projects the key can see.</span>
          </li>
          <li className="grid grid-cols-[1.5rem_1fr] gap-x-2">
            <span className="tnum font-mono text-[12px] text-ink-3">3.</span>
            <span className="text-dense text-ink">
              Press <Kbd>Ctrl K</Kbd> anywhere to jump to a product or a resource, and <Kbd>?</Kbd> for every shortcut.
            </span>
          </li>
        </ol>
        <p className="mt-6 mb-0 text-meta text-ink-3">
          Or restart Nephoscope with GOOGLE_APPLICATION_CREDENTIALS pointing at a key. It then appears as the Environment profile.
        </p>
      </section>
    </div>
  );
}

/** Home without a project: recent projects and every project the key can see (SPEC-0001 CA-20). */
export function WelcomePage() {
  const { profile, profiles, loading } = useActiveProfile();
  const recents = useRecentProjects();
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const search = useProjectSearch(query, !!profile);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'Nephoscope';
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(filter.trim()), 250);
    return () => window.clearTimeout(t);
  }, [filter]);

  if (loading) return <DelayedSkeleton rows={4} className="p-6" />;
  if (profiles.length === 0) return <FirstRun />;

  const columns: ResourceColumn<ProjectSummary>[] = [
    {
      id: 'name',
      header: 'Project',
      hideable: false,
      sortValue: (p) => p.name,
      cell: (p) => (
        <Link to="/p/$projectId" params={{ projectId: p.projectId }} className="font-medium text-ink" onClick={(e) => e.stopPropagation()}>
          {p.name}
        </Link>
      ),
    },
    { id: 'id', header: 'Project id', sortValue: (p) => p.projectId, cell: (p) => <Mono value={p.projectId} copy /> },
    {
      id: 'number',
      header: 'Number',
      width: '9rem',
      defaultHidden: true,
      cell: (p) => (p.projectNumber ? <Mono value={p.projectNumber} /> : null),
    },
    {
      id: 'state',
      header: 'State',
      width: '10rem',
      sortValue: (p) => p.state,
      cell: (p) =>
        p.state === 'ACTIVE' ? <StatusGlyph kind="ok" label="Active" /> : <StatusGlyph kind="warn" label="Deletion requested" />,
    },
    {
      id: 'parent',
      header: 'Parent',
      width: '12rem',
      cell: (p) =>
        p.parent ? <span className="text-ink-2">{`${p.parent.type} ${p.parent.id}`}</span> : <span className="text-ink-3">None</span>,
    },
    {
      id: 'created',
      header: 'Created',
      width: '8rem',
      sortValue: (p) => p.createTime ?? '',
      cell: (p) => <Timestamp iso={p.createTime} />,
    },
  ];

  const recentIds = recents.data ?? [];

  return (
    <div className="pb-16">
      <TitleBlock
        title="Projects"
        subtitle={profile ? `Acting as ${profile.name}. Pick a project to open its bill of materials.` : undefined}
        cells={profile?.principal ? [{ label: 'Principal', value: <Mono value={profile.principal} />, wide: true }] : undefined}
      />
      {recentIds.length > 0 ? (
        <Section title="Recent">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0 px-6">
            {recentIds.slice(0, 8).map((id) => (
              <li key={id}>
                <Link to="/p/$projectId" params={{ projectId: id }} className="font-mono text-[12px]">
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Every project this key can see">
        {search.isPending && !search.data ? (
          <DelayedSkeleton rows={6} />
        ) : search.error instanceof ApiError ? (
          <ProblemState problem={search.error.problem} onRetry={() => void search.refetch()} />
        ) : (
          <ResourceTable
            tableId="projects"
            label="Projects"
            rows={search.data?.items ?? []}
            columns={columns}
            getRowId={(p) => p.projectId}
            onOpen={(p) => void navigate({ to: '/p/$projectId', params: { projectId: p.projectId } })}
            filtered={!!query}
            emptyTitle="This key sees no project"
            emptyText="Grant it a role on a project, such as Viewer, or open a project by its id with the picker."
            noMatchAction={<Button onClick={() => setFilter('')}>Clear the search</Button>}
            toolbar={
              <Input
                data-filter-input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search by name or id"
                aria-label="Search projects"
                className="max-w-72"
              />
            }
          />
        )}
      </Section>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <EmptyState
      title="No sheet at this address"
      action={
        <Link to="/" className={buttonClass()}>
          Go to projects
        </Link>
      }
    >
      The address does not match any page of Nephoscope. Products still to come are listed on each project's home.
    </EmptyState>
  );
}
