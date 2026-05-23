import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/useI18n";
import { usePlayer } from "../../context/PlayerContext";
import { useUserState } from "../../context/UserStateContext";
import {
  popoverPlacementStyle,
  usePopoverLayerAnchored,
} from "../../hooks/usePopoverLayerAnchored";
import { ExcludeShuffleIcon } from "../ExcludeShuffleIcon";
import {
  UiFavorite,
  UiMoreVert,
  UiRepeat,
  UiShuffle,
  UiSkipNext,
  UiSkipPrevious,
} from "../KordUiIcons";
import type { EnrichedTrack } from "../../types";

type PlayerCtx = ReturnType<typeof usePlayer>;
type UserCtx = ReturnType<typeof useUserState>;

interface PlayerBarMobileMenuProps {
  cur: EnrichedTrack | null;
  p: PlayerCtx;
  user: UserCtx;
  shuffleExcluded: boolean;
  albumShuffleExcluded: boolean;
  onGoToAscolta: () => void;
}

export const PlayerBarMobileMenu = memo(function PlayerBarMobileMenu({
  cur,
  p,
  user,
  shuffleExcluded,
  albumShuffleExcluded,
  onGoToAscolta,
}: PlayerBarMobileMenuProps) {
  const { t } = useI18n();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const placement = usePopoverLayerAnchored(open, anchorRef, close, menuRef, {
    alignMinWidthPx: 220,
    preferAbove: true,
  });

  useEffect(() => {
    setOpen(false);
  }, [cur?.relPath]);

  const repeatLabel =
    p.repeat === "off"
      ? t("player.repeatOff")
      : p.repeat === "all"
        ? t("player.repeatAll")
        : t("player.repeatOne");

  const run = (fn: () => void) => {
    fn();
    close();
  };

  type MenuItem = {
    key: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    pressed?: boolean;
    disabled?: boolean;
  };

  const menuItems: MenuItem[] = [
    {
      key: "prev",
      label: t("player.prevTitle"),
      icon: <UiSkipPrevious />,
      onClick: () => run(() => p.prev()),
    },
    {
      key: "next",
      label: t("player.nextTitle"),
      icon: <UiSkipNext />,
      onClick: () => run(() => p.next()),
    },
    {
      key: "shuffle",
      label: t("player.shuffleTitle"),
      icon: <UiShuffle />,
      onClick: () => run(() => p.setShuffle(!p.shuffle)),
      pressed: p.shuffle,
    },
    {
      key: "repeat",
      label: repeatLabel,
      icon: <UiRepeat />,
      onClick: () =>
        run(() =>
          p.setRepeat(
            p.repeat === "off"
              ? "all"
              : p.repeat === "all"
                ? "one"
                : "off",
          ),
        ),
      pressed: p.repeat !== "off",
    },
    ...(cur
      ? [
          {
            key: "fav",
            label: t("trackRow.favTitle"),
            icon: <UiFavorite />,
            onClick: () => run(() => user.toggleFavorite(cur.relPath)),
            pressed: user.isFavorite(cur.relPath),
          },
          {
            key: "exclude",
            label: shuffleExcluded
              ? t("trackRow.unblockShuffle")
              : t("trackRow.blockShuffle"),
            icon: <ExcludeShuffleIcon />,
            onClick: () => {
              if (albumShuffleExcluded) return;
              run(() => user.toggleShuffleExcludedTrack(cur.relPath));
            },
            disabled: albumShuffleExcluded,
            pressed: shuffleExcluded,
          },
        ]
      : []),
    {
      key: "listen",
      label: t("player.openListenTitle"),
      icon: null,
      onClick: () => run(onGoToAscolta),
    },
  ];

  return (
    <div className="player-bar2__mobile-menu-wrap" ref={anchorRef}>
      <button
        type="button"
        className={`player-bar2__ic player-bar2__ic--overflow${
          open ? " is-on" : ""
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        title={t("player.mobileMenuTitle")}
        aria-label={t("player.mobileMenuAria")}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="player-bar2__ic-glyph player-bar2__ic-glyph--svg"
          aria-hidden
        >
          <UiMoreVert />
        </span>
      </button>
      {open && menuItems.length > 0
        ? createPortal(
            <ul
              ref={menuRef}
              id={menuId}
              className="track-row__overflow-menu popover-layer-fixed player-bar2__mobile-menu"
              role="menu"
              style={popoverPlacementStyle(placement)}
            >
              {menuItems.map((item) => (
                <li key={item.key} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className={`track-row__overflow-item${
                      item.pressed ? " is-on" : ""
                    }`}
                    disabled={item.disabled}
                    aria-pressed={item.pressed}
                    onClick={item.onClick}
                  >
                    {item.icon ? (
                      <span
                        className="track-row__overflow-item-glyph track-row__ic-glyph--svg"
                        aria-hidden
                      >
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="track-row__overflow-item-label">
                      {item.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
});

