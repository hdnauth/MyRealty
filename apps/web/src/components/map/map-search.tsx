"use client";

import clsx from "clsx";
import { Building2, Loader2, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MapSearchResult } from "@/app/api/map/search/route";
import { isPropertyType, PROPERTY_TYPES } from "@/lib/property";

/**
 * 지도 상단 검색(단지명·동 이름은 입력하면서, 주소는 엔터로). 고르면 그 위치로 옮긴다.
 */
export function MapSearch({ onPick }: { onPick: (r: MapSearchResult) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<MapSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [geoTried, setGeoTried] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const ctl = useRef<AbortController | null>(null);

  const run = (text: string, geo: boolean) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(true);
    fetch(`/api/map/search?q=${encodeURIComponent(text)}${geo ? "&geo=1" : ""}`, { signal: c.signal })
      .then((r) => r.json())
      .then((d) => {
        setResults(d.results ?? []);
        setActive(0);
        setGeoTried(geo);
        setBusy(false);
      })
      .catch(() => {
        if (!c.signal.aborted) setBusy(false);
      });
  };

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    const t = setTimeout(() => run(text, false), 250);
    return () => clearTimeout(t);
  }, [q]);

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const pick = (r: MapSearchResult) => {
    onPick(r);
    setOpen(false);
    input.current?.blur();
  };
  const text = q.trim();
  const shown = text.length >= 2 ? results : [];

  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
      <input
        ref={input}
        type="search"
        enterKeyHint="search"
        value={q}
        placeholder="단지·동네 검색"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setGeoTried(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, shown.length - 1));
          else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
          else if (e.key === "Escape") setOpen(false);
          else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (shown[active]) pick(shown[active]);
            else if (text.length >= 2) run(text, true);
          }
        }}
        className="h-9 w-full rounded-full border border-border bg-surface-2 pl-8 pr-8 text-sm outline-none focus:border-accent focus:bg-surface [&::-webkit-search-cancel-button]:hidden"
      />
      {busy ? (
        <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted" />
      ) : q ? (
        <button
          type="button"
          aria-label="검색어 지우기"
          onClick={() => {
            setQ("");
            setResults([]);
            input.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted"
        >
          <X size={15} />
        </button>
      ) : null}
      {open && text.length >= 2 ? (
        <ul className="absolute left-0 top-full z-10 mt-1 max-h-[60vh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto rounded-xl border border-border bg-surface py-1 text-sm shadow-lg">
          {shown.map((r, i) => (
            <li key={r.kind === "complex" ? `c${r.id}` : `p${r.label}${r.lng}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={clsx("flex w-full items-center gap-2 px-3 py-2 text-left", i === active && "bg-surface-2")}
              >
                {r.kind === "complex" ? <Building2 size={15} className="shrink-0 text-accent" /> : <MapPin size={15} className="shrink-0 text-warn" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.kind === "complex" ? r.name : r.label}</span>
                  <span className="block truncate text-xs text-muted">
                    {r.kind === "complex" ? [isPropertyType(r.property_type) ? PROPERTY_TYPES[r.property_type].label : r.property_type, r.area].filter(Boolean).join(" · ") : r.sub ?? "동네"}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {!geoTried ? (
            <li>
              <button type="button" onClick={() => run(text, true)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-accent">
                <MapPin size={15} className="shrink-0" />
                <span className="truncate">‘{text}’ 주소로 위치 찾기</span>
              </button>
            </li>
          ) : !shown.length ? (
            <li className="px-3 py-2 text-muted">찾지 못했습니다. 단지 이름이나 ‘시·구 + 동’으로 검색해 보세요.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
