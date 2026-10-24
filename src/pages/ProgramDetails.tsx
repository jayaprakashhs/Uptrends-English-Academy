import React from 'react';
import { Program } from '../types';
import { ArrowLeft, Users, Clock, Award, PhoneCall, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';

interface ProgramDetailsProps {
  program: Program | null;
  setCurrentPage: (page: string) => void;
  openCallbackModal: (programName?: string) => void;
}

export const ProgramDetails: React.FC<ProgramDetailsProps> = ({
  program,
  setCurrentPage,
  openCallbackModal,
}) => {
  if (!program) {
    return (
      <div className="max-w-3xl mx-auto py-20 px-4 text-center">
        <p className="text-slate-600 mb-4">No program selected.</p>
        <button
          onClick={() => setCurrentPage('programs')}
          className="px-5 py-2.5 bg-orange-600 text-white font-bold text-sm rounded-xl"
        >
          Back to Programs Catalogue
        </button>
      </div>
    );
  }

  const handleApply = () => {
    setCurrentPage('apply');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
      {/* Back button */}
      <button
        onClick={() => {
          setCurrentPage('programs');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-orange-600 transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Programs Catalogue</span>
      </button>

      {/* Main Detail Header */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="relative aspect-21/9 bg-slate-900 max-h-80">
          <img
            src={
              program.image_url ||
              'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=1200&q=80'
            }
            alt={program.title}
            className="w-full h-full object-cover opacity-90"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent flex items-end p-6 sm:p-10 text-white">
            <div className="space-y-2">
              {program.level && (
                <span className="px-3 py-1 rounded-md bg-orange-600 text-white text-xs font-bold uppercase tracking-wider">
                  Level: {program.level}
                </span>
              )}
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white">
                {program.title}
              </h1>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 sm:p-10 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase">Intended Audience</p>
                <p className="text-sm font-semibold text-slate-900">{program.target_audience}</p>
              </div>
            </div>

            {program.duration && (
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase">Estimated Duration</p>
                  <p className="text-sm font-semibold text-slate-900">{program.duration}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <Award className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase">Training Location</p>
                <p className="text-sm font-semibold text-slate-900">Davangere Center</p>
              </div>
            </div>
          </div>

          {program.age_range && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              <strong>Age Requirement Notice:</strong> {program.age_range}
            </div>
          )}

          {/* Description */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-slate-950">About This Program</h2>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {program.description}
            </p>
          </div>

          {/* Training Focus */}
          <div className="space-y-4 pt-4 border-t border-slate-100">
            <h2 className="text-xl font-bold text-slate-950">Key Communication Focus</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-700">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-50/60 border border-orange-100">
                <CheckCircle2 className="w-4 h-4 text-orange-600 shrink-0" />
                <span>Overcoming speaking hesitation & stage fear</span>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50/60 border border-emerald-100">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Correct sentence structure & functional grammar</span>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-teal-50/60 border border-teal-100">
                <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                <span>Vocabulary expansion for day-to-day conversation</span>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50/60 border border-amber-100">
                <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Clear pronunciation and interactive dialogues</span>
              </div>
            </div>
          </div>

          {/* Direct Actions */}
          <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Direct application review by authorized academy staff</span>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                onClick={() => openCallbackModal(program.title)}
                className="w-full sm:w-auto px-5 py-3 rounded-xl border border-slate-300 hover:border-orange-500 text-slate-800 hover:text-orange-600 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <PhoneCall className="w-4 h-4 text-orange-600" />
                <span>Request a Call</span>
              </button>

              <button
                onClick={handleApply}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Apply for Admission</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
