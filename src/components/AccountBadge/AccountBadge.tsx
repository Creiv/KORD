import { memo, useEffect, useState } from "react";
import { fetchAccounts, getSelectedAccountId } from "../../lib/api";
import type { AccountsResponse } from "../../lib/api";
import { useI18n } from "../../i18n/useI18n";
import styles from "./AccountBadge.module.css";

interface AccountBadgeProps {
  onOpenSettings: () => void;
}

export const AccountBadge = memo(function AccountBadge({
  onOpenSettings,
}: AccountBadgeProps) {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<AccountsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    getSelectedAccountId()
  );

  useEffect(() => {
    fetchAccounts()
      .then((next) => {
        setAccounts(next);
        setSelectedId(getSelectedAccountId() || next.defaultAccountId);
      })
      .catch(() => setAccounts(null));
    const onChange = () => setSelectedId(getSelectedAccountId());
    window.addEventListener("kord-account-session-changed", onChange);
    return () =>
      window.removeEventListener("kord-account-session-changed", onChange);
  }, []);

  if (!accounts || accounts.accounts.length === 0) return null;

  const account =
    accounts.accounts.find((item) => item.id === selectedId) ||
    accounts.accounts[0];
  const letter = (account.name.trim()[0] || "?").toUpperCase();

  return (
    <button
      type="button"
      className={styles.badge}
      title={t("accounts.openSettingsTitle", { name: account.name })}
      aria-label={t("accounts.openSettingsTitle", { name: account.name })}
      onClick={onOpenSettings}
    >
      <span aria-hidden>{letter}</span>
    </button>
  );
});
