/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "../i18n/useI18n";

export type AppConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger" | "warning";
};

export type AppAlertOptions = {
  title?: string;
  message: string;
  okLabel?: string;
};

type QueueEntry =
  | {
      id: number;
      kind: "confirm";
      options: AppConfirmOptions;
      resolve: (v: boolean) => void;
    }
  | {
      id: number;
      kind: "alert";
      options: AppAlertOptions;
      resolve: () => void;
    };

export type AppConfirmContextValue = {
  confirm: (
    options: AppConfirmOptions | string,
    overrides?: Omit<Partial<AppConfirmOptions>, "message">,
  ) => Promise<boolean>;
  alert: (options: AppAlertOptions | string) => Promise<void>;
};

const AppConfirmContext = createContext<AppConfirmContextValue | null>(null);

function normalizeConfirm(
  options: AppConfirmOptions | string,
  overrides?: Omit<Partial<AppConfirmOptions>, "message">,
): AppConfirmOptions {
  if (typeof options === "string") {
    return { message: options, ...overrides };
  }
  return { ...options, ...overrides };
}

export function AppConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const idRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((confirmResult?: boolean) => {
    setQueue((q) => {
      const entry = q[0];
      if (!entry) return q;
      if (entry.kind === "confirm") entry.resolve(Boolean(confirmResult));
      else entry.resolve();
      return q.slice(1);
    });
  }, []);

  const confirm = useCallback(
    (
      options: AppConfirmOptions | string,
      overrides?: Omit<Partial<AppConfirmOptions>, "message">,
    ) => {
      const o = normalizeConfirm(options, overrides);
      return new Promise<boolean>((resolve) => {
        const id = ++idRef.current;
        setQueue((q) => [...q, { id, kind: "confirm", options: o, resolve }]);
      });
    },
    [],
  );

  const alertFn = useCallback((options: AppAlertOptions | string) => {
    const o: AppAlertOptions =
      typeof options === "string" ? { message: options } : options;
    return new Promise<void>((resolve) => {
      const id = ++idRef.current;
      setQueue((q) => [...q, { id, kind: "alert", options: o, resolve }]);
    });
  }, []);

  const value = useMemo(
    () => ({ confirm, alert: alertFn }),
    [confirm, alertFn],
  );

  const current = queue[0];
  const cancelLbl = t("app.dialogCancel");
  const okLbl = t("app.dialogOk");
  const confirmLbl = t("app.dialogConfirm");

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (current.kind === "confirm") dismiss(false);
      else dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, dismiss]);

  useLayoutEffect(() => {
    if (!current || !panelRef.current) return;
    const primary = panelRef.current.querySelector<HTMLElement>(
      '[data-app-dialog-primary="1"]',
    );
    primary?.focus();
  }, [current]);

  return (
    <AppConfirmContext.Provider value={value}>
      {children}
      {current ? (
        <div
          className="meta-edit-backdrop app-dialog-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              if (current.kind === "confirm") dismiss(false);
              else dismiss();
            }
          }}
        >
          <div
            ref={panelRef}
            className="meta-edit-dialog surface-card app-dialog"
            role={current.kind === "confirm" ? "dialog" : "alertdialog"}
            aria-modal="true"
            aria-labelledby={
              current.options.title ? `app-dialog-title-${current.id}` : undefined
            }
            aria-describedby={`app-dialog-desc-${current.id}`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {current.options.title ? (
              <p
                className="eyebrow app-dialog__eyebrow"
                id={`app-dialog-title-${current.id}`}
              >
                {current.options.title}
              </p>
            ) : null}
            <p
              className="app-dialog__body"
              id={`app-dialog-desc-${current.id}`}
            >
              {current.options.message}
            </p>
            <div className="app-dialog__actions">
              {current.kind === "confirm" ? (
                <>
                  <button
                    type="button"
                    className="btn ghost-btn"
                    onClick={() => dismiss(false)}
                  >
                    {current.options.cancelLabel ?? cancelLbl}
                  </button>
                  <button
                    type="button"
                    className={
                      current.options.variant === "danger"
                        ? "btn app-dialog__btn--danger"
                        : current.options.variant === "warning"
                          ? "btn app-dialog__btn--warning"
                          : "btn"
                    }
                    data-app-dialog-primary="1"
                    onClick={() => dismiss(true)}
                  >
                    {current.options.confirmLabel ?? confirmLbl}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn"
                  data-app-dialog-primary="1"
                  onClick={() => dismiss()}
                >
                  {current.options.okLabel ?? okLbl}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </AppConfirmContext.Provider>
  );
}

export function useAppConfirm() {
  const ctx = useContext(AppConfirmContext);
  if (!ctx) throw new Error("useAppConfirm richiede AppConfirmProvider");
  return ctx;
}
