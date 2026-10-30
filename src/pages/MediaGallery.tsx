import React, { useState } from 'react';
import { MediaItem } from '../types';
import { Play, Image as ImageIcon, Video, Filter, X } from 'lucide-react';
import { extractYouTubeId, getYouTubeThumbnail } from '../lib/youtube';
import { ApplicationCTA } from '../components/ApplicationCTA';

interface MediaGalleryProps {
  mediaItems: MediaItem[];
  openVideoModal: (url: string, title: string) => void;
  openDemoClassModal: () => void;
  openCallbackModal: (programName?: string) => void;
}

export const MediaGallery: React.FC<MediaGalleryProps> = ({
  mediaItems,
  openVideoModal,
  openDemoClassModal,
  openCallbackModal,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'photo' | 'video'>('all');
  const [lightboxPhoto, setLightboxPhoto] = useState<MediaItem | null>(null);

  const publishedItems = mediaItems.filter((m) => m.is_published);

  const filtered = publishedItems.filter((item) => {
    if (filterType === 'all') return true;
    return item.media_type === filterType;
  });

  return (
    <div className="space-y-12 py-12">
      {/* Header */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 text-orange-800 text-xs font-bold uppercase tracking-wider">
            <Video className="w-4 h-4 text-orange-600" />
            <span>Academy In Pictures & Video</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-950 tracking-tight">
            Media & Testimonials
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">
            Take a look inside Uptrend’s English Academy: classroom interaction sessions, video talks, and student speech activities at our Davangere campus.
          </p>
        </div>

        {/* Filter buttons */}
        <div className="mt-8 flex justify-center items-center gap-2">
          <button
            onClick={() => setFilterType('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              filterType === 'all'
                ? 'bg-orange-600 text-white shadow-md'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            All Media ({publishedItems.length})
          </button>
          <button
            onClick={() => setFilterType('photo')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              filterType === 'photo'
                ? 'bg-orange-600 text-white shadow-md'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Photos</span>
          </button>
          <button
            onClick={() => setFilterType('video')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              filterType === 'video'
                ? 'bg-orange-600 text-white shadow-md'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>Testimonials</span>
          </button>
        </div>
      </section>

      {/* Gallery Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((item) => {
              const isVideo = item.media_type === 'video';
              const yId = isVideo ? extractYouTubeId(item.youtube_url || item.youtube_video_id) : null;
              const coverSrc = isVideo
  ? item.cover_image_url || getYouTubeThumbnail(yId)
  : item.cover_image_url || item.media_url || '';

              return (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-xs hover:shadow-xl transition-all duration-300 flex flex-col group cursor-pointer"
                  onClick={() => {
                    if (isVideo && item.youtube_url) {
                      openVideoModal(item.youtube_url, item.title);
                    } else {
                      setLightboxPhoto(item);
                    }
                  }}
                >
                  <div className="relative aspect-16/10 overflow-hidden bg-slate-900">
                    <img
                      src={coverSrc}
                      alt={item.alt_text || item.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />

                    {isVideo ? (
                      <div className="absolute inset-0 bg-black/35 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <div className="w-14 h-14 rounded-full bg-orange-600 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                          <Play className="w-6 h-6 fill-current ml-0.5" />
                        </div>
                        <span className="absolute top-3 left-3 bg-black/70 px-2 py-0.5 rounded text-[11px] font-bold text-white uppercase tracking-wider">
                          YouTube Video
                        </span>
                      </div>
                    ) : (
                      <span className="absolute top-3 left-3 bg-emerald-700/80 backdrop-blur-xs px-2.5 py-1 rounded text-[11px] font-bold text-white uppercase tracking-wider">
                        Photo
                      </span>
                    )}
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 text-base leading-snug group-hover:text-orange-600 transition-colors">
                        {item.title}
                      </h3>
                      {item.caption && (
                        <p className="text-xs text-slate-600 mt-2 line-clamp-2 leading-relaxed">
                          {item.caption}
                        </p>
                      )}
                    </div>
                    <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                      <span>{isVideo ? 'Click to play video' : 'Click to view photo'}</span>
                      <span className="font-medium text-orange-600">
                        {isVideo ? 'Watch →' : 'Expand →'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 max-w-md mx-auto p-6">
            <p className="text-sm font-semibold text-slate-700">No media items found for this filter.</p>
          </div>
        )}
      </section>

      {/* Photo Lightbox Modal */}
      {lightboxPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="relative max-w-4xl w-full bg-slate-950 rounded-2xl overflow-hidden shadow-2xl border border-slate-800">
            <div className="flex items-center justify-between p-4 bg-slate-900 text-white border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-200 truncate pr-4">
                {lightboxPhoto.title}
              </h3>
              <button
                onClick={() => setLightboxPhoto(null)}
                className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-2 bg-black flex items-center justify-center max-h-[75vh]">
              <img
                src={lightboxPhoto.media_url || lightboxPhoto.cover_image_url || ''}
                alt={lightboxPhoto.alt_text || lightboxPhoto.title}
                className="max-h-[70vh] w-auto object-contain rounded-lg"
              />
            </div>
            {lightboxPhoto.caption && (
              <div className="p-4 bg-slate-900 text-xs text-slate-300 border-t border-slate-800">
                {lightboxPhoto.caption}
              </div>
            )}
          </div>
        </div>
      )}
      <ApplicationCTA
        openDemoClassModal={openDemoClassModal}
        openCallbackModal={openCallbackModal}
      />
    </div>
  );
};
