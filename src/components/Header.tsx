import React, { useState } from 'react';
import { Logo } from './Logo';
import { Menu, X, PhoneCall, ArrowRight, ShieldCheck, Phone } from 'lucide-react';

import { SiteBranding } from '../types';

interface HeaderProps {
  currentPage: string;
  setCurrentPage: (page: string) => void;
  openCallbackModal: (programName?: string) => void;
  branding?: SiteBranding | null;
}

export const Header: React.FC<HeaderProps> = ({
  currentPage,
  setCurrentPage,
  openCallbackModal,
  branding,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { id: 'home', label: 'Home' },
    { id: 'about', label: 'About Us' },
    { id: 'programs', label: 'Programs' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'media', label: 'Media Gallery' },
    { id: 'faqs', label: 'FAQs' },
    { id: 'contact', label: 'Contact Us' },
  ];

  const handleNavigate = (page: string) => {
    setCurrentPage(page);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 transition-all shadow-xs">
      {/* Top quick-contact micro bar */}
      <div className="hidden lg:block bg-slate-900 text-slate-300 py-1.5 px-4 text-xs font-medium">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              Admissions Open in Davangere
            </span>
            <span className="text-slate-500">|</span>
            <a
              href="tel:+919008000211"
              className="flex items-center gap-1.5 hover:text-white transition-colors"
            >
              <Phone className="w-3.5 h-3.5 text-orange-400" />
              +91 900 8000 211
            </a>
            <span className="text-slate-500">|</span>
            <span>Mon–Sat: 8:00 AM – 8:30 PM (Sun Closed)</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => handleNavigate('admin')}
              className="flex items-center gap-1 text-slate-400 hover:text-orange-400 transition-colors text-xs"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Admin Portal
            </button>
          </div>
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <button
            onClick={() => handleNavigate('home')}
            className="flex items-center text-left focus:outline-hidden focus:ring-2 focus:ring-orange-500 rounded-lg p-1"
          >
            <Logo
              size="md"
              logoUrl={branding?.logo_url}
              altText={branding?.main_logo_alt || branding?.logo_alt}
            />
          </button>

          {/* Desktop Nav Links */}
          <nav className="hidden xl:flex items-center space-x-1">
            {navLinks.map((link) => {
              const isActive = currentPage === link.id;
              return (
                <button
                  key={link.id}
                  onClick={() => handleNavigate(link.id)}
                  className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors duration-150 cursor-pointer ${
                    isActive
                      ? 'text-orange-600 bg-orange-50/80 font-bold'
                      : 'text-slate-700 hover:text-orange-600 hover:bg-slate-50'
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </nav>

          {/* Action Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => openCallbackModal()}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold text-slate-700 hover:text-orange-600 border border-slate-300 hover:border-orange-500 bg-white transition-all shadow-xs cursor-pointer"
            >
              <PhoneCall className="w-4 h-4 text-orange-600" />
              <span>Request a Call</span>
            </button>

            <button
              onClick={() => handleNavigate('apply')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all cursor-pointer ${
                currentPage === 'apply'
                  ? 'bg-emerald-700 text-white ring-2 ring-emerald-500 ring-offset-2'
                  : 'bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white hover:shadow-md'
              }`}
            >
              <span>Apply Now</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2 xl:hidden">
            <button
              onClick={() => openCallbackModal()}
              className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg border border-orange-200 md:hidden"
              title="Request a Call"
            >
              <PhoneCall className="w-5 h-5" />
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-slate-700 hover:text-orange-600 hover:bg-slate-100 rounded-lg focus:outline-hidden"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="xl:hidden bg-white border-b border-slate-200 px-4 pt-2 pb-6 space-y-2 shadow-xl animate-in fade-in slide-in-from-top duration-200">
          <div className="grid grid-cols-1 gap-1">
            {navLinks.map((link) => (
              <button
                key={link.id}
                onClick={() => handleNavigate(link.id)}
                className={`text-left px-4 py-3 rounded-lg text-base font-semibold transition-colors ${
                  currentPage === link.id
                    ? 'bg-orange-50 text-orange-600 font-bold border-l-4 border-orange-500'
                    : 'text-slate-800 hover:bg-slate-50'
                }`}
              >
                {link.label}
              </button>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2.5">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                openCallbackModal();
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-slate-800 border border-slate-300 bg-slate-50"
            >
              <PhoneCall className="w-4 h-4 text-orange-600" />
              <span>Request a Call</span>
            </button>

            <button
              onClick={() => handleNavigate('apply')}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-base font-bold bg-orange-600 text-white shadow-sm"
            >
              <span>Apply Now</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => handleNavigate('admin')}
              className="w-full text-center text-xs text-slate-500 hover:text-slate-800 py-2"
            >
              Admin Portal
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
