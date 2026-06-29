import { useEffect, useMemo, useState } from 'react';
import {
  findCountryCodeByName,
  findStateCodeByName,
  getAllCountriesSorted,
  getCountryName,
  getCitiesForProvinceSync,
  getProvincesForCountry,
  getProvinceName,
  loadCitiesForProvince,
} from './guardianLocationUtils';

/**
 * Guardian address layout:
 * Row 1: Country | Province
 * Row 2: City | Postal code
 * Row 3: Address (full width)
 */
const GuardianLocationFields = ({
  values,
  errors = {},
  onFieldChange,
  idPrefix = 'guardian',
}) => {
  const countries = useMemo(() => getAllCountriesSorted(), []);

  const countryCode = useMemo(
    () => findCountryCodeByName(values.country),
    [values.country]
  );

  const provinceCode = useMemo(
    () => (countryCode ? findStateCodeByName(countryCode, values.stateProvince) : ''),
    [countryCode, values.stateProvince]
  );

  const provinces = useMemo(
    () => getProvincesForCountry(countryCode),
    [countryCode]
  );

  const [cities, setCities] = useState([]);
  const [citiesLoading, setCitiesLoading] = useState(false);

  useEffect(() => {
    if (!countryCode || !provinceCode) {
      setCities([]);
      setCitiesLoading(false);
      return undefined;
    }

    const syncCities = getCitiesForProvinceSync(countryCode, provinceCode);
    if (syncCities.length > 0) {
      setCities(syncCities);
      setCitiesLoading(false);
      return undefined;
    }

    let cancelled = false;
    setCitiesLoading(true);

    loadCitiesForProvince(countryCode, provinceCode)
      .then((loadedCities) => {
        if (!cancelled) setCities(loadedCities);
      })
      .catch(() => {
        if (!cancelled) setCities([]);
      })
      .finally(() => {
        if (!cancelled) setCitiesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [countryCode, provinceCode]);

  const handleCountryChange = (e) => {
    const nextCountryCode = e.target.value;
    onFieldChange({
      country: getCountryName(nextCountryCode),
      stateProvince: '',
      city: '',
    });
  };

  const handleProvinceChange = (e) => {
    const nextProvinceCode = e.target.value;
    const nextProvinceName = getProvinceName(countryCode, nextProvinceCode);

    onFieldChange({
      stateProvince: nextProvinceName,
      city: '',
    });
  };

  const handleCityChange = (e) => {
    onFieldChange({ city: e.target.value });
  };

  const field = (suffix) => `${idPrefix}_${suffix}`;
  const err = (suffix) => errors[`${idPrefix}_${suffix}`];

  const cityPlaceholder = !provinceCode
    ? 'Select province first'
    : citiesLoading
      ? 'Loading cities...'
      : cities.length === 0
        ? 'No cities available'
        : 'Select City';

  return (
    <>
      <div>
        <label htmlFor={field('country')} className="label-field">
          Country <span className="text-red-500">*</span>
        </label>
        <select
          id={field('country')}
          name={field('country')}
          value={countryCode}
          onChange={handleCountryChange}
          className={`input-field ${err('country') ? 'border-red-500' : ''}`}
          required
        >
          <option value="">Select Country</option>
          {countries.map((country) => (
            <option key={country.isoCode} value={country.isoCode}>
              {country.name}
            </option>
          ))}
        </select>
        {err('country') && (
          <p className="mt-1 text-sm text-red-600">{err('country')}</p>
        )}
      </div>

      <div>
        <label htmlFor={field('state_province_region')} className="label-field">
          State/Province/Region <span className="text-red-500">*</span>
        </label>
        <select
          id={field('state_province_region')}
          name={field('state_province_region')}
          value={provinceCode}
          onChange={handleProvinceChange}
          className={`input-field ${err('state_province_region') ? 'border-red-500' : ''}`}
          required
          disabled={!countryCode}
        >
          <option value="">
            {countryCode ? 'Select Province' : 'Select country first'}
          </option>
          {provinces.map((province) => (
            <option key={province.isoCode} value={province.isoCode}>
              {province.name}
            </option>
          ))}
        </select>
        {err('state_province_region') && (
          <p className="mt-1 text-sm text-red-600">{err('state_province_region')}</p>
        )}
      </div>

      <div>
        <label htmlFor={field('city')} className="label-field">
          City <span className="text-red-500">*</span>
        </label>
        <select
          id={field('city')}
          name={field('city')}
          value={values.city}
          onChange={handleCityChange}
          className={`input-field ${err('city') ? 'border-red-500' : ''}`}
          required
          disabled={!provinceCode || citiesLoading}
        >
          <option value="">{cityPlaceholder}</option>
          {cities.map((city) => (
            <option key={city.name} value={city.name}>
              {city.name}
            </option>
          ))}
        </select>
        {err('city') && (
          <p className="mt-1 text-sm text-red-600">{err('city')}</p>
        )}
      </div>

      <div>
        <label htmlFor={field('postal_code')} className="label-field">
          Postal Code <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          id={field('postal_code')}
          name={field('postal_code')}
          value={values.postalCode}
          onChange={(e) => onFieldChange({ postalCode: e.target.value })}
          className={`input-field ${err('postal_code') ? 'border-red-500' : ''}`}
          required
          placeholder="Postal code"
        />
        {err('postal_code') && (
          <p className="mt-1 text-sm text-red-600">{err('postal_code')}</p>
        )}
      </div>

      <div className="md:col-span-2">
        <label htmlFor={field('address')} className="label-field">
          Address <span className="text-red-500">*</span>
        </label>
        <textarea
          id={field('address')}
          name={field('address')}
          value={values.address}
          onChange={(e) => onFieldChange({ address: e.target.value })}
          className={`input-field ${err('address') ? 'border-red-500' : ''}`}
          required
          rows="2"
          placeholder="Street address"
        />
        {err('address') && (
          <p className="mt-1 text-sm text-red-600">{err('address')}</p>
        )}
      </div>
    </>
  );
};

export default GuardianLocationFields;
