import type { BoardNode } from './board-types';
import { STENCIL_ICONS, type StencilIconDef } from './stencil-data';

/**
 * Architecture Stencil Registry.
 *
 * Vector icons are sourced directly from industry-standard third-party libraries:
 * - @aws-icons/react (Official AWS Architecture Service icons)
 * - simple-icons (Official vectors for Kubernetes, Docker, PostgreSQL, Redis, Kafka, GCP, etc.)
 * - devicons-react & Microsoft Azure (Official Azure Architecture icons)
 *
 * All icons are pre-compiled into lightweight static vector markup with source viewBoxes
 * for zero-runtime overhead, crisp infinite-canvas scaling, and fast SVG/PDF export.
 */

export type StencilCategory =
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'k8s'
  | 'database'
  | 'messaging'
  | 'runtime';

export type StencilDefinition = {
  /** Stable id, `<category>:<slug>` — also the D2 `icon:` value. */
  id: string;
  name: string;
  category: StencilCategory;
  defaultLabel: string;
  defaultDetail: string;
  defaultTone: BoardNode['tone'];
  /** Accent color used by the stencil icon. */
  color: string;
  /** Inner SVG markup for the icon. */
  body: string;
  /** Source coordinate viewBox (e.g. '0 0 24 24', '0 0 64 64', '0 0 128 128'). */
  viewBox: string;
  /** Third-party library origin. */
  source: string;
  keywords: string[];
};

export const STENCIL_CATEGORIES: Array<{
  id: StencilCategory;
  label: string;
}> = [
  { id: 'aws', label: 'AWS' },
  { id: 'gcp', label: 'GCP' },
  { id: 'azure', label: 'Azure' },
  { id: 'k8s', label: 'Kubernetes' },
  { id: 'database', label: 'Databases' },
  { id: 'messaging', label: 'Queues' },
  { id: 'runtime', label: 'Runtime' },
];

/** Default spawn size for a stencil node (world units). */
export const STENCIL_NODE_SIZE = { width: 128, height: 100 } as const;

type StencilMeta = {
  id: string;
  name: string;
  category: StencilCategory;
  defaultLabel: string;
  defaultDetail: string;
  defaultTone: BoardNode['tone'];
  keywords: string[];
};

