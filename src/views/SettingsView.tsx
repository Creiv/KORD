import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useAppConfirm } from "../context/AppConfirmContext";
import { useUserState } from "../context/UserStateContext";
import { useI18n } from "../i18n/useI18n";
import {
  clearYoutubeCookies,
  createAccount as createApiAccount,
  deleteAccount as deleteApiAccount,
  downloadKordDataBackup,
  fetchAccounts,
  fetchActivityLog,
  fetchConfig,
  fetchRemoteAccessState,
  getRemoteAccessLoginUrl,
  getSelectedAccountId,
  logoutRemoteAccessLogin,
  saveAppConfig,
  setSelectedAccountId,
  startRemoteAccess,
  stopRemoteAccess,
  uploadKordDataRestore,
  uploadYoutubeCookies,
} from "../lib/api";
import type {
  Account,
  AccountsResponse,
  ActivityLogEntry,
  RemoteAccessState,
} from "../lib/api";
import { ThemePicker } from "../components/ThemePicker";
import { APP_LOCALES, type AppLocale, type AppSection } from "../types";

function SettingsView({
  onOpenSection,
}: {
  onOpenSection: (section: AppSection) => void;
}) {
  const user = useUserState();
  const { t, locale, setLocale } = useI18n();
  const { confirm: appConfirm } = useAppConfirm();
  const [libLocked, setLibLocked] = useState(false);
  const [libraryRootWritable, setLibraryRootWritable] = useState(true);
  const [libraryRootLabel, setLibraryRootLabel] = useState<string | null>(null);
  const [libraryPath, setLibraryPath] = useState("");
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryErr, setLibraryErr] = useState<string | null>(null);
  const [serverLocalAccess, setServerLocalAccess] = useState(() => {
    try {
      const host = String(window.location.hostname || "").toLowerCase();
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch {
      return false;
    }
  });
  const [youtubeCookiesConfigured, setYoutubeCookiesConfigured] =
    useState(false);
  const [youtubeCookiesWritable, setYoutubeCookiesWritable] = useState(false);
  const [youtubeCookiesLockedByEnv, setYoutubeCookiesLockedByEnv] =
    useState(false);
  const [youtubeCookiesLabel, setYoutubeCookiesLabel] = useState<string | null>(
    null
  );
  const [youtubeCookiesBusy, setYoutubeCookiesBusy] = useState(false);
  const [youtubeCookiesErr, setYoutubeCookiesErr] = useState<string | null>(
    null
  );
  const [youtubeCookiesOk, setYoutubeCookiesOk] = useState<string | null>(null);
  const youtubeCookiesInputRef = useRef<HTMLInputElement | null>(null);
  const [lanAccessUrl, setLanAccessUrl] = useState<string | null>(null);
  const [remoteAccess, setRemoteAccess] = useState<RemoteAccessState | null>(
    null
  );
  const [remoteLoginHover, setRemoteLoginHover] = useState(false);
  const [remoteShareHover, setRemoteShareHover] = useState(false);
  const [remoteAccessBusy, setRemoteAccessBusy] = useState(false);
  const [remoteAccessErr, setRemoteAccessErr] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountsResponse | null>(null);
  const [selectedAccountId, setSelectedAccountIdState] = useState<
    string | null
  >(() => getSelectedAccountId());
  const [newAccountName, setNewAccountName] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountErr, setAccountErr] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[] | null>(
    null
  );
  const [activityLogErr, setActivityLogErr] = useState<string | null>(null);
  const [activityLogBusy, setActivityLogBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupOk, setBackupOk] = useState<string | null>(null);
  const [backupErr, setBackupErr] = useState<string | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreOk, setRestoreOk] = useState<string | null>(null);
  const [restoreErr, setRestoreErr] = useState<string | null>(null);
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isKordClientEmbed] = useState(() => {
    try {
      return sessionStorage.getItem("kord-embed") === "client";
    } catch {
      return false;
    }
  });
  const kordAppVersion = String(import.meta.env.VITE_KORD_VERSION ?? "2.2.0");

  useEffect(() => {
    Promise.all([fetchConfig(), fetchAccounts()])
      .then(([c, a]) => {
        setLibLocked(c.lockedByEnv);
        setLibraryRootWritable(c.libraryRootWritable !== false);
        setLibraryRootLabel(
          typeof c.libraryRootLabel === "string" && c.libraryRootLabel.trim()
            ? c.libraryRootLabel.trim()
            : null
        );
        setServerLocalAccess(Boolean(c.localAccess));
        setYoutubeCookiesConfigured(Boolean(c.youtubeCookiesConfigured));
        setYoutubeCookiesWritable(Boolean(c.youtubeCookiesWritable));
        setYoutubeCookiesLockedByEnv(Boolean(c.youtubeCookiesLockedByEnv));
        setYoutubeCookiesLabel(
          typeof c.youtubeCookiesLabel === "string" &&
            c.youtubeCookiesLabel.trim()
            ? c.youtubeCookiesLabel.trim()
            : null
        );
        setAccounts(a);
        const selected = getSelectedAccountId() || a.defaultAccountId;
        setSelectedAccountIdState(selected);
        setLibraryPath(String(c.musicRoot ?? ""));
        setLanAccessUrl(c.lanAccessUrl);
        setRemoteAccess(c.remoteAccess || null);
        setLibraryErr(null);
        setAccountErr(null);
      })
      .catch((e: unknown) =>
        setAccountErr(e instanceof Error ? e.message : String(e))
      );
  }, []);

  const loadActivityLog = useCallback(() => {
    setActivityLogErr(null);
    setActivityLogBusy(true);
    fetchActivityLog(500)
      .then((d) => setActivityLog(Array.isArray(d.entries) ? d.entries : []))
      .catch((e: unknown) =>
        setActivityLogErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setActivityLogBusy(false));
  }, []);

  useEffect(() => {
    if (isKordClientEmbed) return;
    queueMicrotask(() => {
      loadActivityLog();
    });
  }, [isKordClientEmbed, loadActivityLog]);

  const selectedAccount: Account | null =
    accounts?.accounts.find((account) => account.id === selectedAccountId) ||
    accounts?.accounts[0] ||
    null;

  const accountNameById = useMemo(() => {
    if (!accounts?.accounts?.length) return null;
    return new Map(accounts.accounts.map((a) => [a.id, a.name] as const));
  }, [accounts]);

  const createNewAccount = () => {
    setAccountErr(null);
    setAccountBusy(true);
    createApiAccount({
      name: newAccountName.trim() || t("accounts.newFallback"),
    })
      .then((next) => {
        setAccounts(next);
        window.location.replace(new URL("/", window.location.href).href);
      })
      .catch((e: unknown) =>
        setAccountErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setAccountBusy(false));
  };

  const selectSessionAccount = (id: string) => {
    if (!id || id === selectedAccountId) return;
    setSelectedAccountId(id);
    setSelectedAccountIdState(id);
    const url = new URL("/", window.location.href);
    url.searchParams.set("accountId", id);
    window.location.replace(url.toString());
  };

  const runKordBackup = () => {
    setBackupErr(null);
    setBackupOk(null);
    setBackupBusy(true);
    downloadKordDataBackup()
      .then((name) => {
        setBackupOk(t("settings.backupSuccess", { name }));
        window.setTimeout(() => setBackupOk(null), 5000);
      })
      .catch((e: unknown) =>
        setBackupErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setBackupBusy(false));
  };

  const onRestoreFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const f = event.target.files?.[0];
    if (event.target) event.target.value = "";
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setRestoreErr(t("settings.restoreErrNotZip"));
      return;
    }
    setRestoreErr(null);
    setRestoreOk(null);
    setRestoreBusy(true);
    uploadKordDataRestore(f)
      .then(() => {
        setRestoreOk(t("settings.restoreSuccess"));
        window.setTimeout(() => setRestoreOk(null), 8000);
      })
      .catch((e: unknown) =>
        setRestoreErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setRestoreBusy(false));
  };

  const applyYoutubeCookieConfig = (c: {
    youtubeCookiesConfigured?: boolean;
    youtubeCookiesWritable?: boolean;
    youtubeCookiesLockedByEnv?: boolean;
    youtubeCookiesLabel?: string | null;
  }) => {
    setYoutubeCookiesConfigured(Boolean(c.youtubeCookiesConfigured));
    setYoutubeCookiesWritable(Boolean(c.youtubeCookiesWritable));
    setYoutubeCookiesLockedByEnv(Boolean(c.youtubeCookiesLockedByEnv));
    setYoutubeCookiesLabel(
      typeof c.youtubeCookiesLabel === "string" && c.youtubeCookiesLabel.trim()
        ? c.youtubeCookiesLabel.trim()
        : null
    );
  };

  const onYoutubeCookiesFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const f = event.target.files?.[0];
    if (event.target) event.target.value = "";
    if (!f) return;
    setYoutubeCookiesErr(null);
    setYoutubeCookiesOk(null);
    setYoutubeCookiesBusy(true);
    uploadYoutubeCookies(f)
      .then((c) => {
        applyYoutubeCookieConfig(c);
        setYoutubeCookiesOk(t("settings.youtubeCookiesSaved"));
        window.setTimeout(() => setYoutubeCookiesOk(null), 5000);
      })
      .catch((e: unknown) =>
        setYoutubeCookiesErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setYoutubeCookiesBusy(false));
  };

  const removeYoutubeCookies = () => {
    setYoutubeCookiesErr(null);
    setYoutubeCookiesOk(null);
    setYoutubeCookiesBusy(true);
    clearYoutubeCookies()
      .then((c) => {
        applyYoutubeCookieConfig(c);
        setYoutubeCookiesOk(t("settings.youtubeCookiesCleared"));
        window.setTimeout(() => setYoutubeCookiesOk(null), 5000);
      })
      .catch((e: unknown) =>
        setYoutubeCookiesErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setYoutubeCookiesBusy(false));
  };

  const removeAccount = async (id: string) => {
    if (id === accounts?.defaultAccountId) return;
    const account = accounts?.accounts.find((item) => item.id === id) || null;
    const name = account?.name || id;
    if (
      !(await appConfirm({
        message: t("accounts.removeConfirm", { name }),
        variant: "danger",
      }))
    ) {
      return;
    }
    setAccountErr(null);
    setAccountBusy(true);
    deleteApiAccount(id)
      .then((next) => {
        setAccounts(next);
        if (getSelectedAccountId() !== selectedAccountId) {
          setSelectedAccountIdState(getSelectedAccountId());
        }
        window.location.replace(new URL("/", window.location.href).href);
      })
      .catch((e: unknown) =>
        setAccountErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setAccountBusy(false));
  };

  const runRemoteCloudflareLogin = () => {
    setRemoteAccessErr(null);
    setRemoteAccessBusy(true);
    getRemoteAccessLoginUrl()
      .then((d) => {
        if (d.loginUrl) {
          window.open(d.loginUrl, "_blank", "noopener,noreferrer");
        }
      })
      .catch((e: unknown) =>
        setRemoteAccessErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setRemoteAccessBusy(false));
  };

  const logoutRemoteCloudflareLogin = () => {
    setRemoteAccessErr(null);
    setRemoteAccessBusy(true);
    logoutRemoteAccessLogin()
      .then((s) => setRemoteAccess(s))
      .catch((e: unknown) =>
        setRemoteAccessErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setRemoteAccessBusy(false));
  };

  const refreshRemoteState = useCallback(() => {
    fetchRemoteAccessState()
      .then((s) => {
        setRemoteAccess(s);
        if (s.status !== "error") setRemoteAccessErr(null);
      })
      .catch((e: unknown) =>
        setRemoteAccessErr(e instanceof Error ? e.message : String(e))
      );
  }, []);

  const toggleRemoteAccess = () => {
    setRemoteAccessErr(null);
    setRemoteAccessBusy(true);
    const op =
      remoteAccess?.status === "running" || remoteAccess?.status === "starting"
        ? stopRemoteAccess()
        : startRemoteAccess();
    op.then((s) => {
      setRemoteAccess(s);
    })
      .catch((e: unknown) =>
        setRemoteAccessErr(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setRemoteAccessBusy(false));
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshRemoteState();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshRemoteState]);

  const isRemoteViewer = !serverLocalAccess;
  const isNetworkControlAllowed = serverLocalAccess && !isKordClientEmbed;

  return (
    <div
      className={`dashboard-grid settings-page${
        isRemoteViewer ? " settings-page--remote" : ""
      }`}
    >
      <section className="surface-card">
        <div className="section-head section-head--page-toolbar">
          <div>
            <p className="eyebrow">{t("accounts.eyebrow")}</p>
            <h2>{t("accounts.heading")}</h2>
          </div>
        </div>
        {accountErr ? <p className="subtle sm warnline">{accountErr}</p> : null}
        {accounts ? (
          <div className="account-list">
            {accounts.accounts.map((account) => {
              const selected = account.id === selectedAccount?.id;
              return (
                <div
                  key={account.id}
                  className={`account-row${selected ? " is-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="account-row__main"
                    disabled={accountBusy || selected}
                    onClick={() => selectSessionAccount(account.id)}
                  >
                    <span className="account-row__avatar" aria-hidden>
                      {(account.name.trim()[0] || "?").toUpperCase()}
                    </span>
                    <span className="account-row__text">
                      <strong>{account.name}</strong>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    title={
                      account.id === accounts.defaultAccountId
                        ? t("accounts.removeDisabledDefault")
                        : undefined
                    }
                    disabled={
                      accountBusy || account.id === accounts.defaultAccountId
                    }
                    onClick={() => removeAccount(account.id)}
                  >
                    {t("accounts.remove")}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        {!libLocked ? (
          <div className="settings-merge-block">
            <div className="section-head section-head--page-toolbar">
              <div>
                <p className="eyebrow">{t("accounts.createEyebrow")}</p>
                <h2>{t("accounts.createHeading")}</h2>
              </div>
            </div>
            <div
              className="row gap flex-wrap"
              style={{ alignItems: "flex-end" }}
            >
              <label className="flex1" style={{ minWidth: "10rem" }}>
                <span className="sr-only">{t("accounts.newNameAria")}</span>
                <input
                  type="text"
                  className="ghost-input w-full"
                  value={newAccountName}
                  onChange={(event) => setNewAccountName(event.target.value)}
                  placeholder={t("accounts.newNamePh")}
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                className="btn"
                disabled={accountBusy || !newAccountName.trim()}
                onClick={createNewAccount}
              >
                {accountBusy ? t("settings.saving") : t("accounts.create")}
              </button>
            </div>
          </div>
        ) : null}
      </section>
      <section className="surface-card settings-ui-section">
        <div className="section-head section-head--page-toolbar">
          <div>
            <p className="eyebrow">{t("settings.uiEyebrow")}</p>
            <h2>{t("settings.uiHeading")}</h2>
          </div>
        </div>
        <div className="settings-grid settings-ui-section__grid">
          <label className="settings-ui-inline-control">
            <span>{t("settings.language")}</span>
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value as AppLocale)}
            >
              {APP_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {loc === "en" ? t("settings.langEn") : t("settings.langIt")}
                </option>
              ))}
            </select>
          </label>
          <div className="settings-ui-inline-control">
            <span>{t("settings.theme")}</span>
            <ThemePicker
              value={user.state.settings.theme}
              onChange={(theme) => user.updateSettings({ theme })}
              customTheme={user.state.settings.customTheme}
              onCustomThemeChange={(customTheme) =>
                user.updateSettings({ theme: "custom", customTheme })
              }
            />
          </div>
          <label className="settings-ui-inline-control">
            <span>{t("settings.visualizer")}</span>
            <select
              value={user.state.settings.vizMode}
              onChange={(event) =>
                user.updateSettings({
                  vizMode: event.target.value as
                    | "bars"
                    | "mirror"
                    | "osc"
                    | "oscSoft"
                    | "signals"
                    | "embers"
                    | "karaoke"
                    | "kord",
                })
              }
            >
              <option value="bars">{t("settings.vizBars")}</option>
              <option value="mirror">{t("settings.vizMirror")}</option>
              <option value="osc">{t("settings.vizOsc")}</option>
              <option value="oscSoft">{t("settings.vizOscSoft")}</option>
              <option value="signals">{t("settings.vizSignals")}</option>
              <option value="embers">{t("settings.vizEmbers")}</option>
              <option value="karaoke">{t("settings.vizKaraoke")}</option>
              <option value="kord">{t("settings.vizKord")}</option>
            </select>
          </label>
        </div>
      </section>
      <section className="surface-card">
        <div className="settings-merge-block settings-merge-block--first">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("settings.shortcutsEyebrow")}</p>
              <h2>{t("settings.shortcutsHeading")}</h2>
            </div>
          </div>
          <div className="shortcut-list">
            <div className="shortcut-row">
              <span className="shortcut-keys">
                <kbd className="shortcut-kbd">/</kbd>
                <span className="shortcut-keys__sep">
                  {t("settings.shortcutOr")}
                </span>
                <kbd className="shortcut-kbd">{t("settings.kbdCtrlK")}</kbd>
              </span>
              <span className="shortcut-row__dash" aria-hidden>
                —
              </span>
              <span className="shortcut-row__desc">
                {t("settings.shortcutSearchDesc")}
              </span>
            </div>
            <div className="shortcut-row">
              <kbd className="shortcut-kbd">{t("settings.kbdSpace")}</kbd>
              <span className="shortcut-row__dash" aria-hidden>
                —
              </span>
              <span className="shortcut-row__desc">
                {t("settings.shortcutPlayDesc")}
              </span>
            </div>
            <div className="shortcut-row">
              <kbd className="shortcut-kbd">{t("settings.kbdI")}</kbd>
              <span className="shortcut-row__dash" aria-hidden>
                —
              </span>
              <span className="shortcut-row__desc">
                {t("settings.shortcutListenDesc")}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="text-btn"
            onClick={() => onOpenSection("dashboard")}
          >
            {t("settings.backDashboard")}
          </button>
        </div>
      </section>
      {isKordClientEmbed ? null : (
        <section className="surface-card">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("settings.libraryEyebrow")}</p>
              <h2>{t("settings.libraryHeading")}</h2>
            </div>
          </div>
          {!libraryRootWritable ? (
            libLocked ? (
              <p className="subtle sm">
                {t("settings.libLocked", {
                  path: libraryPath.trim() || libraryRootLabel || "—",
                })}
              </p>
            ) : (
              <>
                <p className="subtle sm">{t("settings.libraryReadOnlyLead")}</p>
                {libraryRootLabel ? (
                  <p className="subtle sm">
                    {t("settings.libraryReadOnlyFolder", {
                      name: libraryRootLabel,
                    })}
                  </p>
                ) : (
                  <p className="subtle sm">
                    {t("settings.libraryRemoteUnsetLead")}
                  </p>
                )}
              </>
            )
          ) : (
            <>
              <p className="subtle sm">{t("settings.libraryRootLead")}</p>
              {libraryErr ? (
                <p className="subtle sm warnline">{libraryErr}</p>
              ) : null}
              {libLocked ? (
                <p className="subtle sm">
                  {t("settings.libLocked", {
                    path: libraryPath || "—",
                  })}
                </p>
              ) : (
                <div
                  className="row gap flex-wrap"
                  style={{ alignItems: "flex-end" }}
                >
                  <label className="flex1" style={{ minWidth: "12rem" }}>
                    <span className="sr-only">{t("settings.libPathAria")}</span>
                    <input
                      type="text"
                      className="ghost-input w-full"
                      value={libraryPath}
                      onChange={(event) => setLibraryPath(event.target.value)}
                      placeholder={t("settings.libPathPh")}
                      autoComplete="off"
                      aria-label={t("settings.libPathAria")}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn"
                    disabled={libraryBusy || !libraryPath.trim()}
                    onClick={() => {
                      setLibraryErr(null);
                      setLibraryBusy(true);
                      saveAppConfig({ musicRoot: libraryPath.trim() })
                        .then(() => {
                          window.location.replace(
                            new URL("/", window.location.href).href
                          );
                        })
                        .catch((e: unknown) =>
                          setLibraryErr(
                            e instanceof Error ? e.message : String(e)
                          )
                        )
                        .finally(() => setLibraryBusy(false));
                    }}
                  >
                    {libraryBusy
                      ? t("settings.saving")
                      : t("settings.saveReload")}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {!isKordClientEmbed &&
      serverLocalAccess &&
      (youtubeCookiesWritable || youtubeCookiesLockedByEnv) ? (
        <section className="surface-card settings-youtube-cookies-section">
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("settings.youtubeCookiesEyebrow")}</p>
              <h2>{t("settings.youtubeCookiesHeading")}</h2>
            </div>
          </div>
          <p className="subtle sm">{t("settings.youtubeCookiesLead")}</p>
          <p className="subtle sm">
            {youtubeCookiesConfigured
              ? t("settings.youtubeCookiesActive", {
                  name: youtubeCookiesLabel || "cookies.txt",
                })
              : t("settings.youtubeCookiesMissing")}
          </p>
          {youtubeCookiesLockedByEnv ? (
            <p className="subtle sm">{t("settings.youtubeCookiesEnvLocked")}</p>
          ) : (
            <div className="row gap flex-wrap">
              <input
                ref={youtubeCookiesInputRef}
                type="file"
                accept=".txt,text/plain"
                className="sr-only"
                onChange={onYoutubeCookiesFileChange}
              />
              <button
                type="button"
                className="btn"
                disabled={youtubeCookiesBusy}
                onClick={() => youtubeCookiesInputRef.current?.click()}
              >
                {youtubeCookiesBusy
                  ? t("settings.saving")
                  : t("settings.youtubeCookiesChoose")}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={youtubeCookiesBusy || !youtubeCookiesConfigured}
                onClick={removeYoutubeCookies}
              >
                {t("settings.youtubeCookiesClear")}
              </button>
            </div>
          )}
          {youtubeCookiesOk ? (
            <p className="subtle sm">{youtubeCookiesOk}</p>
          ) : null}
          {youtubeCookiesErr ? (
            <p className="subtle sm warnline">{youtubeCookiesErr}</p>
          ) : null}
        </section>
      ) : null}
      <section className="surface-card settings-network-section">
        <div className="section-head section-head--page-toolbar">
          <div>
            <p className="eyebrow">{t("settings.networkEyebrow")}</p>
            <h2>{t("settings.networkHeading")}</h2>
          </div>
        </div>
        <div className="settings-network-section__body">
          <div className="settings-network-main">
            {lanAccessUrl ? (
              <p className="subtle sm">
                {t("settings.networkUrlHint", { url: lanAccessUrl })}
              </p>
            ) : (
              <p className="subtle sm">{t("settings.networkNoUrl")}</p>
            )}
            {isNetworkControlAllowed ? (
              <>
                <div
                  className="row gap"
                  style={{
                    marginTop: "0.5rem",
                    flexDirection: "row",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    className="btn secondary sm"
                    disabled={remoteAccessBusy}
                    onMouseEnter={() => setRemoteLoginHover(true)}
                    onMouseLeave={() => setRemoteLoginHover(false)}
                    onClick={() => {
                      if (remoteAccess?.cloudflareLoggedIn) {
                        logoutRemoteCloudflareLogin();
                      } else {
                        runRemoteCloudflareLogin();
                      }
                    }}
                    style={
                      remoteAccess?.cloudflareLoggedIn
                        ? {
                            minWidth: "11.5rem",
                            backgroundColor: remoteLoginHover
                              ? "#c62828"
                              : "#2e7d32",
                            color: "#fff",
                            borderColor: remoteLoginHover
                              ? "#c62828"
                              : "#2e7d32",
                          }
                        : { minWidth: "11.5rem" }
                    }
                  >
                    {remoteAccess?.cloudflareLoggedIn
                      ? remoteLoginHover
                        ? t("settings.remoteLogout")
                        : t("settings.remoteLoginDone")
                      : t("settings.remoteLogin")}
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={remoteAccessBusy}
                    onMouseEnter={() => setRemoteShareHover(true)}
                    onMouseLeave={() => setRemoteShareHover(false)}
                    onClick={toggleRemoteAccess}
                    style={
                      remoteAccess?.status === "starting"
                        ? {
                            minWidth: "11.5rem",
                            background: "#f0be67",
                            color: "#1a1a1a",
                            border: "1px solid #f0be67",
                          }
                        : remoteAccess?.status === "running"
                        ? {
                            minWidth: "11.5rem",
                            background: remoteShareHover
                              ? "#c62828"
                              : "#2e7d32",
                            color: "#fff",
                            border: `1px solid ${
                              remoteShareHover ? "#c62828" : "#2e7d32"
                            }`,
                          }
                        : { minWidth: "11.5rem" }
                    }
                  >
                    {remoteAccess?.status === "starting"
                      ? "Starting"
                      : remoteAccess?.status === "running"
                      ? remoteShareHover
                        ? t("settings.remoteStopSharing")
                        : t("settings.remoteShared")
                      : t("settings.remoteStart")}
                  </button>
                </div>
                {remoteAccess?.publicUrl ? (
                  <p className="subtle sm">
                    {t("settings.remoteUrl", { url: remoteAccess.publicUrl })}
                  </p>
                ) : null}
              </>
            ) : remoteAccess?.publicUrl ? (
              <p className="subtle sm">
                {t("settings.remoteUrl", { url: remoteAccess.publicUrl })}
              </p>
            ) : (
              <p className="subtle sm">{t("settings.remoteNotShared")}</p>
            )}
            {remoteAccessErr || remoteAccess?.error ? (
              <p className="subtle sm warnline">
                {remoteAccessErr || remoteAccess?.error}
              </p>
            ) : null}
          </div>
          {remoteAccess?.publicUrl ? (
            <div className="settings-network-qr">
              <img
                className="settings-network-qr__img"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
                  remoteAccess.publicUrl
                )}`}
                alt={t("settings.remoteQrAlt", {
                  url: remoteAccess.publicUrl,
                })}
                loading="lazy"
              />
            </div>
          ) : null}
        </div>
      </section>
      {isKordClientEmbed ? null : (
        <section
          className="surface-card settings-activity-section"
          aria-label={t("settings.backupHeading")}
        >
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("settings.backupEyebrow")}</p>
              <h2>{t("settings.backupHeading")}</h2>
            </div>
            <div
              className="row gap flex-wrap"
              style={{ alignItems: "center", justifyContent: "flex-end" }}
            >
              <button
                type="button"
                className="btn secondary sm"
                disabled={backupBusy || restoreBusy}
                onClick={runKordBackup}
              >
                {backupBusy
                  ? t("settings.backupRunning")
                  : t("settings.backupCta")}
              </button>
              <input
                ref={restoreFileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                aria-label={t("settings.restoreCta")}
                onChange={onRestoreFileChange}
              />
              <button
                type="button"
                className="btn secondary sm"
                disabled={restoreBusy || backupBusy}
                onClick={() => restoreFileInputRef.current?.click()}
              >
                {restoreBusy
                  ? t("settings.restoreRunning")
                  : t("settings.restoreCta")}
              </button>
            </div>
          </div>
          {backupErr ? <p className="subtle sm warnline">{backupErr}</p> : null}
          {backupOk ? <p className="subtle sm">{backupOk}</p> : null}
          {restoreErr ? (
            <p className="subtle sm warnline">{restoreErr}</p>
          ) : null}
          {restoreOk ? <p className="subtle sm">{restoreOk}</p> : null}
        </section>
      )}
      {isKordClientEmbed ? null : (
        <section
          className="surface-card settings-activity-section"
          aria-label={t("settings.activityLogHeading")}
        >
          <div className="section-head section-head--page-toolbar">
            <div>
              <p className="eyebrow">{t("settings.activityLogEyebrow")}</p>
              <h2>{t("settings.activityLogHeading")}</h2>
            </div>
            <button
              type="button"
              className="btn secondary sm"
              disabled={activityLogBusy}
              onClick={loadActivityLog}
            >
              {activityLogBusy
                ? t("settings.saving")
                : t("settings.activityLogReload")}
            </button>
          </div>
          {activityLogErr ? (
            <p className="subtle sm warnline">{activityLogErr}</p>
          ) : null}
          {activityLog && !activityLog.length ? (
            <p className="subtle sm">{t("settings.activityLogEmpty")}</p>
          ) : null}
          {activityLog && activityLog.length > 0 ? (
            <div
              className="activity-log-scroll"
              style={{ maxHeight: "22rem", overflow: "auto" }}
            >
              <table className="activity-log-table">
                <thead>
                  <tr>
                    <th>{t("settings.activityLogColTime")}</th>
                    <th>{t("settings.activityLogColAccount")}</th>
                    <th>{t("settings.activityLogColKind")}</th>
                    <th>{t("settings.activityLogColAction")}</th>
                    <th>{t("settings.activityLogColFolder")}</th>
                    <th>{t("settings.activityLogColDetail")}</th>
                  </tr>
                </thead>
                <tbody>
                  {activityLog.map((row, i) => (
                    <tr key={`${row.ts}-${i}`}>
                      <td className="activity-log-td-nowrap">
                        {new Date(row.ts).toLocaleString(locale, {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
                      </td>
                      <td
                        className="activity-log-td-clip"
                        title={row.accountId}
                      >
                        {accountNameById?.get(row.accountId) ?? row.accountId}
                      </td>
                      <td>{row.kind}</td>
                      <td>{row.action}</td>
                      <td
                        className="activity-log-td-clip"
                        title={row.folder || ""}
                      >
                        {row.folder || "—"}
                      </td>
                      <td
                        className="activity-log-td-clip"
                        title={row.detail || ""}
                      >
                        {row.detail || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      )}
      <footer
        className="settings-colophon"
        role="contentinfo"
        aria-label={t("settings.colophonLine1", { version: kordAppVersion })}
      >
        <p className="settings-colophon__line">
          {t("settings.colophonLine1", { version: kordAppVersion })}
        </p>
        <p className="settings-colophon__subtle subtle sm">
          {t("settings.colophonLine2")}
        </p>
        <p className="settings-colophon__subtle subtle sm">
          {t("settings.colophonLine3")}
        </p>
        <p className="settings-colophon__subtle subtle sm">
          {t("settings.colophonLine4")}
        </p>
      </footer>
    </div>
  );
}


export default SettingsView;
