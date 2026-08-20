import * as Schema from "effect/Schema";

/** One Jira issue, reduced to what the composer picker renders. */
export const JiraIssue = Schema.Struct({
  key: Schema.String,
  summary: Schema.String,
  status: Schema.String,
  url: Schema.String,
  prApprovals: Schema.optional(Schema.Number),
});
export type JiraIssue = typeof JiraIssue.Type;

export const JiraErrorReason = Schema.Literals(["not-configured", "request-failed"]);
export type JiraErrorReason = typeof JiraErrorReason.Type;

export class JiraError extends Schema.TaggedErrorClass<JiraError>()("JiraError", {
  reason: JiraErrorReason,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
