import { Keyboard, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cn } from "../utils/cn";

interface ShortcutRecorderProps {
  value: string;
  onChange: (value: string) => void;
  /** Optional reset value. If provided, a small button is shown to restore it. */
  defaultValue?: string;
  disabled?: boolean;
}

/**
 * "Press to record" shortcut input. While focused, the next non-modifier key
 * the user presses is captured together with the active modifiers and emitted
 * as a `+`-separated string (e.g. "Alt+Space", "Ctrl+Shift+K").
 *
 * Esc cancels the recording without changes. Enter / Space without modifiers
 * are still accepted as a normal key.
 */
export function ShortcutRecorder({
  value,
  onChange,
  defaultValue,
  disabled,
}: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recording) return;
    // Autofocus the container so the key listener works immediately.
    containerRef.current?.focus();
  }, [recording]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      setRecording(false);
      return;
    }

    // Ignore lone modifier presses.
    if (
      e.key === "Control" ||
      e.key === "Alt" ||
      e.key === "Shift" ||
      e.key === "Meta"
    ) {
      return;
    }

    // Accept printable single chars and named keys; bail on combos with more
    // than one non-modifier key (browsers don't normally emit those anyway).
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");

    const main = formatKey(e);
    if (!main) return;
    parts.push(main);

    onChange(parts.join("+"));
    setRecording(false);
  };

  return (
    <div className="flex items-center gap-2">
      <div
        ref={containerRef}
        tabIndex={0}
        role="button"
        aria-pressed={recording}
        onKeyDown={handleKeyDown}
        onBlur={() => setRecording(false)}
        onClick={() => !disabled && setRecording(true)}
        className={cn(
          "flex h-9 flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[12px] transition outline-none",
          recording
            ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/30"
            : "border-white/10 bg-white/[0.03] text-zinc-200 hover:border-white/20",
          disabled && "pointer-events-none opacity-50",
        )}
        title={recording ? "Press any key combination. Esc to cancel." : "Click to record a new shortcut"}
      >
        <Keyboard className="h-3.5 w-3.5 text-cyan-400" />
        <span className="font-mono">
          {recording ? "Press a key combination…" : value || "Not set"}
        </span>
      </div>
      {defaultValue !== undefined && defaultValue !== value && (
        <button
          type="button"
          onClick={() => onChange(defaultValue)}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-zinc-300 transition hover:bg-white/[0.08]"
          title={`Reset to ${defaultValue}`}
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      )}
    </div>
  );
}

function formatKey(e: ReactKeyboardEvent<HTMLDivElement>): string | null {
  const key = e.key;
  // Functional / navigation keys expose a stable name.
  if (key.startsWith("Arrow")) return key; // ArrowUp, ArrowDown, …
  if (key === " " || e.code === "Space") return "Space";
  if (key === "Enter" || e.code === "Enter") return "Enter";
  if (key === "Tab" || e.code === "Tab") return "Tab";
  if (key === "Backspace" || e.code === "Backspace") return "Backspace";
  if (key === "Delete" || e.code === "Delete") return "Delete";
  if (key === "Home" || e.code === "Home") return "Home";
  if (key === "End" || e.code === "End") return "End";
  if (key === "PageUp" || e.code === "PageUp") return "PageUp";
  if (key === "PageDown" || e.code === "PageDown") return "PageDown";
  if (key === "Escape" || e.code === "Escape") return "Escape";
  if (/^F\d{1,2}$/.test(key)) return key; // F1..F12

  // For alphanumeric and digit keys prefer e.code which is layout independent.
  if (e.code.startsWith("Key") && e.code.length === 4) return e.code; // "KeyA"
  if (e.code.startsWith("Digit") && e.code.length === 6) return e.code; // "Digit1"

  // Punctuation
  const codeMap: Record<string, string> = {
    Minus: "Minus",
    Equal: "Equal",
    Comma: "Comma",
    Period: "Period",
    Slash: "Slash",
    Semicolon: "Semicolon",
    Quote: "Quote",
    Backquote: "Backquote",
    Backslash: "Backslash",
    BracketLeft: "BracketLeft",
    BracketRight: "BracketRight",
  };
  if (e.code in codeMap) return codeMap[e.code];

  // Fallback: single printable character.
  if (key.length === 1) return key.toUpperCase();
  return null;
}
