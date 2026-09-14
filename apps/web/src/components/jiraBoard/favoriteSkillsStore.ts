import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface FavoriteSkillsStore {
  favoriteKeys: string[];
  toggleFavorite: (key: string) => void;
}

/** Skills/slash commands the user pinned to the top of the Jira card's skill popover. */
export const useFavoriteSkillsStore = create<FavoriteSkillsStore>()(
  persist(
    (set) => ({
      favoriteKeys: [],
      toggleFavorite: (key) =>
        set((state) => ({
          favoriteKeys: state.favoriteKeys.includes(key)
            ? state.favoriteKeys.filter((existing) => existing !== key)
            : [...state.favoriteKeys, key],
        })),
    }),
    {
      name: "t3code:jira-board-favorite-skills:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
    },
  ),
);
