import { useRef, useEffect } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Eraser, Baseline } from "lucide-react";

// A lightweight rich-text editor built on a contenteditable div.
// Pasting formatted content (e.g. an HTML quotation) keeps its colours,
// backgrounds and layout, and we read out innerHTML as the email body.
// Being a standard editable field, browser extensions like Grammarly attach
// to it automatically for spell/grammar checking.
export function RichTextEditor({
  html,
  onChange,
  placeholder,
  minHeight = 200,
  maxHeight = 300,
}: {
  html: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Sync DOM when the value is set programmatically (snippet insert / reset).
  // While typing, `html` already equals the DOM, so this is a no-op (no caret jump).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html || "";
    }
  }, [html]);

  const emit = () => onChange(ref.current?.innerHTML ?? "");
  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    // eslint-disable-next-line deprecation/deprecation
    document.execCommand(cmd, false, arg);
    emit();
  };

  const isEmpty = !html || html === "<br>" || html === "<div><br></div>";

  const Btn = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className="h-8 w-8 grid place-items-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring">
      <div className="flex items-center gap-0.5 border-b px-1 py-1 flex-wrap">
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
      </div>
      <div className="relative">
        {isEmpty && placeholder && (
          <div className="absolute left-3 top-2 text-sm text-muted-foreground pointer-events-none">{placeholder}</div>
        )}
        <div
          ref={ref}
          contentEditable
          spellCheck
          onInput={emit}
          className="prose prose-sm max-w-none px-3 py-2 text-sm focus:outline-none overflow-y-auto overflow-x-auto [&_a]:text-primary [&_a]:underline"
          style={{ minHeight, maxHeight }}
          suppressContentEditableWarning
        />
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
