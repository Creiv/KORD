import { createPortal } from "react-dom";

type Props = {
  message: string;
  busy?: boolean;
};

export function SyncStatusSnackbar({ message, busy = false }: Props) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="sync-status-snackbar"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {busy ? (
        <span className="sync-status-snackbar__spinner" aria-hidden>
          <span className="rekord-splash__ring" />
        </span>
      ) : null}
      <span className="sync-status-snackbar__text">{message}</span>
    </div>,
    document.body
  );
}
