import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError, TextGenerationError } from "./git.ts";
import { ModelSelection } from "./orchestration.ts";
import { VcsError } from "./vcs.ts";

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals(["working-tree", "branch-range"]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewDiffFileContentsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sourceKind: ReviewDiffPreviewSourceKind,
  changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  oldPath: TrimmedNonEmptyString,
  newPath: TrimmedNonEmptyString,
});
export type ReviewDiffFileContentsInput = typeof ReviewDiffFileContentsInput.Type;

export const ReviewDiffFileContentsResult = Schema.Struct({
  oldContents: Schema.String,
  newContents: Schema.String,
});
export type ReviewDiffFileContentsResult = typeof ReviewDiffFileContentsResult.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;

export const ReviewGuideInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  diff: Schema.String,
  modelSelection: ModelSelection,
});
export type ReviewGuideInput = typeof ReviewGuideInput.Type;

/**
 * Chapters are ordered by review priority: core change first, tests/generated last.
 * `flow` is a before/after chain of steps; `chapter` is the 1-based chapter that
 * introduces a step, or 0 when no chapter does. `concerns` are possible problems the
 * model could point to in a chapter file; usually empty.
 */
export const ReviewGuide = Schema.Struct({
  summary: Schema.String,
  points: Schema.Array(Schema.String),
  flow: Schema.Struct({
    caption: Schema.String,
    steps: Schema.Array(
      Schema.Struct({ label: Schema.String, added: Schema.Boolean, chapter: Schema.Number }),
    ),
  }),
  chapters: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      explanation: Schema.String,
      files: Schema.Array(Schema.String),
      concerns: Schema.Array(Schema.Struct({ file: Schema.String, note: Schema.String })),
    }),
  ),
});
export type ReviewGuide = typeof ReviewGuide.Type;

export const ReviewGuideError = Schema.Union([VcsError, TextGenerationError]);
export type ReviewGuideError = typeof ReviewGuideError.Type;
