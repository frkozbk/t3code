import { describe, expect, it } from "vite-plus/test";

import { jiraBasicAuthHeader, jiraSearchUrl, parseJiraIssues } from "./jira.ts";

describe("jiraSearchUrl", () => {
  it("normalizes the pasted site value", () => {
    for (const site of [
      "hesap.atlassian.net",
      "https://hesap.atlassian.net",
      "http://hesap.atlassian.net/",
      "  hesap.atlassian.net//  ",
    ]) {
      expect(jiraSearchUrl(site)).toBe("https://hesap.atlassian.net/rest/api/3/search/jql");
    }
  });
});

describe("jiraBasicAuthHeader", () => {
  it("base64-encodes email:token", () => {
    expect(jiraBasicAuthHeader("me@example.com", "t0ken")).toBe(
      `Basic ${Buffer.from("me@example.com:t0ken", "utf8").toString("base64")}`,
    );
  });
});

describe("parseJiraIssues", () => {
  it("reads key and summary from a search/jql response", () => {
    expect(
      parseJiraIssues({
        issues: [
          { id: "1", key: "HEM-123", fields: { summary: "Fix the thing" } },
          { id: "2", key: "HEM-124", fields: { summary: "Other thing" } },
        ],
        nextPageToken: null,
      }),
    ).toEqual([
      { key: "HEM-123", summary: "Fix the thing" },
      { key: "HEM-124", summary: "Other thing" },
    ]);
  });

  it("falls back to an empty summary when fields were not returned", () => {
    expect(parseJiraIssues({ issues: [{ key: "HEM-1" }] })).toEqual([
      { key: "HEM-1", summary: "" },
    ]);
  });

  it("skips rows without a usable key and tolerates unexpected bodies", () => {
    expect(parseJiraIssues({ issues: [{ key: "" }, { id: "3" }, null] })).toEqual([]);
    expect(parseJiraIssues({ errorMessages: ["nope"] })).toEqual([]);
    expect(parseJiraIssues(null)).toEqual([]);
  });
});
