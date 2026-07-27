import { describe, expect, it } from 'vitest';
import { listGithubRepos } from '../src/fleet/github.js';

interface FakeRepo {
  full_name: string;
  clone_url: string;
  archived?: boolean;
  fork?: boolean;
}

interface Route {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Fake fetch keyed by "pathname?query"; records requests for assertions. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = url.pathname + url.search;
    calls.push({ url: key, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes[key];
    if (!route) throw new Error(`unexpected fetch: ${key}`);
    return new Response(JSON.stringify(route.body ?? []), {
      status: route.status,
      headers: route.headers,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const repo = (full_name: string, extra: Partial<FakeRepo> = {}): FakeRepo => ({
  full_name,
  clone_url: `https://github.com/${full_name}.git`,
  ...extra,
});

describe('listGithubRepos', () => {
  it('lists an org, skipping archived repos and forks by default', async () => {
    const { impl } = fakeFetch({
      '/orgs/acme/repos?per_page=100&page=1': {
        status: 200,
        body: [
          repo('acme/api'),
          repo('acme/old', { archived: true }),
          repo('acme/copied', { fork: true }),
        ],
      },
    });
    const repos = await listGithubRepos('acme', { fetchImpl: impl });
    expect(repos).toEqual([{ name: 'acme/api', url: 'https://github.com/acme/api.git' }]);
  });

  it('includes archived repos and forks when asked', async () => {
    const { impl } = fakeFetch({
      '/orgs/acme/repos?per_page=100&page=1': {
        status: 200,
        body: [repo('acme/old', { archived: true }), repo('acme/copied', { fork: true })],
      },
    });
    const repos = await listGithubRepos('acme', {
      fetchImpl: impl,
      includeArchived: true,
      includeForks: true,
    });
    expect(repos.map((r) => r.name)).toEqual(['acme/old', 'acme/copied']);
  });

  it('paginates until a short page', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => repo(`acme/repo${i}`));
    const { impl, calls } = fakeFetch({
      '/orgs/acme/repos?per_page=100&page=1': { status: 200, body: page1 },
      '/orgs/acme/repos?per_page=100&page=2': { status: 200, body: [repo('acme/last')] },
    });
    const repos = await listGithubRepos('acme', { fetchImpl: impl });
    expect(repos).toHaveLength(101);
    expect(calls).toHaveLength(2);
  });

  it('falls back to the users endpoint when the org 404s', async () => {
    const { impl } = fakeFetch({
      '/orgs/octocat/repos?per_page=100&page=1': { status: 404 },
      '/users/octocat/repos?per_page=100&page=1': { status: 200, body: [repo('octocat/hi')] },
    });
    const repos = await listGithubRepos('octocat', { fetchImpl: impl });
    expect(repos.map((r) => r.name)).toEqual(['octocat/hi']);
  });

  it('reports an unknown owner when both endpoints 404', async () => {
    const { impl } = fakeFetch({
      '/orgs/nope/repos?per_page=100&page=1': { status: 404 },
      '/users/nope/repos?per_page=100&page=1': { status: 404 },
    });
    await expect(listGithubRepos('nope', { fetchImpl: impl })).rejects.toThrow(/not found/i);
  });

  it('explains rate limiting and suggests --token', async () => {
    const { impl } = fakeFetch({
      '/orgs/acme/repos?per_page=100&page=1': {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      },
    });
    await expect(listGithubRepos('acme', { fetchImpl: impl })).rejects.toThrow(/--token/);
  });

  it('reports bad credentials on 401', async () => {
    const { impl } = fakeFetch({
      '/orgs/acme/repos?per_page=100&page=1': { status: 401 },
    });
    await expect(listGithubRepos('acme', { fetchImpl: impl, token: 'bad' })).rejects.toThrow(
      /credentials|token/i,
    );
  });

  it('returns an empty list for an empty org', async () => {
    const { impl } = fakeFetch({
      '/orgs/empty/repos?per_page=100&page=1': { status: 200, body: [] },
    });
    expect(await listGithubRepos('empty', { fetchImpl: impl })).toEqual([]);
  });

  it('sends the token as a bearer Authorization header', async () => {
    const { impl, calls } = fakeFetch({
      '/orgs/acme/repos?per_page=100&page=1': { status: 200, body: [] },
    });
    await listGithubRepos('acme', { fetchImpl: impl, token: 'sekret' });
    expect(calls[0]?.headers['Authorization']).toBe('Bearer sekret');
  });
});
