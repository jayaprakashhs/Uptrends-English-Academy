import React, { useState } from 'react';
import { FAQ } from '../types';
import { HelpCircle, ChevronDown, ChevronUp, Search, MessageSquare, PhoneCall } from 'lucide-react';

interface FAQsProps {
  faqs: FAQ[];
  openCallbackModal: () => void;
  setCurrentPage: (page: string) => void;
}

export const FAQs: React.FC<FAQsProps> = ({ faqs, openCallbackModal, setCurrentPage }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [search, setSearch] = useState('');

  const publishedFaqs = faqs.filter((f) => f.is_published);

  const filteredFaqs = publishedFaqs.filter(
    (f) =>
      f.question.toLowerCase().includes(search.toLowerCase()) ||
      f.answer.toLowerCase().includes(search.toLowerCase())
  );

  const toggleAccordion = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <div className="space-y-12 py-12">
      {/* Header */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 text-orange-800 text-xs font-bold uppercase tracking-wider">
            <HelpCircle className="w-4 h-4 text-orange-600" />
            <span>Got Questions?</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-950 tracking-tight">
            Frequently Asked Questions
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">
            Find answers to common questions about admissions, courses, learning approach, and visiting our academy in Davangere.
          </p>
        </div>

        {/* Search */}
        <div className="max-w-xl mx-auto mt-8 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions (e.g., location, hours, spoken English)..."
            className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 bg-white shadow-xs text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
          />
        </div>
      </section>

      {/* Accordion List */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {filteredFaqs.length > 0 ? (
          <div className="space-y-3">
            {filteredFaqs.map((faq, idx) => {
              const isOpen = openIndex === idx;
              return (
                <div
                  key={faq.id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden transition-all duration-200"
                >
                  <button
                    onClick={() => toggleAccordion(idx)}
                    className="w-full flex items-center justify-between p-5 sm:p-6 text-left cursor-pointer focus:outline-hidden"
                  >
                    <span className="font-bold text-slate-900 text-sm sm:text-base pr-4">
                      {faq.question}
                    </span>
                    <span className="p-1 rounded-full bg-slate-100 text-slate-600 shrink-0">
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-6 sm:px-6 sm:pb-6 text-xs sm:text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-4 bg-slate-50/50">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 p-6">
            <p className="text-sm font-semibold text-slate-700">No questions found matching your search.</p>
          </div>
        )}
      </section>

      {/* Still Have Questions CTA */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-r from-emerald-800 to-slate-900 rounded-3xl p-8 text-white flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xl">
          <div className="space-y-1 text-center sm:text-left">
            <h3 className="text-xl font-bold">Have another question?</h3>
            <p className="text-xs text-emerald-200">
              Our academic counselors are happy to answer your inquiries.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={openCallbackModal}
              className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Request a Call</span>
            </button>
            <button
              onClick={() => {
                setCurrentPage('contact');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Contact Us</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
