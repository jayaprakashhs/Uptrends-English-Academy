
import React from 'react';

interface LogoProps {
  className?: string;
  variant?: 'full' | 'icon' | 'white';
  size?: 'sm' | 'md' | 'lg';
  logoUrl?: string | null;
  altText?: string;
}

const DEFAULT_LOGO_URL =
  "https://gpnfznwqwaokfzmozpxo.supabase.co/storage/v1/object/public/Uptrend's%20English%20Academy-photos/main_logo/UEA_main_02.png";

export const Logo: React.FC<LogoProps> = ({
  className = '',
  variant = 'full',
  size = 'md',
  logoUrl,
  altText = "Uptrend's English Academy Davangere Logo",
}) => {
  // Display dimensions for the logo.
  const customLogoSizes = {
    sm: 'w-[280px] h-[64px]',
    md: 'w-[350px] h-[80px]',
    lg: 'w-[350px] h-[80px]',
  };

  // An Admin Portal logo takes priority over the default logo.
  const effectiveLogoUrl = logoUrl?.trim() || DEFAULT_LOGO_URL;

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <div
        className={`relative flex items-center justify-center shrink-0 ${customLogoSizes[size]}`}
      >
        <img
          src={effectiveLogoUrl}
          alt={altText}
          width={350}
          height={80}
          className="block w-full h-full object-contain"
          loading="eager"
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden';
          }}
        />
      </div>
    </div>
  );
};
