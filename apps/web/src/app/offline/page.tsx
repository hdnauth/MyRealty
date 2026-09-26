export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-lg font-semibold">오프라인 상태입니다</p>
      <p className="text-sm text-muted">네트워크에 연결되면 최신 정보를 불러옵니다.</p>
    </div>
  );
}
