export const ANNOUNCEMENT_ALL_RECIPIENT_VALUE = 'All';

/** Individual recipient values from a page config (excludes All). */
export function getAnnouncementIndividualRecipientValues(recipientGroupOptions = []) {
  return recipientGroupOptions
    .filter((group) => group.value !== ANNOUNCEMENT_ALL_RECIPIENT_VALUE)
    .map((group) => group.value);
}

/**
 * Expand stored `All` into every checkbox value for edit/create form display.
 */
export function expandAnnouncementRecipientGroupsForForm(
  recipientGroups = [],
  recipientGroupOptions = []
) {
  const individualValues = getAnnouncementIndividualRecipientValues(recipientGroupOptions);
  if (!recipientGroups.includes(ANNOUNCEMENT_ALL_RECIPIENT_VALUE)) {
    return [...recipientGroups];
  }
  return [ANNOUNCEMENT_ALL_RECIPIENT_VALUE, ...individualValues];
}

/**
 * Toggle recipient group checkboxes with All-select-all / All-clear-all behavior.
 */
export function toggleAnnouncementRecipientGroups(
  currentGroups = [],
  toggledGroup,
  recipientGroupOptions = []
) {
  const individualValues = getAnnouncementIndividualRecipientValues(recipientGroupOptions);
  const current = currentGroups || [];
  const isChecked = current.includes(toggledGroup);

  if (toggledGroup === ANNOUNCEMENT_ALL_RECIPIENT_VALUE) {
    return isChecked ? [] : [ANNOUNCEMENT_ALL_RECIPIENT_VALUE, ...individualValues];
  }

  if (isChecked) {
    return current.filter(
      (group) => group !== toggledGroup && group !== ANNOUNCEMENT_ALL_RECIPIENT_VALUE
    );
  }

  const next = [
    ...current.filter((group) => group !== ANNOUNCEMENT_ALL_RECIPIENT_VALUE),
    toggledGroup,
  ];

  if (individualValues.every((value) => next.includes(value))) {
    return [ANNOUNCEMENT_ALL_RECIPIENT_VALUE, ...individualValues];
  }

  return next;
}

/**
 * Persist `All` when every individual group is selected; otherwise drop All.
 */
export function normalizeAnnouncementRecipientGroupsForSubmit(
  recipientGroups = [],
  recipientGroupOptions = []
) {
  const individualValues = getAnnouncementIndividualRecipientValues(recipientGroupOptions);
  const groups = recipientGroups || [];

  if (
    groups.includes(ANNOUNCEMENT_ALL_RECIPIENT_VALUE) ||
    individualValues.every((value) => groups.includes(value))
  ) {
    return [ANNOUNCEMENT_ALL_RECIPIENT_VALUE];
  }

  return groups.filter((group) => group !== ANNOUNCEMENT_ALL_RECIPIENT_VALUE);
}
