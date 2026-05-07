import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchConfig } from "../../lib/api";
import { parseRoute } from "../../lib/routing";
import { EN } from "../../i18n/en";
import { IT } from "../../i18n/it";
import { translate } from "../../i18n/translate";
import styles from "./LibraryRootGate.module.css";

interface LibraryRootGateProps {
  children: ReactNode;
}

export function LibraryRootGate({ children }: LibraryRootGateProps) {
  const [phase, setPhase] = useState<"load" | "ok" | "need">("load");
  const [libraryRootWritable, setLibraryRootWritable] = useState(true);
  const route = parseRoute();

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setLibraryRootWritable(c.libraryRootWritable !== false);
        if (c.lockedByEnv || c.libraryRootConfigured) setPhase("ok");
        else setPhase("need");
      })
      .catch(() => {
        setLibraryRootWritable(true);
        setPhase("need");
      });
  }, []);

  if (phase === "load") {
    const table =
      typeof navigator !== "undefined" && navigator.language.startsWith("it")
        ? IT
        : EN;
    return (
      <div className={`dashboard-grid ${styles.loading}`}>
        <p className="subtle sm">
          {translate(table, "gate.checkingLibrary", undefined)}
        </p>
      </div>
    );
  }

  if (phase === "need" && route.section !== "settings") {
    const table =
      typeof navigator !== "undefined" && navigator.language.startsWith("it")
        ? IT
        : EN;
    return (
      <div className={`dashboard-grid settings-page ${styles.gate}`}>
        <section className="surface-card">
          <h2>{translate(table, "gate.libraryRequiredTitle", undefined)}</h2>
          <p className="subtle sm">
            {translate(
              table,
              libraryRootWritable
                ? "gate.libraryRequiredLead"
                : "gate.libraryRequiredLeadRemote",
              undefined
            )}
          </p>
          {libraryRootWritable ? (
            <button
              type="button"
              className="btn"
              onClick={() => window.location.assign("/settings")}
            >
              {translate(table, "gate.openSettings", undefined)}
            </button>
          ) : null}
        </section>
      </div>
    );
  }

  return <>{children}</>;
}
