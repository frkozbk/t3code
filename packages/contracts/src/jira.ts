import * as Schema from "effect/Schema";

/** One Jira issue, reduced to what the composer picker and board render. */
export const JiraIssue = Schema.Struct({
  key: Schema.String,
  summary: Schema.String,
  status: Schema.String,
  statusCategory: Schema.optional(Schema.String),
  url: Schema.String,
  prApprovals: Schema.optional(Schema.Number),
  issueType: Schema.optional(Schema.String),
  issueTypeIconUrl: Schema.optional(Schema.String),
  priority: Schema.optional(Schema.String),
  priorityIconUrl: Schema.optional(Schema.String),
});
export type JiraIssue = typeof JiraIssue.Type;

export const JiraErrorReason = Schema.Literals([
  "not-configured",
  "request-failed",
  "invalid-transition",
]);
export type JiraErrorReason = typeof JiraErrorReason.Type;

export class JiraError extends Schema.TaggedErrorClass<JiraError>()("JiraError", {
  reason: JiraErrorReason,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
