/**
 * Production-style outline icons for dashboard stat cards (Heroicons-compatible paths).
 * Use with colored circular/square backgrounds; pass text-* classes for icon color.
 */

const stroke = { strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

function Svg({ children, className, viewBox = '0 0 24 24' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox={viewBox} aria-hidden>
      {children}
    </svg>
  );
}

export function DashboardStatIcon({ name, className = 'h-6 w-6' }) {
  switch (name) {
    case 'building':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </Svg>
      );
    case 'users':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </Svg>
      );
    case 'academicCap':
      return (
        <Svg className={className}>
          <path d="M12 14l9-5-9-5-9 5 9 5z" {...stroke} />
          <path
            {...stroke}
            d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"
          />
          <path {...stroke} d="M12 14v7" />
        </Svg>
      );
    case 'bookOpen':
      return (
        <Svg className={className}>
          <path {...stroke} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </Svg>
      );
    case 'creditCard':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          />
        </Svg>
      );
    case 'currency':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </Svg>
      );
    case 'checkCircle':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </Svg>
      );
    case 'shieldCheck':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </Svg>
      );
    case 'clock':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </Svg>
      );
    case 'exclamationTriangle':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </Svg>
      );
    case 'userMinus':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6h12a6 6 0 00-6-6z"
          />
          <path {...stroke} d="M22 11h-6" />
        </Svg>
      );
    case 'clipboardList':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
          />
        </Svg>
      );
    case 'chartBar':
      return (
        <Svg className={className}>
          <path {...stroke} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </Svg>
      );
    case 'sparkles':
      return (
        <Svg className={className}>
          <path
            {...stroke}
            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
          />
        </Svg>
      );
    default:
      return (
        <Svg className={className}>
          <path {...stroke} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </Svg>
      );
  }
}

export default DashboardStatIcon;
