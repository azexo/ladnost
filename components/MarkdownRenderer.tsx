// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

// components/MarkdownRenderer.tsx
"use client";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  return (
    // Базовый контейнер. Классы из components будут применяться к тегам внутри.
    <div className={`space-y-6 pb-10 text-blue-100 text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          h1: ({ node, ...props }) => (
            <h1 className="text-3xl xl:text-4xl font-extrabold leading-tight mb-4" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="text-xl font-bold mb-3 flex items-center gap-2" {...props} />
          ),
          p: ({ node, ...props }) => (
            <p className="mb-3 text-base leading-relaxed" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="list-disc list-inside space-y-2" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="list-decimal list-inside space-y-2" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote className="border-l-2 border-blue-300 pl-4 italic" {...props} />
          ),
          strong: ({ node, ...props }) => (
            <strong className="font-semibold" {...props} />
          ),
          a: ({ node, ...props }) => (
            <a className="underline" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}