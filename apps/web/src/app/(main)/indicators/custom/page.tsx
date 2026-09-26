import type { Metadata } from "next";
import Link from "next/link";
import { LineSeriesChart } from "@/components/charts/series-chart";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { evalExpression, listCustom } from "@/lib/queries/custom";
import { indicatorRegions, listSeries } from "@/lib/queries/indicators";
import { deleteCustomAction } from "./actions";
import { Builder } from "./builder";

export const metadata: Metadata = { title: "커스텀 지표" };

export default async function CustomIndicatorsPage() {
  const user = await requireUser();
  const [catalog, saved, regions] = await Promise.all([listSeries(), listCustom(user.id), indicatorRegions(user.id)]);
  const results = await Promise.all(saved.map((s) => evalExpression(s.expression)));
  return (
    <div className="space-y-4">
      <PageHeader title="커스텀 지표" sub="보유한 시계열을 조합해 나만의 지표를 만듭니다." action={<Link href="/indicators" className="shrink-0 whitespace-nowrap text-sm text-accent">← 지표</Link>} />
      {saved.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {saved.map((s, i) => {
            const r = results[i];
            return (
              <Card key={s.id}>
                <CardHeader
                  title={s.name}
                  sub={<code className="text-xs">{s.expression}</code>}
                  action={
                    <form action={deleteCustomAction.bind(null, s.id)}>
                      <button className="text-xs text-up">삭제</button>
                    </form>
                  }
                />
                <div className="px-2 pb-3">
                  {"points" in r ? <LineSeriesChart lines={[{ name: s.name, points: r.points }]} fmt="num1" height={200} /> : <p className="px-2 text-sm text-up">{r.error}</p>}
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
      <Builder catalog={catalog} sgg={regions[0]?.sgg ?? null} />
    </div>
  );
}
