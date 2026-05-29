const TemplateVariablePalette = ({ variables = [], activeFieldLabel = 'Title', onInsert }) => {
  if (!variables.length) return null;

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        Available variables (auto-detected, read-only)
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">
        Drag onto a field or click to insert into the focused field ({activeFieldLabel}).
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {variables.map((variable) => (
          <button
            key={variable}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', variable);
              event.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onInsert?.(variable)}
            className="cursor-grab rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 select-none active:cursor-grabbing"
            title="Drag into a field or click to insert"
          >
            {variable}
          </button>
        ))}
      </div>
    </div>
  );
};

export default TemplateVariablePalette;
