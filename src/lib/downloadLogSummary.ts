import type { useI18n } from "../i18n/useI18n";

type TFn = ReturnType<typeof useI18n>["t"];

export type DownloadItemSummary = {
  downloadedItems?: string[];
  skippedItems?: { label: string; reason: string }[];
  failedItems?: { label: string; reason: string }[];
};

function skipReasonLabel(reason: string, t: TFn): string {
  if (reason === "already downloaded") {
    return t("tools.dlSummarySkipReasonAlready");
  }
  return reason;
}

export function buildDownloadSummaryLine(r: DownloadItemSummary, t: TFn): string {
  const downloaded = r.downloadedItems?.length ?? 0;
  const skipped = r.skippedItems?.length ?? 0;
  if (downloaded + skipped === 0) return "";

  let out = t("tools.dlSummaryCounts", { downloaded, skipped }) + "\n";

  for (const item of r.skippedItems ?? []) {
    out +=
      t("tools.dlSummarySkippedLine", {
        label: item.label,
        reason: skipReasonLabel(item.reason, t),
      }) + "\n";
  }
  return out;
}

export function buildReleaseBatchSummaryLine(
  rows: { status: "ok" | "partial" | "failed"; title: string }[],
  t: TFn,
): string {
  if (!rows.length) return "";
  const ok = rows.filter((row) => row.status === "ok").length;
  const partial = rows.filter((row) => row.status === "partial").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  return (
    t("tools.dlBatchSummaryCounts", { ok, partial, failed }) +
    "\n" +
    t("tools.dlBatchSummaryLegend") +
    "\n"
  );
}
