import { useDroppable } from "@dnd-kit/core";

import { cn } from "~/lib/utils";
import { JiraBoardCard, jiraBoardCardId, type JiraBoardIssue } from "./JiraBoardCard";

export function JiraBoardColumn(props: {
  readonly status: string;
  readonly issues: ReadonlyArray<JiraBoardIssue>;
  readonly showEnvironmentBadges: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-accent/30 p-2",
        isOver && "bg-accent/60",
      )}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-sm font-medium">{props.status}</span>
        <span className="text-xs text-secondary-label">{props.issues.length}</span>
      </div>
      <div className="flex min-h-8 flex-col gap-2 overflow-y-auto">
        {props.issues.map((issue) => (
          <JiraBoardCard
            key={jiraBoardCardId(issue)}
            issue={issue}
            showEnvironmentBadge={props.showEnvironmentBadges}
          />
        ))}
      </div>
    </div>
  );
}
