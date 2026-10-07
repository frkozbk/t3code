import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { CheckCheck, ExternalLink, TicketIcon } from "lucide-react";
import { memo, useState } from "react";

import { serverEnvironment } from "~/state/server";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";

/**
 * Skills that already take a bare issue key as their argument. Hardcoded on
 * purpose — this is a personal shortcut bar, not a skill registry.
 */
const ISSUE_SKILLS = ["test-it", "jira-todo", "jira-summary"] as const;

/**
 * Composer footer button listing the Jira issues assigned to me. Clicking an
 * issue drops its key into the prompt as plain text; the skill buttons drop
 * `/<skill> <key>` instead. Server-scoped RPC, so it works on a draft thread
 * with no agent session running.
 */
export const JiraIssuePicker = memo(function JiraIssuePicker(props: {
  readonly environmentId: EnvironmentId;
  readonly compact: boolean;
  readonly onInsert: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ComposerControl type="button" className="shrink-0" aria-label="Jira issues">
            <ComposerControlIcon icon={TicketIcon} />
            {props.compact ? null : "Jira"}
          </ComposerControl>
        }
      />
      <PopoverPopup side="top" align="start" className="w-90" padding="compact">
        {open ? (
          <JiraIssueList
            environmentId={props.environmentId}
            onInsert={(text) => {
              props.onInsert(text);
              setOpen(false);
            }}
          />
        ) : null}
      </PopoverPopup>
    </Popover>
  );
});

/**
 * Split out so the query only runs while the popover is open — reading the
 * atom is what starts the request.
 */
function JiraIssueList(props: {
  readonly environmentId: EnvironmentId;
  readonly onInsert: (text: string) => void;
}) {
  const result = useAtomValue(
    serverEnvironment.jiraMyIssues({ environmentId: props.environmentId, input: {} }),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  if (result.waiting && result._tag !== "Success") {
    return (
      <div className="flex items-center gap-2 px-2 py-3 text-sm text-secondary-label">
        <Spinner className="size-4" />
        Loading issues…
      </div>
    );
  }
  if (result._tag === "Failure") {
    return (
      <p className="px-2 py-3 text-sm text-secondary-label">
        Couldn’t load Jira issues. Check the Jira settings under Settings → Connections.
      </p>
    );
  }

  const issues = Option.getOrElse(AsyncResult.value(result), () => []);
  if (issues[0] === undefined) {
    return <p className="px-2 py-3 text-sm text-secondary-label">No issues assigned to you.</p>;
  }

  const statuses = [...new Set(issues.map((i) => i.status).filter(Boolean))];
  const filtered = statusFilter ? issues.filter((i) => i.status === statusFilter) : issues;
  const firstFiltered = filtered[0];

  // The toolbar acts on whichever row was last hovered or focused, defaulting
  // to the top one, so a skill insert stays a single click from the list.
  const activeKey =
    selectedKey && filtered.some((i) => i.key === selectedKey)
      ? selectedKey
      : (firstFiltered?.key ?? null);
  const activeIssue = activeKey ? filtered.find((i) => i.key === activeKey) : null;

  return (
    <div className="flex flex-col gap-2">
      {statuses.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-border/60 pb-2">
          <button
            type="button"
            data-active={statusFilter === null ? "true" : undefined}
            className="rounded px-1.5 py-0.5 text-[11px] text-secondary-label hover:bg-accent data-active:bg-accent data-active:text-primary"
            onClick={() => setStatusFilter(null)}
          >
            All
          </button>
          {statuses.map((s) => (
            <button
              key={s}
              type="button"
              data-active={statusFilter === s ? "true" : undefined}
              className="rounded px-1.5 py-0.5 text-[11px] text-secondary-label hover:bg-accent data-active:bg-accent data-active:text-primary"
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/60 pb-2">
        <span className="px-1 font-mono text-[11px] text-secondary-label">{activeKey}</span>
        {ISSUE_SKILLS.map((skill) => (
          <Button
            key={skill}
            type="button"
            size="xs"
            variant="ghost"
            className="font-mono text-[11px]"
            onClick={() => activeKey && props.onInsert(`/${skill} ${activeKey}`)}
          >
            /{skill}
          </Button>
        ))}
        {activeIssue?.status === "CODE REVIEW" && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="font-mono text-[11px]"
            onClick={() => activeKey && props.onInsert(`/ready-for-test ${activeKey}`)}
          >
            /ready-for-test
          </Button>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto">
        {filtered.map((issue) => (
          <button
            key={issue.key}
            type="button"
            data-active={issue.key === activeKey ? "true" : undefined}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent data-active:bg-accent"
            onClick={() => props.onInsert(issue.key)}
            onPointerEnter={() => setSelectedKey(issue.key)}
            onFocus={() => setSelectedKey(issue.key)}
          >
            <span className="shrink-0 font-mono text-xs text-secondary-label">{issue.key}</span>
            <span className="min-w-0 flex-1 truncate">{issue.summary}</span>
            {issue.status === "CODE REVIEW" && (issue.prApprovals ?? 0) >= 2 && (
              <CheckCheck className="size-3 shrink-0 text-green-500" />
            )}
            {issue.url && (
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto shrink-0 opacity-40 hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="size-3" />
              </a>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
