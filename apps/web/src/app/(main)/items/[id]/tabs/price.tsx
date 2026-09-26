import { PriceHistoryChart } from "@/components/charts/price-history";
import { TxTable } from "@/components/items/tx-table";
import { Card, CardHeader } from "@/components/ui";
import { itemTransactions, type WatchItem } from "@/lib/queries/items";

export async function PriceTab({ item, all = false }: { item: WatchItem; all?: boolean }) {
  const points = await itemTransactions(item, 10);
  const scope = item.complex_id ? `${item.complex_name} · 면적 ±3㎡` : `${item.umd_nm ?? "같은 지역"} · 유사 면적`;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="실거래가 추이" sub={scope} />
        <div className="px-2 pb-3">
          <PriceHistoryChart points={points} />
        </div>
      </Card>
      <Card>
        <CardHeader title="거래 내역" sub={`${points.length}건 · 해제(취소) 거래 포함 표시`} />
        <TxTable
          rows={[...points].reverse()}
          showName={!item.complex_id}
          limit={all ? 5000 : 30}
          moreHref={`/items/${item.id}?tab=price&all=1`}
        />
      </Card>
    </div>
  );
}
