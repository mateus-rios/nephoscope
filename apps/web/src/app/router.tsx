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
const ColabPage = lazyRouteComponent(() => import('../products/colab/ColabPage'), 'ColabPage');
const ColabNotebookPage = lazyRouteComponent(() => import('../products/colab/NotebookPage'), 'NotebookPage');
const ColabRuntimePage = lazyRouteComponent(() => import('../products/colab/RuntimePage'), 'RuntimePage');
const ColabTemplatePage = lazyRouteComponent(() => import('../products/colab/TemplatePage'), 'TemplatePage');
const ColabExecutionPage = lazyRouteComponent(() => import('../products/colab/ExecutionPage'), 'ExecutionPage');
const ColabSchedulePage = lazyRouteComponent(() => import('../products/colab/SchedulePage'), 'SchedulePage');
const LoggingPage = lazyRouteComponent(() => import('../products/logging/LoggingPage'), 'LoggingPage');
const MonitoringPage = lazyRouteComponent(() => import('../products/monitoring/MonitoringPage'), 'MonitoringPage');
const DashboardPage = lazyRouteComponent(() => import('../products/monitoring/Dashboards'), 'DashboardPage');
const AlertPolicyPage = lazyRouteComponent(() => import('../products/monitoring/Alerts'), 'AlertPolicyPage');
const ErrorsPage = lazyRouteComponent(() => import('../products/errorreporting/ErrorsPage'), 'ErrorsPage');
const ErrorGroupPage = lazyRouteComponent(() => import('../products/errorreporting/ErrorsPage'), 'ErrorGroupPage');
const TracePage = lazyRouteComponent(() => import('../products/trace/TracePages'), 'TracePage');
const TraceViewPage = lazyRouteComponent(() => import('../products/trace/TracePages'), 'TraceViewPage');
const IamPage = lazyRouteComponent(() => import('../products/iam/IamPage'), 'IamPage');
const ServiceAccountPage = lazyRouteComponent(() => import('../products/iam/ServiceAccounts'), 'ServiceAccountPage');
const SecretsPage = lazyRouteComponent(() => import('../products/secrets/SecretsPage'), 'SecretsPage');
const SecretPage = lazyRouteComponent(() => import('../products/secrets/SecretPage'), 'SecretPage');
const KmsPage = lazyRouteComponent(() => import('../products/kms/KmsPages'), 'KmsPage');
const KeyRingPage = lazyRouteComponent(() => import('../products/kms/KmsPages'), 'KeyRingPage');
const CryptoKeyPage = lazyRouteComponent(() => import('../products/kms/KmsPages'), 'CryptoKeyPage');
const ArmorPage = lazyRouteComponent(() => import('../products/armor/ArmorPages'), 'ArmorPage');
const ArmorPolicyPage = lazyRouteComponent(() => import('../products/armor/ArmorPages'), 'ArmorPolicyPage');
const RegistryPage = lazyRouteComponent(() => import('../products/registry/RegistryPages'), 'RegistryPage');
const RepositoryPage = lazyRouteComponent(() => import('../products/registry/RegistryPages'), 'RepositoryPage');
const CloudBuildPage = lazyRouteComponent(() => import('../products/delivery/BuildPages'), 'CloudBuildPage');
const BuildPage = lazyRouteComponent(() => import('../products/delivery/BuildPages'), 'BuildPage');
const CloudDeployPage = lazyRouteComponent(() => import('../products/delivery/DeployPages'), 'CloudDeployPage');
const PipelinePage = lazyRouteComponent(() => import('../products/delivery/DeployPages'), 'PipelinePage');
const BigQueryPage = lazyRouteComponent(() => import('../products/bigquery/BigQueryPages'), 'BigQueryPage');
const BqDatasetPage = lazyRouteComponent(() => import('../products/bigquery/BigQueryPages'), 'BqDatasetPage');
const BqTablePage = lazyRouteComponent(() => import('../products/bigquery/BigQueryPages'), 'BqTablePage');
const DnsPage = lazyRouteComponent(() => import('../products/dns/DnsPages'), 'DnsPage');
const DnsZonePage = lazyRouteComponent(() => import('../products/dns/DnsPages'), 'DnsZonePage');
const LoadBalancingPage = lazyRouteComponent(() => import('../products/loadbalancing/LoadBalancingPage'), 'LoadBalancingPage');
const AppEnginePage = lazyRouteComponent(() => import('../products/appengine/AppEnginePage'), 'AppEnginePage');
const RawApiPage = lazyRouteComponent(() => import('../products/rawapi/RawApiPage'), 'RawApiPage');
const BillingPage = lazyRouteComponent(() => import('../products/governance/GovernancePages'), 'BillingPage');
const QuotasPage = lazyRouteComponent(() => import('../products/governance/GovernancePages'), 'QuotasPage');
const RecommendationsPage = lazyRouteComponent(() => import('../products/governance/GovernancePages'), 'RecommendationsPage');
const OrgPoliciesPage = lazyRouteComponent(() => import('../products/governance/GovernancePages'), 'OrgPoliciesPage');
const KitProductPage = lazyRouteComponent(() => import('../products/kit/KitProductPage'), 'KitProductPage');
const KitItemPage = lazyRouteComponent(() => import('../products/kit/KitItemPage'), 'KitItemPage');

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
  productRoute('/colab', ColabPage),
  productRoute('/colab/notebooks/$location/$notebook', ColabNotebookPage),
  productRoute('/colab/runtimes/$location/$runtime', ColabRuntimePage),
  productRoute('/colab/templates/$location/$template', ColabTemplatePage),
  productRoute('/colab/executions/$location/$execution', ColabExecutionPage),
  productRoute('/colab/schedules/$location/$schedule', ColabSchedulePage),
  productRoute('/logging', LoggingPage),
  productRoute('/monitoring', MonitoringPage),
  productRoute('/monitoring/dashboards/$dashboard', DashboardPage),
  productRoute('/monitoring/alerts/$policy', AlertPolicyPage),
  productRoute('/errorreporting', ErrorsPage),
  productRoute('/errorreporting/$group', ErrorGroupPage),
  productRoute('/trace', TracePage),
  productRoute('/trace/$traceId', TraceViewPage),
  productRoute('/iam', IamPage),
  productRoute('/iam/serviceaccounts/$email', ServiceAccountPage),
  productRoute('/secretmanager', SecretsPage),
  productRoute('/secretmanager/$location/$secret', SecretPage),
  productRoute('/kms', KmsPage),
  productRoute('/kms/$location/$ring', KeyRingPage),
  productRoute('/kms/$location/$ring/$key', CryptoKeyPage),
  productRoute('/armor', ArmorPage),
  productRoute('/armor/$scope/$policy', ArmorPolicyPage),
  productRoute('/artifactregistry', RegistryPage),
  productRoute('/artifactregistry/$location/$repo', RepositoryPage),
  productRoute('/cloudbuild', CloudBuildPage),
  productRoute('/cloudbuild/builds/$location/$build', BuildPage),
  productRoute('/clouddeploy', CloudDeployPage),
  productRoute('/clouddeploy/$location/$pipeline', PipelinePage),
  productRoute('/bigquery', BigQueryPage),
  productRoute('/bigquery/$dsProject/$dataset', BqDatasetPage),
  productRoute('/bigquery/$dsProject/$dataset/$table', BqTablePage),
  productRoute('/dns', DnsPage),
  productRoute('/dns/$zone', DnsZonePage),
  productRoute('/loadbalancing', LoadBalancingPage),
  productRoute('/appengine', AppEnginePage),
  productRoute('/rawapi', RawApiPage),
  productRoute('/billing', BillingPage),
  productRoute('/quotas', QuotasPage),
  productRoute('/recommender', RecommendationsPage),
  productRoute('/orgpolicy', OrgPoliciesPage),
  // Resource kit pages (SPEC-0001 D-16): any product without a page of its own, and kit resources.
  productRoute('/r/$product/$collection/$', KitItemPage),
  productRoute('/$product', KitProductPage),
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
