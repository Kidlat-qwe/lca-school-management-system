import {
  TEMPLATE_DEFS,
  TEMPLATE_DEFS_WITHOUT_GROUP,
  TEMPLATE_GROUP_LABELS,
  getTemplateDefsForGroup,
} from '../../constants/templateDefinitions';

/**
 * Grouped template dropdown for Settings → Templates (matches email template editor UX).
 */
export default function TemplatePickerSelect({
  id = 'template-select',
  value,
  onChange,
  className = 'mt-1 w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30',
  disabled = false,
}) {
  return (
    <select
      id={id}
      className={className}
      value={value}
      onChange={onChange}
      disabled={disabled}
    >
      {TEMPLATE_DEFS_WITHOUT_GROUP.map((def) => (
        <option key={def.key} value={def.key}>
          {def.label}
        </option>
      ))}
      {TEMPLATE_GROUP_LABELS.map((groupLabel) => (
        <optgroup key={groupLabel} label={groupLabel}>
          {getTemplateDefsForGroup(groupLabel).map((def) => (
            <option key={def.key} value={def.key}>
              {def.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
