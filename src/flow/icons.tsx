import { memo } from 'react';
import type { ComponentType } from '@/engine';

/** Minimal line icons, one per component type. 20×20, currentColor. */
const ComponentIconInner = ({ type, size = 18 }: { type: ComponentType; size?: number }) => {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (type) {
    case 'client':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="14" height="10" rx="1.5" />
          <path d="M7 17h6M10 14v3" />
        </svg>
      );
    case 'loadBalancer':
      return (
        <svg {...p}>
          <circle cx="10" cy="4" r="2" />
          <circle cx="4" cy="16" r="2" />
          <circle cx="16" cy="16" r="2" />
          <path d="M10 6v3m0 0-5 5m5-5 5 5" />
        </svg>
      );
    case 'apiServer':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="14" height="6" rx="1.2" />
          <rect x="3" y="11" width="14" height="6" rx="1.2" />
          <path d="M6 6h.01M6 14h.01" />
        </svg>
      );
    case 'cache':
      return (
        <svg {...p}>
          <path d="M10 3c4 0 6 1.3 6 3s-2 3-6 3-6-1.3-6-3 2-3 6-3Z" />
          <path d="M4 6v8c0 1.7 2 3 6 3s6-1.3 6-3V6" />
        </svg>
      );
    case 'sqlDatabase':
      return (
        <svg {...p}>
          <ellipse cx="10" cy="5" rx="6" ry="2.5" />
          <path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
        </svg>
      );
    case 'queue':
      return (
        <svg {...p}>
          <rect x="2" y="7" width="4" height="6" rx="1" />
          <rect x="8" y="7" width="4" height="6" rx="1" />
          <rect x="14" y="7" width="4" height="6" rx="1" />
        </svg>
      );
    case 'worker':
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="3" />
          <path d="M10 2v3m0 10v3M2 10h3m10 0h3M4.5 4.5l2 2m7 7 2 2m0-11-2 2m-7 7-2 2" />
        </svg>
      );
    case 'cdn':
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7" />
          <path d="M3 10h14M10 3c2.5 2 2.5 12 0 14M10 3c-2.5 2-2.5 12 0 14" />
        </svg>
      );
    case 'objectStore':
      return (
        <svg {...p}>
          <path d="M3 6.5 10 3l7 3.5-7 3.5-7-3.5Z" />
          <path d="M3 10.5 10 14l7-3.5M3 14 10 17.5 17 14" />
        </svg>
      );
    case 'externalService':
      return (
        <svg {...p}>
          <path d="M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z" strokeDasharray="2.5 2" />
          <path d="M8 10h4m0 0-1.6-1.6M12 10l-1.6 1.6" />
        </svg>
      );
    case 'circuitBreaker':
      return (
        <svg {...p}>
          <path d="M3 10h4l2-4 3 8 2-4h3" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7" />
        </svg>
      );
  }
}

export const ComponentIcon = memo(ComponentIconInner);
