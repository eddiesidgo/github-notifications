/**
 * Thin GitHub REST API client used by the main process.
 */
const { config } = require('../config');
const logger = require('./logger');

class GitHubApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'GitHubApiError';
    this.code = code;
    this.status = status;
  }
}

class GitHubApi {
  constructor() {
    this.accessToken = null;
  }

  setToken(token) {
    this.accessToken = token || null;
  }

  clearToken() {
    this.accessToken = null;
  }

  async request(pathname, options = {}) {
    if (!this.accessToken) {
      throw new GitHubApiError('Not authenticated', 'TOKEN_MISSING', 401);
    }

    const url = pathname.startsWith('http')
      ? pathname
      : `${config.github.apiBaseUrl}${pathname}`;

    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.accessToken}`,
      'User-Agent': config.appName,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    };

    let response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (err) {
      throw new GitHubApiError(
        `Network error talking to GitHub: ${err.message}`,
        'NETWORK_ERROR',
        0
      );
    }

    if (response.status === 304) {
      return { status: 304, data: null, etag: options.headers?.['If-None-Match'] || null };
    }

    const etag = response.headers.get('etag');
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (response.status === 401) {
      throw new GitHubApiError(
        'GitHub token is invalid or expired. Please sign in again.',
        'TOKEN_INVALID',
        401
      );
    }

    if (response.status === 403) {
      const msg =
        data?.message ||
        'Forbidden. Check token scopes or repository permissions.';
      throw new GitHubApiError(msg, 'FORBIDDEN', 403);
    }

    if (response.status === 404) {
      throw new GitHubApiError(
        'Repository not found or you do not have access.',
        'NOT_FOUND',
        404
      );
    }

    if (!response.ok) {
      const msg = data?.message || `GitHub API error (HTTP ${response.status})`;
      throw new GitHubApiError(msg, 'API_ERROR', response.status);
    }

    return { status: response.status, data, etag };
  }

  async getAuthenticatedUser() {
    const { data } = await this.request('/user');
    return {
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      htmlUrl: data.html_url,
      id: data.id,
    };
  }

  /**
   * Resolve owner/name and verify the authenticated user can access the repo.
   */
  async getRepository(owner, name) {
    const { data } = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
    return {
      id: data.id,
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name,
      private: data.private,
      defaultBranch: data.default_branch,
      htmlUrl: data.html_url,
    };
  }

  /**
   * Fetch a single commit (full message). Used when PushEvent.payload.commits
   * is empty or truncated (GitHub only embeds up to 20 commits in the event).
   */
  async getCommit(owner, name, ref) {
    const { data } = await this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(ref)}`
    );
    return {
      sha: data.sha,
      message: data.commit?.message || '',
      authorName: data.commit?.author?.name || data.author?.login || null,
      authorLogin: data.author?.login || null,
      htmlUrl: data.html_url,
    };
  }

  /**
   * Fetch recent repository events. Prefer ETag to skip unchanged payloads.
   * Push detection uses PushEvent entries from this endpoint.
   */
  async getRepositoryEvents(owner, name, { etag, perPage } = {}) {
    const qs = new URLSearchParams({
      per_page: String(perPage || config.monitor.eventsPerPage),
    });
    const headers = {};
    if (etag) headers['If-None-Match'] = etag;

    return this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/events?${qs}`,
      { headers }
    );
  }

  async searchUserRepos(query, limit = 20) {
    const q = encodeURIComponent(`${query} in:name fork:true`);
    const { data } = await this.request(
      `/search/repositories?q=${q}&per_page=${limit}`
    );
    return (data.items || []).map((item) => ({
      owner: item.owner.login,
      name: item.name,
      fullName: item.full_name,
      private: item.private,
      htmlUrl: item.html_url,
    }));
  }
}

module.exports = {
  githubApi: new GitHubApi(),
  GitHubApiError,
};
