import { useDraggable } from "@dnd-kit/core";
import type { EnvironmentId, JiraIssue } from "@t3tools/contracts";
import { CheckCheck, ExternalLink } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { JiraBoardSkillMenu } from "./JiraBoardSkillMenu";

export interface JiraBoardIssue extends JiraIssue {
  readonly environmentId: EnvironmentId;
}

/** `${environmentId}:${issueKey}` — unique across every board card, however many environments feed it. */
export function jiraBoardCardId(issue: JiraBoardIssue): string {
  return `${issue.environmentId}:${issue.key}`;
}

/**
 * Pure visual body, shared between the in-column card and the `DragOverlay`
 * clone — the overlay renders outside the column DOM (in a portal), so it
 * can't reuse the draggable element itself, only its contents.
 */
export function JiraBoardCardContent(props: {
  readonly issue: JiraBoardIssue;
  readonly showEnvironmentBadge: boolean;
}) {
  const { issue } = props;
  return (
    <>
      <div className="flex items-center gap-1.5">
        {issue.issueTypeIconUrl ? (
          <img
            src={issue.issueTypeIconUrl}
            alt={issue.issueType ?? "Issue type"}
            className="size-3.5 shrink-0"
          />
        ) : null}
        <span className="shrink-0 font-mono text-xs text-secondary-label">{issue.key}</span>
        {issue.priorityIconUrl ? (
          <img
            src={issue.priorityIconUrl}
            alt={issue.priority ?? "Priority"}
            className="size-3.5 shrink-0"
          />
        ) : null}
        {issue.status === "CODE REVIEW" && (issue.prApprovals ?? 0) >= 2 && (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
              <CheckCheck className="size-3.5 shrink-0 text-green-500" />
            </TooltipTrigger>
            <TooltipPopup side="top">2+ approvals — ready for Ready For Test</TooltipPopup>
          </Tooltip>
        )}
        <a
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 opacity-40 hover:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="size-3" />
        </a>
      </div>
      <span className="line-clamp-2 text-sm">{issue.summary}</span>
      {props.showEnvironmentBadge && (
        <span className="w-fit rounded bg-accent px-1 py-0.5 text-[10px] text-secondary-label">
          {issue.environmentId}
        </span>
      )}
    </>
  );
}

export const JIRA_BOARD_CARD_CLASS =
  "flex cursor-pointer flex-col gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-2 text-left text-sm shadow-sm hover:border-border";

export function JiraBoardCard(props: {
  readonly issue: JiraBoardIssue;
  readonly showEnvironmentBadge: boolean;
}) {
  const { issue } = props;
  const [open, setOpen] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: jiraBoardCardId(issue),
    data: { issue },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            className={cn(JIRA_BOARD_CARD_CLASS, isDragging && "opacity-0")}
          >
            <JiraBoardCardContent issue={issue} showEnvironmentBadge={props.showEnvironmentBadge} />
          </div>
        }
      />
      <PopoverPopup side="right" align="start" className="w-80" padding="compact">
        {open ? (
          <JiraBoardSkillMenu
            issue={issue}
            onDone={() => {
              setOpen(false);
            }}
          />
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}
