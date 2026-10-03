import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** AI 응답·리포트용 Markdown 렌더러(표 지원, 링크는 새 탭) */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-mr text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (p) => <a {...p} target="_blank" rel="noreferrer" className="text-accent underline" />,
          table: (p) => (
            <div className="my-2 overflow-x-auto">
              <table {...p} className="w-full whitespace-nowrap text-sm" />
            </div>
          ),
          th: (p) => <th {...p} className="border-b border-border px-2 py-1 text-left font-medium text-muted" />,
          td: (p) => <td {...p} className="border-b border-border/60 px-2 py-1 tabular" />,
          h1: (p) => <h3 {...p} className="mt-4 mb-1 text-base font-bold" />,
          h2: (p) => <h3 {...p} className="mt-4 mb-1 text-base font-bold" />,
          h3: (p) => <h4 {...p} className="mt-3 mb-1 font-semibold" />,
          ul: (p) => <ul {...p} className="my-1 list-disc space-y-0.5 pl-5" />,
          ol: (p) => <ol {...p} className="my-1 list-decimal space-y-0.5 pl-5" />,
          p: (p) => <p {...p} className="my-1.5" />,
          code: (p) => <code {...p} className="rounded bg-surface-2 px-1 text-xs" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
