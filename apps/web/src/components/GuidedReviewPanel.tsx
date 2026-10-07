import type { FileDiffMetadata } from "@pierre/diffs";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection, ReviewGuide } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useMemo, useRef, type ReactNode, type RefObject } from "react";

import { usePrimarySettings } from "../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { serverEnvironment } from "../state/server";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";

import { getDiffLineStat } from "../lib/diffRendering";
import { cn } from "../lib/utils";
import { DiffStatLabel } from "./chat/DiffStatLabel";
import { DiffPanelLoadingState } from "./DiffPanelShell";
import type { AnnotatableCodeViewHandle } from "./diffs/AnnotatableCodeView";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export type GuidedReviewState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly guide: ReviewGuide };

export type GuidedReviewTab = "overview" | "guide";

/** `diff` is the host surface's own plain diff. */
export type GuidedReviewView = GuidedReviewTab | "diff";

export interface GuidedReviewProgress {
  readonly chapter: number;
  readonly reviewed: ReadonlySet<number>;
}

export interface GuidedReviewFile {
  readonly fileDiff: FileDiffMetadata;
  readonly filePath: string;
  readonly fileKey: string;
  readonly fileVersion: number;
  readonly collapsed: boolean;
}

interface Chapter {
  readonly title: string;
  readonly explanation: string;
  readonly files: ReadonlyArray<GuidedReviewFile>;
  /** Possible problems keyed by file path, for files that are in this chapter. */
  readonly concerns: ReadonlyMap<string, ReadonlyArray<string>>;
}

type RenderDiff = (
  files: ReadonlyArray<GuidedReviewFile>,
  key: string,
  viewerRef: RefObject<AnnotatableCodeViewHandle | null>,
) => ReactNode;

/**
 * Resolves the model's chapters against the files actually in the diff: unknown paths
 * are dropped, and files the model skipped land in a trailing "Other changes" chapter.
 */
function resolveChapters(guide: ReviewGuide, files: ReadonlyArray<GuidedReviewFile>): Chapter[] {
  const byPath = new Map(files.map((file) => [file.filePath, file]));
  const used = new Set<string>();
  const chapters = guide.chapters.flatMap((chapter) => {
    const chapterFiles = chapter.files.flatMap((path) => {
      const file = byPath.get(path);
      if (!file || used.has(path)) return [];
      used.add(path);
      return [file];
    });
    if (chapterFiles.length === 0) return [];
    const concerns = new Map<string, string[]>();
    for (const { file, note } of chapter.concerns) {
      if (chapterFiles.some((candidate) => candidate.filePath === file)) {
        concerns.set(file, [...(concerns.get(file) ?? []), note]);
      }
    }
    return [
      { title: chapter.title, explanation: chapter.explanation, files: chapterFiles, concerns },
    ];
  });
  const rest = files.filter((file) => !used.has(file.filePath));
  return rest.length > 0
    ? [...chapters, { title: "Other changes", explanation: "", files: rest, concerns: new Map() }]
    : chapters;
}

const pad = (value: number) => String(value).padStart(2, "0");

function splitPath(path: string) {
  const index = path.lastIndexOf("/");
  return index < 0
    ? { name: path, dir: "" }
    : { name: path.slice(index + 1), dir: path.slice(0, index + 1) };
}

