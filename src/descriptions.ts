// Descriptions sourced from:
// https://docs.github.com/en/rest/rate-limit/rate-limit

const DESCRIPTIONS: Record<string, string> = {
  core: 'General REST API (5,000 req/hr authenticated, 60/hr unauthenticated). Covers most /repos, /users, /orgs endpoints.',
  search: 'Search API (/search/*): 30 req/min authenticated, 10/min unauthenticated.',
  graphql: 'GraphQL API (api.github.com/graphql): 5,000 points/hr.',
  code_search: 'Code search via REST (/search/code): 10 req/min authenticated.',
  integration_manifest: 'GitHub App manifest creation flow endpoints.',
  actions_runner_registration: 'Self-hosted runner registration tokens: 10,000 req/hr.',
  scim: 'SCIM provisioning for GitHub Enterprise: 15,000 req/hr.',
  dependency_snapshots: 'Dependency graph snapshot submission API.',
  code_scanning_upload: 'SARIF upload endpoint for Code Scanning results.',
  source_import: 'Source Import API for migrating repositories.',
};

export function getDescription(resource: string): string {
  return DESCRIPTIONS[resource] ?? `${resource} — GitHub API rate limit resource.`;
}
