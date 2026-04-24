import { useEffect, useRef, type CSSProperties } from "react";
import { usePlayer } from "../context/PlayerContext";
import { KordWordmarkSvg } from "./KordWordmarkSvg";

export function KordMascotOverlay() {
  const { isPlaying, getAnalyser } = usePlayer();
  const wrapRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef(0);
  const freqRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = wrapRef.current;
      const an = getAnalyser();
      if (an && isPlaying) {
        let buf = freqRef.current;
        if (!buf || buf.length < an.frequencyBinCount) {
          buf = new Uint8Array(an.frequencyBinCount);
          freqRef.current = buf;
        }
        an.getByteFrequencyData(buf as never);
        const n = buf.length;
        let bsum = 0;
        const bn = Math.min(48, n);
        for (let j = 0; j < bn; j++) bsum += buf[j]!;
        const bassRaw = Math.min(1, (bsum / (bn * 255)) * 1.38);
        beatRef.current = beatRef.current * 0.62 + bassRaw * 0.38;
      } else {
        beatRef.current *= 0.82;
      }
      if (el) {
        el.style.setProperty("--kord-beat", beatRef.current.toFixed(4));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getAnalyser, isPlaying]);

  return (
    <div
      ref={wrapRef}
      className={`viz-kord-wordmark${isPlaying ? " is-playing" : ""}`}
      style={{ "--kord-beat": "0" } as CSSProperties}
      aria-hidden
    >
      <KordWordmarkSvg
        className="kord-wordmark-svg kord-wordmark-svg--viz"
        decorative
      />
    </div>
  );
}
