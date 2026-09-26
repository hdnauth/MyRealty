import { Card, EmptyState, PageHeader } from "@/components/ui";

export default function Page() {
  return (
    <div>
      <PageHeader title="비교" />
      <Card>
        <EmptyState title="준비 중인 화면입니다" desc="다음 단계에서 제공됩니다." />
      </Card>
    </div>
  );
}
