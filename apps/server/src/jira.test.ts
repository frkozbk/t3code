import { describe, expect, it } from "vite-plus/test";

import { jiraBasicAuthHeader, jiraHost, jiraSearchUrl, parseJiraIssues } from "./jira.ts";

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
