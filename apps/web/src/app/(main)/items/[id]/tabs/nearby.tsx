import { TxTable } from "@/components/items/tx-table";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { nearbyTransactions, type WatchItem } from "@/lib/queries/items";

export async function NearbyTab({ item }: { item: WatchItem }) {
  if (item.lng === null) {
    return (
      <Card>
        <EmptyState title="좌표가 없어 주변 거래를 찾을 수 없습니다" desc="지오코딩 키(NCP)를 설정하거나 ETL 지오코딩 작업을 실행하세요." />
      </Card>
    );
  }
  const rows = await nearbyTransactions(item, { months: 6 });
  return (
    <Card>
      <CardHeader title="반경 내 최근 매매" sub={`반경 ${item.radius_m.toLocaleString()}m · 최근 6개월 · ${rows.length}건`} />
      <TxTable rows={rows} showName extra="dist" />
    </Card>
  );
}
