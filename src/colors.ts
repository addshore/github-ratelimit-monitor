const RESOURCE_COLORS: Record<string, string> = {
  core: '#00d4aa',
  search: '#ff6b6b',
  graphql: '#ffd93d',
  code_search: '#6bcb77',
  integration_manifest: '#4d96ff',
  actions_runner_registration: '#ff922b',
  scim: '#845ef7',
  dependency_snapshots: '#f06595',
  code_scanning_upload: '#20c997',
  source_import: '#339af0',
};

const FALLBACK_COLORS = [
  '#e64980', '#f76707', '#868e96', '#fab005', '#82c91e',
  '#15aabf', '#7950f2', '#e8590c', '#12b886', '#4c6ef5',
];

let nextIndex = 0;

export function getColor(resource: string): string {
  if (RESOURCE_COLORS[resource]) return RESOURCE_COLORS[resource];
  const color = FALLBACK_COLORS[nextIndex % FALLBACK_COLORS.length];
  RESOURCE_COLORS[resource] = color;
  nextIndex++;
  return color;
}
