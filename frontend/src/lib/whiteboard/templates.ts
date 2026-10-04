'use client';

export type BoardTemplate = {
  id: string;
  name: string;
  description: string;
  /** Starter D2 source applied to the new room's editor. */
  d2: string;
};

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: 'microservices',
    name: 'Microservices map',
    description: 'API gateway, services, and a Postgres store.',
    d2: `api-gateway -> auth-service: validates\napi-gateway -> billing-service: routes\nbilling-service -> postgres: reads/writes\n`,
  },
  {
    id: 'sprint-planning',
    name: 'Sprint planning',
    description: 'Now / next / later lanes for the coming sprint.',
    d2: `now: Sprint goal\nnext: Stretch items\nlater: Backlog\n\nnow -> next: ships into\nnext -> later: defers to\n`,
  },
  {
    id: 'api-flow',
    name: 'API request flow',
    description: 'Client to edge to origin request path.',
    d2: `client -> cdn: GET /app\ncdn -> edge-auth: verify token\nedge-auth -> origin-api: proxy\norigin-api -> db: query\n`,
  },
  {
    id: 'infra',
    name: 'Infrastructure map',
    description: 'Region, VPC, and managed services.',
    d2: `region: us-east-1 {\n  vpc: 10.0.0.0/16\n  rds: postgres 16\n}\napp -> vpc: deploys into\napp -> rds: connects\n`,
  },
  {
    id: 'event-pipeline',
    name: 'Event pipeline',
    description: 'Producers, bus, and consumers.',
    d2: `producer -> kafka: publishes events\nkafka -> consumer-a: fan-out\nkafka -> consumer-b: fan-out\nconsumer-a -> warehouse: loads\n`,
  },
  {
    id: 'auth-sequence',
    name: 'Auth sequence',
    description: 'Login, SSO fallback, and session issue.',
    d2: `user -> login: email + password\nlogin -> sso: fallback when enterprise\nsso -> session: u1 token\nlogin -> session: u1 token\n`,
  },
  {
    id: 'onboarding',
    name: 'Team onboarding',
    description: 'Docs, pairing, and first deploy checklist.',
    d2: `docs: read the runbook\npairing: first week buddy\ndeploy: ship a docs fix\n\ndocs -> pairing: then\npairing -> deploy: then\n`,
  },
  {
    id: 'rfc',
    name: 'RFC diagram',
    description: 'Blank-ish RFC skeleton for proposals.',
    d2: `problem: what hurts today\nproposal: what changes\nrollout: how we ship\n\nproblem -> proposal: motivates\nproposal -> rollout: ships via\n`,
  },
];
