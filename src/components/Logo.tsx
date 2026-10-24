import React from 'react';

interface LogoProps {
  className?: string;
  variant?: 'full' | 'icon' | 'white';
  size?: 'sm' | 'md' | 'lg';
  logoUrl?: string | null;
  altText?: string;
}

export const Logo: React.FC<LogoProps> = ({
  className = '',
  variant = 'full',
  size = 'md',
  logoUrl,
  altText = "Uptrend's English Academy Davangere Logo",
}) => {
  const iconSizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
  };

  const textSizes = {
    sm: { title: 'text-base', sub: 'text-[9px]' },
    md: { title: 'text-lg', sub: 'text-[11px]' },
    lg: { title: 'text-2xl', sub: 'text-xs' },
  };

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Brand Icon or Custom Logo Image */}
      <div className={`relative flex items-center justify-center shrink-0 ${iconSizes[size]}`}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={altText}
            className="w-full h-full object-contain rounded-xl"
          />
        ) : (
          <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full drop-shadow-sm">
            {/* Circular badge container */}
            <rect width="100" height="100" rx="24" fill="#0f172a" />
          
          {/* Upward Growth Arrow (Orange) */}
          <path
            d="M20 70 L48 42 L62 56 L82 28"
            stroke="#ea580c"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M68 28 H82 V42"
            stroke="#ea580c"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Book / Communication Wings (Green) */}
          <path
            d="M24 76 C36 72 44 74 50 78 C56 74 64 72 76 76"
            stroke="#16a34a"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M24 82 C36 78 44 80 50 84 C56 80 64 78 76 82"
            stroke="#16a34a"
            strokeWidth="5"
            strokeLinecap="round"
          />

          {/* Graduation / Excellence Accent */}
          <circle cx="50" cy="24" r="5" fill="#f97316" />
        </svg>
        )}
      </div>

      {/* Typography */}
      {variant !== 'icon' && (
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1.5 font-extrabold tracking-tight font-sans">
            <span className={`${textSizes[size].title} ${variant === 'white' ? 'text-white' : 'text-slate-900'}`}>
              UPTREND’S
            </span>
            <span className={`${textSizes[size].title} text-orange-600`}>
              ENGLISH
            </span>
          </div>
          <div className="flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-500">
            <span className={`${textSizes[size].sub} font-bold text-emerald-600 tracking-widest`}>
              ACADEMY
            </span>
            <span className={`${textSizes[size].sub} text-slate-400 font-medium`}>• DAVANGERE</span>
          </div>
        </div>
      )}
    </div>
  );
};