const STENCIL_METADATA: StencilMeta[] = [
  // --- AWS (sourced from @aws-icons/react) ---
  {
    id: 'aws:ec2',
    name: 'Amazon EC2',
    category: 'aws',
    defaultLabel: 'Amazon EC2',
    defaultDetail: 'Virtual servers',
    defaultTone: 'orange',
    keywords: ['vm', 'compute', 'instance', 'server'],
  },
  {
    id: 'aws:lambda',
    name: 'AWS Lambda',
    category: 'aws',
    defaultLabel: 'AWS Lambda',
    defaultDetail: 'Serverless functions',
    defaultTone: 'orange',
    keywords: ['faas', 'serverless', 'function'],
  },
  {
    id: 'aws:s3',
    name: 'Amazon S3',
    category: 'aws',
    defaultLabel: 'Amazon S3',
    defaultDetail: 'Object storage',
    defaultTone: 'mint',
    keywords: ['blob', 'bucket', 'storage'],
  },
  {
    id: 'aws:rds',
    name: 'Amazon RDS',
    category: 'aws',
    defaultLabel: 'Amazon RDS',
    defaultDetail: 'Managed relational DB',
    defaultTone: 'blue',
    keywords: ['database', 'sql', 'postgres', 'mysql'],
  },
  {
    id: 'aws:dynamodb',
    name: 'DynamoDB',
    category: 'aws',
    defaultLabel: 'DynamoDB',
    defaultDetail: 'Managed NoSQL key-value',
    defaultTone: 'blue',
    keywords: ['database', 'nosql', 'kv', 'dynamo'],
  },
  {
    id: 'aws:apigw',
    name: 'API Gateway',
    category: 'aws',
    defaultLabel: 'API Gateway',
    defaultDetail: 'Managed API front door',
    defaultTone: 'violet',
    keywords: ['gateway', 'rest', 'api', 'http'],
  },
  {
    id: 'aws:sqs',
    name: 'Amazon SQS',
    category: 'aws',
    defaultLabel: 'Amazon SQS',
    defaultDetail: 'Message queue',
    defaultTone: 'violet',
    keywords: ['queue', 'message', 'fifo'],
  },
  {
    id: 'aws:sns',
    name: 'Amazon SNS',
    category: 'aws',
    defaultLabel: 'Amazon SNS',
    defaultDetail: 'Pub/sub notifications',
    defaultTone: 'violet',
    keywords: ['pubsub', 'topic', 'notification', 'push'],
  },
  {
    id: 'aws:ecs',
    name: 'Amazon ECS',
    category: 'aws',
    defaultLabel: 'Amazon ECS',
    defaultDetail: 'Container service',
    defaultTone: 'orange',
    keywords: ['container', 'docker', 'task'],
  },
  {
    id: 'aws:cloudfront',
    name: 'CloudFront',
    category: 'aws',
    defaultLabel: 'CloudFront',
    defaultDetail: 'Global CDN',
    defaultTone: 'violet',
    keywords: ['cdn', 'edge', 'cache', 'proxy'],
  },
  {
    id: 'aws:eks',
    name: 'Amazon EKS',
    category: 'aws',
    defaultLabel: 'Amazon EKS',
    defaultDetail: 'Managed Kubernetes',
    defaultTone: 'orange',
    keywords: ['k8s', 'kubernetes', 'cluster', 'container'],
  },
  {
    id: 'aws:cognito',
    name: 'Amazon Cognito',
    category: 'aws',
    defaultLabel: 'Cognito',
    defaultDetail: 'User auth & identity',
    defaultTone: 'violet',
    keywords: ['auth', 'login', 'jwt', 'iam'],
  },
  {
    id: 'aws:route53',
    name: 'Amazon Route 53',
    category: 'aws',
    defaultLabel: 'Route 53',
    defaultDetail: 'Scalable DNS',
    defaultTone: 'violet',
    keywords: ['dns', 'domain', 'routing'],
  },
  {
    id: 'aws:aurora',
    name: 'Amazon Aurora',
    category: 'aws',
    defaultLabel: 'Aurora',
    defaultDetail: 'Cloud relational DB',
    defaultTone: 'blue',
    keywords: ['database', 'sql', 'mysql', 'postgres'],
  },
  {
    id: 'aws:redshift',
    name: 'Amazon Redshift',
    category: 'aws',
    defaultLabel: 'Redshift',
    defaultDetail: 'Cloud data warehouse',
    defaultTone: 'blue',
    keywords: ['dw', 'analytics', 'olap', 'sql'],
  },
  {
    id: 'aws:fargate',
    name: 'AWS Fargate',
    category: 'aws',
    defaultLabel: 'Fargate',
    defaultDetail: 'Serverless containers',
    defaultTone: 'orange',
    keywords: ['serverless', 'container', 'ecs', 'eks'],
  },
  {
    id: 'aws:eventbridge',
    name: 'EventBridge',
    category: 'aws',
    defaultLabel: 'EventBridge',
    defaultDetail: 'Serverless event bus',
    defaultTone: 'violet',
    keywords: ['events', 'bus', 'pubsub'],
  },
  {
    id: 'aws:cloudwatch',
    name: 'CloudWatch',
    category: 'aws',
    defaultLabel: 'CloudWatch',
    defaultDetail: 'Monitoring & metrics',
    defaultTone: 'violet',
    keywords: ['observability', 'logs', 'metrics', 'alarm'],
  },

  // --- GCP (sourced from simple-icons) ---
  {
    id: 'gcp:cloudrun',
    name: 'Cloud Run',
    category: 'gcp',
    defaultLabel: 'Cloud Run',
    defaultDetail: 'Serverless containers',
    defaultTone: 'blue',
    keywords: ['container', 'serverless', 'docker', 'gcp'],
  },
  {
    id: 'gcp:gke',
    name: 'GKE',
    category: 'gcp',
    defaultLabel: 'GKE',
    defaultDetail: 'Google Kubernetes Engine',
    defaultTone: 'blue',
    keywords: ['kubernetes', 'k8s', 'cluster', 'container'],
  },
  {
    id: 'gcp:functions',
    name: 'Cloud Functions',
    category: 'gcp',
    defaultLabel: 'Cloud Functions',
    defaultDetail: 'Event-driven functions',
    defaultTone: 'blue',
    keywords: ['faas', 'serverless', 'gcp'],
  },
  {
    id: 'gcp:bigquery',
    name: 'BigQuery',
    category: 'gcp',
    defaultLabel: 'BigQuery',
    defaultDetail: 'Cloud data warehouse',
    defaultTone: 'blue',
    keywords: ['analytics', 'sql', 'dw', 'data'],
  },
  {
    id: 'gcp:spanner',
    name: 'Cloud Spanner',
    category: 'gcp',
    defaultLabel: 'Cloud Spanner',
    defaultDetail: 'Global relational DB',
    defaultTone: 'blue',
    keywords: ['database', 'sql', 'acid', 'relational'],
  },
  {
    id: 'gcp:gcs',
    name: 'Cloud Storage',
    category: 'gcp',
    defaultLabel: 'Cloud Storage',
    defaultDetail: 'Object storage',
    defaultTone: 'blue',
    keywords: ['blob', 'bucket', 'storage'],
  },
  {
    id: 'gcp:pubsub',
    name: 'Pub/Sub',
    category: 'gcp',
    defaultLabel: 'Pub/Sub',
    defaultDetail: 'Global event messaging',
    defaultTone: 'blue',
    keywords: ['messaging', 'queue', 'stream', 'events'],
  },
  {
    id: 'gcp:gce',
    name: 'Compute Engine',
    category: 'gcp',
    defaultLabel: 'Compute Engine',
    defaultDetail: 'Virtual machines',
    defaultTone: 'blue',
    keywords: ['vm', 'iaas', 'server', 'compute'],
  },
  {
    id: 'gcp:dataflow',
    name: 'Cloud Dataflow',
    category: 'gcp',
    defaultLabel: 'Dataflow',
    defaultDetail: 'Stream & batch processing',
    defaultTone: 'orange',
    keywords: ['apache-beam', 'streaming', 'etl', 'pipeline'],
  },
  {
    id: 'gcp:dataproc',
    name: 'Cloud Dataproc',
    category: 'gcp',
    defaultLabel: 'Dataproc',
    defaultDetail: 'Managed Spark & Hadoop',
    defaultTone: 'blue',
    keywords: ['spark', 'hadoop', 'bigdata'],
  },
  {
    id: 'gcp:composer',
    name: 'Cloud Composer',
    category: 'gcp',
    defaultLabel: 'Cloud Composer',
    defaultDetail: 'Managed Apache Airflow',
    defaultTone: 'blue',
    keywords: ['airflow', 'dag', 'orchestration', 'pipeline'],
  },
  {
    id: 'gcp:bigtable',
    name: 'Cloud Bigtable',
    category: 'gcp',
    defaultLabel: 'Cloud Bigtable',
    defaultDetail: 'NoSQL wide-column DB',
    defaultTone: 'blue',
    keywords: ['nosql', 'database', 'hbase'],
  },

  // --- Azure (sourced from devicons-react & Azure architecture icons) ---
  {
    id: 'azure:cloud',
    name: 'Microsoft Azure',
    category: 'azure',
    defaultLabel: 'Microsoft Azure',
    defaultDetail: 'Cloud platform',
    defaultTone: 'blue',
    keywords: ['cloud', 'microsoft'],
  },
  {
    id: 'azure:vm',
    name: 'Virtual Machine',
    category: 'azure',
    defaultLabel: 'Virtual Machine',
    defaultDetail: 'IaaS compute',
    defaultTone: 'blue',
    keywords: ['vm', 'compute', 'iaas', 'instance'],
  },
  {
    id: 'azure:functions',
    name: 'Azure Functions',
    category: 'azure',
    defaultLabel: 'Azure Functions',
    defaultDetail: 'Serverless compute',
    defaultTone: 'blue',
    keywords: ['faas', 'serverless', 'function'],
  },
  {
    id: 'azure:blob',
    name: 'Blob Storage',
    category: 'azure',
    defaultLabel: 'Blob Storage',
    defaultDetail: 'Object storage',
    defaultTone: 'blue',
    keywords: ['storage', 'bucket', 'blob'],
  },
  {
    id: 'azure:cosmos',
    name: 'Cosmos DB',
    category: 'azure',
    defaultLabel: 'Cosmos DB',
    defaultDetail: 'Global NoSQL database',
    defaultTone: 'blue',
    keywords: ['database', 'nosql', 'document', 'mongo'],
  },
  {
    id: 'azure:aks',
    name: 'AKS',
    category: 'azure',
    defaultLabel: 'AKS',
    defaultDetail: 'Azure Kubernetes Service',
    defaultTone: 'blue',
    keywords: ['k8s', 'kubernetes', 'containers'],
  },
  {
    id: 'azure:sqldb',
    name: 'Azure SQL Database',
    category: 'azure',
    defaultLabel: 'Azure SQL',
    defaultDetail: 'Managed SQL database',
    defaultTone: 'blue',
    keywords: ['database', 'sql', 'mssql', 'relational'],
  },
  {
    id: 'azure:devops',
    name: 'Azure DevOps',
    category: 'azure',
    defaultLabel: 'Azure DevOps',
    defaultDetail: 'CI/CD pipelines & git',
    defaultTone: 'blue',
    keywords: ['cicd', 'pipeline', 'git', 'repos'],
  },
  {
    id: 'azure:mssql',
    name: 'SQL Server',
    category: 'azure',
    defaultLabel: 'SQL Server',
    defaultDetail: 'Enterprise SQL database',
    defaultTone: 'orange',
    keywords: ['database', 'sql', 'microsoft', 'mssql'],
  },
  {
    id: 'azure:servicebus',
    name: 'Service Bus',
    category: 'azure',
    defaultLabel: 'Service Bus',
    defaultDetail: 'Enterprise messaging broker',
    defaultTone: 'blue',
    keywords: ['queue', 'messaging', 'broker', 'pubsub'],
  },
  {
    id: 'azure:loadbalancer',
    name: 'Azure Load Balancer',
    category: 'azure',
    defaultLabel: 'Load Balancer',
    defaultDetail: 'Layer 4 traffic distribution',
    defaultTone: 'blue',
    keywords: ['lb', 'networking', 'traffic'],
  },
  {
    id: 'azure:appgateway',
    name: 'Application Gateway',
    category: 'azure',
    defaultLabel: 'App Gateway',
    defaultDetail: 'Layer 7 load balancer & WAF',
    defaultTone: 'blue',
    keywords: ['alb', 'waf', 'gateway', 'proxy'],
  },
  {
    id: 'azure:eventhubs',
    name: 'Event Hubs',
    category: 'azure',
    defaultLabel: 'Event Hubs',
    defaultDetail: 'Big data event streaming',
    defaultTone: 'blue',
    keywords: ['streaming', 'kafka', 'events', 'telemetry'],
  },

  // --- Kubernetes (sourced from simple-icons) ---
  {
    id: 'k8s:pod',
    name: 'Pod',
    category: 'k8s',
    defaultLabel: 'Pod',
    defaultDetail: 'Smallest deployable unit',
    defaultTone: 'blue',
    keywords: ['container', 'workload', 'instance'],
  },
  {
    id: 'k8s:service',
    name: 'Service',
    category: 'k8s',
    defaultLabel: 'Service',
    defaultDetail: 'Stable network endpoint',
    defaultTone: 'blue',
    keywords: ['networking', 'clusterip', 'loadbalancer'],
  },
  {
    id: 'k8s:ingress',
    name: 'Ingress',
    category: 'k8s',
    defaultLabel: 'Ingress',
    defaultDetail: 'HTTP / HTTPS routing',
    defaultTone: 'blue',
    keywords: ['routing', 'gateway', 'reverse-proxy'],
  },
  {
    id: 'k8s:deployment',
    name: 'Deployment',
    category: 'k8s',
    defaultLabel: 'Deployment',
    defaultDetail: 'Declarative Pod management',
    defaultTone: 'blue',
    keywords: ['workload', 'replicaset', 'scaling'],
  },
  {
    id: 'k8s:configmap',
    name: 'ConfigMap',
    category: 'k8s',
    defaultLabel: 'ConfigMap',
    defaultDetail: 'Key-value configuration data',
    defaultTone: 'blue',
    keywords: ['config', 'environment', 'variables'],
  },
  {
    id: 'k8s:statefulset',
    name: 'StatefulSet',
    category: 'k8s',
    defaultLabel: 'StatefulSet',
    defaultDetail: 'Stateful workload controller',
    defaultTone: 'blue',
    keywords: ['database', 'state', 'replica'],
  },
  {
    id: 'k8s:volume',
    name: 'Persistent Volume',
    category: 'k8s',
    defaultLabel: 'Volume',
    defaultDetail: 'Persistent cluster storage',
    defaultTone: 'blue',
    keywords: ['pvc', 'storage', 'disk'],
  },
  {
    id: 'k8s:helm',
    name: 'Helm',
    category: 'k8s',
    defaultLabel: 'Helm',
    defaultDetail: 'Kubernetes package manager',
    defaultTone: 'blue',
    keywords: ['charts', 'package', 'deploy'],
  },

  // --- Databases (sourced from simple-icons) ---
  {
    id: 'database:postgres',
    name: 'PostgreSQL',
    category: 'database',
    defaultLabel: 'PostgreSQL',
    defaultDetail: 'Relational database',
    defaultTone: 'blue',
    keywords: ['sql', 'pg', 'rdbms', 'relational'],
  },
  {
    id: 'database:mysql',
    name: 'MySQL',
    category: 'database',
    defaultLabel: 'MySQL',
    defaultDetail: 'Relational database',
    defaultTone: 'blue',
    keywords: ['sql', 'mariadb', 'rdbms'],
  },
  {
    id: 'database:redis',
    name: 'Redis',
    category: 'database',
    defaultLabel: 'Redis',
    defaultDetail: 'In-memory cache & store',
    defaultTone: 'orange',
    keywords: ['cache', 'in-memory', 'kv', 'pubsub'],
  },
  {
    id: 'database:mongodb',
    name: 'MongoDB',
    category: 'database',
    defaultLabel: 'MongoDB',
    defaultDetail: 'Document database',
    defaultTone: 'mint',
    keywords: ['nosql', 'document', 'json'],
  },
  {
    id: 'database:elasticsearch',
    name: 'Elasticsearch',
    category: 'database',
    defaultLabel: 'Elasticsearch',
    defaultDetail: 'Distributed search engine',
    defaultTone: 'mint',
    keywords: ['search', 'elk', 'lucene', 'analytics'],
  },
  {
    id: 'database:cassandra',
    name: 'Cassandra',
    category: 'database',
    defaultLabel: 'Cassandra',
    defaultDetail: 'Wide-column store',
    defaultTone: 'blue',
    keywords: ['nosql', 'distributed', 'apache'],
  },
  {
    id: 'database:sqlite',
    name: 'SQLite',
    category: 'database',
    defaultLabel: 'SQLite',
    defaultDetail: 'Embedded SQL engine',
    defaultTone: 'blue',
    keywords: ['sql', 'embedded', 'local', 'lightweight'],
  },
  {
    id: 'database:neo4j',
    name: 'Neo4j',
    category: 'database',
    defaultLabel: 'Neo4j',
    defaultDetail: 'Graph database',
    defaultTone: 'blue',
    keywords: ['graph', 'cypher', 'nodes', 'edges'],
  },
  {
    id: 'database:supabase',
    name: 'Supabase',
    category: 'database',
    defaultLabel: 'Supabase',
    defaultDetail: 'Open source Postgres platform',
    defaultTone: 'mint',
    keywords: ['postgres', 'baas', 'auth', 'database'],
  },

  // --- Messaging (sourced from simple-icons) ---
  {
    id: 'messaging:kafka',
    name: 'Apache Kafka',
    category: 'messaging',
    defaultLabel: 'Apache Kafka',
    defaultDetail: 'Distributed event streaming',
    defaultTone: 'violet',
    keywords: ['stream', 'event', 'queue', 'pubsub'],
  },
  {
    id: 'messaging:rabbitmq',
    name: 'RabbitMQ',
    category: 'messaging',
    defaultLabel: 'RabbitMQ',
    defaultDetail: 'AMQP message broker',
    defaultTone: 'orange',
    keywords: ['queue', 'broker', 'amqp'],
  },
  {
    id: 'messaging:nats',
    name: 'NATS',
    category: 'messaging',
    defaultLabel: 'NATS',
    defaultDetail: 'Lightweight cloud messaging',
    defaultTone: 'blue',
    keywords: ['pubsub', 'microservices', 'messaging'],
  },
  {
    id: 'messaging:pulsar',
    name: 'Apache Pulsar',
    category: 'messaging',
    defaultLabel: 'Apache Pulsar',
    defaultDetail: 'Cloud-native distributed messaging',
    defaultTone: 'blue',
    keywords: ['stream', 'queue', 'pubsub'],
  },

  // --- Runtime (sourced from simple-icons) ---
  {
    id: 'runtime:docker',
    name: 'Docker',
    category: 'runtime',
    defaultLabel: 'Docker',
    defaultDetail: 'Container runtime',
    defaultTone: 'blue',
    keywords: ['container', 'image', 'runtime', 'dockerfile'],
  },
  {
    id: 'runtime:nginx',
    name: 'NGINX',
    category: 'runtime',
    defaultLabel: 'NGINX',
    defaultDetail: 'Reverse proxy & web server',
    defaultTone: 'mint',
    keywords: ['proxy', 'loadbalancer', 'http', 'web'],
  },
  {
    id: 'runtime:envoy',
    name: 'Envoy',
    category: 'runtime',
    defaultLabel: 'Envoy Proxy',
    defaultDetail: 'Service mesh proxy',
    defaultTone: 'violet',
    keywords: ['proxy', 'mesh', 'istio'],
  },
  {
    id: 'runtime:graphql',
    name: 'GraphQL',
    category: 'runtime',
    defaultLabel: 'GraphQL',
    defaultDetail: 'API query language',
    defaultTone: 'violet',
    keywords: ['api', 'query', 'schema', 'apollo'],
  },
  {
    id: 'runtime:terraform',
    name: 'Terraform',
    category: 'runtime',
    defaultLabel: 'Terraform',
    defaultDetail: 'Infrastructure as Code',
    defaultTone: 'violet',
    keywords: ['iac', 'hcl', 'cloud', 'provision'],
  },
  {
    id: 'runtime:linux',
    name: 'Linux',
    category: 'runtime',
    defaultLabel: 'Linux',
    defaultDetail: 'Operating system',
    defaultTone: 'yellow',
    keywords: ['os', 'kernel', 'unix', 'server'],
  },
  {
    id: 'runtime:go',
    name: 'Go',
    category: 'runtime',
    defaultLabel: 'Go',
    defaultDetail: 'Compiled systems language',
    defaultTone: 'mint',
    keywords: ['golang', 'backend', 'concurrent'],
  },
  {
    id: 'runtime:python',
    name: 'Python',
    category: 'runtime',
    defaultLabel: 'Python',
    defaultDetail: 'General-purpose / AI language',
    defaultTone: 'blue',
    keywords: ['ai', 'scripting', 'backend'],
  },
  {
    id: 'runtime:node',
    name: 'Node.js',
    category: 'runtime',
    defaultLabel: 'Node.js',
    defaultDetail: 'JavaScript runtime',
    defaultTone: 'mint',
    keywords: ['javascript', 'npm', 'backend', 'v8'],
  },
  {
    id: 'runtime:rust',
    name: 'Rust',
    category: 'runtime',
    defaultLabel: 'Rust',
    defaultDetail: 'Fast & memory-safe language',
    defaultTone: 'orange',
    keywords: ['systems', 'wasm', 'performance'],
  },
  {
    id: 'runtime:grafana',
    name: 'Grafana',
    category: 'runtime',
    defaultLabel: 'Grafana',
    defaultDetail: 'Operational dashboards',
    defaultTone: 'orange',
    keywords: ['observability', 'metrics', 'monitoring', 'charts'],
  },
  {
    id: 'runtime:prometheus',
    name: 'Prometheus',
    category: 'runtime',
    defaultLabel: 'Prometheus',
    defaultDetail: 'Time-series monitoring',
    defaultTone: 'orange',
    keywords: ['metrics', 'alerting', 'monitoring'],
  },
];

