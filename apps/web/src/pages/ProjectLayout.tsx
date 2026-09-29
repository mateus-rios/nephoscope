import { Outlet, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TitleBlock } from '../design/Drafting';
import { ProblemState } from '../design/Feedback';
import { ApiError } from '../lib/api';
import { useActiveProfile, useProject } from '../state/queries';

/**
 * Project-scoped pages. A project the key cannot open shows the problem with the permission it
 * lacks, and the project picker stays in the title strip (SPEC-0001 CA-23).
 */
export function ProjectLayout() {
  const { projectId } = useParams({ from: '/p/$projectId' });
  const project = useProject(projectId);
  const { profile } = useActiveProfile();

  useEffect(() => {
    document.title = `${project.data?.name ?? projectId} · Nephoscope`;
  }, [project.data?.name, projectId]);

  // The emulators accept any project id, so an emulators-only profile opens it anyway (SPEC-0001 D-18).
  if (project.error instanceof ApiError && project.error.problem.code !== 'UNAVAILABLE' && profile?.type !== 'emulator_only') {
    return (
      <div>
        <TitleBlock title={projectId} subtitle="This project could not be opened with the active profile." />
        <ProblemState problem={project.error.problem} onRetry={() => void project.refetch()} />
      </div>
    );
  }
  return <Outlet />;
}
