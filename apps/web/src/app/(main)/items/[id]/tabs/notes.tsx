import { Button, Card, CardHeader, Textarea } from "@/components/ui";
import { CHECKLISTS } from "@/lib/checklists";
import { sql } from "@/lib/db";
import { timeAgo } from "@/lib/format";
import type { WatchItem } from "@/lib/queries/items";
import { addNoteAction, deleteNoteAction } from "../../actions";
import { ChecklistBox } from "./checklist-box";

export async function NotesTab({ item }: { item: WatchItem }) {
  const notes = await sql<{ id: string; body: string; checklist: Record<string, boolean> | null; created_at: string }[]>`
    select id, body, checklist, created_at::text from notes where watch_item_id = ${item.id} and user_id = ${item.user_id}
    order by created_at desc`;
  const state = notes.find((n) => n.checklist)?.checklist ?? {};
  const items = CHECKLISTS[item.property_type] ?? [];
  const memo = notes.filter((n) => n.body);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="임장·메모" sub="방문 기록, 중개사 코멘트, 확인한 사실 등을 남겨 두세요." />
        <form action={addNoteAction.bind(null, item.id)} className="space-y-2 px-4 pb-3">
          <Textarea name="body" rows={3} placeholder="예) 9/20 임장 — 남향, 단지 내 경사 있음, 관리비 월 38만원" />
          <div className="flex justify-end"><Button type="submit" className="h-9">저장</Button></div>
        </form>
        <ul className="divide-y divide-border px-4 pb-2">
          {memo.map((n) => (
            <li key={n.id} className="py-3">
              <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                <span>{timeAgo(n.created_at)}</span>
                <form action={deleteNoteAction.bind(null, n.id)}><button className="text-up">삭제</button></form>
              </div>
            </li>
          ))}
          {!memo.length ? <li className="py-3 text-sm text-muted">메모가 없습니다.</li> : null}
        </ul>
      </Card>
      <Card className="h-fit">
        <CardHeader title="확인 체크리스트" sub={`${Object.values(state).filter(Boolean).length} / ${items.length} 완료`} />
        <ul className="space-y-2 px-4 pb-4 text-sm">
          {items.map((label) => (
            <li key={label}><ChecklistBox itemId={item.id} label={label} done={Boolean(state[label])} /></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
