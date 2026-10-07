import { useAtomValue } from "@effect/atom-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { EnvironmentId, JiraIssue } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { useEnvironments } from "../../state/environments";
import { toastManager } from "../ui/toast";
import { JiraBoardColumn } from "./JiraBoardColumn";
import { JIRA_BOARD_CARD_CLASS, JiraBoardCardContent, type JiraBoardIssue } from "./JiraBoardCard";

// The board's fixed workflow, left to right. Always rendered as drop
// targets, even with no issues in them yet, so a card can be dragged there
// before any issue actually holds that status.
const PINNED_COLUMNS: ReadonlyArray<string> = [
  "Ready For Development",
  "Blocked",
  "In Development",
  "Code Review",
  "Ready For Test",
  "Test Failed",
  "Test Passed",
  "Ready For UAT",
  "UAT Passed",
  "UAT Failed",
];
const PINNED_COLUMN_RANK = new Map(
  PINNED_COLUMNS.map((status, index) => [status.toLowerCase(), index]),
);

// Jira's own ordering: unstarted work, then active, then finished. Only
// used as a tiebreaker for statuses outside the fixed workflow above.
const STATUS_CATEGORY_ORDER: Record<string, number> = { new: 0, indeterminate: 1, done: 2 };

function readableFailure(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

/** Runs the `jiraMyIssues` query for one environment and reports results to the board. */
const JiraBoardEnvironmentFeed = memo(function JiraBoardEnvironmentFeed(props: {
  readonly environmentId: EnvironmentId;
  readonly onIssues: (
    environmentId: EnvironmentId,
    issues: ReadonlyArray<JiraIssue> | null,
  ) => void;
}) {
  const result = useAtomValue(
    serverEnvironment.jiraMyIssues({ environmentId: props.environmentId, input: {} }),
  );
  const issues = result._tag === "Success" ? Option.getOrNull(AsyncResult.value(result)) : null;
  const { onIssues, environmentId } = props;
  useEffect(() => {
    onIssues(environmentId, issues);
  }, [environmentId, issues, onIssues]);
  return null;
});

export function JiraBoardPage() {
  const { environments } = useEnvironments();
  const [issuesByEnvironment, setIssuesByEnvironment] = useState<
    ReadonlyMap<EnvironmentId, ReadonlyArray<JiraIssue>>
  >(new Map());
  const [statusOverrides, setStatusOverrides] = useState<ReadonlyMap<string, string>>(new Map());
  const [activeIssue, setActiveIssue] = useState<JiraBoardIssue | null>(null);
  const transitionIssue = useAtomCommand(serverEnvironment.jiraTransitionIssue, {
    reportFailure: false,
  });

  const onIssues = useCallback(
    (environmentId: EnvironmentId, issues: ReadonlyArray<JiraIssue> | null) => {
      setIssuesByEnvironment((existing) => {
        if (issues === null) return existing;
        const next = new Map(existing);
        next.set(environmentId, issues);
        return next;
      });
    },
    [],
  );

  const allIssues = useMemo<ReadonlyArray<JiraBoardIssue>>(() => {
    const merged: JiraBoardIssue[] = [];
    for (const [environmentId, issues] of issuesByEnvironment) {
      for (const issue of issues) {
        const override = statusOverrides.get(`${environmentId}:${issue.key}`);
        merged.push({ ...issue, environmentId, ...(override ? { status: override } : {}) });
      }
    }
    return merged;
  }, [issuesByEnvironment, statusOverrides]);

  const columns = useMemo(() => {
    const byStatus = new Map<string, JiraBoardIssue[]>();
    const categoryByStatus = new Map<string, string | undefined>();
    for (const issue of allIssues) {
      const bucket = byStatus.get(issue.status);
      if (bucket) {
        bucket.push(issue);
      } else {
        byStatus.set(issue.status, [issue]);
        categoryByStatus.set(issue.status, issue.statusCategory);
      }
    }
    for (const pinned of PINNED_COLUMNS) {
      const alreadyPresent = [...byStatus.keys()].some(
        (status) => status.toLowerCase() === pinned.toLowerCase(),
      );
      if (!alreadyPresent) {
        byStatus.set(pinned, []);
      }
    }
    return [...byStatus.entries()]
      .map(([status, issues]) => ({ status, issues }))
      .sort((a, b) => {
        const rankA = PINNED_COLUMN_RANK.get(a.status.toLowerCase());
        const rankB = PINNED_COLUMN_RANK.get(b.status.toLowerCase());
        if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
        if (rankA !== undefined) return -1;
        if (rankB !== undefined) return 1;
        // Neither status is part of the fixed workflow (e.g. a custom Jira
        // status): fall back to category order so they still land in a
        // sensible place instead of at an arbitrary spot.
        const categoryRankA = STATUS_CATEGORY_ORDER[categoryByStatus.get(a.status) ?? ""] ?? 3;
        const categoryRankB = STATUS_CATEGORY_ORDER[categoryByStatus.get(b.status) ?? ""] ?? 3;
        return categoryRankA - categoryRankB;
      });
  }, [allIssues]);

  const showEnvironmentBadges = environments.length > 1;

  // Without a distance threshold, dnd-kit starts a drag on the first pixel of
  // pointer movement and swallows the click that would otherwise open a
  // card's skill popover — a plain click never moves 8px, so it still opens.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragStart = (event: DragStartEvent) => {
    setActiveIssue((event.active.data.current?.issue as JiraBoardIssue | undefined) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveIssue(null);
    const targetStatus = event.over?.id;
    const issue = event.active.data.current?.issue as JiraBoardIssue | undefined;
    if (!issue || typeof targetStatus !== "string" || issue.status === targetStatus) return;

    const overrideKey = `${issue.environmentId}:${issue.key}`;
    setStatusOverrides((existing) => new Map(existing).set(overrideKey, targetStatus));

    void transitionIssue({
      environmentId: issue.environmentId,
      input: { issueKey: issue.key, targetStatus },
    }).then((result) => {
      if (result._tag !== "Failure") return;
      setStatusOverrides((existing) => {
        const next = new Map(existing);
        next.delete(overrideKey);
        return next;
      });
      toastManager.add({
        type: "error",
        title: "Could not move the issue",
        description: readableFailure(
          squashAtomCommandFailure(result),
          `Jira didn't accept the move to "${targetStatus}".`,
        ),
      });
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      {environments.map((environment) => (
        <JiraBoardEnvironmentFeed
          key={environment.environmentId}
          environmentId={environment.environmentId}
          onIssues={onIssues}
        />
      ))}
      <h1 className="text-lg font-semibold">Jira board</h1>
      {allIssues.length === 0 ? (
        <p className="text-sm text-secondary-label">
          No issues to show. Assign yourself something in Jira, or connect Jira under Settings →
          Connections.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveIssue(null)}
        >
          <div className="flex flex-1 gap-3 overflow-x-auto">
            {columns.map((column) => (
              <JiraBoardColumn
                key={column.status}
                status={column.status}
                issues={column.issues}
                showEnvironmentBadges={showEnvironmentBadges}
              />
            ))}
          </div>
          <DragOverlay>
            {activeIssue ? (
              <div className={JIRA_BOARD_CARD_CLASS}>
                <JiraBoardCardContent
                  issue={activeIssue}
                  showEnvironmentBadge={showEnvironmentBadges}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
