/**
 * Configurable announcement creator permissions (Superadmin Settings).
 */
import { getEffectiveSettings, validateAndNormalizeSettingInput } from '../../utils/settingsService.js';

export const CREATOR_MODES = Object.freeze({
  ALL: 'all',
  ROLES: 'roles',
  SPECIFIC: 'specific',
});

export const DEFAULT_CREATOR_MODE = CREATOR_MODES.ROLES;

export const DEFAULT_CREATOR_ROLES = Object.freeze(['Admin', 'Teacher']);

export const ANNOUNCEMENT_CREATOR_ROLE_OPTIONS = Object.freeze([
  'Admin',
  'Teacher',
  'Student',
  'Finance',
  'Superfinance',
  'Guardians',
]);

const CREATOR_SETTING_KEYS = ['announcement_creator_mode', 'announcement_creator_roles'];

/** Accept pg PoolClient or the pool `query(text, params)` helper from database.js */
function asDbClient(db) {
  if (db && typeof db.query === 'function') {
    return db;
  }
  if (typeof db === 'function') {
    return {
      query: (text, params) => db(text, params),
    };
  }
  throw new Error('Invalid database client for announcement creator checks');
}

function normalizeUserId(user) {
  return Number(user?.userId ?? user?.user_id);
}

function normalizeUserType(user) {
  return String(user?.userType ?? user?.user_type ?? '').trim();
}

export function normalizeCreatorMode(raw) {
  const mode = String(raw || '').trim().toLowerCase();
  if (mode === CREATOR_MODES.ALL || mode === CREATOR_MODES.ROLES || mode === CREATOR_MODES.SPECIFIC) {
    return mode;
  }
  return DEFAULT_CREATOR_MODE;
}

export function normalizeCreatorRoles(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_CREATOR_ROLES];
  const allowed = new Set(ANNOUNCEMENT_CREATOR_ROLE_OPTIONS);
  const roles = [...new Set(raw.map((r) => String(r || '').trim()).filter((r) => allowed.has(r)))];
  return roles.length ? roles : [...DEFAULT_CREATOR_ROLES];
}

export async function loadAnnouncementCreatorSettings(db) {
  const client = asDbClient(db);
  const effective = await getEffectiveSettings(client, CREATOR_SETTING_KEYS, null);
  return {
    mode: normalizeCreatorMode(effective.announcement_creator_mode?.value),
    roles: normalizeCreatorRoles(effective.announcement_creator_roles?.value),
  };
}

export async function loadAnnouncementCreatorUserIds(db) {
  const client = asDbClient(db);
  try {
    await ensureAnnouncementCreatorsTable(client);
    const result = await client.query(
      `SELECT user_id FROM announcement_creatorstbl ORDER BY user_id ASC`
    );
    return result.rows.map((row) => Number(row.user_id));
  } catch (error) {
    if (isMissingCreatorsTable(error)) {
      return [];
    }
    throw error;
  }
}

export async function canUserCreateAnnouncement(db, user) {
  const userType = normalizeUserType(user);
  const userId = normalizeUserId(user);

  if (userType === 'Superadmin') return true;
  if (!Number.isFinite(userId) || userId <= 0) return false;

  const client = asDbClient(db);
  const { mode, roles } = await loadAnnouncementCreatorSettings(client);

  if (mode === CREATOR_MODES.ALL) return true;
  if (mode === CREATOR_MODES.ROLES) return roles.includes(userType);
  if (mode === CREATOR_MODES.SPECIFIC) {
    const ids = await loadAnnouncementCreatorUserIds(client);
    return ids.includes(userId);
  }

  return false;
}

