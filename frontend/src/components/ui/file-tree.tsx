'use client';

import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

const FolderIcon = ({ open = false }: { open?: boolean }) => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0 text-[#6965DB]"
  >
    {open ? (
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    ) : (
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    )}
  </svg>
);

const FileIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0 text-[#8c8b9f]"
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </svg>
);

const Chevron = ({ open = false }: { open?: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn(
      'shrink-0 text-[#8c8b9f] transition-transform duration-200',
      open && 'rotate-90',
    )}
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export function Tree({
  children,
  className,
  label = 'room-files',
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="tree"
      aria-label={label}
      className={cn(
        'flex flex-col gap-0.5 rounded-xl border border-[#e7e6ef] bg-white p-3 text-left shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Folder({
  name,
  children,
  defaultOpen = false,
  badge,
}: {
  name: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] font-bold text-[#242257] transition-colors hover:bg-[#f6f6fb]"
      >
        <Chevron open={open} />
        <FolderIcon open={open} />
        <span className="truncate">{name}</span>
        {badge && (
          <span className="ml-auto rounded-full bg-[#e9e8ff] px-1.5 py-px font-mono text-[10px] font-bold text-[#6965DB]">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div
          role="group"
          className="ml-4 flex flex-col gap-0.5 border-l border-[#e7e6ef] py-0.5 pl-2"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function File({
  name,
  selected = false,
  onSelect,
  meta,
}: {
  name: string;
  selected?: boolean;
  onSelect?: () => void;
  meta?: string;
}) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] transition-colors',
        selected
          ? 'bg-[#e9e8ff] font-bold text-[#17174a]'
          : 'font-medium text-[#525172] hover:bg-[#f6f6fb]',
      )}
    >
      <span className="w-3 shrink-0" aria-hidden="true" />
      <FileIcon />
      <span className="truncate">{name}</span>
      {meta && (
        <span className="ml-auto font-mono text-[10px] text-[#8c8b9f]">
          {meta}
        </span>
      )}
    </button>
  );
}
