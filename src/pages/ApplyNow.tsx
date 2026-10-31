import React, { useState } from 'react';
import { Program } from '../types';
import { compressPassportPhoto } from '../lib/imageCompressor';
import { MAX_APPLICATION_PHOTO_BYTES } from '../../application-photo-storage';
import { CheckCircle2, AlertCircle, Upload, ArrowRight, ShieldCheck, FileCheck, RefreshCw } from 'lucide-react';
import { isValidContactEmail, normalizeIndianMobileNumber } from '../../contact-validation';
import { ContactValidationMessage, useContactDuplicateValidation } from '../hooks/useContactDuplicateValidation';

interface ApplyNowProps {
  programs: Program[];
  selectedProgram: Program | null;
  setCurrentPage: (page: string) => void;
}

export const ApplyNow: React.FC<ApplyNowProps> = ({
  programs,
  selectedProgram,
  setCurrentPage,
}) => {
  const publishedPrograms = programs.filter((p) => p.is_published);

  // Form states
  const [studentName, setStudentName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [qualification, setQualification] = useState('');
  const [programId, setProgramId] = useState(
    selectedProgram ? selectedProgram.id : (publishedPrograms[0]?.id || '')
  );
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(true);

  // Photo state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoSizeKB, setPhotoSizeKB] = useState<number | null>(null);
  const [photoSizeBytes, setPhotoSizeBytes] = useState<number | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState<string>('image/jpeg');
  const [photoCompressionMessage, setPhotoCompressionMessage] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  // Submission states
  const [submitting, setSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const contactValidation = useContactDuplicateValidation(email, mobile);

  // Handle Photo Selection & Compression (Strict <= 300 KB)
  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    setErrorMessage(null);
    if (!file || compressing || submitting) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setErrorMessage(`Please upload a valid image (JPEG, PNG, or WebP).${photoPreview ? ' Your previously selected photo is still selected.' : ''}`);
      return;
    }

    try {
      setCompressing(true);
      // Run browser canvas compression with 300 KB limit
      const compressed = await compressPassportPhoto(file, MAX_APPLICATION_PHOTO_BYTES);
      setPhotoFile(file);
      setPhotoPreview(compressed.base64);
      setPhotoSizeKB(compressed.sizeKB);
      setPhotoSizeBytes(compressed.sizeBytes);
      setPhotoMimeType(compressed.mimeType);
      setPhotoCompressionMessage(file.size > MAX_APPLICATION_PHOTO_BYTES
        ? `Photo automatically compressed from ${Math.ceil(file.size / 1024)} KB to ${Math.ceil(compressed.sizeBytes / 1024)} KB.`
        : null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error processing the selected photo.';
      setErrorMessage(`${message}${photoPreview ? ' Your previously selected photo is still selected.' : ''}`);
    } finally {
      setCompressing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Client-side validations
    if (!studentName.trim()) {
      setErrorMessage('Student full name is required.');
      return;
    }
    if (!normalizeIndianMobileNumber(mobile)) {
      setErrorMessage('Please provide a valid Indian mobile number.');
      return;
    }
    if (!isValidContactEmail(email)) {
      setErrorMessage('A valid email address is mandatory to receive confirmation and admission decisions.');
      return;
    }
    if (!qualification.trim()) {
      setErrorMessage('Student qualification is required.');
      return;
    }
    if (compressing) {
      setErrorMessage('Please wait for photo processing to finish.');
      return;
    }
    if (!photoPreview || photoSizeBytes === null) {
      setErrorMessage('A passport-size photograph (300 KB or less) is required.');
      return;
    }
    if (photoSizeBytes !== null && photoSizeBytes > MAX_APPLICATION_PHOTO_BYTES) {
      setErrorMessage(`Photograph size (${photoSizeKB} KB) exceeds the 300 KB maximum limit. Please re-upload.`);
      return;
    }
    if (!privacyConsent) {
      setErrorMessage('You must agree to the privacy policy to submit your application.');
      return;
    }

    const [emailResult, mobileResult] = await Promise.all([
      contactValidation.validateEmail(email),
      contactValidation.validateMobile(mobile),
    ]);
    if (emailResult.error || mobileResult.error) {
      setErrorMessage(emailResult.error || mobileResult.error || 'Unable to verify your contact information. Please try again.');
      return;
    }

    const currentProgram = programs.find((p) => p.id === programId);
    const progTitle = currentProgram ? currentProgram.title : 'Spoken English Course';

    setSubmitting(true);

    try {
      const response = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_name: studentName,
          mobile,
          email,
          qualification,
          program_id: programId,
          program_name: progTitle,
          date_of_birth: dateOfBirth || null,
          address: address || null,
          message: message || null,
          photo_base64: photoPreview,
          photo_mime_type: photoMimeType,
          privacy_consent: privacyConsent,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit application. Please retry.');
      }

      setSubmissionSuccess(true);
      window.scrollTo({ top: 100, behavior: 'smooth' });
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to process application. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {submissionSuccess ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-12 shadow-xl text-center space-y-6">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
            <CheckCircle2 className="w-12 h-12" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-extrabold text-slate-950">Request Received</h1>
            <p className="text-sm text-slate-600 max-w-lg mx-auto">
              Thank you. If we can process your request, the academy will contact you using the details provided.
            </p>
          </div>

          <div className="pt-4 flex justify-center gap-4">
            <button
              onClick={() => {
                setSubmissionSuccess(false);
                setStudentName('');
                setMobile('');
                setEmail('');
                setQualification('');
                setPhotoFile(null);
                setPhotoPreview(null);
                setPhotoSizeKB(null);
                setPhotoSizeBytes(null);
                setPhotoCompressionMessage(null);
              }}
              className="px-6 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
            >
              Submit Another Application
            </button>
            <button
              onClick={() => setCurrentPage('home')}
              className="px-6 py-2.5 rounded-xl bg-orange-600 text-white text-xs font-bold hover:bg-orange-500 cursor-pointer"
            >
              Return to Homepage
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-orange-600 to-orange-500 p-8 text-white">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-xs font-bold uppercase tracking-wider mb-2">
              <ShieldCheck className="w-4 h-4 text-white" />
              <span>Official Admission Form</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Apply to Uptrend’s English Academy
            </h1>
            <p className="text-xs sm:text-sm text-orange-100 mt-1 max-w-2xl">
              Fill out the required information below to apply for our spoken English and communication training programs in Davangere.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-8 sm:p-10 space-y-8">
            {errorMessage && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800 text-xs">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <strong className="block font-bold">Submission Notice:</strong>
                  <span>{errorMessage}</span>
                </div>
              </div>
            )}

            {/* Section 1: Student Information */}
            <div className="space-y-4">
              <h2 className="text-base font-extrabold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 text-xs flex items-center justify-center font-bold">
                  1
                </span>
                <span>Personal & Academic Details</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Student Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="Enter student's legal name"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Mobile Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    onBlur={() => void contactValidation.validateMobile(mobile)}
                    aria-invalid={contactValidation.mobileCheck.duplicate || Boolean(contactValidation.mobileCheck.error)}
                    aria-describedby="application-mobile-validation"
                    placeholder="+91 98765 43210"
                    className={`w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${contactValidation.mobileCheck.duplicate || contactValidation.mobileCheck.error ? 'border-rose-600' : 'border-slate-300'}`}
                  />
                  <ContactValidationMessage id="application-mobile-validation" state={contactValidation.mobileCheck} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Email Address (Mandatory for updates) *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => void contactValidation.validateEmail(email)}
                    aria-invalid={contactValidation.emailCheck.duplicate || Boolean(contactValidation.emailCheck.error)}
                    aria-describedby="application-email-validation"
                    placeholder="student@example.com"
                    className={`w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 ${contactValidation.emailCheck.duplicate || contactValidation.emailCheck.error ? 'border-rose-600' : 'border-slate-300'}`}
                  />
                  <ContactValidationMessage id="application-email-validation" state={contactValidation.emailCheck} />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Confirmation & approval notifications will be delivered to this address.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Student Qualification *
                  </label>
                  <input
                    type="text"
                    required
                    value={qualification}
                    onChange={(e) => setQualification(e.target.value)}
                    placeholder="e.g. SSLC / PUC / Graduate / Working"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Selected Program *
                  </label>
                  <select
                    value={programId}
                    onChange={(e) => setProgramId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 bg-white"
                  >
                    {programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} {p.level ? `(${p.level})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Date of Birth (Optional)
                  </label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Residential Address (Optional)
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Area / Locality in Davangere or outside"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Additional Message or Learning Goals (Optional)
                </label>
                <textarea
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what you hope to achieve (e.g. interview preparation, fluency, grammar)..."
                  className="w-full px-4 py-2 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500 resize-none"
                />
              </div>
            </div>

            {/* Section 2: Passport-Size Photograph (Strict <= 300 KB requirement) */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h2 className="text-base font-extrabold text-slate-900 border-b border-slate-100 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 text-xs flex items-center justify-center font-bold">
                    2
                  </span>
                  <span>Passport-Size Photograph *</span>
                </div>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                  Strictly ≤ 300 KB
                </span>
              </h2>

              <p className="text-xs text-slate-500">
                Upload a recent front-facing passport photograph. Supported formats: JPEG, PNG, WebP. The photo will automatically be compressed to under 300 KB.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
                <div className="sm:col-span-8">
                  <label className="border-2 border-dashed border-slate-300 hover:border-orange-500 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-slate-50/50 hover:bg-orange-50/20">
                    <Upload className="w-8 h-8 text-slate-400 mb-2" />
                    <span className="text-xs font-bold text-slate-800">
                      Click to choose photo or drag & drop
                    </span>
                    <span className="text-[11px] text-slate-500 mt-1">
                      JPEG, PNG, WebP (Max 300 KB compressed)
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePhotoChange}
                      disabled={compressing || submitting}
                      className="hidden"
                    />
                  </label>
                  {compressing && (
                    <div className="flex items-center gap-2 mt-2 text-xs text-orange-600">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Processing photo and checking the 300 KB limit...</span>
                    </div>
                  )}
                </div>

                <div className="sm:col-span-4 flex flex-col items-center justify-center">
                  {photoPreview ? (
                    <div className="space-y-2 text-center">
                      <div className="w-28 h-36 rounded-xl overflow-hidden border-2 border-emerald-500 shadow-md mx-auto relative bg-slate-100">
                        <img
                          src={photoPreview}
                          alt="Passport preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                        <FileCheck className="w-3 h-3" />
                        <span>Ready: {photoSizeKB} KB (≤ 300 KB)</span>
                      </div>
                      {photoCompressionMessage && <p role="status" className="text-[11px] font-semibold text-blue-700">{photoCompressionMessage}</p>}
                    </div>
                  ) : (
                    <div className="w-28 h-36 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 text-center p-2 bg-slate-50">
                      <span className="text-[11px]">Photo Preview (Passport)</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Section 3: Privacy Consent */}
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <input
                  type="checkbox"
                  id="privacy"
                  required
                  checked={privacyConsent}
                  onChange={(e) => setPrivacyConsent(e.target.checked)}
                  className="mt-1 h-4 w-4 text-orange-600 rounded-sm border-slate-300 focus:ring-orange-500"
                />
                <label htmlFor="privacy" className="text-xs text-slate-700 leading-relaxed cursor-pointer">
                  <strong>Privacy Consent:</strong> I confirm that the details and photograph provided above are accurate and belong to me. I authorize Uptrend’s English Academy to store these details securely in the database and contact me regarding my admission status.
                </label>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={submitting || compressing}
                className="form-submit-button w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white font-extrabold text-base shadow-lg shadow-orange-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    <span role="status" aria-live="polite">Saving application &amp; sending confirmation...</span>
                  </>
                ) : (
                  <>
                    <span>Submit Student Application</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
              <p className="text-center text-[11px] text-slate-400 mt-2">
                Upon saving, you will receive your database-generated Application Number (UEA-APP-YYYY-0001).
              </p>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
