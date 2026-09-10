import {
  BRANCH_INVENTORY_CATEGORY_TABS,
} from '../../utils/merchandisePackageInclusion';

/**
 * Merchandise | Supplies sub-tabs on the branch inventory card grid.
 * Supplies = types with is_package_included = false (Not in package).
 */
export default function BranchInventoryCategoryTabs({ value, onChange }) {
  const tabs = [
    { id: BRANCH_INVENTORY_CATEGORY_TABS.MERCHANDISE, label: 'Merchandise' },
    { id: BRANCH_INVENTORY_CATEGORY_TABS.SUPPLIES, label: 'Supplies' },
  ];

  return (
    <div className="border-b border-gray-200">
      <nav className="-mb-px flex flex-wrap gap-x-8 gap-y-1" aria-label="Inventory category">
        {tabs.map((tab) => {
          const isActive = value === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange?.(tab.id)}
              className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                isActive
                  ? 'border-[#F7C844] text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
