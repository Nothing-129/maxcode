"use client"

import Markdown from "react-markdown"
import { BrowserLink } from "@/components/ui/browser-link"
import remarkGfm from "remark-gfm"

export function TodoMarkdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 space-y-3 text-sm leading-6 wrap-anywhere [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_code]:bg-muted [&_table]:block [&_table]:overflow-auto [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => {
            if (!href) return <span>{children}</span>
            if (href.startsWith("/api/todo_attachment/")) {
              return (
                <a href={href} download className="text-primary underline">
                  {children}
                </a>
              )
            }
            return (
              <BrowserLink href={href} className="text-primary underline">
                {children}
              </BrowserLink>
            )
          },
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt ?? ""}
              loading="lazy"
              className="my-2 max-h-80 max-w-full rounded-lg object-contain"
            />
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
