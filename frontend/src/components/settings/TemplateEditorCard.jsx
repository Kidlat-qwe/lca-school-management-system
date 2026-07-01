import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TemplateVariableField from './TemplateVariableField';
import TemplateVariablePalette from './TemplateVariablePalette';
import { mergeTemplateVariables } from '../../utils/templateVariables';

const TemplateEditorCard = ({
  templateDef,
  templateValue,
  disabled = false,
  scopeTag = null,
  onFieldChange,
}) => {
  const fieldRefs = useRef({});
  const [activeFieldId, setActiveFieldId] = useState('title');
  const [insertRequest, setInsertRequest] = useState(null);

  useEffect(() => {
    setActiveFieldId('title');
  }, [templateDef?.key]);

  const registerField = useCallback((fieldId, ref) => {
    fieldRefs.current[fieldId] = ref;
  }, []);

  const unregisterField = useCallback((fieldId) => {
    delete fieldRefs.current[fieldId];
  }, []);

  const detectedVariables = useMemo(
    () =>
      mergeTemplateVariables(
        templateDef?.variables || [],
        templateValue?.title,
        templateValue?.subject,
        templateValue?.body,
        templateValue?.sms_body
      ),
    [
      templateDef?.variables,
      templateValue?.title,
      templateValue?.subject,
      templateValue?.body,
      templateValue?.sms_body,
    ]
  );

  const resolveFieldId = (fieldId) => {
    if (fieldId === 'subject' && !templateDef.showSubject) return 'title';
    if (fieldId === 'title' || fieldId === 'body' || fieldId === 'subject' || fieldId === 'sms_body') {
      return fieldId;
    }
    return 'title';
  };

  const requestInsert = (token, preferredFieldId = activeFieldId) => {
    const targetFieldId = resolveFieldId(preferredFieldId);
    const targetRef = fieldRefs.current[targetFieldId]?.current;
    if (targetRef && typeof targetRef.focus === 'function') {
      targetRef.focus();
    }
    setInsertRequest({ fieldId: targetFieldId, token, nonce: Date.now() });
  };

  const activeFieldLabel =
    activeFieldId === 'subject'
      ? 'Subject'
      : activeFieldId === 'body'
        ? 'Body'
        : activeFieldId === 'sms_body'
          ? 'SMS body'
          : 'Title';

  const handleFocusField = (fieldId) => {
    setActiveFieldId(fieldId);
  };

  if (!templateDef) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{templateDef.label}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{templateDef.description}</p>
        </div>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-[#F7C844] focus:ring-[#F7C844]/40"
            checked={!!templateValue?.enabled}
            onChange={(event) => onFieldChange('enabled', event.target.checked)}
            disabled={disabled}
          />
          Enabled
        </label>
      </div>

      {scopeTag ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
          Source: {scopeTag}
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        <TemplateVariableField
          id="title"
          label="Title"
          value={templateValue?.title || ''}
          onChange={(next) => onFieldChange('title', next)}
          disabled={disabled}
          onFocus={() => handleFocusField('title')}
          onRegister={registerField}
          onUnregister={unregisterField}
          insertRequest={insertRequest}
          onInsertHandled={() => setInsertRequest(null)}
        />

        {templateDef.showSubject ? (
          <TemplateVariableField
            id="subject"
            label="Subject"
            value={templateValue?.subject || ''}
            onChange={(next) => onFieldChange('subject', next)}
            disabled={disabled}
            onFocus={() => handleFocusField('subject')}
            onRegister={registerField}
            onUnregister={unregisterField}
            insertRequest={insertRequest}
            onInsertHandled={() => setInsertRequest(null)}
          />
        ) : null}

        <TemplateVariableField
          id="body"
          label="Body"
          value={templateValue?.body || ''}
          onChange={(next) => onFieldChange('body', next)}
          disabled={disabled}
          multiline
          rows={5}
          onFocus={() => handleFocusField('body')}
          onRegister={registerField}
          onUnregister={unregisterField}
          insertRequest={insertRequest}
          onInsertHandled={() => setInsertRequest(null)}
        />

        {templateDef.supportsSms ? (
          <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-amber-900">SMS notification</p>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-amber-900">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-amber-300 text-[#F7C844] focus:ring-[#F7C844]/40"
                  checked={templateValue?.sms_enabled !== false}
                  onChange={(event) => onFieldChange('sms_enabled', event.target.checked)}
                  disabled={disabled}
                />
                Send SMS when email is sent
              </label>
            </div>
            <p className="mb-2 text-xs text-amber-800/90">
              Uses guardian/student mobile numbers. Leave blank to reuse the email body (plain text).
              Keep under 160 characters when possible.
            </p>
            <TemplateVariableField
              id="sms_body"
              label="SMS message"
              value={templateValue?.sms_body || ''}
              onChange={(next) => onFieldChange('sms_body', next)}
              disabled={disabled}
              multiline
              rows={3}
              onFocus={() => handleFocusField('sms_body')}
              onRegister={registerField}
              onUnregister={unregisterField}
              insertRequest={insertRequest}
              onInsertHandled={() => setInsertRequest(null)}
            />
          </div>
        ) : null}

        <TemplateVariablePalette
          variables={detectedVariables}
          activeFieldLabel={activeFieldLabel}
          onInsert={(token) => requestInsert(token)}
        />
      </div>
    </div>
  );
};

export default TemplateEditorCard;
