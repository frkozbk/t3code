import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { Star } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { markPendingAutoSend, useComposerDraftStore } from "../../composerDraftStore";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useProjects } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { toastManager } from "../ui/toast";
import type { JiraBoardIssue } from "./JiraBoardCard";
import { useFavoriteSkillsStore } from "./favoriteSkillsStore";

interface RunnableCommand {
  readonly key: string;
  readonly command: string;
  readonly description: string;
}

/**
 * Click-a-card menu: pick any skill or slash command discovered on your
 * default project's provider, then pick which project the resulting thread
 * should run in. Always spins up a new thread and runs it immediately — this
 * is "pick up this work", not a place to leave a draft for later.
 */
export function JiraBoardSkillMenu(props: {
  readonly issue: JiraBoardIssue;
  readonly onDone: () => void;
}) {
  const [step, setStep] = useState<"skill" | "project">("skill");
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();
  const providersByEnvironment = useEnvironmentProviders();
  const projects = useProjects();
  const favoriteKeys = useFavoriteSkillsStore((state) => state.favoriteKeys);
  const toggleFavorite = useFavoriteSkillsStore((state) => state.toggleFavorite);

  const commands = useMemo<ReadonlyArray<RunnableCommand>>(() => {
    if (!defaultProjectRef) return [];
    const providers = providersByEnvironment.get(defaultProjectRef.environmentId) ?? [];
    const seen = new Set<string>();
    const options: RunnableCommand[] = [];
    for (const provider of providers) {
      if (!provider.enabled) continue;
      for (const skill of provider.skills) {
        if (!skill.enabled || seen.has(skill.name)) continue;
        seen.add(skill.name);
        options.push({
          key: `skill:${skill.name}`,
          command: skill.name,
          description: skill.shortDescription ?? skill.description ?? "Skill",
        });
      }
      for (const slashCommand of provider.slashCommands) {
        if (seen.has(slashCommand.name)) continue;
        seen.add(slashCommand.name);
        options.push({
          key: `slash:${slashCommand.name}`,
          command: slashCommand.name,
          description: slashCommand.description ?? "Provider command",
        });
      }
    }
    // Stable sort: favorites first, otherwise the provider's original order.
    return [...options].sort(
      (a, b) => Number(favoriteKeys.includes(b.key)) - Number(favoriteKeys.includes(a.key)),
    );
  }, [defaultProjectRef, providersByEnvironment, favoriteKeys]);

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return commands;
    return commands.filter(
      (option) =>
        option.command.toLowerCase().includes(query) ||
        option.description.toLowerCase().includes(query),
    );
  }, [commands, filter]);

  const runOnProject = async (project: (typeof projects)[number]) => {
    if (!selectedCommand) return;
    const session = await handleNewThread(scopeProjectRef(project.environmentId, project.id));
    if (!session) {
      toastManager.add({
        type: "error",
        title: "Could not open a thread",
        description: "Try again from the project directly.",
      });
      props.onDone();
      return;
    }
    useComposerDraftStore
      .getState()
      .setPrompt(session.draftId, `/${selectedCommand} ${props.issue.key}`);
    markPendingAutoSend(session.draftId);
    props.onDone();
  };

  if (step === "project") {
    return (
      <div className="flex flex-col gap-2">
        <p className="px-1 text-xs text-secondary-label">
          Run <span className="font-mono">/{selectedCommand}</span> in which project?
        </p>
        <div className="max-h-72 overflow-y-auto">
          {projects.map((project) => (
            <button
              key={`${project.environmentId}:${project.id}`}
              type="button"
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                void runOnProject(project);
              }}
            >
              <span className="truncate">{project.title}</span>
              <span className="truncate text-xs text-secondary-label">{project.workspaceRoot}</span>
            </button>
          ))}
          {projects.length === 0 && (
            <p className="px-2 py-3 text-sm text-secondary-label">No projects yet.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Run a skill or command…"
        className="w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-sm outline-none"
      />
      <div className="max-h-72 overflow-y-auto">
        {filtered.map((option) => {
          const isFavorite = favoriteKeys.includes(option.key);
          return (
            <div key={option.key} className="flex items-center rounded-md hover:bg-accent">
              <button
                type="button"
                onClick={() => toggleFavorite(option.key)}
                aria-label={isFavorite ? "Remove from favorites" : "Mark as favorite"}
                className="shrink-0 px-1.5 py-1.5 text-secondary-label hover:text-foreground"
              >
                <Star className={cn("size-3.5", isFavorite && "fill-current text-amber-500")} />
              </button>
              <button
                type="button"
                className="flex flex-1 items-baseline gap-3 py-1.5 pr-2 text-left text-sm"
                onClick={() => {
                  setSelectedCommand(option.command);
                  setStep("project");
                }}
              >
                <span className="shrink-0 font-mono text-xs">/{option.command}</span>
                <span className="min-w-0 flex-1 truncate text-right text-xs text-secondary-label">
                  {option.description}
                </span>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-sm text-secondary-label">
            {commands.length === 0 ? "No skills available." : "No matching skill."}
          </p>
        )}
      </div>
    </div>
  );
}