export const STENCILS: StencilDefinition[] = STENCIL_METADATA.map((meta) => {
  const icon: StencilIconDef | undefined = STENCIL_ICONS[meta.id];
  const [cat, slug] = meta.id.split(':') as [StencilCategory, string];

  return {
    id: meta.id,
    name: meta.name,
    category: meta.category,
    defaultLabel: meta.defaultLabel,
    defaultDetail: meta.defaultDetail,
    defaultTone: meta.defaultTone,
    color: icon?.color || '#3b82d9',
    body: icon?.body || '',
    viewBox: icon?.viewBox || '0 0 24 24',
    source: icon?.source || 'third-party',
    keywords: [slug, cat, ...meta.keywords],
  };
});

const STENCIL_BY_ID = new Map(STENCILS.map((s) => [s.id, s]));

export function getStencil(id: string | undefined): StencilDefinition | null {
  return id ? (STENCIL_BY_ID.get(id) ?? null) : null;
}

/** Case-insensitive search across name, detail, source, and keywords. */
export function searchStencils(
  query: string,
  category?: StencilCategory | 'all',
): StencilDefinition[] {
  const q = query.trim().toLowerCase();
  return STENCILS.filter((s) => {
    if (category && category !== 'all' && s.category !== category) return false;
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      s.defaultDetail.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q) ||
      s.keywords.some((k) => k.toLowerCase().includes(q))
    );
  });
}

/** Build a ready-to-insert stencil node at a world position (top-left). */
export function createStencilNode(
  stencil: StencilDefinition,
  id: string,
  x: number,
  y: number,
): BoardNode {
  return {
    id,
    label: stencil.defaultLabel,
    detail: stencil.defaultDetail,
    x,
    y,
    width: STENCIL_NODE_SIZE.width,
    height: STENCIL_NODE_SIZE.height,
    tone: stencil.defaultTone,
    icon: stencil.id,
    iconLayout: 'hero',
  };
}
