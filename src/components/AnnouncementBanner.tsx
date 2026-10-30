import React, { useCallback, useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Announcement } from '../types';
import { fetchPublicJson, getPublicApiErrorMessage, PublicApiError } from '../lib/publicApi';

interface AnnouncementBannerProps {
  initialAnnouncements?: Announcement[];
  onOpenApplication: () => void;
  onOpenDemoClass: () => void;
}

export const AnnouncementBanner: React.FC<AnnouncementBannerProps> = ({
  initialAnnouncements,
  onOpenApplication,
  onOpenDemoClass,
}) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>(initialAnnouncements || []);
  const [loading, setLoading] = useState(!initialAnnouncements);
  const [error, setError] = useState<string | null>(null);

  const loadAnnouncements = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPublicJson('/api/announcements', signal);
      if (!Array.isArray(data)) throw new PublicApiError('unexpected_response');
      setAnnouncements(data.filter((item: Announcement) => item.is_active));
    } catch (loadError) {
      setError(getPublicApiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAnnouncements(controller.signal);
    return () => controller.abort();
  }, [loadAnnouncements]);

  if (error) {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-900" role="status" aria-live="polite">
        Announcements could not be loaded. {error}{' '}
        <button type="button" onClick={() => void loadAnnouncements()} disabled={loading} className="font-semibold underline underline-offset-2 disabled:opacity-60">
          {loading ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }
  if (announcements.length === 0) return loading ? <div className="sr-only" role="status" aria-live="polite">Loading announcements…</div> : null;

  const renderAnnouncementItems = (isDuplicate = false) => announcements.map((announcement) => (
    <span key={`${announcement.id}${isDuplicate ? '-duplicate' : ''}`} className="inline-flex items-center gap-3 px-5">
      <span>{announcement.content}</span>
      {announcement.button_action && (
        <button
          type="button"
          tabIndex={isDuplicate ? -1 : undefined}
          aria-hidden={isDuplicate || undefined}
          onClick={announcement.button_action === 'application' ? onOpenApplication : onOpenDemoClass}
          className="shrink-0 rounded-full border border-white/60 bg-white px-3 py-1 text-xs font-bold text-orange-700 shadow-sm transition-colors hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
        >
          {announcement.button_action === 'application' ? 'Application Form' : 'Book Your Free Demo'}
        </button>
      )}
      {!isDuplicate && <span className="text-orange-100" aria-hidden="true">✦</span>}
    </span>
  ));

  return (
    <div className="relative w-full overflow-hidden bg-gradient-to-r from-orange-600 via-orange-500 to-emerald-700 py-2.5 text-sm font-medium text-white shadow-sm border-b border-orange-700/30">
      <div className="flex w-full min-w-0 items-center">
        {/* Fixed label badge */}
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-0.5 bg-black/25 backdrop-blur-xs rounded-r-full text-xs font-semibold uppercase tracking-wider text-orange-100 z-10 shadow-xs mr-3">
          <Volume2 className="w-3.5 h-3.5 text-orange-200 animate-pulse" />
          <span>Notice</span>
        </div>

        {/* Marquee Container (No close button as required) */}
        <div className="relative flex-1 overflow-hidden whitespace-nowrap">
          <div className="inline-flex w-max animate-marquee hover:[animation-play-state:paused] motion-reduce:animate-none">
            <div className="inline-flex items-center">{renderAnnouncementItems()}</div>
            <div className="inline-flex items-center" aria-hidden="true">{renderAnnouncementItems(true)}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