function Flow({ flow }: { flow: ReviewGuide["flow"] }) {
  const added = flow.steps.filter((step) => step.added).length;
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Before / after</h3>
        {added > 0 && <span className="text-xs text-success">+{added}</span>}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{flow.caption}</p>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {flow.steps.map((step, index) => (
          <div key={`${index}:${step.label}`} className="flex items-center gap-1.5">
            {index > 0 && <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground/60" />}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs",
                step.added
                  ? "border-success/30 border-l-2 border-l-success bg-success/8"
                  : "border-border/70",
              )}
            >
              {step.added && <span className="text-success">+</span>}
              {step.label}
              {step.chapter > 0 && (
                <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                  {pad(step.chapter)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Overview({ guide }: { guide: ReviewGuide }) {
  return (
    <div className="grid min-h-0 flex-1 content-start gap-5 overflow-auto p-4 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className="space-y-3 text-sm">
        <h2 className="text-lg font-semibold">Overview</h2>
        <p>{guide.summary}</p>
        <ol className="list-decimal space-y-1.5 pl-5 marker:text-muted-foreground">
          {guide.points.map((point, index) => (
            <li key={`${index}:${point}`}>{point}</li>
          ))}
        </ol>
      </section>
      <Flow flow={guide.flow} />
    </div>
  );
}

function ChapterStep({
  chapters,
  progress,
  onProgressChange,
  renderDiff,
}: {
  chapters: ReadonlyArray<Chapter>;
  progress: GuidedReviewProgress;
  onProgressChange: (progress: GuidedReviewProgress) => void;
  renderDiff: RenderDiff;
}) {
  const viewerRef = useRef<AnnotatableCodeViewHandle>(null);
  const index = Math.min(progress.chapter, chapters.length - 1);
  const chapter = chapters[index];
  const reviewed = progress.reviewed.has(index);
  const go = (next: number) => onProgressChange({ ...progress, chapter: next });
  const toggleReviewed = (checked: boolean) => {
    const next = new Set(progress.reviewed);
    if (checked) next.add(index);
    else next.delete(index);
    onProgressChange({ chapter: index, reviewed: next });
  };
  if (!chapter) return null;

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @3xl:grid-rows-1">
      <div className="min-h-0 space-y-3 overflow-auto p-4 text-sm">
        <h2 className="text-lg font-semibold">{chapter.title}</h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {pad(index + 1)} / {pad(chapters.length)}
          </span>
          <label className="flex cursor-pointer items-center gap-1.5">
            <Checkbox checked={reviewed} onCheckedChange={toggleReviewed} />
            Reviewed
          </label>
          <span className="ml-auto flex gap-1">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Previous chapter"
              disabled={index === 0}
              onClick={() => go(index - 1)}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Next chapter"
              disabled={index === chapters.length - 1}
              onClick={() => go(index + 1)}
            >
              <ChevronRightIcon />
            </Button>
          </span>
        </div>
        {chapter.explanation && <p className="whitespace-pre-line">{chapter.explanation}</p>}
        <ul className="space-y-1.5">
          {chapter.files.map((file) => {
            const { name, dir } = splitPath(file.filePath);
            const concerns = chapter.concerns.get(file.filePath);
            return (
              <li key={file.fileKey} className="flex items-baseline gap-2 text-xs">
                <button
                  type="button"
                  className="flex min-w-0 items-baseline gap-2 text-left hover:underline"
                  onClick={() =>
                    viewerRef.current?.scrollTo({ type: "item", id: file.fileKey, align: "start" })
                  }
                >
                  <span className="font-medium">{name}</span>
                  <span className="min-w-0 truncate text-muted-foreground">{dir}</span>
                </button>
                {concerns && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          className="inline-flex shrink-0 translate-y-0.5 text-warning"
                          aria-label={`Possible issue: ${concerns.join(" ")}`}
                        />
                      }
                    >
                      <TriangleAlertIcon className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipPopup side="top" className="max-w-72">
                      {concerns.map((note) => (
                        <p key={note}>{note}</p>
                      ))}
                    </TooltipPopup>
                  </Tooltip>
                )}
                <DiffStatLabel
                  className="ml-auto shrink-0"
                  {...getDiffLineStat([file.fileDiff])}
                  layout="inline"
                />
              </li>
            );
          })}
        </ul>
      </div>
      <div className="min-h-0 min-w-0 border-t border-border/70 @3xl:border-l @3xl:border-t-0">
        {renderDiff(
          chapter.files.map((file) => ({ ...file, collapsed: false })),
          `guide:${index}`,
          viewerRef,
        )}
      </div>
    </div>
  );
}

/** Header button: generates a guide, then flips between the guide and the plain diff. */
export function GuidedReviewButton({
  state,
  showGuide,
  onClick,
}: {
  state: GuidedReviewState | null;
  showGuide: boolean;
  onClick: () => void;
}) {
  const label =
    state === null ? "Make a guided review" : showGuide ? "Back to diff" : "Show guided review";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant={showGuide ? "secondary" : "ghost"}
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        <SparklesIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

/** Overview / Guide / Diff tabs plus the model that writes the guide. */
export function GuidedReviewBar({
  environmentId,
  model,
  view,
  onViewChange,
  onModelChange,
}: {
  environmentId: EnvironmentId | null;
  model: ModelSelection | undefined;
  view: GuidedReviewView;
  onViewChange: (view: GuidedReviewView) => void;
  onModelChange: (model: ModelSelection) => void;
}) {
  const settings = usePrimarySettings();
  const providers = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.providers;
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers ?? []), settings),
      ),
    [providers, settings],
  );
  return (
    <div className="flex shrink-0 gap-1 border-b border-border/70 px-3 py-1.5">
      {(["overview", "guide", "diff"] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
            view === tab
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onViewChange(tab)}
        >
          {tab}
        </button>
      ))}
      {model && (
        <div className="ml-auto">
          <ProviderModelPicker
            activeInstanceId={model.instanceId}
            model={model.model}
            lockedProvider={null}
            instanceEntries={instanceEntries}
            modelOptionsByInstance={getCustomModelOptionsByInstance(
              settings,
              providers ?? [],
              model.instanceId,
              model.model,
            )}
            triggerVariant="ghost"
            triggerAriaLabel="Guided review model"
            onInstanceModelChange={(instanceId, nextModel) =>
              onModelChange(createModelSelection(instanceId, nextModel))
            }
          />
        </div>
      )}
    </div>
  );
}

/** Overview and chapter-by-chapter walkthrough of a diff, shown in place of the file list. */
export function GuidedReviewPanel({
  tab,
  state,
  files,
  progress,
  onProgressChange,
  onRetry,
  renderDiff,
  notice,
}: {
  tab: GuidedReviewTab;
  state: GuidedReviewState;
  files: ReadonlyArray<GuidedReviewFile>;
  progress: GuidedReviewProgress;
  onProgressChange: (progress: GuidedReviewProgress) => void;
  onRetry: () => void;
  renderDiff: RenderDiff;
  /** A caveat about what the guide covers, e.g. a partly loaded diff. */
  notice?: string | undefined;
}) {
  const guide = state.status === "ready" ? state.guide : null;
  const chapters = useMemo(() => (guide ? resolveChapters(guide, files) : []), [guide, files]);

  if (state.status === "loading") {
    return <DiffPanelLoadingState label="Writing guided review..." />;
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center">
        <p className="text-xs text-error/80">{state.message}</p>
        <Button size="xs" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      {notice && (
        <p className="shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          {notice}
        </p>
      )}
      {tab === "overview" ? (
        <Overview guide={state.guide} />
      ) : (
        <ChapterStep
          chapters={chapters}
          progress={progress}
          onProgressChange={onProgressChange}
          renderDiff={renderDiff}
        />
      )}
    </div>
  );
}
