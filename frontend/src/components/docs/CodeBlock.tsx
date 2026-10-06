'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  showLineNumbers?: boolean;
}

export function CodeBlock({
  code,
  language = 'd2',
  title,
  showLineNumbers = true,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const lines = code.trim().split('\n');

  return (
    <div className="relative group my-5 rounded-lg overflow-hidden border border-gray-800 bg-[#0c0c0c] shadow-xs">
      {/* Next.js docs style top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#141414] border-b border-gray-800/80 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-gray-300 font-medium">
            {title || `${language.toLowerCase()}`}
          </span>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code"
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors font-mono"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 text-[11px]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-300" />
              <span className="text-[11px]">Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Area */}
      <div className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-[#ededed] bg-[#0c0c0c]">
        <pre className="flex">
          {showLineNumbers && (
            <div
              className="select-none pr-4 text-right text-gray-600 font-mono text-xs border-r border-gray-800 mr-4"
              aria-hidden="true"
            >
              {lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <code className="flex-1 font-mono">{code.trim()}</code>
        </pre>
      </div>
    </div>
  );
}
