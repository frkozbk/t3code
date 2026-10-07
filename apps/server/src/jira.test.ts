import { describe, expect, it } from "vite-plus/test";
import { assert, it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  jiraBasicAuthHeader,
  jiraHost,
  jiraSearchUrl,
  parseJiraIssues,
  transitionJiraIssueByStatusName,
} from "./jira.ts";

const isJiraError = (error: unknown): error is { reason: string; detail: string } =>
  typeof error === "object" && error !== null && "reason" in error;

describe("jiraHost", () => {
  it("normalizes the pasted site value", () => {
    for (const site of [
      "hesap.atlassian.net",
      "https://hesap.atlassian.net",
      "http://hesap.atlassian.net/",
      "  hesap.atlassian.net//  ",
    ]) {
      expect(jiraHost(site)).toBe("hesap.atlassian.net");
    }
  });
});

describe("jiraSearchUrl", () => {
  it("builds the search endpoint from a site", () => {
    expect(jiraSearchUrl("hesap.atlassian.net")).toBe(
      "https://hesap.atlassian.net/rest/api/3/search/jql",
    );
  });
});

describe("jiraBasicAuthHeader", () => {
  it("base64-encodes email:token", () => {
    expect(jiraBasicAuthHeader("me@example.com", "t0ken")).toBe(
      `Basic ${Buffer.from("me@example.com:t0ken", "utf8").toString("base64")}`,
    );
  });
});

const SITE = "example.atlassian.net";

describe("parseJiraIssues", () => {
  it("reads key, summary, status and url from a search/jql response", () => {
    expect(
      parseJiraIssues(
        {
          issues: [
            {
              id: "1",
              key: "HEM-123",
              fields: { summary: "Fix the thing", status: { name: "In Progress" } },
            },
            {
              id: "2",
              key: "HEM-124",
              fields: { summary: "Other thing", status: { name: "To Do" } },
            },
          ],
          nextPageToken: null,
        },
        SITE,
      ),
    ).toEqual([
      {
        key: "HEM-123",
        summary: "Fix the thing",
        status: "In Progress",
        url: "https://example.atlassian.net/browse/HEM-123",
      },
      {
        key: "HEM-124",
        summary: "Other thing",
        status: "To Do",
        url: "https://example.atlassian.net/browse/HEM-124",
      },
    ]);
  });

  it("reads statusCategory, issue type, and priority when present", () => {
    expect(
      parseJiraIssues(
        {
          issues: [
            {
              key: "HEM-123",
              fields: {
                summary: "Fix the thing",
                status: {
                  name: "In Progress",
                  statusCategory: { key: "indeterminate" },
                },
                issuetype: { name: "Bug", iconUrl: "https://example.atlassian.net/bug.png" },
                priority: { name: "High", iconUrl: "https://example.atlassian.net/high.png" },
              },
            },
          ],
        },
        SITE,
      ),
    ).toEqual([
      {
        key: "HEM-123",
        summary: "Fix the thing",
        status: "In Progress",
        statusCategory: "indeterminate",
        url: "https://example.atlassian.net/browse/HEM-123",
        issueType: "Bug",
        issueTypeIconUrl: "https://example.atlassian.net/bug.png",
        priority: "High",
        priorityIconUrl: "https://example.atlassian.net/high.png",
      },
    ]);
  });

  it("falls back to empty strings when fields were not returned", () => {
    expect(parseJiraIssues({ issues: [{ key: "HEM-1" }] }, SITE)).toEqual([
      { key: "HEM-1", summary: "", status: "", url: "https://example.atlassian.net/browse/HEM-1" },
    ]);
  });

  it("skips rows without a usable key and tolerates unexpected bodies", () => {
    expect(parseJiraIssues({ issues: [{ key: "" }, { id: "3" }, null] }, SITE)).toEqual([]);
    expect(parseJiraIssues({ errorMessages: ["nope"] }, SITE)).toEqual([]);
    expect(parseJiraIssues(null, SITE)).toEqual([]);
  });
});

const mockHttpClient = (respond: (request: { method: string; url: string }) => Response) =>
  HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request))),
  );

describe("transitionJiraIssueByStatusName", () => {
  effectIt.effect("executes the transition matching the target status name", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      const client = mockHttpClient((request) => {
        calls.push(request.method);
        if (request.method === "GET") {
          return new Response(
            JSON.stringify({
              transitions: [
                { id: "11", name: "Start Progress", to: { name: "In Progress" } },
                { id: "31", name: "Done", to: { name: "Done" } },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(null, { status: 204 });
      });

      yield* transitionJiraIssueByStatusName({
        site: SITE,
        email: "me@example.com",
        token: "t0ken",
        issueKey: "HEM-1",
        targetStatus: "Done",
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      assert.deepEqual(calls, ["GET", "POST"]);
    }),
  );

  effectIt.effect("fails with invalid-transition when no transition targets that status", () =>
    Effect.gen(function* () {
      const client = mockHttpClient(
        () =>
          new Response(
            JSON.stringify({ transitions: [{ id: "11", to: { name: "In Progress" } }] }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      );

      const error = yield* transitionJiraIssueByStatusName({
        site: SITE,
        email: "me@example.com",
        token: "t0ken",
        issueKey: "HEM-1",
        targetStatus: "Done",
      }).pipe(Effect.provideService(HttpClient.HttpClient, client), Effect.flip);

      assert.isTrue(isJiraError(error) && error.reason === "invalid-transition");
    }),
  );
});
