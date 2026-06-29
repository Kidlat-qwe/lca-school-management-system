# Guardian Components

Reusable guardian form UI for student and personnel flows.

## GuardianLocationFields

Cascading location inputs for guardian address:

| Row | Fields |
|-----|--------|
| 1 | Country, State/Province/Region |
| 2 | City, Postal code |
| 3 | Address (full width) |

Uses the `country-state-city` package for international locations and `ph-addresses-locations` (PSGC) for Philippines province/city data. Cities load when a province is selected.
