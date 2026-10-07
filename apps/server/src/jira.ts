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
import { HttpClient, HttpClientRequest } from "effect/http";

import * as GitLabCli from "./sourceControl/GitLabCli.ts";

export const JIRA_TOKEN_SECRET_NAME = "jira-api-token";

export const JIRA_MY_ISSUES_JQL =
  "assignee = currentUser() AND (statusCategory != Done OR updated >= -14d) ORDER BY updated DESC";

const MAX_ISSUES = 50;

/** Normalizes whatever the user pasted — bare host, https://…, trailing slash. */
export function jiraHost(site: string): string {
  return site
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

export function jiraSearchUrl(site: string): string {
  return `https://${jiraHost(site)}/rest/api/3/search/jql`;
}

export function jiraBasicAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, "utf8").toString("base64")}`;
}

/** Reads `{ issues: [{ key, fields: { summary, status, issuetype, priority } }] }`, skipping junk rows. */
export function parseJiraIssues(body: unknown, site: string): readonly JiraIssue[] {
  const host = jiraHost(site);
  const issues = (body as { readonly issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: unknown) => {
    const key = (issue as { readonly key?: unknown } | null)?.key;
    if (typeof key !== "string" || key.length === 0) return [];
    const fields = (issue as { readonly fields?: unknown } | null)?.fields as
      | {
          readonly summary?: unknown;
          readonly status?: {
            readonly name?: unknown;
            readonly statusCategory?: { readonly key?: unknown };
          };
          readonly issuetype?: { readonly name?: unknown; readonly iconUrl?: unknown };
          readonly priority?: { readonly name?: unknown; readonly iconUrl?: unknown };
        }
      | undefined;
    const summary = fields?.summary;
    const status = fields?.status?.name;
    const statusCategory = fields?.status?.statusCategory?.key;
    const issueType = fields?.issuetype?.name;
    const issueTypeIconUrl = fields?.issuetype?.iconUrl;
    const priority = fields?.priority?.name;
    const priorityIconUrl = fields?.priority?.iconUrl;
    return [
      {
        key,
        summary: typeof summary === "string" ? summary : "",
        status: typeof status === "string" ? status : "",
        url: `https://${host}/browse/${key}`,
        ...(typeof statusCategory === "string" ? { statusCategory } : {}),
        ...(typeof issueType === "string" ? { issueType } : {}),
        ...(typeof issueTypeIconUrl === "string" ? { issueTypeIconUrl } : {}),
        ...(typeof priority === "string" ? { priority } : {}),
        ...(typeof priorityIconUrl === "string" ? { priorityIconUrl } : {}),
      },
    ];
  });
}

const CODE_REVIEW_STATUS = "CODE REVIEW";

function fetchMrApprovalCount(
  gitlab: GitLabCli.GitLabCli["Service"],
  cwd: string,
  issueKey: string,
): Effect.Effect<number> {
  return gitlab
    .execute({
      cwd,
      args: [
        "api",
        `projects/:fullpath/merge_requests?state=all&search=${encodeURIComponent(issueKey)}&per_page=10`,
      ],
    })
    .pipe(
      Effect.flatMap((result) =>
        Effect.try(() => {
          const items = JSON.parse(result.stdout.trim()) as Array<{
            iid: number;
            source_branch: string;
          }>;
          const keyLower = issueKey.toLowerCase();
          return Array.isArray(items)
            ? items.find((m) => m.source_branch.toLowerCase().includes(keyLower))
            : undefined;
        }),
      ),
      Effect.flatMap((mr) => {
        if (!mr) return Effect.succeed(0);
        return gitlab
          .execute({
            cwd,
            args: ["api", `projects/:fullpath/merge_requests/${mr.iid}/approvals`],
          })
          .pipe(
            Effect.flatMap((r) =>
              Effect.try(() => {
                const data = JSON.parse(r.stdout.trim()) as { approved_by: unknown[] };
                return Array.isArray(data?.approved_by) ? data.approved_by.length : 0;
              }),
            ),
          );
      }),
      Effect.orElseSucceed(() => 0),
    );
}

export const enrichWithPrApprovals = Effect.fn("Jira.enrichWithPrApprovals")(function* (
  issues: readonly JiraIssue[],
  cwd: string,
) {
  const codeReview = issues.filter((i) => i.status === CODE_REVIEW_STATUS);
  if (codeReview.length === 0) return issues;

  const gitlab = yield* GitLabCli.GitLabCli;
  const counts = yield* Effect.all(
    codeReview.map((issue) => fetchMrApprovalCount(gitlab, cwd, issue.key)),
    { concurrency: 5 },
  );

  const approvalMap = new Map(codeReview.map((issue, i) => [issue.key, counts[i]!]));
  return issues.map((issue) => {
    const count = approvalMap.get(issue.key);
    return count !== undefined ? { ...issue, prApprovals: count } : issue;
  });
});

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
      fields: ["summary", "status", "issuetype", "priority"],
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
  return parseJiraIssues(body, input.site);
});

function jiraTransitionsUrl(site: string, issueKey: string): string {
  return `https://${jiraHost(site)}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`;
}

/**
 * Moves an issue to `targetStatus` by looking up the workflow-specific
 * transition id first — Jira has no "set status" endpoint, only transitions.
 */
export const transitionJiraIssueByStatusName = Effect.fn("Jira.transitionJiraIssueByStatusName")(
  function* (input: {
    readonly site: string;
    readonly email: string;
    readonly token: string;
    readonly issueKey: string;
    readonly targetStatus: string;
  }) {
    const client = yield* HttpClient.HttpClient;
    const authHeader = jiraBasicAuthHeader(input.email, input.token);
    const url = jiraTransitionsUrl(input.site, input.issueKey);

    const listResponse = yield* client
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders({ authorization: authHeader, accept: "application/json" }),
        ),
      )
      .pipe(
        Effect.mapError(
          (cause) => new JiraError({ reason: "request-failed", detail: cause.message }),
        ),
      );
    if (listResponse.status < 200 || listResponse.status >= 300) {
      return yield* new JiraError({
        reason: "request-failed",
        detail: `Jira returned HTTP ${listResponse.status} listing transitions.`,
      });
    }
    const listBody = yield* listResponse.json.pipe(
      Effect.mapError(
        () => new JiraError({ reason: "request-failed", detail: "Jira returned a non-JSON body." }),
      ),
    );
    const transitions = (listBody as { readonly transitions?: unknown } | null)?.transitions;
    const match = Array.isArray(transitions)
      ? transitions.find(
          (t: unknown) =>
            (t as { readonly to?: { readonly name?: unknown } } | null)?.to?.name ===
            input.targetStatus,
        )
      : undefined;
    const transitionId = (match as { readonly id?: unknown } | undefined)?.id;
    if (typeof transitionId !== "string") {
      return yield* new JiraError({
        reason: "invalid-transition",
        detail: `No transition from the current status to "${input.targetStatus}" exists in this issue's workflow.`,
      });
    }

    const executeResponse = yield* client
      .execute(
        HttpClientRequest.post(url).pipe(
          HttpClientRequest.setHeaders({
            authorization: authHeader,
            accept: "application/json",
          }),
          HttpClientRequest.bodyJsonUnsafe({ transition: { id: transitionId } }),
        ),
      )
      .pipe(
        Effect.mapError(
          (cause) => new JiraError({ reason: "request-failed", detail: cause.message }),
        ),
      );
    if (executeResponse.status < 200 || executeResponse.status >= 300) {
      return yield* new JiraError({
        reason: "request-failed",
        detail: `Jira returned HTTP ${executeResponse.status} executing the transition.`,
      });
    }
  },
);
