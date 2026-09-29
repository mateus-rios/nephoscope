import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { passthroughSearch } from '../kit/urlState';
import { NotFoundPage, WelcomePage } from '../pages/WelcomePage';
import { useSession } from '../state/session';
import { CommandPalette } from './CommandPalette';
import { Hotkeys, ShortcutSheet } from './Hotkeys';
import { OperationsBridge } from './Operations';
import { Shell } from './Shell';

// Pages load on demand; the welcome page stays in the entry chunk for the first paint.
const ActivityPage = lazyRouteComponent(() => import('../pages/ActivityPage'), 'ActivityPage');
const ApisPage = lazyRouteComponent(() => import('../pages/ApisPage'), 'ApisPage');
const ConnectionsPage = lazyRouteComponent(() => import('../pages/ConnectionsPage'), 'ConnectionsPage');
const KitPage = lazyRouteComponent(() => import('../pages/KitPage'), 'KitPage');
const ProjectHome = lazyRouteComponent(() => import('../pages/ProjectHome'), 'ProjectHome');
const ProjectLayout = lazyRouteComponent(() => import('../pages/ProjectLayout'), 'ProjectLayout');
const RunPage = lazyRouteComponent(() => import('../products/run/RunPage'), 'RunPage');
const RunServicePage = lazyRouteComponent(() => import('../products/run/ServicePage'), 'ServicePage');
const RunJobPage = lazyRouteComponent(() => import('../products/run/JobPage'), 'JobPage');
const RunExecutionPage = lazyRouteComponent(() => import('../products/run/ExecutionPage'), 'ExecutionPage');
const FunctionsPage = lazyRouteComponent(() => import('../products/functions/FunctionsPage'), 'FunctionsPage');
const FunctionPage = lazyRouteComponent(() => import('../products/functions/FunctionPage'), 'FunctionPage');
const WorkflowsPage = lazyRouteComponent(() => import('../products/workflows/WorkflowsPage'), 'WorkflowsPage');
const WorkflowPage = lazyRouteComponent(() => import('../products/workflows/WorkflowPage'), 'WorkflowPage');
const WorkflowExecutionPage = lazyRouteComponent(() => import('../products/workflows/WorkflowExecutionPage'), 'WorkflowExecutionPage');
const SchedulerPage = lazyRouteComponent(() => import('../products/scheduler/SchedulerPage'), 'SchedulerPage');
const SchedulerJobPage = lazyRouteComponent(() => import('../products/scheduler/SchedulerJobPage'), 'SchedulerJobPage');
const TasksPage = lazyRouteComponent(() => import('../products/tasks/TasksPage'), 'TasksPage');
const QueuePage = lazyRouteComponent(() => import('../products/tasks/QueuePage'), 'QueuePage');
const EventarcPage = lazyRouteComponent(() => import('../products/eventarc/EventarcPage'), 'EventarcPage');
const FirestorePage = lazyRouteComponent(() => import('../products/firestore/FirestorePage'), 'FirestorePage');
const FirestoreDatabasePage = lazyRouteComponent(() => import('../products/firestore/DatabasePage'), 'DatabasePage');
const PubSubPage = lazyRouteComponent(() => import('../products/pubsub/PubSubPage'), 'PubSubPage');
const PubSubTopicPage = lazyRouteComponent(() => import('../products/pubsub/TopicPage'), 'TopicPage');
const PubSubSubscriptionPage = lazyRouteComponent(() => import('../products/pubsub/SubscriptionPage'), 'SubscriptionPage');
const PubSubSchemaPage = lazyRouteComponent(() => import('../products/pubsub/SchemaPage'), 'SchemaPage');
const StoragePage = lazyRouteComponent(() => import('../products/storage/StoragePage'), 'StoragePage');
const StorageBucketPage = lazyRouteComponent(() => import('../products/storage/BucketPage'), 'BucketPage');

function RootLayout() {
  const theme = useSession((s) => s.theme);
  return (
    <>
      <Shell />
      <CommandPalette />
      <ShortcutSheet />
      <Hotkeys />
      <OperationsBridge />
      {/* Bottom right, away from the title strip; toasts stack and never cover the commit (SPEC-0002 CA-25). */}
      <Toaster position="bottom-right" theme={theme} closeButton visibleToasts={4} toastOptions={{ className: 'nb-toast' }} />
    </>
  );
}

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFoundPage });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: WelcomePage });
const connectionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/connections', component: ConnectionsPage });
const activityRoute = createRoute({ getParentRoute: () => rootRoute, path: '/activity', component: ActivityPage });

const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$projectId', component: ProjectLayout });
const projectHomeRoute = createRoute({ getParentRoute: () => projectRoute, path: '/', component: ProjectHome });
const apisRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/apis',
  component: ApisPage,
  validateSearch: (search: Record<string, unknown>): { tab?: 'enabled' | 'available' } =>
    search.tab === 'available' ? { tab: 'available' } : search.tab === 'enabled' ? { tab: 'enabled' } : {},
});
const projectActivityRoute = createRoute({ getParentRoute: () => projectRoute, path: '/activity', component: ActivityPage });

// Product pages keep their view state in search params (SPEC-0001 CA-61).
const productRoute = (path: string, component: Parameters<typeof createRoute>[0]['component']) =>
  createRoute({ getParentRoute: () => projectRoute, path, component, validateSearch: passthroughSearch });
const runRoutes = [
  productRoute('/run', RunPage),
  productRoute('/run/services/$location/$service', RunServicePage),
  productRoute('/run/jobs/$location/$job', RunJobPage),
  productRoute('/run/jobs/$location/$job/executions/$execution', RunExecutionPage),
  productRoute('/functions', FunctionsPage),
  productRoute('/functions/$location/$fn', FunctionPage),
  productRoute('/workflows', WorkflowsPage),
  productRoute('/workflows/$location/$workflow', WorkflowPage),
  productRoute('/workflows/$location/$workflow/executions/$execution', WorkflowExecutionPage),
  productRoute('/scheduler', SchedulerPage),
  productRoute('/scheduler/$location/$job', SchedulerJobPage),
  productRoute('/tasks', TasksPage),
  productRoute('/tasks/$location/$queue', QueuePage),
  productRoute('/eventarc', EventarcPage),
  productRoute('/firestore', FirestorePage),
  productRoute('/firestore/$database', FirestoreDatabasePage),
  productRoute('/pubsub', PubSubPage),
  productRoute('/pubsub/topics/$topic', PubSubTopicPage),
  productRoute('/pubsub/subscriptions/$subscription', PubSubSubscriptionPage),
  productRoute('/pubsub/schemas/$schema', PubSubSchemaPage),
  productRoute('/storage', StoragePage),
  productRoute('/storage/$bucket', StorageBucketPage),
];

const kitRoute = createRoute({ getParentRoute: () => rootRoute, path: '/_kit', component: import.meta.env.DEV ? KitPage : NotFoundPage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  connectionsRoute,
  activityRoute,
  projectRoute.addChildren([projectHomeRoute, apisRoute, projectActivityRoute, ...runRoutes]),
  kitRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  // Scroll lives in the main pane, not the window.
  scrollRestoration: true,
  scrollToTopSelectors: ['#main'],
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
