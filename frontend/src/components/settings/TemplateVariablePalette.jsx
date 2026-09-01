const TemplateVariablePalette = ({
  variables = [],
  variableItems = null,
  activeFieldLabel = 'Title',
  onInsert,
}) => {
  const items =
    variableItems?.length > 0
      ? variableItems
      : variables.map((token) => ({ token, label: null, hint: null }));

  if (!items.length) return null;

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        Available variables (auto-detected, read-only)
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">
        Drag onto a field or click to insert into the focused field ({activeFieldLabel}).
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={item.token}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', item.token);
              event.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onInsert?.(item.token)}
            className="cursor-grab rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-left text-[11px] font-medium text-amber-900 select-none active:cursor-grabbing"
            title={item.hint || item.label || 'Drag into a field or click to insert'}
          >
            <span className="font-mono">{item.token}</span>
            {item.label ? (
              <span className="mt-0.5 block text-[10px] font-semibold normal-case tracking-normal text-amber-800">
                {item.label}
              </span>
            ) : null}
            {item.subtitle ? (
              <span className="mt-0.5 block max-w-[280px] truncate text-[10px] font-normal normal-case tracking-normal text-amber-700/90">
                {item.subtitle}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
};

export default TemplateVariablePalette;
