import React, { useState } from 'react';
import { MapPin, Phone, Mail, Clock, Send, CheckCircle2, AlertCircle, Compass } from 'lucide-react';

export const ContactUs: React.FC = () => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(true);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim() || !email.trim() || !subject.trim() || !message.trim()) {
      setError('Please fill in all required fields.');
      return;
    }

    if (!consent) {
      setError('Please agree to allow the academy to reply to your enquiry.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          email,
          mobile,
          subject,
          message,
          consent,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send message.');
      }

      setSuccess(true);
      setFullName('');
      setEmail('');
      setMobile('');
      setSubject('');
      setMessage('');
    } catch (err: any) {
      setError(err.message || 'Error sending message. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
            Reach out to our academic team or visit our central Davangere learning center at Ram And Co Circle.
          </p>
        </div>
      </section>

      {/* Main Section: Contact Info + Form */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Academy Details */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-slate-200/80 shadow-md space-y-6">
              <h2 className="text-2xl font-extrabold text-slate-900 border-b border-slate-100 pb-4">
                Academy Information
              </h2>

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
                  Located directly at Ram And Co Circle, right above Sangeetha Mobiles on the 2nd Floor of Devi Building, opposite the Ganesha Temple.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Contact Enquiries Form */}
          <div className="lg:col-span-7">
            <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200/80 shadow-md">
              <h2 className="text-2xl font-extrabold text-slate-900 mb-2">Send an Enquiry</h2>
              <p className="text-xs text-slate-600 mb-6">
                Have an inquiry about training programs, faculty, or admission? Send us a message and our team will respond promptly.
              </p>

              {success ? (
                <div className="py-12 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">Message Delivered!</h3>
                  <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto">
                    Thank you for reaching out to Uptrend’s English Academy. We have logged your enquiry and our staff will reply to your registered email.
                  </p>
                  <button
                    onClick={() => setSuccess(false)}
                    className="px-6 py-2.5 bg-orange-600 text-white rounded-xl text-xs font-bold hover:bg-orange-700 transition-colors"
                  >
                    Send Another Message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-700 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Your full name"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Mobile Number (Optional)
                      </label>
                      <input
                        type="tel"
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="+91 98765 43210"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Subject *
                      </label>
                      <input
                        type="text"
                        required
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="e.g. Spoken English Course Enquiry"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Message *
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Please write your message or query here..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 resize-none"
                    />
                  </div>

                  <div className="flex items-start gap-2.5 pt-1">
                    <input
                      type="checkbox"
                      id="contact-consent"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-1 h-4 w-4 text-orange-600 rounded-sm border-slate-300 focus:ring-orange-500"
                    />
                    <label htmlFor="contact-consent" className="text-xs text-slate-600 leading-tight">
                      I consent to Uptrend’s English Academy processing my details to respond to this inquiry.
                    </label>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3.5 px-6 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {loading ? (
                        <span>Sending message...</span>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <span>Send Contact Enquiry</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
