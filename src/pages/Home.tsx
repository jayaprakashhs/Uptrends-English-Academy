
import React from 'react';
import { Program, Review, MediaItem } from '../types';
import {
  ArrowRight,
  PhoneCall,
  Sparkles,
  CheckCircle2,
  Play,
  Users,
  MessageSquareQuote,
  Compass,
  BookOpen,
  Clock,
  Award,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { extractYouTubeId, getYouTubeThumbnail } from '../lib/youtube';

interface HomeProps {
  programs: Program[];
  reviews: Review[];
  mediaItems: MediaItem[];
  dataStatuses: {
    programs: { loading: boolean; error: string | null };
    reviews: { loading: boolean; error: string | null };
    media: { loading: boolean; error: string | null };
  };
  onRetryData: (resource: 'programs' | 'reviews' | 'media') => void;
  setCurrentPage: (page: string) => void;
  setSelectedProgram: (program: Program) => void;
  openCallbackModal: (programName?: string) => void;
  openVideoModal: (url: string, title: string) => void;
}

export const Home: React.FC<HomeProps> = ({
  programs,
  reviews,
  mediaItems,
  dataStatuses,
  onRetryData,
  setCurrentPage,
  setSelectedProgram,
  openCallbackModal,
  openVideoModal,
}) => {
  const publishedPrograms = programs
    .filter((program) => program.is_published)
    .slice(0, 4);

  const publishedReviews = reviews
    .filter((review) => review.is_published)
    .slice(0, 3);

  const previewMedia = mediaItems
    .filter((item) => item.is_published)
    .slice(0, 3);

  const [reviewIndex, setReviewIndex] = React.useState(0);

  React.useEffect(() => {
    setReviewIndex((current) => {
      if (publishedReviews.length === 0) return 0;
      return current % publishedReviews.length;
    });
  }, [publishedReviews.length]);

  const previousReview = () => {
    if (publishedReviews.length <= 1) return;

    setReviewIndex((current) =>
      current <= 0 ? publishedReviews.length - 1 : current - 1
    );
  };

  const nextReview = () => {
    if (publishedReviews.length <= 1) return;

    setReviewIndex((current) =>
      current >= publishedReviews.length - 1 ? 0 : current + 1
    );
  };

  // Keep all published review cards visible and rotate their order.
  const displayedReviews = React.useMemo(() => {
    if (publishedReviews.length === 0) return [];

    return publishedReviews.map(
      (_, index) =>
        publishedReviews[
          (index + reviewIndex) % publishedReviews.length
        ]
    );
  }, [publishedReviews, reviewIndex]);

  const renderResourceState = (
    resource: 'programs' | 'reviews' | 'media'
  ) => {
    const status = dataStatuses[resource];

    if (status.loading) {
      return (
        <p className="py-6 text-center text-sm text-slate-500" role="status">
          Loading {resource}…
        </p>
      );
    }

    if (!status.error) return null;

    return (
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        role="alert"
      >
        <p>{status.error}</p>
        <button
          type="button"
          onClick={() => onRetryData(resource)}
          className="mt-2 font-semibold underline underline-offset-2"
        >
          Retry loading {resource}
        </button>
      </div>
    );
  };

  const handleProgramClick = (program: Program) => {
    setSelectedProgram(program);
    setCurrentPage('program-details');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-20 pb-16">
      {/* HERO SECTION */}
      <section className="relative overflow-hidden border-b border-slate-200/60 bg-gradient-to-b from-orange-50/70 via-white to-slate-50 pb-20 pt-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-100/80 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-orange-800">
                <Sparkles className="h-4 w-4 text-orange-600" />
                <span>English Communication Training • Davangere</span>
              </div>

              <h1 className="text-4xl font-extrabold leading-[1.12] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                Speak English with{' '}
                <span className="bg-gradient-to-r from-orange-600 to-amber-600 bg-clip-text text-transparent">
                  Fluency
                </span>
                , Poise, and{' '}
                <span className="bg-gradient-to-r from-emerald-600 to-teal-700 bg-clip-text text-transparent">
                  Confidence
                </span>
              </h1>

              <p className="max-w-2xl text-lg leading-relaxed text-slate-600">
                Uptrend’s English Academy is Davangere’s dedicated training
                center for practical spoken English, communication development,
                and grammar fundamentals. We empower students, job seekers,
                professionals, and homemakers to speak naturally without
                hesitation.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentPage('apply');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-orange-600/20 transition hover:bg-orange-500 sm:px-7 sm:text-base"
                >
                  Apply Now
                  <ArrowRight className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCurrentPage('programs');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 sm:px-6 sm:text-base"
                >
                  Explore Programs
                </button>

                <button
                  type="button"
                  onClick={() => openCallbackModal('General English Training')}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-800"
                >
                  <PhoneCall className="h-4 w-4 text-emerald-600" />
                  Request a Call
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 text-xs font-medium text-slate-600 sm:grid-cols-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>Interactive Speaking</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>Practical Grammar</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>Ram &amp; Co Circle, Davangere</span>
                </div>
              </div>
            </div>

            {/* HERO IMAGE AND BADGE */}
            <div className="relative mt-4 lg:col-span-5 lg:mt-0">
              <div className="group relative mx-auto max-w-md overflow-hidden rounded-3xl border-4 border-white bg-slate-900 shadow-2xl lg:max-w-none">
                <img
                  src="https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1000&q=80"
                  alt="Students learning together in a classroom"
                  className="aspect-[4/3] w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
                />

                <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-slate-950/80 via-transparent to-transparent p-6 text-white">
                  <span className="text-xs font-bold uppercase tracking-wider text-orange-300">
                    Empowering Davangere Learners
                  </span>
                  <p className="text-sm font-semibold text-slate-100">
                    Real speaking practice in a warm, encouraging environment.
                  </p>
                </div>
              </div>

              <div className="absolute -top-4 right-2 z-20 flex max-w-[calc(100%-1rem)] items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-xl sm:-right-4 sm:-top-5 sm:p-4">
                <div className="shrink-0 rounded-xl bg-emerald-100 p-2.5 text-emerald-700 sm:p-3">
                  <BookOpen className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 sm:text-sm">
                    Proven Pedagogy
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-xs">
                    Foundation to Advanced Modules
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED PROGRAMS */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-orange-600">
              <Compass className="h-4 w-4" />
              <span>Academy Offerings</span>
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-950">
              Featured English Programs
            </h2>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              Structured courses designed to enhance everyday vocabulary,
              correct pronunciation, grammatical accuracy, and professional
              speaking.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setCurrentPage('programs');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-bold text-orange-600 hover:text-orange-700"
          >
            View All Programs
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {renderResourceState('programs') ||
          (publishedPrograms.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No published programs are currently available.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              {publishedPrograms.map((program) => (
                <article
                  key={program.id}
                  className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-all duration-300 hover:shadow-xl"
                >
                  <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
                    <img
                      src={
                        program.image_url ||
                        'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80'
                      }
                      alt={program.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    {program.level && (
                      <div className="absolute left-3 top-3 rounded-md bg-slate-950/80 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                        {program.level}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="mb-2 text-lg font-bold leading-snug text-slate-900 transition-colors group-hover:text-orange-600">
                      {program.title}
                    </h3>
                    <p className="mb-4 line-clamp-2 text-xs leading-relaxed text-slate-600">
                      {program.short_description}
                    </p>

                    <div className="mt-auto space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
                      <div className="flex min-w-0 items-center gap-2">
                        <Users className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                        <span className="min-w-0 truncate">
                          <strong>Audience:</strong> {program.target_audience}
                        </span>
                      </div>

                      {program.duration && (
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <span>
                            <strong>Duration:</strong> {program.duration}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
                      <button
                        type="button"
                        onClick={() => handleProgramClick(program)}
                        className="flex min-w-0 min-h-11 w-full items-center justify-center rounded-xl bg-slate-100 px-2 py-2.5 text-center text-xs font-bold text-slate-800 transition hover:bg-slate-200 sm:px-3"
                      >
                        View Program
                      </button>
                      <button
                        type="button"
                        onClick={() => openCallbackModal(program.title)}
                        className="flex min-w-0 min-h-11 w-full items-center justify-center gap-1 rounded-xl border border-orange-500 px-2 py-2.5 text-center text-xs font-bold text-orange-600 transition hover:bg-orange-50 sm:px-3"
                      >
                        <PhoneCall className="h-3.5 w-3.5 shrink-0" />
                        <span>Request Call</span>
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ))}
      </section>

      {/* WHY CHOOSE US */}
      <section className="bg-slate-900 py-16 text-white sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-12 max-w-3xl text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-orange-400">
              The Uptrend’s Advantage
            </span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Why Learn English with Us?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400 sm:text-base">
              Our training methodology focuses on practical speaking
              habituation rather than rote memorization.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="flex flex-col items-center rounded-3xl border border-slate-700/70 bg-slate-800/80 p-7 text-center transition-all duration-300 hover:-translate-y-1 hover:border-orange-500/40 hover:shadow-xl sm:p-8">
              <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-orange-600/20 text-orange-400">
                <Users className="h-9 w-9" />
              </div>
              <h3 className="mb-3 text-lg font-bold text-white">
                Interactive Speaking Practice
              </h3>
              <p className="max-w-sm text-sm leading-relaxed text-slate-400">
                Overcome the fear of making mistakes with supportive pair
                work, everyday situational dialogues, and structured speaking
                drills.
              </p>
            </div>

            <div className="flex flex-col items-center rounded-3xl border border-slate-700/70 bg-slate-800/80 p-7 text-center transition-all duration-300 hover:-translate-y-1 hover:border-emerald-500/40 hover:shadow-xl sm:p-8">
              <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-600/20 text-emerald-400">
                <Award className="h-9 w-9" />
              </div>
              <h3 className="mb-3 text-lg font-bold text-white">
                Grammar with Immediate Application
              </h3>
              <p className="max-w-sm text-sm leading-relaxed text-slate-400">
                Learn core tenses, sentence structures, and functional
                vocabulary with immediate speaking reinforcement in context.
              </p>
            </div>

            <div className="flex flex-col items-center rounded-3xl border border-slate-700/70 bg-slate-800/80 p-7 text-center transition-all duration-300 hover:-translate-y-1 hover:border-amber-500/40 hover:shadow-xl sm:p-8">
              <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-600/20 text-amber-400">
                <BookOpen className="h-9 w-9" />
              </div>
              <h3 className="mb-3 text-lg font-bold text-white">
                Central Davangere Location
              </h3>
              <p className="max-w-sm text-sm leading-relaxed text-slate-400">
                Conveniently located at Ram And Co Circle, Devi Building,
                2nd Floor, accessible from across Davangere city and nearby
                towns.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ABOUT PREVIEW */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-900 to-slate-900 p-8 text-white shadow-xl sm:p-12">
          <div className="relative z-10 max-w-2xl space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              About Uptrend’s English Academy
            </span>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              An Approximately 25-Year Journey in English Language Training
            </h2>
            <p className="text-sm leading-relaxed text-emerald-100/90">
              Founded in Davangere, Karnataka, Uptrend’s English Academy has
              guided learners across generations. Our mission is to ensure
              every student, professional, and homemaker can express thoughts
              clearly and confidently in English.
            </p>
            <button
              type="button"
              onClick={() => {
                setCurrentPage('about');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-bold text-slate-900 transition-colors hover:bg-emerald-50"
            >
              Read Full About Us &amp; Philosophy
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* REVIEWS WITH LEFT AND RIGHT SIDE ARROWS */}
      {(publishedReviews.length > 0 ||
        dataStatuses.reviews.loading ||
        dataStatuses.reviews.error) && (
        <section className="relative mx-auto w-full max-w-[1600px] px-4 py-2 sm:px-8 lg:px-20">
          {/* LEFT-SIDE PREVIOUS ARROW */}
          <button
            type="button"
            onClick={previousReview}
            disabled={publishedReviews.length <= 1}
            aria-label="Previous reviews"
            title="Previous reviews"
            className="absolute left-1 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg transition hover:border-orange-500 hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40 sm:left-4 lg:left-6"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          {/* RIGHT-SIDE NEXT ARROW */}
          <button
            type="button"
            onClick={nextReview}
            disabled={publishedReviews.length <= 1}
            aria-label="Next reviews"
            title="Next reviews"
            className="absolute right-1 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg transition hover:border-orange-500 hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40 sm:right-4 lg:right-6"
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          <div className="mx-auto max-w-7xl">
            <div className="mb-8 text-center">
              <div className="mb-2 inline-flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-600">
                <MessageSquareQuote className="h-4 w-4" />
                <span>Verified Feedback</span>
              </div>
              <h2 className="text-2xl font-extrabold text-slate-950 sm:text-3xl">
                What Our Students Say
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Hear from our students about their learning experience.
              </p>
            </div>

            {renderResourceState('reviews') ||
              (publishedReviews.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  No published reviews are currently available.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {displayedReviews.map((review) => (
                    <article
                      key={review.id}
                      className="flex h-full min-w-0 flex-col justify-between rounded-3xl border border-slate-200/80 bg-white p-6 shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl sm:p-7"
                    >
                      <div>
                        <div
                          className="mb-4 flex items-center gap-1 text-amber-400"
                          aria-label={`${review.rating} out of 5 stars`}
                        >
                          {Array.from(
                            { length: Math.max(0, Math.min(5, review.rating)) },
                            (_, index) => (
                              <span
                                key={index}
                                className="text-xl"
                                aria-hidden="true"
                              >
                                ★
                              </span>
                            )
                          )}
                        </div>

                        <MessageSquareQuote className="mb-3 h-7 w-7 text-emerald-600/70" />

                        <p className="break-words text-sm italic leading-relaxed text-slate-700 sm:text-base">
                          “{review.review_text}”
                        </p>
                      </div>

                      <div className="mt-6 border-t border-slate-100 pt-4">
                        <p className="font-bold text-slate-900">
                          {review.author_name}
                        </p>
                        <span className="mt-2 inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                          {review.source || 'Verified Student'}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              ))}
          </div>
        </section>
      )}

      {/* MEDIA GALLERY PREVIEW */}
      {(previewMedia.length > 0 ||
        dataStatuses.media.loading ||
        dataStatuses.media.error) && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-orange-600">
                Academy Highlights
              </span>
              <h2 className="mt-1 text-2xl font-extrabold text-slate-950 sm:text-3xl">
                Media &amp; Video Gallery
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setCurrentPage('media');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex cursor-pointer items-center gap-1 text-xs font-bold text-orange-600 hover:text-orange-700"
            >
              Explore Gallery
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {renderResourceState('media') ||
            (previewMedia.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                No published media is currently available.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {previewMedia.map((item) => {
                  const isVideo = item.media_type === 'video';
                  const youtubeId = isVideo
                    ? extractYouTubeId(
                        item.youtube_url || item.youtube_video_id
                      )
                    : null;
                  const coverSrc =
                    item.cover_image_url || getYouTubeThumbnail(youtubeId);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`Open ${item.title}`}
                      className="group relative aspect-[16/10] cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 text-left shadow-md"
                      onClick={() => {
                        if (isVideo && item.youtube_url) {
                          openVideoModal(item.youtube_url, item.title);
                        } else {
                          setCurrentPage('media');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                      }}
                    >
                      <img
                        src={coverSrc}
                        alt={item.alt_text || item.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-slate-950/80 via-transparent to-transparent p-4 text-white">
                        <p className="truncate text-xs font-bold">
                          {item.title}
                        </p>
                        {item.caption && (
                          <p className="mt-0.5 truncate text-[11px] text-slate-300">
                            {item.caption}
                          </p>
                        )}
                      </div>

                      {isVideo && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/90 text-white shadow-lg transition-all group-hover:scale-110 group-hover:bg-orange-500">
                            <Play className="ml-0.5 h-5 w-5 fill-current" />
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
        </section>
      )}

      {/* APPLY NOW CTA */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-8 rounded-3xl bg-gradient-to-r from-orange-600 via-orange-500 to-amber-600 p-8 text-white shadow-xl md:flex-row sm:p-12">
          <div className="max-w-xl space-y-2 text-center md:text-left">
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              Ready to Speak with Confidence?
            </h2>
            <p className="text-sm text-orange-100">
              Submit your application online. Our admissions team will review
              your details and confirm your admission via email.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setCurrentPage('apply');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="cursor-pointer rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-orange-600 shadow-md transition-all hover:bg-orange-50"
            >
              Start Online Application →
            </button>
            <button
              type="button"
              onClick={() => openCallbackModal('Admission Enquiry')}
              className="cursor-pointer rounded-xl bg-black/20 px-5 py-3.5 text-sm font-semibold text-white transition-all hover:bg-black/30"
            >
              Request a Call
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
