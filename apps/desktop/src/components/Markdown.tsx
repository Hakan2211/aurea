import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "@/components/ui";

/* Director-bubble markdown. One components map instead of a prose plugin so
 * every element stays on the token palette and the 13px chat scale. */

type Components = ComponentProps<typeof ReactMarkdown>["components"];

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed [&:not(:first-child)]:mt-2">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-cream">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-gold underline decoration-gold/40 underline-offset-2 transition hover:decoration-gold"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-1 pl-4 marker:text-gold/60 [&:not(:first-child)]:mt-2">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-4 marker:text-fog [&:not(:first-child)]:mt-2">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h3 className="font-serif text-[15px] text-cream [&:not(:first-child)]:mt-3">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="font-serif text-[15px] text-cream [&:not(:first-child)]:mt-3">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="text-[13px] font-semibold text-cream [&:not(:first-child)]:mt-3">{children}</h4>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-gold/40 pl-3 text-cream/70 [&:not(:first-child)]:mt-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-cream/10" />,
  code: ({ className, children }) =>
    className ? (
      // block code — react-markdown sets language-* on fenced blocks
      <code className={cx("font-mono text-[12px] text-cream/90", className)}>{children}</code>
    ) : (
      <code className="rounded bg-ink/60 px-1 py-0.5 font-mono text-[12px] text-gold/90">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg bg-ink/60 p-3 [&:not(:first-child)]:mt-2">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto [&:not(:first-child)]:mt-2">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-cream/15 px-2 py-1 text-left font-semibold text-cream">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-cream/5 px-2 py-1 align-top text-cream/85">{children}</td>
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
