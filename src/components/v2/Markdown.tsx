"use client";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// Markdown from Notion pages and Google Docs. Raw HTML is parsed (Notion uses tags for tables, toggles, callouts) and then sanitised
// with GitHub's allow-list: scripts, styles, event handlers and unknown tags never reach the DOM (unknown tags are
// unwrapped, so their text stays). Links open in a new tab.
const MD = [
  "text-sm leading-relaxed break-words",
  "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-2 [&_a]:underline [&_a]:underline-offset-2",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5",
  "[&_li:has(>input)]:list-none [&_li>input]:mr-2 [&_li>input]:-ml-5 [&_li>input]:align-middle",
  "[&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-4",
  "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:text-[0.85em] [&_pre]:bg-muted [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:my-3 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_details]:my-2 [&_summary]:cursor-pointer [&_summary]:font-medium [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded",
].join(" ");
export function Markdown({ markdown }: { markdown: string }) {
  return (
    <div className={MD}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
