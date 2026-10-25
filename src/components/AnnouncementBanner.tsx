import React, { useCallback, useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Announcement } from '../types';
import { fetchPublicJson, getPublicApiErrorMessage, PublicApiError } from '../lib/publicApi';

interface AnnouncementBannerProps {
  initialAnnouncements?: Announcement[];
}

export const AnnouncementBanner: React.FC<AnnouncementBannerProps> = ({ initialAnnouncements }) => {
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

  const combinedText = announcements.map((a) => a.content).join('  ✦  ');

  return (
    <div className="relative bg-gradient-to-r from-orange-600 via-orange-500 to-emerald-700 text-white overflow-hidden py-2.5 shadow-sm text-sm font-medium border-b border-orange-700/30">
      <div className="max-w-7xl mx-auto flex items-center">
        {/* Fixed label badge */}
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-0.5 bg-black/25 backdrop-blur-xs rounded-r-full text-xs font-semibold uppercase tracking-wider text-orange-100 z-10 shadow-xs mr-3">
          <Volume2 className="w-3.5 h-3.5 text-orange-200 animate-pulse" />
          <span>Notice</span>
        </div>

        {/* Marquee Container (No close button as required) */}
        <div className="relative flex-1 overflow-hidden whitespace-nowrap">
          <div className="inline-block animate-marquee hover:[animation-play-state:paused] motion-reduce:animate-none">
            <span className="px-4">{combinedText}</span>
            <span className="px-4" aria-hidden="true">  ✦  {combinedText}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
