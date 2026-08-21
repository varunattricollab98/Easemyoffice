import { useRef, useEffect, useState } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Eraser, Baseline, Code2 } from "lucide-react";

// A lightweight rich-text editor built on a contenteditable div.
// Pasting formatted content (e.g. an HTML quotation) keeps its colours,
// backgrounds and layout, and we read out innerHTML as the email body.
// Being a standard editable field, browser extensions like Grammarly attach
// to it automatically for spell/grammar checking.
//
// The "</> HTML" toggle switches to a raw source textarea so users can paste
// table-based email templates without contenteditable mangling the structure.
export function RichTextEditor({
  html,
  onChange,
  placeholder,
  minHeight = 200,
  maxHeight,
}: {
  html: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sourceMode, setSourceMode] = useState(false);

  // Sync DOM when the value is set programmatically (snippet insert / reset).
  // While typing, `html` already equals the DOM, so this is a no-op (no caret jump).
  useEffect(() => {
    if (!sourceMode && ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html || "";
    }
  }, [html, sourceMode]);

  const emit = () => onChange(ref.current?.innerHTML ?? "");
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    // eslint-disable-next-line deprecation/deprecation
    document.execCommand(cmd, false, arg);
    emit();
  };

  const isEmpty = !html || html === "<br>" || html === "<div><br></div>";

  const Btn = ({ title, onClick, children, active }: { title: string; onClick: () => void; children: React.ReactNode; active?: boolean }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`h-8 w-8 grid place-items-center rounded hover:bg-accent text-muted-foreground hover:text-foreground ${active ? "bg-accent text-foreground ring-1 ring-ring" : ""}`}
    >
      {children}
    </button>
  );

  const toggleSource = () => {
    if (sourceMode) {
      // Switching from source → visual: sync the contenteditable with the textarea value
      // (already synced via onChange, but ensure DOM is correct)
      if (ref.current) ref.current.innerHTML = html || "";
    }
    setSourceMode((v) => !v);
  };

  return (
    <div className="rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring">
      <div className="flex items-center gap-0.5 border-b px-1 py-1 flex-wrap">
        {!sourceMode && (
          <>
            <Btn title="Bold" onClick={() => exec("bold")}><Bold className="h-4 w-4" /></Btn>
            <Btn title="Italic" onClick={() => exec("italic")}><Italic className="h-4 w-4" /></Btn>
            <Btn title="Underline" onClick={() => exec("underline")}><Underline className="h-4 w-4" /></Btn>
            <span className="w-px h-5 bg-border mx-1" />
            <Btn title="Bulleted list" onClick={() => exec("insertUnorderedList")}><List className="h-4 w-4" /></Btn>
            <Btn title="Numbered list" onClick={() => exec("insertOrderedList")}><ListOrdered className="h-4 w-4" /></Btn>
            <span className="w-px h-5 bg-border mx-1" />
            <label title="Text colour" className="h-8 w-8 grid place-items-center rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer relative">
              <Baseline className="h-4 w-4" />
              <input
                type="color"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => exec("foreColor", e.target.value)}
              />
            </label>
            <Btn title="Clear formatting" onClick={() => exec("removeFormat")}><Eraser className="h-4 w-4" /></Btn>
          </>
        )}
        {sourceMode && (
          <span className="text-xs text-muted-foreground px-2 py-1">
            Paste raw HTML source code below — tables, inline styles, and images will be preserved exactly.
          </span>
        )}
        <span className="flex-1" />
        <Btn title={sourceMode ? "Switch to visual editor" : "Edit HTML source code"} onClick={toggleSource} active={sourceMode}>
          <Code2 className="h-4 w-4" />
        </Btn>
      </div>
      <div className="relative">
        {sourceMode ? (
          <textarea
            value={html}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paste your HTML source code here..."
            spellCheck={false}
            className="w-full px-3 py-2 text-xs font-mono bg-muted/30 focus:outline-none resize-none overflow-y-auto"
            style={{ minHeight, maxHeight: maxHeight ?? undefined }}
          />
        ) : (
          <>
            {isEmpty && placeholder && (
              <div className="absolute left-3 top-2 text-sm text-muted-foreground pointer-events-none">{placeholder}</div>
            )}
            <div
              ref={ref}
              contentEditable
              spellCheck
              onInput={emit}
              className="prose prose-sm max-w-none px-3 py-2 text-sm focus:outline-none overflow-y-auto overflow-x-auto [&_a]:text-primary [&_a]:underline"
              style={{ minHeight, maxHeight: maxHeight ?? undefined }}
              suppressContentEditableWarning
            />
          </>
        )}
      </div>
    </div>
  );
}

// Strip tags to a short plain-text preview (for lists).
export function htmlToText(html: string) {
  if (typeof document === "undefined") return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const el = document.createElement("div");
  el.innerHTML = html || "";
  return (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim();
}
