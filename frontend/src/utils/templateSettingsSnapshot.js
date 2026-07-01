import {
  TEMPLATE_KEYS,
  buildEmptyTemplatesState,
  normalizeTemplateValue,
} from '../constants/templateDefinitions';

export const cloneTemplatesState = (state) => {
  const next = buildEmptyTemplatesState();
  for (const key of TEMPLATE_KEYS) {
    next[key] = normalizeTemplateValue(state?.[key]);
  }
  return next;
};

export const areTemplatesDirty = (current, baseline) =>
  JSON.stringify(cloneTemplatesState(current)) !== JSON.stringify(cloneTemplatesState(baseline));
