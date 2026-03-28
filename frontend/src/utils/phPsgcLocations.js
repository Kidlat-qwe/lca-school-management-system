/**
 * Philippine cities/municipalities via PSGC (psgc.gitlab.io).
 * The `country-state-city` package has inconsistent PH data: province isoCodes (e.g. BUL)
 * do not match city records, so Bulacan and others show wrong cities. We use PSGC for PH only.
 */

const PSGC_BASE = 'https://psgc.gitlab.io/api';

let provincesCache = null;
let provincesPromise = null;

function normalizeName(s) {
  if (!s || typeof s !== 'string') return '';
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function getCachedPhProvinces() {
  if (provincesCache) return provincesCache;
  if (!provincesPromise) {
    provincesPromise = fetch(`${PSGC_BASE}/provinces/`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load Philippine provinces');
        return r.json();
      })
      .then((data) => {
        provincesCache = Array.isArray(data) ? data : [];
        return provincesCache;
      })
      .catch((err) => {
        provincesPromise = null;
        throw err;
      });
  }
  return provincesPromise;
}

/**
 * Match country-state-city / form province name to PSGC province record.
 */
export async function findPhProvinceByName(provinceName) {
  const name = normalizeName(provinceName);
  if (!name) return null;
  const provinces = await getCachedPhProvinces();
  const exact = provinces.find((p) => normalizeName(p.name) === name);
  if (exact) return exact;
  return provinces.find((p) => normalizeName(p.name).includes(name) || name.includes(normalizeName(p.name))) || null;
}

/**
 * @returns {Promise<{ name: string }[]>} sorted city/municipality names for the province
 */
export async function fetchPhCitiesForProvinceName(provinceName) {
  const prov = await findPhProvinceByName(provinceName);
  if (!prov) return [];
  const res = await fetch(`${PSGC_BASE}/provinces/${prov.code}/cities-municipalities`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  const names = data.map((c) => c.name).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).map((name) => ({ name }));
}
