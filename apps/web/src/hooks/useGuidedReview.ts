import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ProviderInstanceId, type EnvironmentId, type ModelSelection } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useState } from "react";

import { usePrimarySettings } from "./useSettings";
import { resolveAppModelSelectionState } from "../modelSelection";

import type {
  GuidedReviewProgress,
  GuidedReviewState,
  GuidedReviewView,
} from "../components/GuidedReviewPanel";
import { reviewEnvironment } from "../state/review";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

/** Guides default to a cheap, fast model; `fallbackModel` is used when it's unavailable. */
const DEFAULT_GUIDE_MODEL = createModelSelection(
  ProviderInstanceId.make("claudeAgent"),
  "claude-sonnet-5",
);

/**
 * State for a guided review of one patch, shared by every surface that shows a diff.
 * The guide is keyed by patch, so a changed diff drops a stale guide. `cwd` must be a
 * directory inside the environment's workspace; the model runs there.
 */
export function useGuidedReview(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null | undefined;
  patch: string | undefined;
  /** Model to use when the default guide model isn't available, e.g. the composer's; the app's text generation model when absent. */
  fallbackModel: ModelSelection | undefined;
}) {
  const { environmentId, cwd, patch, fallbackModel } = input;
  const generateGuide = useAtomCommand(reviewEnvironment.generateGuide, { reportFailure: false });
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const [view, setView] = useState<GuidedReviewView>("diff");
  const [progress, setProgress] = useState<GuidedReviewProgress>({
    chapter: 0,
    reviewed: new Set(),
  });
  // User-picked model; null falls back to the default guide model or `fallbackModel`.
  const [pickedModel, setPickedModel] = useState<ModelSelection | null>(null);
  const [guide, setGuide] = useState<{
    readonly patch: string;
    readonly state: GuidedReviewState;
  } | null>(null);

  const defaultModelAvailable = (serverConfig?.providers ?? []).some(
    (provider) =>
      provider.instanceId === DEFAULT_GUIDE_MODEL.instanceId &&
      provider.enabled &&
      provider.models.some((model) => model.slug === DEFAULT_GUIDE_MODEL.model),
  );
  const settings = usePrimarySettings();
  const model =
    pickedModel ??
    (defaultModelAvailable
      ? DEFAULT_GUIDE_MODEL
      : (fallbackModel ?? resolveAppModelSelectionState(settings, serverConfig?.providers ?? [])));

  const start = (forPatch: string, modelSelection = model) => {
    if (!environmentId || !cwd || !modelSelection) return;
    setGuide({ patch: forPatch, state: { status: "loading" } });
    setProgress({ chapter: 0, reviewed: new Set() });
    void generateGuide({
      environmentId,
      input: { cwd, diff: forPatch, modelSelection },
    }).then((result) => {
      const settle = (state: GuidedReviewState) =>
        setGuide((current) => (current?.patch === forPatch ? { patch: forPatch, state } : current));
      if (result._tag === "Success") {
        settle({ status: "ready", guide: result.value });
        return;
      }
      if (isAtomCommandInterrupted(result)) return;
      const failure = squashAtomCommandFailure(result);
      settle({
        status: "error",
        message:
          failure instanceof Error ? failure.message : "Could not generate the guided review.",
      });
    });
  };

  const state = guide && guide.patch === patch ? guide.state : null;
  return {
    state,
    view,
    setView,
    progress,
    setProgress,
    model,
    /** True while the guide, not the plain diff, should fill the body. */
    showGuide: view !== "diff" && state !== null,
    /** Header button: generate the first time, then flip between guide and diff. */
    toggle: () => {
      if (patch === undefined) return;
      if (state !== null && state.status !== "error") {
        setView(view === "diff" ? "overview" : "diff");
        return;
      }
      setView("overview");
      start(patch);
    },
    selectModel: (selection: ModelSelection) => {
      setPickedModel(selection);
      if (patch !== undefined) start(patch, selection);
    },
    retry: () => {
      if (patch !== undefined) start(patch);
    },
  };
}
