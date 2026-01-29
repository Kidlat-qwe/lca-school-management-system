import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Sidebar = ({ isOpen, onClose }) => {
  const location = useLocation();
  const { userInfo } = useAuth();
  
  // Get user type (handle both user_type and userType for compatibility)
  const userType = userInfo?.user_type || userInfo?.userType;
  
  // Base path based on user role
  const getBasePath = () => {
    switch (userType) {
      case 'Superadmin':
        return '/superadmin';
      case 'Admin':
        return '/admin';
      case 'Teacher':
        return '/teacher';
      case 'Student':
        return '/student';
      case 'Finance':
        // Check if Finance user has no branch (superfinance)
        const branchId = userInfo?.branchId || userInfo?.branch_id;
        if (branchId === null || branchId === undefined) {
          return '/superfinance';
        }
        return '/finance';
      default:
        return '/admin';
    }
  };
  
  const basePath = getBasePath();

  // Define all possible menu items
  // Track only the currently expanded menu (accordion behavior - only one open at a time)
  const [expandedMenu, setExpandedMenu] = useState(null);

  const allMenuItems = [
    {
      name: 'Dashboard',
      path: basePath,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
      roles: ['Superadmin', 'Admin', 'Teacher', 'Student', 'Finance'], // Available for all user types (both Finance and Superfinance)
    },
    {
      name: 'Calendar',
      path: '/superadmin/calendar-schedule', // Will be overridden in map function for Admin, Teacher, and Student
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10m-12 8h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      roles: ['Superadmin', 'Admin', 'Teacher', 'Student'],
    },
    {
      name: 'Announcements',
      path: '/superadmin/announcements', // Will be overridden in map function for Admin, Teacher, and Student
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      ),
      roles: ['Superadmin', 'Admin', 'Teacher', 'Student'],
    },
    {
      name: 'Branch',
      path: '/superadmin/branch',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      roles: ['Superadmin'], // Only for Superadmin
    },
    {
      name: 'Manage Users',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
      roles: ['Superadmin', 'Admin'], // For Superadmin and Admin
      children: [
        {
          name: 'Personnel',
          path: '/superadmin/personnel', // Will be overridden in map function for Admin
        },
        {
          name: 'Student',
          path: '/superadmin/student', // Will be overridden in map function for Admin
        },
        {
          name: 'Student Guardians',
          path: '/superadmin/guardians', // Will be overridden in map function for Admin
        },
      ],
    },
    {
      name: 'Curriculum',
      path: '/superadmin/curriculum', // Will be overridden in map function for Admin and Teacher
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
      roles: ['Superadmin', 'Admin', 'Teacher'], // For Superadmin, Admin, and Teacher
    },
    {
      name: 'Program',
      path: '/superadmin/program', // Will be overridden in map function for Admin and Teacher
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
      roles: ['Superadmin', 'Admin', 'Teacher'], // For Superadmin, Admin, and Teacher
    },
    {
      name: 'Classes',
      path: '/superadmin/classes', // Will be overridden in map function for Admin, Teacher, and Student
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
      roles: ['Superadmin', 'Admin', 'Teacher', 'Student'], // For Superadmin, Admin, Teacher, and Student
    },
    {
      name: 'Student List',
      path: '/teacher/student-list',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
      roles: ['Teacher'], // Only for Teacher
    },
    {
      name: 'Packages',
      path: '/student/packages',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      roles: ['Student'], // For Student (view-only)
    },
    {
      name: 'Invoice',
      path: '/student/invoice',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      roles: ['Student'], // For Student (view-only)
    },
    {
      name: 'Payment Logs',
      path: '/student/payment-logs',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
      roles: ['Student'], // For Student (view-only)
    },
    {
      name: 'Manage Package',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      roles: ['Superadmin', 'Admin'], // For Superadmin and Admin
      children: [
        {
          name: 'Package',
          path: '/superadmin/package', // Will be overridden in map function for Admin
    },
    {
      name: 'Pricing List',
      path: '/superadmin/pricinglist', // Will be overridden in map function for Admin
    },
    {
      name: 'Merchandise',
      path: '/superadmin/merchandise', // Will be overridden in map function for Admin
    },
    {
      name: 'Promo',
      path: '/superadmin/promo', // Will be overridden in map function for Admin
        },
      ],
    },
    {
      name: 'Room',
      path: '/superadmin/room', // Will be overridden in map function for Admin
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
      roles: ['Superadmin', 'Admin'], // For Superadmin and Admin
    },
    {
      name: 'Manage Invoice',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      roles: ['Superadmin', 'Admin', 'Finance'],
      children: [
        {
          name: 'Invoice',
          path: '/superadmin/invoice', // Will be overridden in map function for Admin and Finance
    },
    {
      name: 'Installment Invoice',
      path: '/superadmin/installment-invoice', // Will be overridden in map function for Admin and Finance
    },
    {
      name: 'Payment Logs',
      path: '/superadmin/payment-logs', // Will be overridden in map function for Admin and Finance
        },
      ],
    },
    {
      name: 'Settings',
      path: '/superadmin/settings', // Will be overridden in map function for Admin
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
      roles: ['Superadmin', 'Admin'], // Only for Superadmin and Admin
    },
  ];

  // Filter menu items based on user role and set correct paths
  const menuItems = allMenuItems
    .filter(item => item.roles.includes(userType))
    .map(item => {
      // Handle dynamic paths based on user role
      let itemPath = item.path;
      if (item.name === 'Calendar') {
        if (basePath === '/superadmin') {
          itemPath = '/superadmin/calendar-schedule';
        } else if (basePath === '/admin') {
          itemPath = '/admin/calendar';
        } else if (basePath === '/teacher') {
          itemPath = '/teacher/calendar';
        } else if (basePath === '/student') {
          itemPath = '/student/calendar';
        }
      } else if (item.name === 'Classes') {
        if (basePath === '/superadmin') {
          itemPath = '/superadmin/classes';
        } else if (basePath === '/admin') {
          itemPath = '/admin/classes';
        } else if (basePath === '/teacher') {
          itemPath = '/teacher/classes';
        } else if (basePath === '/student') {
          itemPath = '/student/classes';
        }
      } else if (item.name === 'Packages' && basePath === '/student') {
        itemPath = '/student/packages';
      } else if (item.name === 'Invoice' && basePath === '/student') {
        itemPath = '/student/invoice';
      } else if (item.name === 'Payment Logs' && basePath === '/student') {
        itemPath = '/student/payment-logs';
      } else if (item.name === 'Curriculum') {
        if (basePath === '/admin') {
          itemPath = '/admin/curriculum';
        } else if (basePath === '/teacher') {
          itemPath = '/teacher/curriculum';
        }
      } else if (item.name === 'Program') {
        if (basePath === '/admin') {
          itemPath = '/admin/program';
        } else if (basePath === '/teacher') {
          itemPath = '/teacher/program';
        }
      } else if (item.name === 'Announcements') {
        if (basePath === '/superadmin') {
          itemPath = '/superadmin/announcements';
        } else if (basePath === '/admin') {
          itemPath = '/admin/announcements';
        } else if (basePath === '/teacher') {
          itemPath = '/teacher/announcements';
        } else if (basePath === '/student') {
          itemPath = '/student/announcements';
        }
      } else if (item.name === 'Room' && basePath === '/admin') {
        itemPath = '/admin/room';
      } else if (item.name === 'Settings' && basePath === '/admin') {
        itemPath = '/admin/settings';
      }
      // Handle Manage Users children paths for Admin
      let children = item.children;
      if (item.name === 'Manage Users' && basePath === '/admin') {
        children = item.children?.map(child => {
          if (child.name === 'Personnel') {
            return { ...child, path: '/admin/personnel' };
          }
          if (child.name === 'Student') {
            return { ...child, path: '/admin/student' };
          }
          if (child.name === 'Student Guardians') {
            return { ...child, path: '/admin/guardians' };
          }
          return child;
        });
      }
      // Handle Manage Package children paths for Admin
      if (item.name === 'Manage Package' && basePath === '/admin') {
        children = item.children?.map(child => {
          if (child.name === 'Package') {
            return { ...child, path: '/admin/package' };
          }
          if (child.name === 'Pricing List') {
            return { ...child, path: '/admin/pricinglist' };
          }
          if (child.name === 'Merchandise') {
            return { ...child, path: '/admin/merchandise' };
          }
          if (child.name === 'Promo') {
            return { ...child, path: '/admin/promo' };
          }
          return child;
        });
      }
      // Handle Manage Invoice children paths for Admin
      if (item.name === 'Manage Invoice' && basePath === '/admin') {
        children = item.children?.map(child => {
          if (child.name === 'Invoice') {
            return { ...child, path: '/admin/invoice' };
          }
          if (child.name === 'Installment Invoice') {
            return { ...child, path: '/admin/installment-invoice' };
          }
          if (child.name === 'Payment Logs') {
            return { ...child, path: '/admin/payment-logs' };
          }
          return child;
        });
      }
      // Handle Manage Invoice children paths for Finance
      if (item.name === 'Manage Invoice' && basePath === '/finance') {
        children = item.children?.map(child => {
          if (child.name === 'Invoice') {
            return { ...child, path: '/finance/invoice' };
          }
          if (child.name === 'Installment Invoice') {
            return { ...child, path: '/finance/installment-invoice' };
          }
          if (child.name === 'Payment Logs') {
            return { ...child, path: '/finance/payment-logs' };
          }
          return child;
        });
      }
      // Handle Manage Invoice children paths for Superfinance
      if (item.name === 'Manage Invoice' && basePath === '/superfinance') {
        children = item.children?.map(child => {
          if (child.name === 'Invoice') {
            return { ...child, path: '/superfinance/invoice' };
          }
          if (child.name === 'Installment Invoice') {
            return { ...child, path: '/superfinance/installment-invoice' };
          }
          if (child.name === 'Payment Logs') {
            return { ...child, path: '/superfinance/payment-logs' };
          }
          return child;
        });
      }
      return {
        ...item,
        path: itemPath,
        children: children || null,
      };
    });

  const isActive = (path) => {
    if (path === basePath) {
      return location.pathname === basePath;
    }
    return location.pathname.startsWith(path);
  };

  const isGroupActive = (children) => children?.some(child => isActive(child.path));

  const toggleMenu = (name) => {
    // Accordion behavior: if clicking the same menu, close it; otherwise, close others and open this one
    setExpandedMenu(prev => prev === name ? null : name);
  };

  // Auto-expand the menu group that contains the active page when location changes
  useEffect(() => {
    const activeMenuGroup = menuItems.find(item => 
      item.children && item.children.length > 0 && isGroupActive(item.children)
    );
    
    if (activeMenuGroup) {
      // Only set if it's different from current to avoid unnecessary re-renders
      setExpandedMenu(prev => prev !== activeMenuGroup.name ? activeMenuGroup.name : prev);
    } else {
      // If no active group, close any expanded menu (optional - keeps last opened menu if you prefer)
      // setExpandedMenu(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <aside
      className={`
        w-64 bg-[#fff8e2] border-r border-gray-200 fixed left-0 top-16 bottom-0 overflow-y-auto sidebar-scroll z-50
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}
    >
      <nav className="p-4 space-y-1">
        {menuItems.map((item) => {
          if (item.children && item.children.length > 0) {
            const groupActive = isGroupActive(item.children) || isActive(item.path);
            // Only check if it's the currently expanded menu (accordion behavior - only one open)
            const isExpanded = expandedMenu === item.name;
            return (
              <div key={item.name} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleMenu(item.name)}
                  className={`
                    flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm transition-colors
                    ${
                      groupActive
                        ? 'bg-[#F7C844] text-gray-900 font-medium'
                        : 'text-gray-700 hover:bg-primary-50'
                    }
                  `}
                >
                  <span className="flex items-center space-x-3">
                    {item.icon}
                    <span>{item.name}</span>
                  </span>
                  {isExpanded ? (
                    <svg
                      className="h-5 w-5 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg
                      className="h-5 w-5 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
                <div className={`${isExpanded ? 'space-y-1 pl-8' : 'hidden'}`}>
                  {item.children.map((child) => (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      onClick={onClose}
                      className={`
                        flex items-center space-x-2 rounded-lg px-3 py-2 text-sm transition-colors
                        ${
                          isActive(child.path)
                            ? 'bg-[#F7C844] text-gray-900 font-medium'
                            : 'text-gray-600 hover:bg-primary-50'
                        }
                      `}
                    >
                      <svg
                        className="h-4 w-4 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>{child.name}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          }

          const active = isActive(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={`
                flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors
                ${
                  active
                    ? 'bg-[#F7C844] text-gray-900 font-medium'
                    : 'text-gray-700 hover:bg-primary-50'
                }
              `}
            >
              {item.icon}
              <span className="text-sm">{item.name}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
};

export default Sidebar;

