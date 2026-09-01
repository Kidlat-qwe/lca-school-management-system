import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TemplateVariableField from './TemplateVariableField';
import TemplateVariablePalette from './TemplateVariablePalette';
import { mergeTemplateVariables } from '../../utils/templateVariables';
import {
  STAY_CONNECTED_TEMPLATE_KEY,
  STAY_CONNECTED_BRANCH_PALETTE,
  branchDisplayLabel,
  buildTemplateVariablePaletteItems,
  resolveBranchGroupChatPreview,
} from '../../utils/firstEnrollmentTemplateVariables';

const TemplateEditorCard = ({
  templateDef,
  templateValue,
  disabled = false,
  scopeTag = null,
  templateScope = 'global',
  selectedBranch = null,
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

  const paletteSourceVariables = useMemo(() => {
    if (
      templateDef?.key === STAY_CONNECTED_TEMPLATE_KEY &&
      templateScope === 'branch' &&
      selectedBranch
    ) {
      return STAY_CONNECTED_BRANCH_PALETTE;
    }
    return detectedVariables;
  }, [templateDef?.key, templateScope, selectedBranch, detectedVariables]);

  const variablePaletteItems = useMemo(
    () =>
      buildTemplateVariablePaletteItems({
        variables: paletteSourceVariables,
        templateKey: templateDef?.key,
        templateScope,
        branch: selectedBranch,
      }),
    [paletteSourceVariables, templateDef?.key, templateScope, selectedBranch]
  );

  const stayConnectedBranchHint = useMemo(() => {
    if (
      templateDef?.key !== STAY_CONNECTED_TEMPLATE_KEY ||
      templateScope !== 'branch' ||
      !selectedBranch
    ) {
      return null;
    }
    const label = branchDisplayLabel(selectedBranch);
    const chat = resolveBranchGroupChatPreview(selectedBranch);
    if (!label) return null;
    return {
      branchLabel: label,
      groupChatUrl: chat.url,
      groupChatLabel: chat.displayLabel,
      groupChatLine: chat.groupChatLine,
    };
  }, [templateDef?.key, templateScope, selectedBranch]);

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

        {stayConnectedBranchHint ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-3 py-2.5 text-[11px] text-blue-900">
            <p className="text-xs font-semibold text-blue-950">
              Designated group chat link — {stayConnectedBranchHint.branchLabel}
            </p>
            {stayConnectedBranchHint.groupChatUrl ? (
              <>
                <a
                  href={stayConnectedBranchHint.groupChatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 block break-all font-mono text-[10px] text-blue-700 underline hover:text-blue-900"
                >
                  {stayConnectedBranchHint.groupChatUrl}
                </a>
                <p className="mt-2 text-blue-800/90">
                  Insert <span className="font-mono font-semibold">{'{groupChatLine}'}</span> in
                  the body — it expands to:
                </p>
                <p className="mt-1 rounded-md border border-blue-100 bg-white/80 px-2 py-1.5 text-[10px] leading-snug text-gray-800">
                  {stayConnectedBranchHint.groupChatLine}
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-amber-800">
                No Messenger group chat link is configured for this branch name. Contact dev ops
                or set <span className="font-mono">FIRST_ENROLLMENT_BRANCH_GROUP_CHAT_URLS</span>{' '}
                in the server environment.
              </p>
            )}
          </div>
        ) : null}

        <TemplateVariablePalette
          variableItems={variablePaletteItems}
          activeFieldLabel={activeFieldLabel}
          onInsert={(token) => requestInsert(token)}
        />

      </div>
    </div>
  );
};

export default TemplateEditorCard;
