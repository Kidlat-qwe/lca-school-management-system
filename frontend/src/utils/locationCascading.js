import { Country, State, City } from 'country-state-city';

/** Sorted once for stable dropdown order */
const SORTED_COUNTRIES = [...Country.getAllCountries()].sort((a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
);

export function getSortedCountries() {
  return SORTED_COUNTRIES;
}

/**
 * Resolve ISO-3166 alpha-2 from stored country display name (edit / legacy rows).
 */
export function findCountryCodeByName(name) {
  if (!name || !String(name).trim()) return '';
  const t = String(name).trim();
  const countries = Country.getAllCountries();
  const exact = countries.find((c) => c.name === t);
  if (exact) return exact.isoCode;
  const ci = countries.find((c) => c.name.toLowerCase() === t.toLowerCase());
  return ci?.isoCode || '';
}

/**
 * Resolve state/province ISO code within a country from stored name.
 */
export function findStateCodeByName(countryCode, stateName) {
  if (!countryCode || !stateName || !String(stateName).trim()) return '';
  const t = String(stateName).trim();
  const states = State.getStatesOfCountry(countryCode);
  const exact = states.find((s) => s.name === t);
  if (exact) return exact.isoCode;
  const ci = states.find((s) => s.name.toLowerCase() === t.toLowerCase());
  return ci?.isoCode || '';
}

export function getStatesSorted(countryCode) {
  if (!countryCode) return [];
  return State.getStatesOfCountry(countryCode).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

export function getCitiesSorted(countryCode, stateCode) {
  if (!countryCode || !stateCode) return [];
  return City.getCitiesOfState(countryCode, stateCode).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}
