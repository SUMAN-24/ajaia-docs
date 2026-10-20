import { useEditorState } from "@tiptap/react";

function Btn({ label, active, disabled, onClick, children, shortcut }) {
  return (
    <button
      type="button"
      className={`tb-btn ${active ? "active" : ""}`}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // mousedown keeps the editor selection from being lost before the command runs
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function Toolbar({ editor, disabled, onImport }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      block: e.isActive("heading", { level: 1 })
        ? "1"
        : e.isActive("heading", { level: 2 })
          ? "2"
          : e.isActive("heading", { level: 3 })
            ? "3"
            : "p",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const run = () => editor.chain().focus();

  function setBlock(value) {
    if (value === "p") run().setParagraph().run();
    else run().setHeading({ level: Number(value) }).run();
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn label="Undo" shortcut="Ctrl+Z" disabled={disabled || !s.canUndo} onClick={() => run().undo().run()}>
        ↶
      </Btn>
      <Btn label="Redo" shortcut="Ctrl+Y" disabled={disabled || !s.canRedo} onClick={() => run().redo().run()}>
        ↷
      </Btn>
      <span className="tb-sep" />

      <select
        className="tb-select"
        aria-label="Text style"
        value={s.block}
        disabled={disabled}
        onChange={(e) => setBlock(e.target.value)}
      >
        <option value="p">Normal text</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
      </select>
      <span className="tb-sep" />

      <Btn label="Bold" shortcut="Ctrl+B" active={s.bold} disabled={disabled} onClick={() => run().toggleBold().run()}>
        <b>B</b>
      </Btn>
      <Btn label="Italic" shortcut="Ctrl+I" active={s.italic} disabled={disabled} onClick={() => run().toggleItalic().run()}>
        <i>I</i>
      </Btn>
      <Btn
        label="Underline"
        shortcut="Ctrl+U"
        active={s.underline}
        disabled={disabled}
        onClick={() => run().toggleUnderline().run()}
      >
        <u>U</u>
      </Btn>
      <span className="tb-sep" />

      <Btn label="Bulleted list" active={s.bullet} disabled={disabled} onClick={() => run().toggleBulletList().run()}>
        • ≡
      </Btn>
      <Btn label="Numbered list" active={s.ordered} disabled={disabled} onClick={() => run().toggleOrderedList().run()}>
        1. ≡
      </Btn>
      <Btn label="Quote" active={s.quote} disabled={disabled} onClick={() => run().toggleBlockquote().run()}>
        ❝
      </Btn>
      <span className="tb-sep" />

      <button
        type="button"
        className="tb-btn wide"
        disabled={disabled}
        onClick={onImport}
        title="Insert the contents of a .txt, .md or .docx file at the cursor"
      >
        ⬆ Import file
      </button>
    </div>
  );
}
