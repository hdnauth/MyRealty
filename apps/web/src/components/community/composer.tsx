"use client";

import clsx from "clsx";
import { BarChart3, Building2, ImagePlus, LineChart, Plus, Receipt, X } from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
import type { FormState } from "@/app/(main)/community/actions";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { formatManwon } from "@/lib/format";
import { CATEGORIES, LIMITS, USER_CATEGORIES } from "@/lib/community/rules";

type Att = { type: "trade"; id: number; label?: string } | { type: "complex"; id: number; area?: number | null; label?: string } | { type: "series"; code: string; label?: string } | { type: "image"; id: string };
export type BoardOption = { value: string; label: string; group: string; sgg: string };
type TradeOpt = { id: number; deal_kind: string; deal_date: string; price: number; monthly_rent: number | null; area_m2: number; floor: number | null };
type SeriesOpt = { code: string; name: string };

const DEAL: Record<string, string> = { sale: "매매", jeonse: "전세", wolse: "월세" };

/** 브라우저에서 긴 변 1280px JPEG 로 줄여 올린다(용량·EXIF 위치정보 제거) */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("변환 실패"))), "image/jpeg", 0.82));
}

export function Composer({
  action,
  boards,
  initialBoard,
  initial,
  editing = false,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  boards: BoardOption[];
  initialBoard: string;
  initial?: { category?: string; title?: string; body?: string; attachments?: Att[]; poll?: "" | "outlook" | "custom" };
  editing?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [board, setBoard] = useState(initialBoard);
  const [category, setCategory] = useState(initial?.category ?? "question");
  const [atts, setAtts] = useState<Att[]>(initial?.attachments ?? []);
  const [picker, setPicker] = useState<null | "trade" | "series">(null);
  const [trades, setTrades] = useState<TradeOpt[] | null>(null);
  const [series, setSeries] = useState<SeriesOpt[] | null>(null);
  const [poll, setPoll] = useState<"" | "outlook" | "custom">(initial?.poll ?? "");
  const [options, setOptions] = useState(["", ""]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [scope, scopeId] = board.split(":");
  const complexId = scope === "complex" ? Number(scopeId) : null;
  const sgg = boards.find((b) => b.value === board)?.sgg ?? null;

  useEffect(() => {
    if (picker === "trade" && complexId && !trades) {
      fetch(`/api/community/attach?complex=${complexId}`).then((r) => r.json()).then((j) => setTrades(j.trades ?? []));
    }
    if (picker === "series" && !series) {
      fetch(`/api/community/attach?${complexId ? `complex=${complexId}` : `sgg=${sgg}`}`).then((r) => r.json()).then((j) => setSeries(j.series ?? []));
    }
  }, [picker, complexId, sgg, trades, series]);

  const images = atts.filter((a) => a.type === "image");
  // label 은 화면 표시용(서버는 type·id·code·area 만 읽는다)
  const json = useMemo(() => JSON.stringify(atts), [atts]);
  const has = (a: Att) => atts.some((x) => x.type === a.type && ("code" in x ? x.code === (a as { code: string }).code : x.id === (a as { id: unknown }).id));
  const toggle = (a: Att) => setAtts((xs) => (has(a) ? xs.filter((x) => !(x.type === a.type && ("code" in x ? x.code === (a as { code: string }).code : x.id === (a as { id: unknown }).id))) : [...xs, a]));

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    for (const f of [...files].slice(0, LIMITS.imagesPerPost - images.length)) {
      setUploading((n) => n + 1);
      try {
        const blob = await shrink(f);
        const fd = new FormData();
        fd.set("file", blob, "photo.jpg");
        const r = await fetch("/api/community/images", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "업로드 실패");
        setAtts((xs) => [...xs, { type: "image", id: j.id }]);
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="attachments" value={json} />
      <input type="hidden" name="complex_id" value={complexId ?? ""} />
      <input type="hidden" name="sgg" value={scope === "sgg" ? scopeId : ""} />

      {!editing ? (
        <Field label="게시판">
          <Select
            value={board}
            onChange={(e) => {
              // 게시판이 바뀌면 그 게시판 기준 첨부 후보를 다시 받는다
              setBoard(e.target.value);
              setTrades(null);
              setSeries(null);
              setAtts((xs) => xs.filter((a) => a.type === "image"));
            }}
          >
            {[...new Set(boards.map((b) => b.group))].map((g) => (
              <optgroup key={g} label={g}>
                {boards.filter((b) => b.group === g).map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      ) : null}

      <div>
        <span className="mb-1 block text-[13px] font-medium text-muted">말머리</span>
        <input type="hidden" name="category" value={category} />
        <div className="flex flex-wrap gap-1.5">
          {USER_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={clsx("rounded-full border px-3 py-1 text-sm", category === c ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted")}
            >
              {CATEGORIES[c].label}
            </button>
          ))}
        </div>
        {category === "question" ? <p className="mt-1 text-xs text-muted">질문 글에는 AI가 실거래·지표로 먼저 답을 달고, 이웃의 답을 기다립니다.</p> : null}
      </div>

      <Field label="제목">
        <Input name="title" required maxLength={LIMITS.titleMax} defaultValue={initial?.title} placeholder="예) 84㎡ 최근 거래가 왜 이렇게 올랐을까요?" />
      </Field>
      <Field label="본문" hint="동·호수, 전화번호, 계좌번호는 저장할 때 자동으로 가려집니다. 특정 가격 이하로 팔지 말자는 등 담합 유도는 법으로 금지됩니다.">
        <Textarea name="body" rows={8} maxLength={LIMITS.bodyMax} defaultValue={initial?.body} placeholder="근거(거래·지표)를 붙이면 대화가 쉬워집니다." />
      </Field>

      {/* 첨부 */}
      <div className="space-y-2">
        <span className="block text-[13px] font-medium text-muted">데이터·사진 첨부</span>
        <div className="flex flex-wrap gap-1.5">
          {complexId ? (
            <Chip active={atts.some((a) => a.type === "complex")} onClick={() => toggle({ type: "complex", id: complexId, label: "단지 시세" })} icon={Building2}>단지 시세 카드</Chip>
          ) : null}
          {complexId ? <Chip active={picker === "trade"} onClick={() => setPicker(picker === "trade" ? null : "trade")} icon={Receipt}>실거래</Chip> : null}
          <Chip active={picker === "series"} onClick={() => setPicker(picker === "series" ? null : "series")} icon={LineChart}>지표</Chip>
          <label className={clsx("inline-flex cursor-pointer items-center gap-1 rounded-full border border-border px-3 py-1 text-sm text-muted hover:text-text", images.length >= LIMITS.imagesPerPost && "pointer-events-none opacity-50")}>
            <ImagePlus size={14} /> 사진 {images.length}/{LIMITS.imagesPerPost}
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          </label>
        </div>

        {picker === "trade" ? (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
            {!trades ? <p className="p-3 text-sm text-muted">불러오는 중…</p> : !trades.length ? <p className="p-3 text-sm text-muted">거래가 없습니다.</p> : (
              <ul className="divide-y divide-border text-sm">
                {trades.map((t) => (
                  <li key={t.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface-2">
                      <input type="checkbox" checked={has({ type: "trade", id: t.id })} onChange={() => toggle({ type: "trade", id: t.id, label: `${t.deal_date} ${formatManwon(t.price, { short: true })}` })} />
                      <span className="tabular">{t.deal_date}</span>
                      <span className="text-muted">{Math.round(t.area_m2)}㎡ · {t.floor ?? "-"}층 · {DEAL[t.deal_kind]}</span>
                      <b className="tabular ml-auto">{formatManwon(t.price, { short: true })}</b>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {picker === "series" ? (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
            {!series ? <p className="p-3 text-sm text-muted">불러오는 중…</p> : !series.length ? <p className="p-3 text-sm text-muted">이 지역 지표가 아직 없습니다.</p> : (
              <ul className="divide-y divide-border text-sm">
                {series.map((s) => (
                  <li key={s.code}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface-2">
                      <input type="checkbox" checked={has({ type: "series", code: s.code })} onChange={() => toggle({ type: "series", code: s.code, label: s.name })} />
                      {s.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {atts.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {atts.map((a, i) => (
              <li key={i} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 py-1 pr-1 pl-2 text-xs">
                {a.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/community/images/${a.id}`} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                  <span>{a.type === "trade" ? "실거래" : a.type === "complex" ? "단지 시세" : "지표"}{a.label && a.type !== "complex" ? ` · ${a.label}` : ""}</span>
                )}
                <button type="button" aria-label="첨부 빼기" onClick={() => setAtts((xs) => xs.filter((_, j) => j !== i))} className="rounded p-0.5 text-muted hover:text-up"><X size={13} /></button>
              </li>
            ))}
          </ul>
        ) : null}
        {uploading ? <p className="text-xs text-muted">사진 올리는 중…</p> : null}
        {uploadError ? <p className="text-xs text-up">{uploadError}</p> : null}
      </div>

      {/* 투표 */}
      {!editing ? (
        <div className="space-y-2">
          <span className="block text-[13px] font-medium text-muted">투표</span>
          <input type="hidden" name="poll_kind" value={poll} />
          <div className="flex flex-wrap gap-1.5">
            <Chip active={poll === ""} onClick={() => setPoll("")}>없음</Chip>
            <Chip active={poll === "outlook"} onClick={() => setPoll("outlook")} icon={BarChart3}>1년 뒤 가격 전망</Chip>
            <Chip active={poll === "custom"} onClick={() => setPoll("custom")} icon={Plus}>직접 만들기</Chip>
          </div>
          {poll === "outlook" ? <p className="text-xs text-muted">오른다 / 비슷하다 / 내린다 · 30일 진행. 결과는 지표 화면의 &lsquo;커뮤니티 심리&rsquo;로 모입니다.</p> : null}
          {poll === "custom" ? (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Input name="poll_question" placeholder="투표 질문" maxLength={100} required />
              {options.map((o, i) => (
                <div key={i} className="flex gap-1">
                  <Input name="poll_option" value={o} onChange={(e) => setOptions((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`항목 ${i + 1}`} maxLength={40} />
                  {options.length > 2 ? <Button type="button" variant="ghost" onClick={() => setOptions((xs) => xs.filter((_, j) => j !== i))} aria-label="항목 삭제"><X size={14} /></Button> : null}
                </div>
              ))}
              <div className="flex items-center justify-between">
                {options.length < LIMITS.pollOptionsMax ? <Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => setOptions((xs) => [...xs, ""])}><Plus size={13} />항목 추가</Button> : <span />}
                <label className="flex items-center gap-1 text-xs text-muted">
                  기간
                  <Select name="poll_days" defaultValue="7" className="h-8 w-24 text-xs">
                    {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d}일</option>)}
                  </Select>
                </label>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.error ? <p role="alert" className="text-sm text-up">{state.error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || uploading > 0}>{pending ? "저장 중…" : editing ? "수정" : "올리기"}</Button>
      </div>
    </form>
  );
}

function Chip({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon?: typeof Plus; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm", active ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted hover:text-text")}
    >
      {Icon ? <Icon size={14} /> : null}
      {children}
    </button>
  );
}
