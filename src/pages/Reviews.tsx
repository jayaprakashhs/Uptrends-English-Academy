import React, { useState } from 'react';
import { MessageSquareQuote } from 'lucide-react';
import { SociableKitGoogleReviews } from '../components/SociableKitGoogleReviews';
import { ApplicationCTA } from '../components/ApplicationCTA';

interface ReviewsProps {
  openDemoClassModal: () => void;
  openCallbackModal: (programName?: string) => void;
}

export const Reviews: React.FC<ReviewsProps> = ({ openDemoClassModal, openCallbackModal }) => {
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

        <section className="mt-8 min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5" aria-label="Google Reviews">
          <SociableKitGoogleReviews />
        </section>

      </section>
      <ApplicationCTA
        openDemoClassModal={openDemoClassModal}
        openCallbackModal={openCallbackModal}
      />
    </div>
  );
};
