import { useCallback, useEffect, useState } from "react";
import type { AppSection } from "../types";

export type RouteState = {
  section: AppSection;
  artist: string | null;
  album: string | null;
  playlist: string | null;
};

export const NAV_DEF: {
  id: AppSection;
  labelKey: string;
  group: "core" | "secondary";
}[] = [
  { id: "dashboard", labelKey: "nav.dashboard", group: "core" },
  { id: "libreria", labelKey: "nav.library", group: "core" },
  { id: "studio", labelKey: "nav.studio", group: "core" },
  { id: "discowall", labelKey: "nav.discowall", group: "core" },
  { id: "gioco", labelKey: "nav.plectr", group: "core" },
  { id: "queue", labelKey: "nav.queue", group: "secondary" },
  { id: "playlists", labelKey: "nav.playlists", group: "secondary" },
  { id: "favorites", labelKey: "nav.favorites", group: "secondary" },
  { id: "recent", labelKey: "nav.recent", group: "secondary" },
  { id: "statistics", labelKey: "nav.statistics", group: "secondary" },
  { id: "achievements", labelKey: "nav.achievements", group: "secondary" },
  { id: "settings", labelKey: "nav.settings", group: "secondary" },
];

export function parseRoute(): RouteState {
  const params = new URLSearchParams(window.location.search);
  const raw = window.location.pathname.replace(/^\/+/, "").split("/")[0];
  const normalized =
    raw === "resonance" ? "achievements" : raw === "ascolta" ? "studio" : raw;
  const section = normalized as AppSection;
  const known = NAV_DEF.some((item) => item.id === section);
  return {
    section: known ? section : "dashboard",
    artist: params.get("artist"),
    album: params.get("album"),
    playlist: params.get("playlist"),
  };
}

export function buildHref(route: RouteState) {
  const params = new URLSearchParams();
  if (route.artist) params.set("artist", route.artist);
  if (route.album) params.set("album", route.album);
  if (route.playlist) params.set("playlist", route.playlist);
  const query = params.toString();
  const path = route.section === "dashboard" ? "/" : `/${route.section}`;
  return query ? `${path}?${query}` : path;
}

export function mergeRoute(
  prev: RouteState,
  next: Partial<RouteState>
): RouteState {
  const merged: RouteState = {
    ...prev,
    ...next,
    section: (next.section ?? prev.section) as AppSection,
  };
  if (next.section && next.section !== "libreria") {
    merged.artist = null;
    merged.album = null;
  } else if (next.section === "libreria") {
    if (!("artist" in next)) merged.artist = null;
    if (!("album" in next)) merged.album = null;
  } else {
    merged.artist = next.artist !== undefined ? next.artist : prev.artist;
    merged.album = next.album !== undefined ? next.album : prev.album;
  }
  merged.playlist =
    merged.section && merged.section !== "playlists"
      ? null
      : next.playlist !== undefined
        ? next.playlist
        : prev.playlist;
  return merged;
}

export function isStandaloneDisplayMode(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    );
  } catch {
    return false;
  }
}

export function useAppRoute() {
  const [route, setRoute] = useState<RouteState>(() => parseRoute());
  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((next: Partial<RouteState>) => {
    setRoute((prev) => {
      const merged = mergeRoute(prev, next);
      window.history.pushState({}, "", buildHref(merged));
      return merged;
    });
  }, []);
  return { route, navigate };
}
