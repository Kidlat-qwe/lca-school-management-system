import { Country, State } from 'country-state-city';
import phProvinces from 'ph-addresses-locations/data/provinces.json';
import phCities from 'ph-addresses-locations/data/cities.json';

export const PHILIPPINES_COUNTRY_CODE = 'PH';
export const PHILIPPINES_COUNTRY_NAME = 'Philippines';

export const getAllCountriesSorted = () =>
  Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name));

export const isPhilippinesCountry = (countryCodeOrName) => {
  if (!countryCodeOrName) return false;
  const value = String(countryCodeOrName).trim().toLowerCase();
  return value === PHILIPPINES_COUNTRY_CODE.toLowerCase() || value === 'philippines';
};

export const findCountryCodeByName = (name) => {
  if (!name?.trim()) return '';
  const normalized = name.trim().toLowerCase();
  const match = getAllCountriesSorted().find(
    (c) => c.name.toLowerCase() === normalized || c.isoCode.toLowerCase() === normalized
  );
  return match?.isoCode || '';
};

const normalizeName = (name) => String(name || '').trim().toLowerCase();

export const getPhilippineProvinces = () =>
  phProvinces
    .map((province) => ({
      isoCode: province.code,
      name: province.name.trim(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

export const findPhilippineProvinceCodeByName = (name) => {
  if (!name?.trim()) return '';
  const normalized = normalizeName(name);
  const match = getPhilippineProvinces().find(
    (province) => normalizeName(province.name) === normalized
  );
  return match?.isoCode || '';
};

export const getPhilippineCitiesByProvinceCode = (provinceCode) => {
  if (!provinceCode) return [];
  return phCities
    .filter((city) => city.provinceCode === provinceCode)
    .map((city) => ({ name: city.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const findStateCodeByName = (countryCode, name) => {
  if (!countryCode || !name?.trim()) return '';
  if (isPhilippinesCountry(countryCode)) {
    return findPhilippineProvinceCodeByName(name);
  }
  const normalized = normalizeName(name);
  const states = State.getStatesOfCountry(countryCode);
  const match = states.find(
    (state) =>
      normalizeName(state.name) === normalized ||
      normalizeName(state.isoCode) === normalized
  );
  return match?.isoCode || '';
};

export const getProvincesForCountry = (countryCode) => {
  if (!countryCode) return [];
  if (isPhilippinesCountry(countryCode)) {
    return getPhilippineProvinces();
  }
  return State.getStatesOfCountry(countryCode)
    .map((state) => ({ isoCode: state.isoCode, name: state.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const getProvinceName = (countryCode, provinceCode) => {
  if (!countryCode || !provinceCode) return '';
  if (isPhilippinesCountry(countryCode)) {
    const province = getPhilippineProvinces().find((item) => item.isoCode === provinceCode);
    return province?.name || '';
  }
  return State.getStateByCodeAndCountry(provinceCode, countryCode)?.name || '';
};

export const getCountryName = (countryCode) => {
  if (!countryCode) return '';
  return Country.getCountryByCode(countryCode)?.name || '';
};

let cityModulePromise = null;

const loadCityModule = () => {
  if (!cityModulePromise) {
    cityModulePromise = import('country-state-city').then((module) => module.City);
  }
  return cityModulePromise;
};

export const loadCitiesForProvince = async (countryCode, provinceCode) => {
  if (!countryCode || !provinceCode) return [];

  if (isPhilippinesCountry(countryCode)) {
    return getPhilippineCitiesByProvinceCode(provinceCode);
  }

  const City = await loadCityModule();
  return City.getCitiesOfState(countryCode, provinceCode)
    .map((city) => ({ name: city.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

// Synchronous helper for validation paths
export const getCitiesForProvinceSync = (countryCode, provinceCode) => {
  if (!countryCode || !provinceCode) return [];
  if (isPhilippinesCountry(countryCode)) {
    return getPhilippineCitiesByProvinceCode(provinceCode);
  }
  return [];
};
