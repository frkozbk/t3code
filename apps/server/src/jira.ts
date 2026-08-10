/**
 * Jira - personal issue lookup for the composer picker.
 *
 * Talks to Jira Cloud with basic auth (account email + personal API token).
 * The token lives in `ServerSecretStore` under {@link JIRA_TOKEN_SECRET_NAME};
 * callers pass it in here and nothing in this module logs or echoes it.
 *
 * Uses the enhanced search endpoint `POST /rest/api/3/search/jql` — the old
 * `GET /rest/api/3/search` is deprecated. That endpoint returns issue ids only
 * unless `fields` is requested explicitly.
 *
 * @module Jira
 */
import { JiraError, type JiraIssue } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

export const JIRA_TOKEN_SECRET_NAME = "jira-api-token";

export const JIRA_MY_ISSUES_JQL =
  "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";

const MAX_ISSUES = 50;

/**
 * Accepts whatever shape the user pasted into settings — bare host,
 * `https://…`, trailing slash — and returns the search endpoint URL.
 */
export function jiraSearchUrl(site: string): string {
  const host = site
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  return `https://${host}/rest/api/3/search/jql`;
}

export function jiraBasicAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, "utf8").toString("base64")}`;
}

/** Reads `{ issues: [{ key, fields: { summary } }] }`, skipping junk rows. */
export function parseJiraIssues(body: unknown): readonly JiraIssue[] {
  const issues = (body as { readonly issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: unknown) => {
    const key = (issue as { readonly key?: unknown } | null)?.key;
    if (typeof key !== "string" || key.length === 0) return [];
    const summary = (issue as { readonly fields?: { readonly summary?: unknown } } | null)?.fields
      ?.summary;
    return [{ key, summary: typeof summary === "string" ? summary : "" }];
  });
}

export const fetchMyJiraIssues = Effect.fn("Jira.fetchMyJiraIssues")(function* (input: {
  readonly site: string;
  readonly email: string;
  readonly token: string;
}) {
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.post(jiraSearchUrl(input.site)).pipe(
    HttpClientRequest.setHeaders({
      authorization: jiraBasicAuthHeader(input.email, input.token),
      accept: "application/json",
    }),
    HttpClientRequest.bodyJsonUnsafe({
      jql: JIRA_MY_ISSUES_JQL,
      fields: ["summary"],
      maxResults: MAX_ISSUES,
    }),
  );

  // The token travels in a header, never in the URL or body, so failure text
  // from this call is safe to surface to the client.
  const response = yield* client
    .execute(request)
    .pipe(
      Effect.mapError(
        (cause) => new JiraError({ reason: "request-failed", detail: cause.message }),
      ),
    );
  if (response.status < 200 || response.status >= 300) {
    return yield* new JiraError({
      reason: "request-failed",
      detail: `Jira returned HTTP ${response.status}.`,
    });
  }

  const body = yield* response.json.pipe(
    Effect.mapError(
      () => new JiraError({ reason: "request-failed", detail: "Jira returned a non-JSON body." }),
    ),
  );
  return parseJiraIssues(body);
});
