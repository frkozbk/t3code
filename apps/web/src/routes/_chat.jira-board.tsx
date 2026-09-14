import { createFileRoute } from "@tanstack/react-router";

import { JiraBoardPage } from "../components/jiraBoard/JiraBoardPage";

export const Route = createFileRoute("/_chat/jira-board")({
  component: JiraBoardPage,
});
