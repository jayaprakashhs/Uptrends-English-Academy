import React, { useState } from 'react';
import { AlertCircle, ExternalLink, MapPin, Navigation } from 'lucide-react';
import './AcademyMapPreview.css';

const STREET_VIEW_URL =
  'https://www.google.com/maps/embed?pb=!6m8!1m7!1sloirlxZ3zu6bporwIfonkA!2m2!1d14.4627549!2d75.9166421!3f59.150302017067276!4f-16.996214787007204!5f0.7820865974627469';
const GOOGLE_MAPS_LOCATION_URL = 'https://maps.app.goo.gl/L6ZTieauzXFiVUCJ6';
const DIRECTIONS_URL = 'https://maps.app.goo.gl/E2ZAz7M92yJ6LobS9';

export const AcademyMapPreview: React.FC = () => {
  const [streetViewUnavailable, setStreetViewUnavailable] = useState(false);

  return (
    <div className="academy-map-preview">
      <div className="academy-map-preview__frame">
        {streetViewUnavailable ? (
          <div className="academy-map-preview__fallback" role="status">
            <AlertCircle aria-hidden="true" className="academy-map-preview__fallback-icon" />
            <p>Street View is temporarily unavailable for this location.</p>
            <a href={GOOGLE_MAPS_LOCATION_URL} target="_blank" rel="noopener noreferrer">
              View the academy location in Google Maps
              <ExternalLink aria-hidden="true" />
            </a>
          </div>
        ) : (
          <iframe
            title="Interactive Google Street View of Uptrend's English Academy in Davangere"
            src={STREET_VIEW_URL}
            className="academy-map-preview__iframe"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
            onError={() => setStreetViewUnavailable(true)}
          />
        )}
      </div>

      <div className="academy-map-preview__actions">
        <a
          href={DIRECTIONS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="academy-map-preview__button academy-map-preview__button--primary"
        >
          <Navigation aria-hidden="true" />
          Directions
          <ExternalLink aria-hidden="true" />
        </a>
        <a
          href={GOOGLE_MAPS_LOCATION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="academy-map-preview__button academy-map-preview__button--secondary"
        >
          <MapPin aria-hidden="true" />
          Open Street View
          <ExternalLink aria-hidden="true" />
        </a>
      </div>
    </div>
  );
};
