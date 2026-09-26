import clsx from "clsx";

/** 화면 전환 중 보여 줄 뼈대(loading.tsx). 서버가 데이터를 가져오는 동안 바로 표시돼 눌렀는지 알 수 있다. */
export function Bone({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-md bg-surface-2", className)} />;
}

export function PageSkeleton({ variant = "list" }: { variant?: "list" | "detail" | "full" }) {
  if (variant === "full") return <Bone className="h-[calc(100dvh-9rem)] w-full rounded-xl lg:h-[calc(100dvh-6rem)]" />;
  return (
    <div role="status" aria-label="불러오는 중" className="space-y-4">
      {variant === "detail" ? (
        <div className="flex items-center gap-3">
          <Bone className="h-12 w-12 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Bone className="h-6 w-1/2" />
            <Bone className="h-4 w-2/3" />
          </div>
        </div>
      ) : (
        <Bone className="h-7 w-40" />
      )}
      {variant === "detail" ? <Bone className="h-9 w-full" /> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card space-y-3 p-4 lg:col-span-2">
          <Bone className="h-5 w-1/3" />
          <Bone className="h-40 w-full" />
          <Bone className="h-4 w-5/6" />
          <Bone className="h-4 w-2/3" />
        </div>
        <div className="card space-y-3 p-4">
          <Bone className="h-5 w-1/2" />
          {[0, 1, 2, 3].map((i) => (
            <Bone key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
