import React, { useState } from 'react';
import { Review } from '../types';
import { MessageSquareQuote, Star, ArrowUpDown, Filter, CheckCircle2 } from 'lucide-react';

interface ReviewsProps {
  reviews: Review[];
}

export const Reviews: React.FC<ReviewsProps> = ({ reviews }) => {
  const [sortOrder, setSortOrder] = useState<'latest' | 'oldest'>('latest');
  const [ratingFilter, setRatingFilter] = useState<number | 'all'>('all');
  const [visibleCount, setVisibleCount] = useState<number>(6);

  const publishedReviews = reviews.filter((r) => r.is_published);

  const filtered = publishedReviews.filter((r) => {
    if (ratingFilter === 'all') return true;
    return r.rating === ratingFilter;
  });

  const sorted = [...filtered].sort((a, b) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    return sortOrder === 'latest' ? timeB - timeA : timeA - timeB;
  });

  const displayed = sorted.slice(0, visibleCount);

  return (
    <div className="space-y-12 py-12">
      {/* Header */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold uppercase tracking-wider">
            <MessageSquareQuote className="w-4 h-4 text-emerald-600" />
            <span>Learner Feedback</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-950 tracking-tight">
            Student Reviews & Experiences
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">
            Read verified experiences and testimonials from students, graduates, and professionals who trained with Uptrend’s English Academy in Davangere.
          </p>
        </div>

        {/* Filter and Sorting Controls */}
        <div className="mt-10 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
          {/* Rating filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-600 uppercase">Rating:</span>
            <div className="flex items-center gap-1">
              {(['all', 5, 4, 3] as const).map((star) => (
                <button
                  key={star}
                  onClick={() => {
                    setRatingFilter(star);
                    setVisibleCount(6);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    ratingFilter === star
                      ? 'bg-orange-600 text-white font-bold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {star === 'all' ? 'All Ratings' : `${star} Stars`}
                </button>
              ))}
            </div>
          </div>

          {/* Sort order */}
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-600 uppercase">Sort:</span>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-semibold text-slate-700 border-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
            >
              <option value="latest">Latest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
        </div>
      </section>

      {/* Reviews Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {displayed.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayed.map((rev) => (
              <div
                key={rev.id}
                className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1 text-amber-400">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          className={`w-4 h-4 ${
                            i < rev.rating
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-slate-200 fill-slate-100'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {new Date(rev.created_at).toLocaleDateString('en-IN', {
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-700 leading-relaxed italic">
                    "{rev.review_text}"
                  </p>
                </div>

                <div className="pt-4 mt-6 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-900">{rev.author_name}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{rev.source || 'Verified Student'}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 max-w-md mx-auto p-6">
            <p className="text-sm font-semibold text-slate-700">No reviews found matching this rating.</p>
            <button
              onClick={() => setRatingFilter('all')}
              className="mt-2 text-xs font-bold text-orange-600 hover:underline cursor-pointer"
            >
              Reset filter
            </button>
          </div>
        )}

        {/* Load More Button */}
        {visibleCount < sorted.length && (
          <div className="text-center pt-8">
            <button
              onClick={() => setVisibleCount((prev) => prev + 6)}
              className="px-6 py-2.5 rounded-xl border border-slate-300 hover:border-orange-500 text-slate-800 hover:text-orange-600 text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              Load More Reviews ({sorted.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
