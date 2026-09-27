import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { NewItemForm } from "./new-item-form";

export const metadata: Metadata = { title: "부동산 등록" };

export default function NewItemPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="관심 부동산 등록" sub="아파트·빌라·오피스텔·단독·토지·임야·상가를 주소로 등록하세요." />
      <NewItemForm />
    </div>
  );
}