export async function saveAnnouncementCreatorSettings(db, { mode, roles, userIds, updatedBy }) {
  const client = asDbClient(db);
  const normalizedMode = normalizeCreatorMode(mode);
  const normalizedRoles = normalizeCreatorRoles(roles);
  const requestedIds = [
    ...new Set((userIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
  ];

  const modeSetting = validateAndNormalizeSettingInput('announcement_creator_mode', normalizedMode);
  const rolesSetting = validateAndNormalizeSettingInput(
    'announcement_creator_roles',
    normalizedRoles
  );
  if (!modeSetting.ok) throw new Error(modeSetting.error);
  if (!rolesSetting.ok) throw new Error(rolesSetting.error);

  for (const setting of [modeSetting, rolesSetting]) {
    const updateRes = await client.query(
      `UPDATE system_settingstbl
       SET setting_value = $1, setting_type = $2, category = $3, description = $4,
           updated_by = $5, updated_at = CURRENT_TIMESTAMP
       WHERE setting_key = $6 AND branch_id IS NULL`,
      [
        setting.storedValue,
        setting.type,
        setting.category,
        setting.description,
        updatedBy,
        setting.key,
      ]
    );
    if (updateRes.rowCount === 0) {
      await client.query(
        `INSERT INTO system_settingstbl
           (setting_key, setting_value, setting_type, category, description, branch_id, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, CURRENT_TIMESTAMP)`,
        [
          setting.key,
          setting.storedValue,
          setting.type,
          setting.category,
          setting.description,
          updatedBy,
        ]
      );
    }
  }

  if (normalizedMode === CREATOR_MODES.SPECIFIC && requestedIds.length > 0) {
    const check = await client.query(
      `SELECT user_id, user_type FROM userstbl WHERE user_id = ANY($1::int[])`,
      [requestedIds]
    );
    const found = new Set(check.rows.map((row) => Number(row.user_id)));
    const missing = requestedIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error('One or more selected users were not found');
    }
    const superadmins = check.rows.filter((row) => row.user_type === 'Superadmin');
    if (superadmins.length > 0) {
      throw new Error('Superadmin users do not need to be added — they always have access');
    }
  }

  await ensureAnnouncementCreatorsTable(client);
  await client.query('DELETE FROM announcement_creatorstbl');
  if (normalizedMode === CREATOR_MODES.SPECIFIC) {
    for (const uid of requestedIds) {
      await client.query(
        `INSERT INTO announcement_creatorstbl (user_id, created_by)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [uid, updatedBy]
      );
    }
  }

  return {
    mode: normalizedMode,
    roles: normalizedRoles,
    user_ids: normalizedMode === CREATOR_MODES.SPECIFIC ? requestedIds : [],
  };
}

export const CREATOR_USER_LIST_SELECT = `
  SELECT u.user_id,
         u.full_name,
         u.email,
         u.user_type,
         u.branch_id,
         b.branch_name
  FROM announcement_creatorstbl ac
  INNER JOIN userstbl u ON u.user_id = ac.user_id
  LEFT JOIN branchestbl b ON b.branch_id = u.branch_id
  ORDER BY u.full_name ASC NULLS LAST, u.user_id ASC
`;

function isMissingCreatorsTable(error) {
  return error?.code === '42P01' && String(error?.message || '').includes('announcement_creatorstbl');
}

/** Idempotent — safe if migration 148 was not applied yet. */
export async function ensureAnnouncementCreatorsTable(db) {
  const client = asDbClient(db);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.announcement_creatorstbl (
      user_id INTEGER NOT NULL PRIMARY KEY
        REFERENCES public.userstbl (user_id) ON DELETE CASCADE,
      created_by INTEGER NULL
        REFERENCES public.userstbl (user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_announcement_creatorstbl_created_at
      ON public.announcement_creatorstbl (created_at DESC)
  `);
}

export async function loadAnnouncementCreatorUsers(db) {
  const client = asDbClient(db);
  try {
    await ensureAnnouncementCreatorsTable(client);
    const result = await client.query(CREATOR_USER_LIST_SELECT);
    return result.rows;
  } catch (error) {
    if (isMissingCreatorsTable(error)) {
      return [];
    }
    throw error;
  }
}
