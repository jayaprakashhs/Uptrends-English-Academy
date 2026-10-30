import React, { useEffect } from 'react';

const SCRIPT_URL = 'https://widgets.sociablekit.com/google-reviews/widget.js';
const SCRIPT_SELECTOR = `script[src="${SCRIPT_URL}"]`;

interface SociableKitGoogleReviewsProps {
  className?: string;
}

export const SociableKitGoogleReviews: React.FC<SociableKitGoogleReviewsProps> = ({
  className = '',
}) => {
  useEffect(() => {
    if (document.querySelector(SCRIPT_SELECTOR)) return;

    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.defer = true;
    script.dataset.sociablekitGoogleReviews = 'true';
    document.body.appendChild(script);
  }, []);

  return (
    <div
      className={`min-w-0 max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] sm:overflow-x-visible ${className}`.trim()}
    >
      <div
        className="sk-ww-google-reviews min-w-0 w-full max-w-full"
        data-embed-id="25725847"
      />
    </div>
  );
};
