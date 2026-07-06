/**
 * Split "Company - Location" branch labels for payment log tables.
 * @param {string|null|undefined} branchName
 */
export function splitPaymentLogBranchName(branchName) {
  const name = String(branchName || '').trim();
  if (!name || name === 'N/A') return null;

  if (name.includes(' - ')) {
    const parts = name.split(' - ');
    return {
      company: parts[0].trim(),
      location: parts.slice(1).join(' - ').trim(),
    };
  }

  if (name.includes('-')) {
    const parts = name.split('-');
    return {
      company: parts[0].trim(),
      location: parts.slice(1).join('-').trim(),
    };
  }

  return { company: name, location: '' };
}
