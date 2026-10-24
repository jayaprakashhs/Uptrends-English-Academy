import React from 'react';
import { Logo } from './Logo';
import { MapPin, Phone, Mail, Clock, ArrowUpRight, ShieldCheck, Heart } from 'lucide-react';

import { SiteBranding } from '../types';

interface FooterProps {
  setCurrentPage: (page: string) => void;
  openCallbackModal: () => void;
  branding?: SiteBranding | null;
}

export const Footer: React.FC<FooterProps> = ({
  setCurrentPage,
  openCallbackModal,
  branding,
}) => {
  const handleNav = (page: string) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-slate-950 text-slate-300 pt-16 pb-12 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          {/* Column 1: Brand & Purpose */}
          <div className="space-y-4">
            <Logo
              variant="white"
              size="md"
              logoUrl={branding?.footer_logo_url || branding?.logo_url}
              altText={branding?.main_logo_alt || branding?.logo_alt}
            />
            <p className="text-sm text-slate-400 leading-relaxed pt-2">
              Davangere’s dedicated training center for spoken English, grammar fundamentals, and professional communication skills. Over two decades of empowering confident speakers.
            </p>
            <div className="pt-2">
              <button
                onClick={openCallbackModal}
                className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-md bg-orange-600 hover:bg-orange-500 text-white transition-colors cursor-pointer"
              >
                <span>Request a Callback</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Column 2: Navigation Links */}
          <div>
            <h4 className="text-white text-sm font-bold uppercase tracking-wider mb-4 border-l-2 border-orange-500 pl-2">
              Quick Links
            </h4>
            <ul className="space-y-2 text-sm">
              <li>
                <button
                  onClick={() => handleNav('home')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  Home
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('about')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  About Us & Philosophy
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('programs')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  English Programs
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('reviews')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  Student Reviews
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('media')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  Media & Video Gallery
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('faqs')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  FAQs
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('contact')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  Contact & Location
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('apply')}
                  className="text-emerald-400 font-semibold hover:text-emerald-300 transition-colors"
                >
                  Apply for Admission →
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: Contact Details */}
          <div>
            <h4 className="text-white text-sm font-bold uppercase tracking-wider mb-4 border-l-2 border-emerald-500 pl-2">
              Contact Academy
            </h4>
            <ul className="space-y-3 text-sm text-slate-400">
              <li className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                <span className="leading-snug">
                  #259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, opposite Ganesha Temple, above Sangeetha Mobiles, Prince Jayachamaraja Wodeyar, Davangere, Karnataka 577002, India
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
                <a href="tel:+919008000211" className="hover:text-white transition-colors">
                  +91 900 8000 211
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-orange-400 shrink-0" />
                <a href="mailto:uptrendsinstitute@gmail.com" className="hover:text-white transition-colors">
                  uptrendsinstitute@gmail.com
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: Regular Business Hours */}
          <div>
            <h4 className="text-white text-sm font-bold uppercase tracking-wider mb-4 border-l-2 border-orange-500 pl-2">
              Regular Hours
            </h4>
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 text-xs space-y-2">
              <div className="flex items-center gap-2 text-slate-300 font-semibold mb-2">
                <Clock className="w-4 h-4 text-orange-400" />
                <span>Academy Schedule</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Monday – Saturday</span>
                <span className="text-white font-medium">8:00 AM – 8:30 PM</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Sunday</span>
                <span className="text-rose-400 font-semibold">Closed</span>
              </div>
              <p className="text-[11px] text-slate-500 pt-2 italic">
                *Supplied regular academy hours, subject to holiday schedules.
              </p>
            </div>

            <div className="mt-4">
              <button
                onClick={() => handleNav('admin')}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Authorized Admin Portal
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 mt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <p>© {new Date().getFullYear()} Uptrend’s English Academy. All rights reserved. Davangere, Karnataka.</p>
          <div className="flex items-center gap-6">
            <span>English Language School & Spoken English Training Center</span>
            <span className="text-slate-700">|</span>
            <span className="flex items-center gap-1 text-slate-400">
              Built with excellence for Davangere
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};
