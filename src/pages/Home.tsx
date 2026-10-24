import React, { useState } from 'react';
import { Program, Review, MediaItem } from '../types';
import { ArrowRight, PhoneCall, Sparkles, CheckCircle2, Play, Users, MessageSquareQuote, Compass, BookOpen, Clock, Award } from 'lucide-react';
import { extractYouTubeId, getYouTubeThumbnail } from '../lib/youtube';

interface HomeProps {
  programs: Program[];
  reviews: Review[];
  mediaItems: MediaItem[];
  setCurrentPage: (page: string) => void;
  setSelectedProgram: (program: Program) => void;
  openCallbackModal: (programName?: string) => void;
  openVideoModal: (url: string, title: string) => void;
}

export const Home: React.FC<HomeProps> = ({
  programs,
  reviews,
  mediaItems,
  setCurrentPage,
  setSelectedProgram,
  openCallbackModal,
  openVideoModal,
}) => {
  const publishedPrograms = programs.filter((p) => p.is_published);
  const publishedReviews = reviews.filter((r) => r.is_published).slice(0, 3);
  const previewMedia = mediaItems.filter((m) => m.is_published).slice(0, 3);

  const handleProgramClick = (prog: Program) => {
    setSelectedProgram(prog);
    setCurrentPage('program-details');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-20 pb-16">
      {/* C. HERO SECTION */}
      <section className="relative overflow-hidden bg-gradient-to-b from-orange-50/70 via-white to-slate-50 pt-12 pb-20 border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Content */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-orange-100/80 border border-orange-200 text-orange-800 text-xs font-bold uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-orange-600" />
                <span>English Communication Training • Davangere</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-950 tracking-tight leading-[1.12]">
                Speak English with{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-amber-600">
                  Fluency
                </span>
                , Poise, and{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-700">
                  Confidence
                </span>
              </h1>

              <p className="text-lg text-slate-600 leading-relaxed max-w-2xl">
                Uptrend’s English Academy is Davangere’s dedicated training center for practical spoken English, communication development, and grammar fundamentals. We empower students, job seekers, professionals, and homemakers to speak naturally without hesitation.
              </p>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-wrap items-center gap-4">
                <button
                  onClick={() => {
                    setCurrentPage('apply');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="px-7 py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-base shadow-lg shadow-orange-600/20 hover:shadow-orange-600/30 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <span>Apply Now</span>
                  <ArrowRight className="w-5 h-5" />
                </button>

                <button
                  onClick={() => {
                    setCurrentPage('programs');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="px-6 py-3.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 font-bold text-base border border-slate-300 hover:border-slate-400 shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                >
                  <span>Explore Programs</span>
                </button>

                <button
                  onClick={() => openCallbackModal('General English Training')}
                  className="px-5 py-3.5 rounded-xl text-emerald-700 hover:text-emerald-800 font-semibold text-sm flex items-center gap-2 hover:bg-emerald-50 transition-colors cursor-pointer"
                >
                  <PhoneCall className="w-4 h-4 text-emerald-600" />
                  <span>Request a Call</span>
                </button>
              </div>

              {/* Verified Features Pills */}
              <div className="pt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs text-slate-600 font-medium border-t border-slate-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Interactive Speaking</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Practical Grammar</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Ram & Co Circle, Davangere</span>
                </div>
              </div>
            </div>

            {/* Right Hero Visual */}
            <div className="lg:col-span-5 relative">
              <div className="relative mx-auto max-w-md lg:max-w-none rounded-3xl overflow-hidden shadow-2xl border-4 border-white bg-slate-900 group">
                <img
                  src="https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1000&q=80"
                  alt="Uptrend's English Academy classroom communication practice"
                  className="w-full aspect-4/3 object-cover object-center group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex flex-col justify-end p-6 text-white">
                  <span className="text-xs uppercase font-bold tracking-wider text-orange-300">
                    Empowering Davangere Learners
                  </span>
                  <p className="text-sm font-semibold text-slate-100">
                    Real speaking practice in a warm, encouraging environment.
                  </p>
                </div>
              </div>

              {/* Floating Badge */}
              <div className="absolute -bottom-6 -left-6 bg-white p-4 rounded-2xl shadow-xl border border-slate-100 hidden sm:flex items-center gap-3">
                <div className="p-3 bg-emerald-100 text-emerald-700 rounded-xl">
                  <BookOpen className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Proven Pedagogy</p>
                  <p className="text-[11px] text-slate-500">Foundation to Advanced Modules</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* D. PROGRAMS PREVIEW */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-10 gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-orange-600 mb-2">
              <Compass className="w-4 h-4" />
              <span>Academy Offerings</span>
            </div>
            <h2 className="text-3xl font-extrabold text-slate-950 tracking-tight">
              Featured English Programs
            </h2>
            <p className="text-sm text-slate-600 mt-1 max-w-xl">
              Structured courses designed to enhance everyday vocabulary, correct pronunciation, grammatical accuracy, and professional speaking.
            </p>
          </div>
          <button
            onClick={() => {
              setCurrentPage('programs');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-orange-600 hover:text-orange-700 cursor-pointer"
          >
            <span>View All Programs</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Program Cards Grid (Strictly no batches, schedules, or invented fees) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {publishedPrograms.map((prog) => (
            <div
              key={prog.id}
              className="bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-xl transition-all duration-300 flex flex-col overflow-hidden group"
            >
              <div className="relative aspect-16/10 overflow-hidden bg-slate-100">
                <img
                  src={
                    prog.image_url ||
                    'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80'
                  }
                  alt={prog.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {prog.level && (
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-slate-950/80 backdrop-blur-xs text-white text-[11px] font-semibold">
                    {prog.level}
                  </div>
                )}
              </div>

              <div className="p-5 flex-1 flex flex-col">
                <h3 className="font-bold text-slate-900 text-lg leading-snug mb-2 group-hover:text-orange-600 transition-colors">
                  {prog.title}
                </h3>
                <p className="text-xs text-slate-600 line-clamp-2 mb-4 leading-relaxed">
                  {prog.short_description}
                </p>

                <div className="mt-auto space-y-2 pt-3 border-t border-slate-100 text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    <span className="truncate"><strong>Audience:</strong> {prog.target_audience}</span>
                  </div>
                  {prog.duration && (
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span><strong>Duration:</strong> {prog.duration}</span>
                    </div>
                  )}
                </div>

                <div className="pt-5 mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleProgramClick(prog)}
                    className="w-full py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold text-center transition-colors cursor-pointer"
                  >
                    View Program
                  </button>
                  <button
                    onClick={() => openCallbackModal(prog.title)}
                    className="w-full py-2 px-3 rounded-lg border border-orange-500 hover:bg-orange-50 text-orange-600 text-xs font-bold text-center transition-colors flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <PhoneCall className="w-3 h-3" />
                    <span>Request Call</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* E. WHY CHOOSE US */}
      <section className="bg-slate-900 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold uppercase tracking-wider text-orange-400">
              The Uptrend’s Advantage
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight mt-1">
              Why Learn English with Us?
            </h2>
            <p className="text-sm text-slate-400 mt-2">
              Our training methodology focuses on practical speaking habituation rather than rote memorization.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-slate-800/80 p-6 rounded-2xl border border-slate-700/60 space-y-3">
              <div className="w-12 h-12 rounded-xl bg-orange-600/20 text-orange-400 flex items-center justify-center">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Interactive Speaking Practice</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Overcome the fear of making mistakes with supportive pair work, everyday situational dialogues, and structured speaking drills.
              </p>
            </div>

            <div className="bg-slate-800/80 p-6 rounded-2xl border border-slate-700/60 space-y-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
                <Award className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Grammar with Immediate Application</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Learn core tenses, sentence structures, and functional vocabulary with immediate speaking reinforcement in context.
              </p>
            </div>

            <div className="bg-slate-800/80 p-6 rounded-2xl border border-slate-700/60 space-y-3">
              <div className="w-12 h-12 rounded-xl bg-amber-600/20 text-amber-400 flex items-center justify-center">
                <BookOpen className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Central Davangere Location</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Conveniently located at Ram And Co Circle, Devi Building 2nd Floor, accessible from across Davangere city and nearby towns.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* F. ABOUT PREVIEW */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-emerald-900 to-slate-900 rounded-3xl p-8 sm:p-12 text-white relative overflow-hidden shadow-xl">
          <div className="max-w-2xl space-y-4 relative z-10">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              About Uptrend’s English Academy
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              An Approximately 25-Year Journey in English Language Training
            </h2>
            <p className="text-sm text-emerald-100/90 leading-relaxed">
              Founded in Davangere, Karnataka, Uptrend’s English Academy has guided learners across generations. Our mission is to ensure every student, professional, and homemaker can express thoughts clearly and confidently in English.
            </p>
            <div className="pt-2">
              <button
                onClick={() => {
                  setCurrentPage('about');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-slate-900 font-bold text-xs hover:bg-emerald-50 transition-colors cursor-pointer"
              >
                <span>Read Full About Us & Philosophy</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* G. REVIEWS PREVIEW */}
      {publishedReviews.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-600 mb-1">
                <MessageSquareQuote className="w-4 h-4" />
                <span>Verified Feedback</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950">
                What Our Students Say
              </h2>
            </div>
            <button
              onClick={() => {
                setCurrentPage('reviews');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1 cursor-pointer"
            >
              <span>View All Reviews</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {publishedReviews.map((rev) => (
              <div
                key={rev.id}
                className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-1 text-amber-400 mb-3">
                    {[...Array(rev.rating)].map((_, i) => (
                      <span key={i} className="text-base">★</span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed italic">
                    "{rev.review_text}"
                  </p>
                </div>
                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-900">{rev.author_name}</span>
                  <span className="text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">
                    {rev.source || 'Verified Student'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* H. MEDIA GALLERY PREVIEW (With Proper Video Cover Fix) */}
      {previewMedia.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-orange-600">
                Academy Highlights
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 mt-1">
                Media & Video Gallery
              </h2>
            </div>
            <button
              onClick={() => {
                setCurrentPage('media');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="text-xs font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1 cursor-pointer"
            >
              <span>Explore Gallery</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {previewMedia.map((item) => {
              const isVideo = item.media_type === 'video';
              const yId = isVideo ? extractYouTubeId(item.youtube_url || item.youtube_video_id) : null;
              const coverSrc = item.cover_image_url || getYouTubeThumbnail(yId);

              return (
                <div
                  key={item.id}
                  className="group relative rounded-2xl overflow-hidden bg-slate-900 shadow-md aspect-16/10 cursor-pointer border border-slate-200"
                  onClick={() => {
                    if (isVideo && item.youtube_url) {
                      openVideoModal(item.youtube_url, item.title);
                    } else {
                      setCurrentPage('media');
                    }
                  }}
                >
                  <img
                    src={coverSrc}
                    alt={item.alt_text || item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex flex-col justify-end p-4 text-white">
                    <p className="text-xs font-bold truncate">{item.title}</p>
                    {item.caption && (
                      <p className="text-[11px] text-slate-300 truncate mt-0.5">{item.caption}</p>
                    )}
                  </div>
                  {isVideo && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-orange-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-orange-500 transition-all">
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* I. APPLY NOW CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-r from-orange-600 via-orange-500 to-amber-600 rounded-3xl p-8 sm:p-12 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="space-y-2 max-w-xl text-center md:text-left">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Ready to Speak with Confidence?
            </h2>
            <p className="text-sm text-orange-100">
              Submit your application online. Our admissions team will review your details and confirm your admission via email.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                setCurrentPage('apply');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="px-7 py-3.5 rounded-xl bg-white text-orange-600 font-bold text-sm shadow-md hover:bg-orange-50 transition-all cursor-pointer"
            >
              Start Online Application →
            </button>
            <button
              onClick={() => openCallbackModal('Admission Enquiry')}
              className="px-5 py-3.5 rounded-xl bg-black/20 hover:bg-black/30 text-white font-semibold text-sm transition-all cursor-pointer"
            >
              Request a Call
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
