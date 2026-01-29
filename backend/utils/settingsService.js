/**
 * System Settings Service
 *
 * Provides typed, validated access to system settings stored in `system_settingstbl`,
 * supporting per-branch overrides with global defaults (branch_id NULL).
 */

export const SETTINGS_DEFINITIONS = Object.freeze({
  installment_penalty_rate: {
    key: 'installment_penalty_rate',
    type: 'number',
    category: 'billing',
    description: 'Installment late payment penalty rate (decimal; 0.10 = 10%).',
    defaultValue: 0.1,
    min: 0,
    max: 1,
  },
  installment_penalty_grace_days: {
    key: 'installment_penalty_grace_days',
    type: 'int',
    category: 'billing',
    description:
      'Number of grace days after due_date before applying installment late penalty.',
    defaultValue: 0,
    min: 0,
    max: 365,
  },
  installment_final_dropoff_days: {
    key: 'installment_final_dropoff_days',
    type: 'int',
    category: 'billing',
    description:
      'Number of days after due_date before auto-removing student for installment delinquency.',
    defaultValue: 30,
    min: 0,
    max: 365,
  },
});

export const SETTINGS_KEYS = Object.freeze(Object.keys(SETTINGS_DEFINITIONS));

export function getSettingDefinition(settingKey) {
  return SETTINGS_DEFINITIONS[settingKey] || null;
}

function parseByType(rawValue, type, fallbackValue) {
  if (rawValue === null || rawValue === undefined) return fallbackValue;

  if (type === 'int') {
    const n = Number.parseInt(String(rawValue), 10);
    return Number.isFinite(n) ? n : fallbackValue;
  }

  if (type === 'number') {
    const n = Number.parseFloat(String(rawValue));
    return Number.isFinite(n) ? n : fallbackValue;
  }

  if (type === 'boolean') {
    const v = String(rawValue).toLowerCase().trim();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return fallbackValue;
  }

  if (type === 'json') {
    try {
      return JSON.parse(String(rawValue));
    } catch {
      return fallbackValue;
    }
  }

  return String(rawValue);
}

export function validateAndNormalizeSettingInput(settingKey, inputValue) {
  const def = getSettingDefinition(settingKey);
  if (!def) {
    return { ok: false, error: `Unknown setting key: ${settingKey}` };
  }

  const parsed = parseByType(inputValue, def.type, def.defaultValue);

  // For numeric types, ensure finite
  if ((def.type === 'int' || def.type === 'number') && !Number.isFinite(parsed)) {
    return { ok: false, error: `${settingKey} must be a valid ${def.type}` };
  }

  // For int, enforce integer
  if (def.type === 'int' && !Number.isInteger(parsed)) {
    return { ok: false, error: `${settingKey} must be an integer` };
  }

  // Range checks (applies to number/int)
  if ((def.type === 'int' || def.type === 'number') && def.min !== undefined) {
    if (parsed < def.min) {
      return { ok: false, error: `${settingKey} must be >= ${def.min}` };
    }
  }
  if ((def.type === 'int' || def.type === 'number') && def.max !== undefined) {
    if (parsed > def.max) {
      return { ok: false, error: `${settingKey} must be <= ${def.max}` };
    }
  }

  // Normalize to string for storage
  const storedValue =
    def.type === 'json' ? JSON.stringify(parsed) : def.type === 'boolean' ? (parsed ? 'true' : 'false') : String(parsed);

  return {
    ok: true,
    key: settingKey,
    value: parsed,
    storedValue,
    type: def.type,
    category: def.category || null,
    description: def.description || null,
  };
}

/**
 * Fetch effective settings for a branch:
 * - branch override (branch_id = X)
 * - else global default (branch_id IS NULL)
 * - else code default (SETTINGS_DEFINITIONS.defaultValue)
 *
 * @param {import('pg').PoolClient} client
 * @param {string[]} keys
 * @param {number|null|undefined} branchId
 */
export async function getEffectiveSettings(client, keys, branchId) {
  const safeKeys = (keys || []).filter((k) => typeof k === 'string' && k.length > 0);
  const result = {};

  if (safeKeys.length === 0) return result;

  const globalRowsRes = await client.query(
    `SELECT setting_key, setting_value, setting_type, category, description, branch_id
     FROM system_settingstbl
     WHERE branch_id IS NULL AND setting_key = ANY($1::text[])`,
    [safeKeys]
  );
  const globalByKey = new Map();
  for (const row of globalRowsRes.rows) {
    globalByKey.set(row.setting_key, row);
  }

  let branchByKey = new Map();
  if (branchId !== null && branchId !== undefined) {
    const branchRowsRes = await client.query(
      `SELECT setting_key, setting_value, setting_type, category, description, branch_id
       FROM system_settingstbl
       WHERE branch_id = $1 AND setting_key = ANY($2::text[])`,
      [branchId, safeKeys]
    );
    branchByKey = new Map(branchRowsRes.rows.map((r) => [r.setting_key, r]));
  }

  for (const key of safeKeys) {
    const def = getSettingDefinition(key);
    const fallbackType = def?.type || 'string';
    const fallbackValue = def?.defaultValue ?? null;

    const branchRow = branchByKey.get(key) || null;
    const globalRow = globalByKey.get(key) || null;

    const chosenRow = branchRow || globalRow;
    const scope = branchRow ? 'branch' : globalRow ? 'global' : 'default';
    const rawValue = chosenRow?.setting_value ?? null;
    const type = chosenRow?.setting_type || fallbackType;

    result[key] = {
      key,
      value: parseByType(rawValue, type, fallbackValue),
      scope,
      type,
      category: chosenRow?.category ?? def?.category ?? null,
      description: chosenRow?.description ?? def?.description ?? null,
    };
  }

  return result;
}

