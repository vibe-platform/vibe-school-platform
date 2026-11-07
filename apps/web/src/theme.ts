import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
const storageKey = "vibe-theme-mode";

function readMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch { /* Storage can be disabled by the browser. */ }
  return "system";
}

function applyMode(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#11172a" : "#f5f2ff";
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(readMode);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyMode(mode);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const next = event.newValue === "light" || event.newValue === "dark" || event.newValue === "system" ? event.newValue : "system";
      setMode(next);
    };
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("storage", onStorage);
    return () => { media.removeEventListener("change", apply); window.removeEventListener("storage", onStorage); };
  }, [mode]);

  const choose = (next: ThemeMode) => {
    try { window.localStorage.setItem(storageKey, next); } catch { /* Theme still applies for this session. */ }
    setMode(next);
    applyMode(next);
  };
  return { mode, choose };
}
