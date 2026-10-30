import React from 'react';
import { MapPin, Phone, Mail, Clock, Compass } from 'lucide-react';
import { ApplicationCTA } from '../components/ApplicationCTA';
import { AcademyMapPreview } from '../components/AcademyMapPreview';

interface ContactUsProps {
  openDemoClassModal: () => void;
  openCallbackModal: (programName?: string) => void;
}

export const ContactUs: React.FC<ContactUsProps> = ({ openDemoClassModal, openCallbackModal }) => {
  return (
    <div className="space-y-16 py-12">
      {/* Header */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 text-orange-800 text-xs font-bold uppercase tracking-wider">
            <MapPin className="w-4 h-4 text-orange-600" />
            <span>Davangere Campus</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-950 tracking-tight">
            Contact & Location Details
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">
            Reach out to our academic team or visit our learning centre at Ram And Co Circle, Davangere.
          </p>
        </div>
      </section>

      {/* Main Section: Contact Info + Academy Location */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Academy Details */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-slate-200/80 shadow-md space-y-6">
              <h2 className="text-2xl font-extrabold text-slate-900 border-b border-slate-100 pb-4">
                Academy Information
              </h2>
              <p className="-mt-4 text-sm font-bold text-slate-800">
                Uptrend's English Academy
              </p>

              <div className="space-y-4 text-sm text-slate-700">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-orange-100 text-orange-600 shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <strong className="block text-slate-900 mb-0.5">Address:</strong>
                    <p className="text-xs leading-relaxed text-slate-600">
                      #259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, opposite Ganesha Temple, above Sangeetha Mobiles, Prince Jayachamaraja Wodeyar, Davangere, Karnataka 577002, India
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-600 shrink-0">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <strong className="block text-slate-900 mb-0.5">Phone Number:</strong>
                    <a
                      href="tel:+919008000211"
                      className="text-xs font-bold text-emerald-700 hover:underline"
                    >
                      +91 900 8000 211
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-amber-100 text-amber-600 shrink-0">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div>
                    <strong className="block text-slate-900 mb-0.5">Email Address:</strong>
                    <a
                      href="mailto:uptrendsinstitute@gmail.com"
                      className="text-xs font-bold text-orange-600 hover:underline"
                    >
                      uptrendsinstitute@gmail.com
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-slate-100 text-slate-600 shrink-0">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div className="w-full">
                    <strong className="block text-slate-900 mb-0.5">Regular Business Hours:</strong>
                    <div className="text-xs space-y-1 pt-1 text-slate-600">
                      <div className="flex justify-between">
                        <span>Monday – Saturday:</span>
                        <span className="font-semibold text-slate-900">8:00 AM – 8:30 PM</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Sunday:</span>
                        <span className="font-semibold text-rose-600">Closed</span>
                      </div>
                      <p className="text-[11px] text-slate-400 italic pt-1">
                        *Supplied regular business hours.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Landmark Guidance */}
              <div className="p-4 rounded-2xl bg-orange-50 border border-orange-100 text-xs text-orange-900 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <Compass className="w-4 h-4 text-orange-600" />
                  <span>Landmarks in Davangere:</span>
                </p>
                <p className="text-orange-800 text-[11px] leading-relaxed">
                  Located at Ram And Co Circle, above Sangeetha Mobiles on the 2nd Floor of Devi Building, opposite the Ganesha Temple.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 min-w-0">
            <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200/80 shadow-md space-y-5">
              <div>
                <h2 className="text-2xl font-extrabold text-slate-900">Find Our Academy</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Visit Uptrend's English Academy in Davangere.
                </p>
              </div>
              <AcademyMapPreview />
            </div>
          </div>
        </div>
      </section>
      <ApplicationCTA
        openDemoClassModal={openDemoClassModal}
        openCallbackModal={openCallbackModal}
      />
    </div>
  );
};
