import type { RepoSource } from './targets.js';

export interface GithubListOptions {
  token?: string;
  includeArchived?: boolean;
  includeForks?: boolean;
  fetchImpl?: typeof fetch;
}

interface GithubRepoJson {
  full_name: string;
  clone_url: string;
  archived?: boolean;
  fork?: boolean;
}

const API = 'https://api.github.com';
const PER_PAGE = 100;

function headers(token: string | undefined): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'unrot',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function listPages(
  path: string,
  opts: GithubListOptions,
): Promise<GithubRepoJson[] | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const repos: GithubRepoJson[] = [];
  for (let page = 1; ; page++) {
    const response = await fetchImpl(`${API}${path}?per_page=${PER_PAGE}&page=${page}`, {
      headers: headers(opts.token),
    });
    if (response.status === 404) return null;
    if (response.status === 401) {
      throw new Error('GitHub rejected the token (bad credentials)');
    }
    if (
      (response.status === 403 || response.status === 429) &&
      response.headers.get('x-ratelimit-remaining') === '0'
    ) {
      throw new Error(
        'GitHub API rate limit exceeded. Authenticate with --token <token> or the GITHUB_TOKEN env var to raise the limit.',
      );
    }
    if (!response.ok) {
      throw new Error(`GitHub API request failed (${response.status}) for ${path}`);
    }
    const batch = (await response.json()) as GithubRepoJson[];
    repos.push(...batch);
    if (batch.length < PER_PAGE) return repos;
  }
}

export async function listGithubRepos(
  owner: string,
  opts: GithubListOptions = {},
): Promise<RepoSource[]> {
  const repos =
    (await listPages(`/orgs/${owner}/repos`, opts)) ??
    (await listPages(`/users/${owner}/repos`, opts));
  if (repos === null) throw new Error(`GitHub org or user not found: ${owner}`);
  return repos
    .filter((repo) => (opts.includeArchived || !repo.archived) && (opts.includeForks || !repo.fork))
    .map((repo) => ({ name: repo.full_name, url: repo.clone_url }));
}
