import React, { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Announcement } from '../types';

interface AnnouncementBannerProps {
  initialAnnouncements?: Announcement[];
}

export const AnnouncementBanner: React.FC<AnnouncementBannerProps> = ({ initialAnnouncements }) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>(
    initialAnnouncements || [
      {
        id: '1',
        content: "Welcome to Uptrend's English Academy, Davangere! Admissions are open for Spoken English & Communication training.",
        is_active: true,
        display_order: 1,
      },
      {
        id: '2',
        content: "Visit our campus at Ram And Co Circle, Devi Building, 2nd Floor, Davangere or call +91 900 8000 211.",
        is_active: true,
        display_order: 2,
      },
      {
        id: '3',
        content: "Practical conversation practice and grammar fundamentals tailored for students, professionals, and homemakers.",
        is_active: true,
        display_order: 3,
      },
    ]
  );

  useEffect(() => {
    fetch('/api/announcements')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setAnnouncements(data.filter((item: Announcement) => item.is_active));
        }
      })
      .catch((err) => console.error('Failed to load announcements:', err));
  }, []);

  if (announcements.length === 0) return null;

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
