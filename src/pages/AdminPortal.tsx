import React, { useState, useEffect } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import {
  DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
  type OfficialDocumentSettings,
} from '../../official-document';


import {
  AdminProfile,
  AdminRole,
  StudentApplication,
  ApplicationNotification,
  CallbackRequest,
  ContactEnquiry,
  Program,
  Announcement,
  Review,
  MediaItem,
  FAQ,
  SiteBranding,
} from '../types';
import {
  LayoutDashboard,
  Users,
  FileText,
  PhoneCall,
  Mail,
  BookOpen,
  Volume2,
  Video,
  HelpCircle,
  Settings,
  ShieldAlert,
  LogOut,
  Search,
  Filter,
  RefreshCw,
  CheckCircle,
  XCircle,
  Eye,
  Trash2,
  Plus,
  Send,
  AlertTriangle,
  FileCheck,
  FileSpreadsheet,
  ChevronRight,
  Menu,
  X,
  ExternalLink,
  Palette,
  ShieldCheck,
} from 'lucide-react';
import { extractYouTubeId } from '../lib/youtube';
import { fetchSystemStatus, type IntegrationHealth, type SystemStatus } from '../lib/systemStatus';

interface AdminPortalProps {
  currentAdmin: AdminProfile;
  onLogout: () => void;
  setCurrentPage: (page: string) => void;
}

type PaymentStage = 'first_fee' | 'second_fee' | 'installment' | 'final_payment';
type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'card' | 'cheque' | 'other';

interface ApplicationFeeAgreement {
  id: string;
  application_id: string;
  agreed_total: number;
  currency: string;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface ApplicationPayment {
  id: string;
  application_id: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_stage: PaymentStage;
  recorded_at: string;
  reference_number: string | null;
  notes: string | null;
  recorded_by: string | null;
  updated_by: string | null;
  recorded_by_name?: string | null;
  updated_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface ApplicationPaymentData {
  application: {
    id: string;
    application_reference: string;
    student_name: string;
    program_name: string | null;
  };
  feeAgreement: ApplicationFeeAgreement | null;
  payments: ApplicationPayment[];
  totalPaid: number;
  remainingBalance: number | null;
}

const integrationStatusLabel = (health: IntegrationHealth | undefined, missingLabel: string): string => {
  if (!health) return 'Checking...';
  if (health.connected) return 'Connected';
  if (
    health.error_category &&
    health.error_category !== 'missing_configuration' &&
    health.error_category !== 'missing_or_invalid_configuration'
  ) {
    return `Issue: ${health.error_category}`;
  }
  if (!health.configured) return missingLabel;
  return `Issue: ${health.error_category || 'unavailable'}`;
};

const integrationStatusClass = (health: IntegrationHealth | undefined): string => {
  if (health?.connected) return 'bg-emerald-100 text-emerald-800';
  if (
    health?.error_category &&
    health.error_category !== 'missing_configuration' &&
    health.error_category !== 'missing_or_invalid_configuration'
  ) {
    return 'bg-amber-100 text-amber-800';
  }
  return health?.configured ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700';
};

export const AdminPortal: React.FC<AdminPortalProps> = ({
  currentAdmin,
  onLogout,
  setCurrentPage,
}) => {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Data states
  const [applications, setApplications] = useState<StudentApplication[]>([]);
  const [notifications, setNotifications] = useState<ApplicationNotification[]>([]);
  const [callbacks, setCallbacks] = useState<CallbackRequest[]>([]);
  const [contacts, setContacts] = useState<ContactEnquiry[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [editingReview, setEditingReview] = useState<Partial<Review> | null>(null);
  const [reviewSort, setReviewSort] = useState<'latest' | 'oldest'>('latest');
  const [reviewRatingFilter, setReviewRatingFilter] = useState<'All' | '1' | '2' | '3' | '4' | '5'>('All');
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [editingFaq, setEditingFaq] = useState<Partial<FAQ> | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [branding, setBranding] = useState<SiteBranding | null>(null);
  const [editingBranding, setEditingBranding] = useState<Partial<SiteBranding> | null>(null);
  
type JoiningInformationSettings = {
  joiningDate: string;
  classSchedule: string;
  classTimings: string;
  venue: string;
};

const DEFAULT_JOINING_INFORMATION: JoiningInformationSettings = {
  joiningDate: 'To be confirmed',
  classSchedule: 'Monday to Saturday',
  classTimings: 'To be confirmed',
  venue: 'Uptrends English Academy, Davangere',
};

const [officialDocumentSettings, setOfficialDocumentSettings] =
  useState<OfficialDocumentSettings & JoiningInformationSettings>({
    ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
    ...DEFAULT_JOINING_INFORMATION,
  });
const [officialPdfPreviewUrl, setOfficialPdfPreviewUrl] = useState<string | null>(null);
  const [adminProfiles, setAdminProfiles] = useState<AdminProfile[]>([]);
  const [mediaForm, setMediaForm] = useState<Partial<MediaItem> & { media_file_base64?: string; media_file_mime?: string; cover_file_base64?: string; cover_file_mime?: string }>({
    media_type: 'photo',
    title: '',
    caption: '',
    alt_text: '',
    youtube_url: '',
    cover_image_url: '',
    is_published: true,
    display_order: 0,
  });
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Selected item modal preview states
  const [selectedApp, setSelectedApp] = useState<StudentApplication | null>(null);
  const [applicationJoiningInfo, setApplicationJoiningInfo] = useState<JoiningInformationSettings>({ ...DEFAULT_JOINING_INFORMATION });
  const [paymentApp, setPaymentApp] = useState<StudentApplication | null>(null);
  const [paymentData, setPaymentData] = useState<ApplicationPaymentData | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [feeTotalInput, setFeeTotalInput] = useState('');
  const [feeNotesInput, setFeeNotesInput] = useState('');
  const [paymentAmountInput, setPaymentAmountInput] = useState('');
  const [paymentMethodInput, setPaymentMethodInput] = useState<PaymentMethod>('upi');
  const [paymentStageInput, setPaymentStageInput] = useState<PaymentStage>('first_fee');
  const [paymentReferenceInput, setPaymentReferenceInput] = useState('');
  const [paymentNotesInput, setPaymentNotesInput] = useState('');

  const [selectedCallback, setSelectedCallback] = useState<CallbackRequest | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactEnquiry | null>(null);
  const [appPhotoModal, setAppPhotoModal] = useState<string | null>(null);

  // Program Edit Modal State
  const [editingProgram, setEditingProgram] = useState<(Partial<Program> & { image_file_base64?: string }) | null>(null);
  const [viewingProgram, setViewingProgram] = useState<Program | null>(null);

  // Announcement New/Edit Modal State
  const [editingAnnouncement, setEditingAnnouncement] = useState<Partial<Announcement> | null>(null);

  // Search and filter states
  const [appSearch, setAppSearch] = useState('');
  const [appFilterStatus, setAppFilterStatus] = useState<'All' | 'Pending' | 'Accepted'>('All');
  const [callbackSearch, setCallbackSearch] = useState('');
  const [callbackFilterStatus, setCallbackFilterStatus] = useState<'All' | CallbackRequest['status']>('All');
  const [contactSearch, setContactSearch] = useState('');
  const [contactFilterStatus, setContactFilterStatus] = useState<'All' | ContactEnquiry['status']>('All');
  const [notifFilterStatus, setNotifFilterStatus] = useState<'All' | 'Pending' | 'Sent' | 'Failed'>('All');

  // Role permissions checking
  const isSuperAdmin = currentAdmin.role === 'super_admin';
  const isAdminOrHigher = currentAdmin.role === 'admin' || isSuperAdmin;

  const getAuthHeaders = (): Record<string, string> => {
    const token = currentAdmin.accessToken || sessionStorage.getItem('uptrends_access_token') || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const requestJson = async (url: string, init?: RequestInit): Promise<any> => {
    const response = await fetch(url, init);
    let data: any;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = data?.error || `Request failed (${response.status}).`;
      if (response.status === 401) throw new Error(`Your admin session has expired. Sign in again. (${message})`);
      if (response.status === 403) throw new Error(`You are not authorized to perform this action. (${message})`);
      throw new Error(message);
    }
    return data;
  };

  const loadApplicationPaymentData = async (app: StudentApplication) => {
    setPaymentApp(app);
    setPaymentData(null);
    setPaymentError(null);
    setPaymentLoading(true);
    setEditingPaymentId(null);

    try {
      const data = await requestJson(
        `/api/admin/applications/${encodeURIComponent(app.id)}/payments`,
        { method: 'GET', headers: getAuthHeaders() },
      );

      setPaymentData(data as ApplicationPaymentData);
      setFeeTotalInput(
        data?.feeAgreement?.agreed_total == null
          ? ''
          : String(data.feeAgreement.agreed_total),
      );
      setFeeNotesInput(data?.feeAgreement?.notes || '');
    } catch (error) {
      setPaymentError(
        error instanceof Error ? error.message : 'Unable to load payment records.',
      );
    } finally {
      setPaymentLoading(false);
    }
  };

  const saveAgreedFee = async () => {
    if (!paymentApp || !isAdminOrHigher) return;

    const agreedTotal = Number(feeTotalInput);
    if (!feeTotalInput.trim() || !Number.isFinite(agreedTotal) || agreedTotal < 0) {
      setPaymentError('Enter a valid agreed fee of zero or more.');
      return;
    }

    setPaymentSaving(true);
    setPaymentError(null);
    try {
      await requestJson(
        `/api/admin/applications/${encodeURIComponent(paymentApp.id)}/fee`,
        {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            agreed_total: Math.round(agreedTotal * 100) / 100,
            notes: feeNotesInput.trim() || null,
          }),
        },
      );
      await loadApplicationPaymentData(paymentApp);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Unable to save agreed fee.');
    } finally {
      setPaymentSaving(false);
    }
  };

  const resetPaymentForm = () => {
    setEditingPaymentId(null);
    setPaymentAmountInput('');
    setPaymentMethodInput('upi');
    setPaymentStageInput('first_fee');
    setPaymentReferenceInput('');
    setPaymentNotesInput('');
  };

  const savePaymentEntry = async () => {
    if (!paymentApp || !isAdminOrHigher) return;

    const amount = Number(paymentAmountInput);
    if (!paymentAmountInput.trim() || !Number.isFinite(amount) || amount <= 0) {
      setPaymentError('Enter a valid payment amount greater than zero.');
      return;
    }

    setPaymentSaving(true);
    setPaymentError(null);
    try {
      const isEditing = Boolean(editingPaymentId);
      const url = isEditing
        ? `/api/admin/payments/${encodeURIComponent(editingPaymentId as string)}`
        : `/api/admin/applications/${encodeURIComponent(paymentApp.id)}/payments`;

      await requestJson(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          amount: Math.round(amount * 100) / 100,
          payment_method: paymentMethodInput,
          payment_stage: paymentStageInput,
          reference_number: paymentReferenceInput.trim() || null,
          notes: paymentNotesInput.trim() || null,
        }),
      });

      resetPaymentForm();
      await loadApplicationPaymentData(paymentApp);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Unable to save payment.');
    } finally {
      setPaymentSaving(false);
    }
  };

  const beginEditPayment = (payment: ApplicationPayment) => {
    setEditingPaymentId(payment.id);
    setPaymentAmountInput(String(payment.amount));
    setPaymentMethodInput(payment.payment_method);
    setPaymentStageInput(payment.payment_stage);
    setPaymentReferenceInput(payment.reference_number || '');
    setPaymentNotesInput(payment.notes || '');
    setPaymentError(null);
  };

  const removePaymentEntry = async (payment: ApplicationPayment) => {
    if (!paymentApp || !isAdminOrHigher) return;

    const confirmed = window.confirm(
      `Delete the payment of ₹${Number(payment.amount).toFixed(2)} recorded on ${new Date(payment.recorded_at).toLocaleString('en-IN')}? This action will be audited.`,
    );
    if (!confirmed) return;

    setPaymentSaving(true);
    setPaymentError(null);
    try {
      await requestJson(`/api/admin/payments/${encodeURIComponent(payment.id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (editingPaymentId === payment.id) resetPaymentForm();
      await loadApplicationPaymentData(paymentApp);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Unable to delete payment.');
    } finally {
      setPaymentSaving(false);
    }
  };

  const notifyPublicDataChanged = () => window.dispatchEvent(new Event('admin-data-updated'));

  const fetchAllData = async () => {
    void fetchSystemStatus().then(setSystemStatus);
    setLoading(true);
    try {
      const headers = getAuthHeaders();
      const [
        appsRes,
        notifsRes,
        cbsRes,
        cntsRes,
        progsRes,
        annsRes,
        revsRes,
        mediaRes,
        faqsRes,
        brandingRes,
        profilesRes,
      ] = await Promise.all([
        requestJson('/api/admin/applications', { headers }),
        isSuperAdmin ? requestJson('/api/admin/notifications', { headers }) : Promise.resolve([]),
        requestJson('/api/admin/callbacks', { headers }),
        requestJson('/api/admin/contacts', { headers }),
        requestJson(isAdminOrHigher ? '/api/admin/programs' : '/api/programs', isAdminOrHigher ? { headers } : undefined),
        requestJson(isAdminOrHigher ? '/api/admin/announcements' : '/api/announcements', isAdminOrHigher ? { headers } : undefined),
        requestJson('/api/admin/reviews', { headers }),
        isAdminOrHigher ? requestJson('/api/admin/media', { headers }) : Promise.resolve([]),
        isSuperAdmin
          ? requestJson('/api/admin/faqs', { headers })
          : requestJson('/api/faqs'),
        requestJson('/api/branding'),
        isSuperAdmin
          ? requestJson('/api/admin/profiles', { headers })
          : Promise.resolve([]),
      ]);

      if (Array.isArray(appsRes)) setApplications(appsRes);
      if (Array.isArray(notifsRes)) setNotifications(notifsRes);
      if (Array.isArray(cbsRes)) setCallbacks(cbsRes);
      if (Array.isArray(cntsRes)) setContacts(cntsRes);
      if (Array.isArray(progsRes)) setPrograms(progsRes);
      if (Array.isArray(annsRes)) setAnnouncements(annsRes);
      if (Array.isArray(revsRes)) setReviews(revsRes);
      if (Array.isArray(mediaRes)) setMediaItems(mediaRes);
      if (Array.isArray(faqsRes)) setFaqs(faqsRes);
      if (brandingRes && brandingRes.academy_name) {
        setBranding(brandingRes);
        setEditingBranding({
          ...brandingRes,
          main_logo_alt: brandingRes.logo_alt || brandingRes.main_logo_alt,
          primary_color: brandingRes.primary_orange || brandingRes.primary_color,
          secondary_color: brandingRes.primary_green || brandingRes.secondary_color,
        });
      }
      if (Array.isArray(profilesRes)) setAdminProfiles(profilesRes);
    } catch (err: any) {
      console.error('Error fetching admin data:', err);
      setActionMessage({ type: 'error', text: err.message || 'Unable to load admin data. Please refresh and try again.' });
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    fetchAllData();
  }, []);

  
  // Load official document settings separately from the other admin data.
  const fetchOfficialDocumentSettings = async () => {
    try {
      const result = await requestJson('/api/admin/official-document', {
        headers: getAuthHeaders(),
      });

      
setOfficialDocumentSettings({
  ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
  ...DEFAULT_JOINING_INFORMATION,
  ...(result.settings ?? {}),
  courses: Array.isArray(result.settings?.courses)
    ? result.settings.courses
    : DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.courses,
});

    } catch (err) {
      console.error('Error fetching official document settings:', err);
    }
  };

const saveOfficialDocumentSettings = async () => {
  try {
    setActionMessage({ type: 'success', text: 'Saving official document settings...' });

    const result = await requestJson('/api/admin/official-document', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ settings: officialDocumentSettings }),
    });

    setOfficialDocumentSettings({
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      ...DEFAULT_JOINING_INFORMATION,
      ...(result.settings ?? {}),
      courses: Array.isArray(result.settings?.courses)
        ? result.settings.courses
        : DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.courses,
    });

    setActionMessage({
      type: 'success',
      text: 'Official document settings saved successfully.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to save official document settings.';
    setActionMessage({ type: 'error', text: message });
  }
};
const previewOfficialDocumentPdf = async () => {
  try {
    // Fixed fictional demo data only. No student records or payment APIs are accessed.
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();
    const navy = rgb(0.02, 0.17, 0.34);
    const blue = rgb(0.04, 0.28, 0.52);
    const orange = rgb(1, 0.40, 0.02);
    const paleBlue = rgb(0.92, 0.96, 0.99);
    const paleOrange = rgb(1, 0.96, 0.91);
    const paleGreen = rgb(0.92, 0.97, 0.94);
    const green = rgb(0.02, 0.40, 0.30);
    const white = rgb(1, 1, 1);
    const ink = rgb(0.06, 0.20, 0.34);
    const muted = rgb(0.30, 0.40, 0.49);
    const line = rgb(0.80, 0.87, 0.92);
    const safe = (value: unknown) => String(value ?? '—')
      .replace(/[’‘]/g, "'").replace(/[–—]/g, '-')
      .replace(/[•·]/g, '-').replace(/[^\x20-\x7E]/g, '?');
    const text = (value: unknown, x: number, y: number, size = 8.5, font = regular, color = ink, maxWidth = 500) => {
      page.drawText(safe(value), { x, y, size, font, color, maxWidth });
    };
    const wrap = (value: unknown, x: number, y: number, maxWidth: number, size = 8, font = regular, color = ink, lineHeight = 11) => {
      const words = safe(value).split(/\s+/);
      let current = '';
      let yy = y;
      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
          text(current, x, yy, size, font, color, maxWidth);
          yy -= lineHeight;
          current = word;
        } else current = next;
      }
      if (current) text(current, x, yy, size, font, color, maxWidth);
      return yy - lineHeight;
    };
    const rect = (x: number, y: number, w: number, h: number, fill: any, border = line) => {
      page.drawRectangle({ x, y, width: w, height: h, color: fill, borderColor: border, borderWidth: 0.7 });
    };
    const section = (x: number, top: number, w: number, h: number, title: string, fill: any, accent: any) => {
      rect(x, top - h, w, h, white, line);
      page.drawRectangle({ x: x + 0.5, y: top - 34, width: w - 1, height: 33, color: fill });
      page.drawCircle({ x: x + 24, y: top - 17, size: 11, color: accent });
      text(title.toUpperCase(), x + 43, top - 20, 10, bold, blue, w - 52);
    };
    const pair = (label: string, value: string, x: number, y: number, valueX: number, maxWidth = 170, size = 8.2) => {
      text(label, x, y, size, bold, blue, valueX - x - 8);
      text(':', valueX - 10, y, size, regular, blue, 8);
      wrap(value, valueX, y, maxWidth, size, regular, ink, 10);
    };

    // Branded masthead; logo is optional so a network/CORS issue never blocks the preview.
    page.drawRectangle({ x: 0, y: height - 126, width, height: 126, color: white });
    page.drawRectangle({ x: 0, y: height - 130, width, height: 4, color: orange });
    try {
      const logoUrl = "https://gpnfznwqwaokfzmozpxo.supabase.co/storage/v1/object/public/Uptrend's%20English%20Academy-photos/main_logo/UEA_main_03.png";
      const response = await fetch(logoUrl);
      if (response.ok) {
        const logo = await pdf.embedPng(new Uint8Array(await response.arrayBuffer()));
        const dims = logo.scale(Math.min(245 / logo.width, 105 / logo.height));
        page.drawImage(logo, { x: 24, y: height - 112, width: dims.width, height: dims.height });
      }
    } catch (logoError) {
      console.warn('Demo PDF logo could not be embedded:', logoError);
      text("UPTRENDS", 26, height - 58, 19, bold, navy, 130);
      text("ENGLISH ACADEMY", 26, height - 76, 9, bold, blue, 130);
    }
    page.drawLine({ start: { x: 282, y: height - 20 }, end: { x: 282, y: height - 105 }, thickness: 1, color: line });
    text(officialDocumentSettings.academyName || "Uptrends English Academy", 300, height - 34, 10, bold, navy, 270);
    text(officialDocumentSettings.address || "Address to be configured", 300, height - 50, 7.3, regular, blue, 270);
    text(`Phone: ${officialDocumentSettings.phone || '—'}`, 300, height - 66, 7.5, regular, blue, 270);
    text(`Email: ${officialDocumentSettings.email || '—'}`, 300, height - 80, 7.5, regular, blue, 270);
    text(`Hours: ${officialDocumentSettings.hours || '—'}`, 300, height - 94, 7.2, regular, blue, 270);

    // Main navy title panel with orange accent.
    page.drawRectangle({ x: 0, y: height - 252, width, height: 122, color: navy });
    page.drawRectangle({ x: 0, y: height - 256, width, height: 4, color: orange });
    text('ENROLLMENT & FEE CONFIRMATION', 30, height - 164, 17, bold, white, 395);
    text(safe(officialDocumentSettings.academyName || "UPTRENDS ENGLISH ACADEMY").toUpperCase(), 30, height - 187, 11.5, bold, orange, 395);
    text('Thank you for choosing our academy!', 30, height - 210, 9.5, bold, white, 395);
    wrap(officialDocumentSettings.welcomeMessage || 'We are excited to have you with us. Here are the details of your selected course, fee and payment status.', 30, height - 228, 385, 7.7, regular, white, 10);
    // Fictional portrait embedded in the PDF so it works without external image requests.
    const demoPortraitBase64 = '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';
    const portraitBytes = Uint8Array.from(atob(demoPortraitBase64), (character) => character.charCodeAt(0));
    const demoPortrait = await pdf.embedPng(portraitBytes);
    page.drawRectangle({ x: 458, y: height - 225, width: 103, height: 76, color: white, borderColor: white, borderWidth: 2 });
    page.drawImage(demoPortrait, { x: 461, y: height - 222, width: 97, height: 70 });
    page.drawRectangle({ x: 443, y: height - 250, width: 126, height: 23, color: blue, borderColor: white, borderWidth: 0.7 });
    text('DEMO STUDENT ID', 452, height - 236, 6.2, regular, white, 110);
    text('DEMO-UEA-0001', 452, height - 246, 7.8, bold, white, 110);

    // Student details and course cards.
    const top = height - 274;
    section(24, top, 265, 133, 'Student Details', paleBlue, blue);
    section(306, top, 265, 133, 'Selected Course', paleOrange, orange);
    pair('Full Name', 'Demo Student', 37, top - 53, 113, 135);
    pair('Email', 'demo.student@example.com', 37, top - 72, 113, 135);
    pair('Phone', '+91 90000 00000', 37, top - 91, 113, 135);
    pair('Address', 'Davangere, Karnataka (demo)', 37, top - 110, 113, 135);
    pair('Course Name', officialDocumentSettings.courses?.[0]?.name || 'Spoken English Course', 319, top - 53, 402, 151);
    pair('Level', 'Beginner to Advanced', 319, top - 72, 402, 151);
    pair('Duration', '2 - 3 Months', 319, top - 91, 402, 151);
    pair('Mode', 'Regular (In-person / Classroom)', 319, top - 110, 402, 151);

    // Fee and joining cards.
    const top2 = top - 147;
    section(24, top2, 265, 151, 'Fee & Payment Information', paleBlue, blue);
    section(306, top2, 265, 151, 'Joining Information', paleGreen, green);
    pair('Course Fee', 'INR 18,000 (sample)', 38, top2 - 53, 126, 145);
    pair('Payment Status', 'Partially paid (demo)', 38, top2 - 73, 126, 145);
    pair('Payment Method', 'Demo payments only', 38, top2 - 93, 126, 145);
    pair('Total Paid', 'INR 9,000', 38, top2 - 113, 126, 145);
    pair('Balance Due', 'INR 9,000', 38, top2 - 133, 126, 145);
    pair('Joining Date', officialDocumentSettings.joiningDate || 'To be confirmed', 319, top2 - 55, 408, 145);
    pair('Class Schedule', officialDocumentSettings.classSchedule || 'To be confirmed', 319, top2 - 75, 408, 145);
    pair('Class Timings', officialDocumentSettings.classTimings || 'To be confirmed', 319, top2 - 95, 408, 145);
    pair('Venue', officialDocumentSettings.venue || 'Uptrends English Academy, Davangere', 319, top2 - 115, 408, 145);
    page.drawRectangle({ x: 319, y: top2 - 143, width: 239, height: 17, color: paleGreen });
    text('Demo only - no real payment was recorded', 326, top2 - 137, 6.8, regular, green, 225);

    // Terms block.
    const termsTop = top2 - 165;
    section(24, termsTop, 547, 112, 'Terms & Conditions', paleBlue, blue);
    const terms = safe(officialDocumentSettings.terms || "Regular attendance and respectful academy conduct are required. Course fees, timings and other details are subject to confirmation. Please retain payment receipts.");
    wrap(terms, 39, termsTop - 51, 515, 7.7, regular, ink, 10);
    page.drawLine({ start: { x: 38, y: termsTop - 88 }, end: { x: 557, y: termsTop - 88 }, thickness: 0.6, color: line });
    text(`Thank you for choosing ${officialDocumentSettings.academyName || "Uptrends English Academy"}.`, 39, termsTop - 102, 7.4, bold, blue, 515);

    // Branded footer.
    page.drawRectangle({ x: 0, y: 0, width, height: 67, color: navy });
    page.drawRectangle({ x: 0, y: 65, width, height: 3, color: orange });
    text(safe(officialDocumentSettings.academyName || "UPTRENDS ENGLISH ACADEMY").toUpperCase(), 24, 45, 10, bold, white, 245);
    text(`Phone: ${officialDocumentSettings.phone || '—'}`, 24, 29, 7.2, regular, white, 245);
    text(`Email: ${officialDocumentSettings.email || '—'}`, 24, 16, 7.2, regular, white, 245);
    text('STUDENT-VIEW DEMO PDF', 385, 31, 8, bold, orange, 180);
    text('Fictional sample - not an official record', 345, 17, 6.8, regular, white, 220);

    const bytes = await pdf.save();
    const safeBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(safeBuffer).set(bytes);
    const pdfBlob = new Blob([safeBuffer], { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(pdfBlob);
    setOfficialPdfPreviewUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return pdfUrl;
    });
    setActionMessage({
      type: 'success',
      text: 'Branded student-view demo PDF preview generated. No student records or payments were changed.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to generate PDF preview.';
    setActionMessage({ type: 'error', text: message });
  }
};


  // Generate a separate student-specific enrollment and fee confirmation PDF.
  // Payment figures are taken only from the saved payment register.
  const generateStudentConfirmationPdf = async () => {
    if (!paymentApp || !paymentData) {
      setPaymentError('Load this student’s payment records before generating the confirmation PDF.');
      return;
    }

    if (paymentApp.status !== 'Accepted') {
      setPaymentError('Approve this application before generating an enrollment confirmation.');
      return;
    }

    setPaymentError(null);
    setPaymentSaving(true);
    try {
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([595.28, 841.89]);
      const regular = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const { width, height } = page.getSize();
      const orange = rgb(0.88, 0.25, 0.04);
      const dark = rgb(0.12, 0.16, 0.22);
      const muted = rgb(0.35, 0.39, 0.44);
      const green = rgb(0.05, 0.42, 0.27);
      const left = 48;
      const right = width - 48;
      let y = height - 48;

      const drawText = (text: string, x: number, topY: number, size = 10, font = regular, color = dark) => {
        page.drawText(text, { x, y: topY - size, size, font, color, maxWidth: right - x });
      };
      const drawRule = (topY: number) => {
        page.drawLine({ start: { x: left, y: topY }, end: { x: right, y: topY }, thickness: 0.8, color: rgb(0.88, 0.89, 0.91) });
      };
      const safe = (value: unknown) => String(value ?? '—')
        .replace(/[’‘]/g, "'")
        .replace(/[–—]/g, '-')
        .replace(/[^\x20-\x7E]/g, '?');

      // Reuse the same public logo asset already used by the website/general PDF.
      try {
        const logoUrl = "https://gpnfznwqwaokfzmozpxo.supabase.co/storage/v1/object/public/Uptrend's%20English%20Academy-photos/main_logo/UEA_main_03.png";
        const response = await fetch(logoUrl);
        if (response.ok) {
          const logoBytes = new Uint8Array(await response.arrayBuffer());
          const logo = await pdf.embedPng(logoBytes);
          const logoDims = logo.scale(Math.min(58 / logo.width, 48 / logo.height));
          page.drawImage(logo, { x: left, y: y - 48, width: logoDims.width, height: logoDims.height });
        }
      } catch (logoError) {
        // Logo is optional; keep PDF generation available if remote fetch/CORS fails.
        console.warn('Student PDF logo could not be embedded:', logoError);
      }

      drawText(safe(officialDocumentSettings.academyName || "Uptrend's English Academy"), left + 70, y - 3, 17, bold, orange);
      drawText(safe(officialDocumentSettings.address), left + 70, y - 22, 8, regular, muted);
      drawText(`Phone: ${safe(officialDocumentSettings.phone)}  |  Email: ${safe(officialDocumentSettings.email)}`, left + 70, y - 35, 8, regular, muted);
      y -= 76;
      drawRule(y);
      y -= 28;

      drawText('STUDENT ENROLLMENT & FEE CONFIRMATION', left, y, 15, bold, dark);
      y -= 32;
      drawText(`Application reference: ${safe(paymentData.application.application_reference || paymentApp.application_reference)}`, left, y, 10, bold);
      y -= 24;

      drawText('STUDENT DETAILS', left, y, 10, bold, orange);
      y -= 20;
      const details = [
        ['Student name', paymentData.application.student_name || paymentApp.student_name],
        ['Selected course', paymentData.application.program_name || paymentApp.program_name || 'Not specified'],
        ['Mobile', paymentApp.mobile],
        ['Email', paymentApp.email || 'Not provided'],
        ['Application status', paymentApp.status],
        ['Confirmation date', new Date().toLocaleDateString('en-IN')],
      ];
      for (const [label, value] of details) {
        drawText(`${label}: ${safe(value)}`, left + 4, y, 9, regular, dark);
        y -= 17;
      }

      y -= 8;
      drawRule(y);
      y -= 25;
      drawText('FEE SUMMARY (INR)', left, y, 10, bold, orange);
      y -= 21;

      const agreedTotal = paymentData.feeAgreement?.agreed_total;
      const totalPaid = Number(paymentData.totalPaid || 0);
      const remaining = paymentData.remainingBalance;
      const money = (value: number) => `INR ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      drawText(`Agreed total fee: ${agreedTotal == null ? 'Not set' : money(Number(agreedTotal))}`, left + 4, y, 10, bold);
      y -= 19;
      drawText(`Total payment recorded: ${money(totalPaid)}`, left + 4, y, 10, regular);
      y -= 19;
      drawText(`Remaining balance: ${remaining == null ? 'Not available - agreed fee not set' : money(Number(remaining))}`, left + 4, y, 10, regular);
      y -= 24;

      const feeStatus = agreedTotal == null
        ? 'Fee confirmation pending'
        : Number(remaining) <= 0
          ? 'Fully paid according to recorded entries'
          : totalPaid > 0
            ? 'Partially paid according to recorded entries'
            : 'Payment not yet recorded';
      drawText(`Payment status: ${feeStatus}`, left + 4, y, 9, bold, green);
      y -= 28;

      drawRule(y);
      y -= 24;
      drawText('ENROLLMENT NOTE', left, y, 10, bold, orange);
      y -= 20;
      drawText('This document confirms the application status and the fee/payment entries saved in the academy admin register.', left + 4, y, 9, regular);
      y -= 16;
      drawText('Payment figures reflect records entered by academy staff; retain the official payment receipt where applicable.', left + 4, y, 9, regular, muted);
      y -= 32;

      if (paymentData.payments.length > 0) {
        drawText('RECENT PAYMENT RECORDS', left, y, 10, bold, orange);
        y -= 19;
        for (const payment of paymentData.payments.slice(0, 8)) {
          if (y < 95) break;
          const line = `${new Date(payment.recorded_at).toLocaleDateString('en-IN')} | ${safe(payment.payment_stage.replaceAll('_', ' '))} | ${safe(payment.payment_method.replaceAll('_', ' '))} | ${money(Number(payment.amount))}${payment.reference_number ? ` | Ref: ${safe(payment.reference_number)}` : ''}`;
          drawText(line, left + 4, y, 8, regular, muted);
          y -= 15;
        }
      }

      page.drawLine({ start: { x: left, y: 58 }, end: { x: right, y: 58 }, thickness: 0.8, color: rgb(0.88, 0.89, 0.91) });
      page.drawText(`${safe(officialDocumentSettings.academyName || "Uptrend's English Academy")} - Davangere`, {
        x: left, y: 40, size: 8, font: regular, color: muted,
      });
      page.drawText('Student copy', { x: right - 75, y: 40, size: 8, font: regular, color: muted });

      const bytes = await pdf.save();
      const safeBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(safeBuffer).set(bytes);
      const blob = new Blob([safeBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeReference = safe(paymentData.application.application_reference || paymentApp.application_reference).replace(/[^A-Za-z0-9_-]/g, '_');
      anchor.href = url;
      anchor.download = `Enrollment_Fee_Confirmation_${safeReference}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setActionMessage({ type: 'success', text: 'Student enrollment and fee confirmation PDF downloaded.' });
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Unable to generate the student confirmation PDF.');
    } finally {
      setPaymentSaving(false);
    }
  };


  useEffect(() => {
    fetchOfficialDocumentSettings();
  }, []);



  // Action: Approve Application (with official PDF verification & email)
  const handleApproveApp = async (appId: string) => {
    const requiredJoiningFields: Array<[keyof JoiningInformationSettings, string]> = [
      ['joiningDate', 'Joining date'],
      ['classSchedule', 'Class schedule'],
      ['classTimings', 'Class timings'],
      ['venue', 'Venue'],
    ];
    const missingJoiningField = requiredJoiningFields.find(([key]) => !applicationJoiningInfo[key].trim() || applicationJoiningInfo[key].trim().toLowerCase() === 'to be confirmed');
    if (missingJoiningField) {
      setActionMessage({ type: 'error', text: `${missingJoiningField[1]} must be completed before approval. Replace “To be confirmed” with the final details.` });
      return;
    }
    setActionMessage(null);
    setLoading(true);
    try {
      const res = await fetch('/api/approve-application', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          application_id: appId,
          approved_by_name: currentAdmin.full_name,
          joining_information: { ...applicationJoiningInfo },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to approve application.');
      }

      setActionMessage({
        type: 'success',
        text: `Application approved! Official PDF attached and approval email triggered (${data.email_status}).`,
      });
      setSelectedApp(null);
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Error approving application.' });
    } finally {
      setLoading(false);
    }
  };

  // Action: Delete Application (Super Admin only)
  const handleDeleteApplication = async (appId: string) => {
    if (!confirm('Are you sure you want to permanently delete this application record? This action cannot be undone.')) return;
    setActionMessage(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/applications/${appId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete application.');

      setActionMessage({
        type: 'success',
        text: 'Application record deleted successfully.',
      });
      if (selectedApp?.id === appId) setSelectedApp(null);
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Error deleting application.' });
    } finally {
      setLoading(false);
    }
  };

  const handleMarkApplicationPending = async (appId: string) => {
    setLoading(true);
    setActionMessage(null);
    try {
      const updated = await requestJson(`/api/admin/applications/${appId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: 'Pending' }),
      });
      setApplications((items) => items.map((item) => item.id === appId ? updated : item));
      setSelectedApp(updated);
      setActionMessage({ type: 'success', text: 'Application returned to Pending.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Unable to update application status.' });
    } finally {
      setLoading(false);
    }
  };

  const handleCallbackStatusChange = async (callback: CallbackRequest, status: CallbackRequest['status']) => {
    setLoading(true);
    setActionMessage(null);
    try {
      const updated = await requestJson(`/api/admin/callbacks/${callback.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status }),
      });
      setCallbacks((items) => items.map((item) => item.id === callback.id ? updated : item));
      setSelectedCallback(updated);
      setActionMessage({ type: 'success', text: `Callback request marked ${status}.` });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Unable to update callback request.' });
    } finally {
      setLoading(false);
    }
  };

  const handleContactStatusChange = async (contact: ContactEnquiry, status: ContactEnquiry['status']) => {
    setLoading(true);
    setActionMessage(null);
    try {
      const updated = await requestJson(`/api/admin/contacts/${contact.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status }),
      });
      setContacts((items) => items.map((item) => item.id === contact.id ? updated : item));
      setSelectedContact(updated);
      setActionMessage({ type: 'success', text: `Contact enquiry marked ${status}.` });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Unable to update contact enquiry.' });
    } finally {
      setLoading(false);
    }
  };

  // Action: Retry Email Notification
  const handleRetryNotification = async (notifId: string) => {
    setActionMessage(null);
    setLoading(true);
    try {
      const res = await fetch('/api/retry-notification', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ notification_id: notifId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Retry failed');
      setActionMessage({
        type: data.success ? 'success' : 'error',
        text: data.message || 'Notification retry completed.',
      });
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Action: Save Program
  const handleSaveProgram = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProgram) return;
    if (!editingProgram.title?.trim() || !editingProgram.short_description?.trim()
        || !editingProgram.description?.trim() || !editingProgram.target_audience?.trim()) {
      setActionMessage({ type: 'error', text: 'Title, short description, full description, and target audience are required.' });
      return;
    }
    setLoading(true);
    try {
      const method = editingProgram.id ? 'PUT' : 'POST';
      const url = editingProgram.id ? `/api/admin/programs/${editingProgram.id}` : '/api/admin/programs';
      // The Worker manages image_object_key; never send it from the browser.
const { image_object_key: _imageObjectKey, ...programPayload } = editingProgram;

const res = await fetch(url, {
  method,
  headers: getAuthHeaders(),
  body: JSON.stringify(programPayload),
});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save program');
      setEditingProgram(null);
      setActionMessage({ type: 'success', text: 'Program updated successfully!' });
      notifyPublicDataChanged();
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Action: Delete Program
  const handleDeleteProgram = async (id: string) => {
    if (!confirm('Are you sure you want to delete this program?')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/programs/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete program');
      }
      setActionMessage({ type: 'success', text: 'Program deleted.' });
      notifyPublicDataChanged();
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Action: Save Announcement
  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAnnouncement) return;
    if (!editingAnnouncement.content?.trim()) {
      setActionMessage({ type: 'error', text: 'Announcement text is required.' });
      return;
    }
    setLoading(true);
    try {
      const method = editingAnnouncement.id ? 'PUT' : 'POST';
      const url = editingAnnouncement.id ? `/api/admin/announcements/${editingAnnouncement.id}` : '/api/admin/announcements';
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({ ...editingAnnouncement, content: editingAnnouncement.content.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save announcement');
      setEditingAnnouncement(null);
      setActionMessage({ type: 'success', text: 'Announcement updated successfully!' });
      notifyPublicDataChanged();
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Action: Delete Announcement
  const handleDeleteAnnouncement = async (id: string) => {
    if (!confirm('Delete this announcement?')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete announcement');
      }
      setActionMessage({ type: 'success', text: 'Announcement deleted.' });
      notifyPublicDataChanged();
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAnnouncement = async (announcement: Announcement) => {
    setLoading(true);
    setActionMessage(null);
    try {
      const updated = await requestJson(`/api/admin/announcements/${announcement.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_active: !announcement.is_active }),
      });
      setAnnouncements((items) => items.map((item) => item.id === announcement.id ? updated : item));
      notifyPublicDataChanged();
      setActionMessage({ type: 'success', text: `Announcement ${updated.is_active ? 'published' : 'unpublished'}.` });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Unable to update announcement.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFaq = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingFaq) return;
    setLoading(true);
    setActionMessage(null);
    try {
      const url = editingFaq.id ? `/api/admin/faqs/${editingFaq.id}` : '/api/admin/faqs';
      const saved = await requestJson(url, {
        method: editingFaq.id ? 'PUT' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(editingFaq),
      });
      setFaqs((items) => editingFaq.id
        ? items.map((item) => item.id === saved.id ? saved : item)
        : [...items, saved]);
      setEditingFaq(null);
      notifyPublicDataChanged();
      setActionMessage({ type: 'success', text: 'FAQ saved.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Unable to save FAQ.' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFaq = async (faqId: string) => {
    if (!confirm('Delete this FAQ? This cannot be undone.')) return;
    setLoading(true);
    setActionMessage(null);
    try {
      await requestJson(`/api/admin/faqs/${faqId}`, { method: 'DELETE', headers: getAuthHeaders() });
      setFaqs((items) => items.filter((item) => item.id !== faqId));
      notifyPublicDataChanged();
      setActionMessage({ type: 'success', text: 'FAQ deleted.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Unable to delete FAQ.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveReview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingReview) return;
    setLoading(true);
    try {
      const url = editingReview.id ? `/api/admin/reviews/${editingReview.id}` : '/api/admin/reviews';
      const res = await fetch(url, {
        method: editingReview.id ? 'PUT' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(editingReview),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to save review.');
      setEditingReview(null);
      setActionMessage({ type: 'success', text: 'Review saved.' });
      notifyPublicDataChanged();
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Unable to save review.' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteReview = async (id: string) => {
    if (!confirm('Delete this review?')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reviews/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to delete review.');
      setActionMessage({ type: 'success', text: 'Review deleted.' });
      notifyPublicDataChanged();
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Unable to delete review.' });
    } finally {
      setLoading(false);
    }
  };

  // Action: Save Site Branding
  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranding) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/branding', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(editingBranding),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update branding');
      setBranding(data);
      setActionMessage({ type: 'success', text: 'Branding and logo configurations updated successfully!' });
      notifyPublicDataChanged();
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Action: Update Admin Role / Status (Super Admin only)
  const handleUpdateAdminRole = async (profileId: string, newRole: AdminRole, newStatus: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ role: newRole, is_active: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update admin role');
      setActionMessage({ type: 'success', text: `Admin role updated to ${newRole}.` });
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const resetMediaForm = () => {
    setMediaForm({
      media_type: 'photo',
      title: '',
      caption: '',
      alt_text: '',
      youtube_url: '',
      cover_image_url: '',
      is_published: true,
      display_order: 0,
    });
    setEditingMediaId(null);
    setMediaError(null);
  };

  const handleProgramImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setActionMessage({ type: 'error', text: 'Please select a JPEG, PNG, or WebP image.' });
      event.target.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setActionMessage({ type: 'error', text: 'Program images must be 5 MB or smaller.' });
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      if (!result.startsWith('data:image/')) {
        setActionMessage({ type: 'error', text: 'Unable to read this image. Please choose another file.' });
        return;
      }
      setEditingProgram((current) => current ? {
        ...current,
        image_file_base64: result,
      } : current);
      setActionMessage(null);
    };
    reader.onerror = () => {
      setActionMessage({ type: 'error', text: 'Unable to read this image. Please choose another file.' });
    };
    reader.readAsDataURL(file);
  };

  const handleMediaFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMediaError('Please upload a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMediaError('Photo uploads must be under 5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setMediaError(null);
      setMediaForm((prev) => ({
        ...prev,
        media_file_base64: String(reader.result || ''),
        media_file_mime: file.type,
      }));
    };
    reader.onerror = () => setMediaError('Unable to read this image. Please choose another file.');
    reader.readAsDataURL(file);
  };

  const handleCoverFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMediaError('Cover image must be JPEG, PNG, or WebP.');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMediaError('Cover image must be under 5 MB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setMediaError(null);
      setMediaForm((prev) => ({
        ...prev,
        cover_file_base64: String(reader.result || ''),
        cover_file_mime: file.type,
      }));
    };
    reader.onerror = () => setMediaError('Unable to read this cover image.');
    reader.readAsDataURL(file);
  };

  const handleSaveMedia = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMediaError(null);

    try {
      const { media_file_base64, cover_file_base64, ...mediaDetails } = mediaForm;
      const payload = {
        ...mediaDetails,
        ...(media_file_base64 ? { media_file_base64 } : {}),
        ...(cover_file_base64 ? { cover_file_base64 } : {}),
        media_type: mediaForm.media_type || 'photo',
        title: mediaForm.title?.trim(),
        caption: mediaForm.caption?.trim() || '',
        alt_text: mediaForm.alt_text?.trim() || mediaForm.title?.trim() || '',
        youtube_url: mediaForm.youtube_url?.trim() || '',
        cover_image_url: mediaForm.cover_image_url?.trim() || '',
        is_published: mediaForm.is_published !== false,
        display_order: Number(mediaForm.display_order || 0),
      };

      if (!payload.title) {
        throw new Error('Media title is required.');
      }

      if (payload.media_type === 'photo' && !media_file_base64 && !mediaForm.media_url) {
        throw new Error('Upload a photo before saving this gallery entry.');
      }

      if (payload.media_type === 'video' && !payload.youtube_url) {
        throw new Error('Video entries need a valid YouTube URL.');
      }

      const url = editingMediaId ? `/api/admin/media/${editingMediaId}` : '/api/admin/media';
      const method = editingMediaId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save media entry.');

      setActionMessage({ type: 'success', text: editingMediaId ? 'Media item updated successfully.' : 'Media item created successfully.' });
      resetMediaForm();
      notifyPublicDataChanged();
      await fetchAllData();
    } catch (err: any) {
      setMediaError(err.message || 'Unable to save media item.');
      setActionMessage({ type: 'error', text: err.message || 'Unable to save media item.' });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMedia = async (itemId: string) => {
    if (!confirm('Delete this media item? This cannot be undone.')) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media/${itemId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete media item.');
      setActionMessage({ type: 'success', text: 'Media item deleted.' });
      notifyPublicDataChanged();
      await fetchAllData();
      if (editingMediaId === itemId) resetMediaForm();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Unable to delete media item.' });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleMediaPublished = async (item: MediaItem) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/media/${item.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ...item, is_published: !item.is_published }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update publication status.');
      setActionMessage({ type: 'success', text: `Media marked as ${!item.is_published ? 'published' : 'draft'}.` });
      notifyPublicDataChanged();
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Unable to update media status.' });
    } finally {
      setLoading(false);
    }
  };

  // Navigation Items according to role
  const navItems = [
    { id: 'dashboard', label: 'Dashboard Overview', icon: LayoutDashboard, minRole: 'staff' },
    { id: 'applications', label: 'Student Applications', icon: Users, minRole: 'staff' },
    { id: 'callbacks', label: 'Callback Requests', icon: PhoneCall, minRole: 'staff' },
    { id: 'contacts', label: 'Contact Enquiries', icon: Mail, minRole: 'staff' },
    { id: 'reviews', label: 'Reviews', icon: FileText, minRole: 'staff' },
    { id: 'programs', label: 'Programs Management', icon: BookOpen, minRole: 'admin' },
    { id: 'media', label: 'Media Gallery', icon: Video, minRole: 'admin' },
    { id: 'announcements', label: 'Announcements', icon: Volume2, minRole: 'admin' },
    { id: 'branding', label: 'Site Branding & Assets', icon: Palette, minRole: 'super_admin' },
    { id: 'faqs', label: 'FAQs Management', icon: HelpCircle, minRole: 'super_admin' },
    { id: 'notifications', label: 'Email Outbox & Retries', icon: Send, minRole: 'super_admin' },
    { id: 'roles', label: 'Admin Roles & Access', icon: ShieldCheck, minRole: 'super_admin' },
    { id: 'settings', label: 'Settings & PDF Config', icon: Settings, minRole: 'super_admin' },
  ];

  const allowedNavItems = navItems.filter((item) => {
    if (item.minRole === 'staff') return true;
    if (item.minRole === 'admin') return isAdminOrHigher;
    if (item.minRole === 'super_admin') return isSuperAdmin;
    return false;
  });

  // Filtered applications
  const filteredApplications = applications.filter((app) => {
    const matchesSearch =
      app.student_name.toLowerCase().includes(appSearch.toLowerCase()) ||
      app.application_reference.toLowerCase().includes(appSearch.toLowerCase()) ||
      app.mobile.includes(appSearch) ||
      app.email.toLowerCase().includes(appSearch.toLowerCase());

    const matchesStatus = appFilterStatus === 'All' || app.status === appFilterStatus;
    return matchesSearch && matchesStatus;
  });

  const filteredCallbacks = callbacks.filter((callback) => {
    const query = callbackSearch.toLowerCase();
    const matchesSearch = [callback.full_name, callback.mobile, callback.email || '', callback.program_name, callback.message || '']
      .some((value) => value.toLowerCase().includes(query));
    return matchesSearch && (callbackFilterStatus === 'All' || callback.status === callbackFilterStatus);
  });

  const filteredContacts = contacts.filter((contact) => {
    const query = contactSearch.toLowerCase();
    const matchesSearch = [contact.full_name, contact.email, contact.mobile || '', contact.subject, contact.message]
      .some((value) => value.toLowerCase().includes(query));
    return matchesSearch && (contactFilterStatus === 'All' || contact.status === contactFilterStatus);
  });

  const filteredReviews = reviews
    .filter((review) => reviewRatingFilter === 'All' || String(review.rating) === reviewRatingFilter)
    .sort((left, right) => {
      const dateDifference = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      return reviewSort === 'latest' ? -dateDifference : dateDifference;
    });

  return (
    <div className="admin-responsive-shell min-h-screen bg-slate-100 flex flex-col">
      <style>{`
        .admin-responsive-shell, .admin-responsive-shell * { box-sizing: border-box; }
        .admin-responsive-shell { width: 100%; max-width: 100vw; overflow-x: clip; }
        .admin-responsive-shell > header { width: 100%; }
        .admin-responsive-shell > header > div { min-width: 0; gap: .75rem; }
        .admin-responsive-shell > header button { flex-shrink: 0; }
        .admin-responsive-shell > div.flex-1 { min-width: 0; width: 100%; }
        .admin-responsive-shell aside { flex-shrink: 0; }
        .admin-responsive-shell main { min-width: 0; max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; }
        .admin-responsive-shell main > * { min-width: 0; }
        .admin-responsive-shell table { border-collapse: separate; border-spacing: 0; }
        .admin-responsive-shell main > div table { min-width: 1050px; width: max-content; }
        .admin-responsive-shell main > div .overflow-x-auto { display: block; width: 100%; max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
        .admin-responsive-shell input, .admin-responsive-shell select, .admin-responsive-shell textarea { max-width: 100%; min-width: 0; }
        .admin-responsive-shell img, .admin-responsive-shell iframe, .admin-responsive-shell video { max-width: 100%; }
        .admin-responsive-shell [role="dialog"], .admin-responsive-shell .fixed.inset-0 > div { max-width: calc(100vw - 1.5rem); }
        .admin-responsive-shell .whitespace-nowrap { white-space: nowrap; }
        @media (max-width: 1023px) {
          .admin-responsive-shell > div.flex-1 { overflow: visible; }
          .admin-responsive-shell main { padding: 1rem; }
          .admin-responsive-shell main h1 { overflow-wrap: anywhere; }
          .admin-responsive-shell main .grid { min-width: 0; }
        }
        @media (max-width: 639px) {
          .admin-responsive-shell > header > div { height: auto; min-height: 4rem; padding: .625rem .75rem; }
          .admin-responsive-shell > header > div > div:first-child { min-width: 0; gap: .5rem; }
          .admin-responsive-shell > header > div > div:first-child > div { min-width: 0; }
          .admin-responsive-shell > header .text-lg { font-size: 1rem; }
          .admin-responsive-shell > header .uppercase { font-size: 9px; }
          .admin-responsive-shell main { padding: .75rem; }
          .admin-responsive-shell main h1 { font-size: 1.35rem; line-height: 1.35; }
          .admin-responsive-shell main h2 { overflow-wrap: anywhere; }
          .admin-responsive-shell main .flex-wrap, .admin-responsive-shell main .flex.items-center.justify-between { gap: .625rem; }
          .admin-responsive-shell main button { max-width: 100%; }
          .admin-responsive-shell main table { min-width: 1050px; width: max-content; table-layout: auto; }
          .admin-responsive-shell aside { width: min(18rem, 86vw); }
        }
      `}</style>
      {/* Top Admin Bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2">
              <img
                src="https://gpnfznwqwaokfzmozpxo.supabase.co/storage/v1/object/public/Uptrend's%20English%20Academy-photos/main_logo/UEA_main_03.png"
                alt="Uptrend's English Academy logo"
                className="block shrink-0 object-contain"
                style={{ width: 'clamp(80px, 10vw, 140px)', height: '40px', maxWidth: '140px', maxHeight: '40px' }}
              />
              <span className="text-xs uppercase bg-slate-800 text-emerald-400 font-bold px-2 py-0.5 rounded border border-slate-700">
                Admin Portal
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={fetchAllData}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors cursor-pointer"
              title="Refresh Data from Supabase"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Data</span>
            </button>

            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-bold text-white">{currentAdmin.full_name}</span>
              <span className="text-[10px] uppercase font-bold text-orange-400">{currentAdmin.role}</span>
            </div>

            <button
              onClick={onLogout}
              className="flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-950/60 px-3 py-1.5 rounded-lg border border-rose-900 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`fixed inset-y-16 left-0 z-20 w-64 bg-white border-r border-slate-200 flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="p-4 space-y-1 overflow-y-auto">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-3 py-2">
              Navigation Menu
            </div>
            {allowedNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  title={item.label}
                  onClick={() => {
                    setActiveTab(item.id);
                    setSidebarOpen(false);
                    setActionMessage(null);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-orange-50 text-orange-600 font-bold border-l-4 border-orange-600'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-orange-600' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-4 border-t border-slate-100 bg-slate-50/50">
            <button
              onClick={() => setCurrentPage('home')}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-orange-600 py-2 border border-slate-200 rounded-lg bg-white"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>View Academy Site</span>
            </button>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {actionMessage && (
            <div
              className={`mb-6 p-4 rounded-2xl flex items-start gap-3 text-xs font-semibold ${
                actionMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {actionMessage.type === 'success' ? (
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 leading-relaxed">{actionMessage.text}</div>
            </div>
          )}

          {/* TAB 1: DASHBOARD OVERVIEW */}
          {activeTab === 'dashboard' && (
            <div className="space-y-8">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-950">Academy Dashboard</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Live operational overview for Uptrend’s English Academy, Davangere.
                </p>
              </div>

              {/* Stats Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <div
                  onClick={() => {
                    setActiveTab('applications');
                    setAppFilterStatus('All');
                  }}
                  className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase">
                    <span>Total Applications</span>
                    <Users className="w-4 h-4 text-orange-500" />
                  </div>
                  <p className="text-3xl font-black text-slate-900 mt-3">{applications.length}</p>
                  <p className="text-[11px] text-slate-400 mt-1">Direct student submissions</p>
                </div>

                <div
                  onClick={() => {
                    setActiveTab('applications');
                    setAppFilterStatus('Pending');
                  }}
                  className="bg-white p-5 rounded-2xl border border-amber-200 shadow-xs hover:shadow-md transition-all cursor-pointer border-t-4 border-t-amber-500"
                >
                  <div className="flex items-center justify-between text-amber-700 text-xs font-bold uppercase">
                    <span>Pending Approval</span>
                    <ClockIcon className="w-4 h-4 text-amber-600" />
                  </div>
                  <p className="text-3xl font-black text-amber-600 mt-3">
                    {applications.filter((a) => a.status === 'Pending').length}
                  </p>
                  <p className="text-[11px] text-amber-700 mt-1">Require staff action</p>
                </div>

                <div
                  onClick={() => {
                    setActiveTab('applications');
                    setAppFilterStatus('Accepted');
                  }}
                  className="bg-white p-5 rounded-2xl border border-emerald-200 shadow-xs hover:shadow-md transition-all cursor-pointer border-t-4 border-t-emerald-500"
                >
                  <div className="flex items-center justify-between text-emerald-700 text-xs font-bold uppercase">
                    <span>Accepted Applications</span>
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                  </div>
                  <p className="text-3xl font-black text-emerald-600 mt-3">
                    {applications.filter((a) => a.status === 'Accepted').length}
                  </p>
                  <p className="text-[11px] text-emerald-700 mt-1">Official PDF sent</p>
                </div>

                <div
                  onClick={() => setActiveTab('callbacks')}
                  className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase">
                    <span>Callback Requests</span>
                    <PhoneCall className="w-4 h-4 text-teal-500" />
                  </div>
                  <p className="text-3xl font-black text-slate-900 mt-3">{callbacks.length}</p>
                  <p className="text-[11px] text-slate-400 mt-1">Prospective leads</p>
                </div>
              </div>

              {/* Quick Summary Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Recent Applications */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-900 text-sm">Recent Student Applications</h3>
                    <button
                      onClick={() => setActiveTab('applications')}
                      className="text-xs font-bold text-orange-600 hover:underline"
                    >
                      View All →
                    </button>
                  </div>
                  {applications.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                      {applications.slice(0, 5).map((app) => (
                        <div key={app.id} className="py-3 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-bold text-slate-900">{app.student_name}</p>
                            <p className="text-[11px] text-slate-500">
                              {app.program_name} • Ref: {app.application_reference}
                            </p>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              app.status === 'Accepted'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {app.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 py-6 text-center">No student applications submitted yet.</p>
                  )}
                </div>

                {/* System & Integrations Status */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                  <h3 className="font-bold text-slate-900 text-sm">Integration Status & Connectivity</h3>
                  <div className="space-y-3 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Database & Persistence</span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${integrationStatusClass(systemStatus?.supabase)}`}>
                        {integrationStatusLabel(systemStatus?.supabase, 'Supabase Not Configured')}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Resend Transactional Email</span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${integrationStatusClass(systemStatus?.resend)}`}>
                        {integrationStatusLabel(systemStatus?.resend, 'API key missing')}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Cloudflare R2 Storage</span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${integrationStatusClass(systemStatus?.r2_storage)}`}>
                        {integrationStatusLabel(systemStatus?.r2_storage, 'R2 Not Configured')}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Official Fee Structure PDF</span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${integrationStatusClass(systemStatus?.official_pdf)}`}>
                        {systemStatus?.official_pdf?.available ? 'PDF Ready' : integrationStatusLabel(systemStatus?.official_pdf, 'Configure PDF')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: APPLICATIONS MANAGEMENT */}
          {activeTab === 'applications' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-slate-950 leading-tight">Student Applications</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Review incoming student submissions, verify photographs, and execute official admission approval.
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 sm:justify-end">
                  <button type="button" onClick={fetchAllData} disabled={loading} className="col-span-2 sm:col-span-1 px-3 py-2 sm:py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold disabled:opacity-60">
                    Refresh Applications
                  </button>
                  <span className="col-span-2 sm:col-span-1 text-xs font-semibold text-slate-500">Filter Status:</span>
                  {(['All', 'Pending', 'Accepted'] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() => setAppFilterStatus(status)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        appFilterStatus === status
                          ? 'bg-orange-600 text-white font-bold'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Search by student name, ref, mobile, or email..."
                  value={appSearch}
                  onChange={(e) => setAppSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-orange-500 focus:outline-hidden"
                />
              </div>

              {/* Applications Table */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[1050px] text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-200">
                      <tr>
                        <th className="px-5 py-3.5">Reference</th>
                        <th className="px-5 py-3.5">Student Details</th>
                        <th className="px-5 py-3.5">Program</th>
                        <th className="px-5 py-3.5">Photo</th>
                        <th className="px-5 py-3.5">Status</th>
                        <th className="px-5 py-3.5 whitespace-nowrap">Submitted</th>
                        <th className="px-5 py-3.5 text-right whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {filteredApplications.length > 0 ? (
                        filteredApplications.map((app) => (
                          <tr key={app.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-5 py-4 font-mono font-bold text-orange-600 whitespace-nowrap">
                              {app.application_reference}
                            </td>
                            <td className="px-5 py-4">
                              <div className="font-bold text-slate-900">{app.student_name}</div>
                              <div className="text-[11px] text-slate-500">{app.email}</div>
                              <div className="text-[11px] text-slate-500">{app.mobile}</div>
                            </td>
                            <td className="px-5 py-4 font-medium text-slate-800">
                              {app.program_name}
                            </td>
                            <td className="px-5 py-4">
                              {app.photo_data_url ? (
                                <button
                                  onClick={() => setAppPhotoModal(app.photo_data_url!)}
                                  className="w-10 h-12 rounded overflow-hidden border border-slate-300 hover:border-orange-500 transition-colors cursor-pointer"
                                  title="Click to view passport photograph"
                                >
                                  <img
                                    src={app.photo_data_url}
                                    alt="Student"
                                    className="w-full h-full object-cover"
                                  />
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">No photo</span>
                              )}
                            </td>
                            <td className="px-5 py-4">
                              <span
                                className={`inline-flex items-center whitespace-nowrap w-max px-2.5 py-1 rounded-full text-[10px] leading-none font-bold ${
                                  app.status === 'Accepted'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {app.status}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-slate-500 text-[11px] whitespace-nowrap">
                              {new Date(app.created_at).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="px-5 py-4">
                              <div className="grid grid-cols-2 items-center gap-2 min-w-[220px]">
                              <div className="col-span-1 flex">
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => { setApplicationJoiningInfo({ ...DEFAULT_JOINING_INFORMATION }); setSelectedApp(app); }}
                                className="w-full whitespace-nowrap px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer disabled:opacity-50"
                              >
                                Review
                              </button>
                              </div>
                              <div className="col-span-1 flex">
                              <button
                                type="button"
                                disabled={loading || paymentLoading}
                                onClick={() => void loadApplicationPaymentData(app)}
                                className="w-full whitespace-nowrap px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer disabled:opacity-50"
                              >
                                Payment
                              </button>
                              </div>
                              {app.status === 'Pending' && (
                                <div className="col-span-1 flex">
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => { setApplicationJoiningInfo({ ...DEFAULT_JOINING_INFORMATION }); setSelectedApp(app); }}
                                  className="w-full whitespace-nowrap px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer shadow-xs disabled:opacity-50"
                                  title="Open review and complete joining information before approval"
                                >
                                  Review & Approve
                                </button>
                                </div>
                              )}
                              {isSuperAdmin && (
                                <div className={`${app.status === 'Pending' ? 'col-span-1' : 'col-span-2'} flex justify-end`}>
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => handleDeleteApplication(app.id)}
                                  className="px-2 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold cursor-pointer disabled:opacity-50"
                                  title="Permanently Delete Application (Super Admin only)"
                                >
                                  <Trash2 className="w-3.5 h-3.5 inline" />
                                </button>
                                </div>
                              )}
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="text-center py-12 text-slate-400">
                            {loading ? 'Loading applications...' : 'No applications found matching your criteria.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CALLBACK REQUESTS */}
          {activeTab === 'callbacks' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-950">Callback Requests</h1>
                  <p className="text-xs text-slate-500 mt-1">Track callback requests using the existing New, Contacted, and Resolved statuses.</p>
                </div>
                <button type="button" onClick={fetchAllData} disabled={loading} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold disabled:opacity-60">
                  Refresh Callbacks
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <label className="relative flex-1">
                  <Search aria-hidden="true" className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input aria-label="Search callback requests" value={callbackSearch} onChange={(event) => setCallbackSearch(event.target.value)} placeholder="Search name, phone, email, program, or message" className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs" />
                </label>
                <select aria-label="Filter callback requests by status" value={callbackFilterStatus} onChange={(event) => setCallbackFilterStatus(event.target.value as typeof callbackFilterStatus)} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs">
                  {(['All', 'New', 'Contacted', 'Resolved'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3.5">Name</th>
                      <th className="px-5 py-3.5">Mobile</th>
                      <th className="px-5 py-3.5">Program</th>
                      <th className="px-5 py-3.5">Preferred Time</th>
                      <th className="px-5 py-3.5">Message</th>
                      <th className="px-5 py-3.5">Received</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredCallbacks.map((cb) => (
                      <tr key={cb.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 font-bold text-slate-900">{cb.full_name}</td>
                        <td className="px-5 py-4 font-medium text-emerald-700">{cb.mobile}</td>
                        <td className="px-5 py-4">{cb.program_name}</td>
                        <td className="px-5 py-4">
                          <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-700 font-semibold border border-orange-200">
                            {cb.preferred_contact_time}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-500 max-w-xs truncate">
                          {cb.message || '—'}
                        </td>
                        <td className="px-5 py-4 text-slate-400 text-[11px]">
                          {new Date(cb.created_at).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-5 py-4">
                          <select aria-label={`Status for ${cb.full_name}`} value={cb.status} disabled={loading} onChange={(event) => handleCallbackStatusChange(cb, event.target.value as CallbackRequest['status'])} className="px-2 py-1 border border-slate-200 rounded-lg bg-white">
                            {(['New', 'Contacted', 'Resolved'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
                        </td>
                        <td className="px-5 py-4">
                          <button type="button" disabled={loading} onClick={() => setSelectedCallback(cb)} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold disabled:opacity-60">View</button>
                        </td>
                      </tr>
                    ))}
                    {!filteredCallbacks.length && <tr><td colSpan={8} className="text-center py-12 text-slate-400">{loading ? 'Loading callback requests...' : callbacks.length ? 'No callback requests match your filters.' : 'No callback requests yet.'}</td></tr>}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CONTACT ENQUIRIES */}
          {activeTab === 'contacts' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-950">Contact Enquiries</h1>
                  <p className="text-xs text-slate-500 mt-1">Track enquiries using the existing New, Replied, and Archived statuses.</p>
                </div>
                <button type="button" onClick={fetchAllData} disabled={loading} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold disabled:opacity-60">
                  Refresh Enquiries
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <label className="relative flex-1">
                  <Search aria-hidden="true" className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input aria-label="Search contact enquiries" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Search sender, email, subject, or message" className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs" />
                </label>
                <select aria-label="Filter contact enquiries by status" value={contactFilterStatus} onChange={(event) => setContactFilterStatus(event.target.value as typeof contactFilterStatus)} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs">
                  {(['All', 'New', 'Replied', 'Archived'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3.5">Sender</th>
                      <th className="px-5 py-3.5">Subject</th>
                      <th className="px-5 py-3.5">Message</th>
                      <th className="px-5 py-3.5">Date</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {filteredContacts.map((cnt) => (
                      <tr key={cnt.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4">
                          <div className="font-bold text-slate-900">{cnt.full_name}</div>
                          <div className="text-[11px] text-slate-500">{cnt.email}</div>
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-800">{cnt.subject}</td>
                        <td className="px-5 py-4 text-slate-600 max-w-md leading-relaxed">
                          {cnt.message}
                        </td>
                        <td className="px-5 py-4 text-slate-400 text-[11px]">
                          {new Date(cnt.created_at).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-5 py-4">
                          <select aria-label={`Status for ${cnt.full_name}`} value={cnt.status} disabled={loading} onChange={(event) => handleContactStatusChange(cnt, event.target.value as ContactEnquiry['status'])} className="px-2 py-1 border border-slate-200 rounded-lg bg-white">
                            {(['New', 'Replied', 'Archived'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
                        </td>
                        <td className="px-5 py-4">
                          <button type="button" disabled={loading} onClick={() => setSelectedContact(cnt)} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold disabled:opacity-60">View</button>
                        </td>
                      </tr>
                    ))}
                    {!filteredContacts.length && <tr><td colSpan={6} className="text-center py-12 text-slate-400">{loading ? 'Loading contact enquiries...' : contacts.length ? 'No contact enquiries match your filters.' : 'No contact enquiries yet.'}</td></tr>}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'reviews' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-950">Review Management</h1>
                  <p className="text-xs text-slate-500 mt-1">Create reviews and control which ones appear publicly.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={fetchAllData} disabled={loading} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold disabled:opacity-60">Refresh Reviews</button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setEditingReview({ author_name: '', rating: 5, review_text: '', source: 'Verified Student Review', is_published: true })}
                    className="w-full sm:w-auto justify-center px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Review</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  Rating
                  <select aria-label="Filter reviews by rating" value={reviewRatingFilter} onChange={(event) => setReviewRatingFilter(event.target.value as typeof reviewRatingFilter)} className="px-3 py-2 bg-white border border-slate-200 rounded-lg">
                    <option value="All">All ratings</option>
                    {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} stars</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  Sort
                  <select aria-label="Sort reviews by date" value={reviewSort} onChange={(event) => setReviewSort(event.target.value as typeof reviewSort)} className="px-3 py-2 bg-white border border-slate-200 rounded-lg">
                    <option value="latest">Latest</option>
                    <option value="oldest">Oldest</option>
                  </select>
                </label>
              </div>

              {editingReview && (
                <form onSubmit={handleSaveReview} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>Author name</span>
                      <input required maxLength={300} value={editingReview.author_name || ''} onChange={(event) => setEditingReview({ ...editingReview, author_name: event.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-700">
                      <span>Rating (1 to 5)</span>
                      <input required type="number" min={1} max={5} value={editingReview.rating ?? 5} onChange={(event) => setEditingReview({ ...editingReview, rating: Number(event.target.value) })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
                    </label>
                  </div>
                  <label className="block space-y-1 text-xs font-semibold text-slate-700">
                    <span>Review</span>
                    <textarea required maxLength={10000} rows={4} value={editingReview.review_text || ''} onChange={(event) => setEditingReview({ ...editingReview, review_text: event.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
                  </label>
                  <label className="block space-y-1 text-xs font-semibold text-slate-700">
                    <span>Source</span>
                    <input maxLength={300} value={editingReview.source || ''} onChange={(event) => setEditingReview({ ...editingReview, source: event.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={editingReview.is_published !== false} onChange={(event) => setEditingReview({ ...editingReview, is_published: event.target.checked })} />
                    Published on the public site
                  </label>
                  <div className="flex gap-2">
                    <button disabled={loading} type="submit" className="px-4 py-2 bg-orange-600 text-white text-xs font-bold rounded-lg disabled:opacity-60">{loading ? 'Saving...' : editingReview.id ? 'Save Review' : 'Create Review'}</button>
                    <button disabled={loading} type="button" onClick={() => setEditingReview(null)} className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg disabled:opacity-60">Cancel</button>
                  </div>
                </form>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs divide-y divide-slate-100">
                {filteredReviews.length ? filteredReviews.map((review) => (
                  <div key={review.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <strong className="text-slate-900">{review.author_name}</strong>
                        <span className="text-amber-700 font-semibold">{review.rating}/5</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${review.is_published ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{review.is_published ? 'Published' : 'Draft'}</span>
                      </div>
                      <p className="text-slate-600">{review.review_text}</p>
                      {review.source && <p className="text-slate-400">{review.source}</p>}
                      <p className="text-slate-400">{new Date(review.created_at).toLocaleDateString('en-IN')}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button disabled={loading} onClick={() => setEditingReview(review)} className="font-bold text-orange-600 hover:underline disabled:opacity-50">Edit</button>
                      <button disabled={loading} onClick={() => handleDeleteReview(review.id)} className="font-bold text-rose-600 hover:underline disabled:opacity-50">Delete</button>
                    </div>
                  </div>
                )) : <p className="p-8 text-center text-xs text-slate-400">{loading ? 'Loading reviews...' : reviews.length ? 'No reviews match the selected rating.' : 'No reviews found.'}</p>}
              </div>
            </div>
          )}

          {/* TAB 5: PROGRAMS MANAGEMENT (Admin/Super Admin only) */}
          {activeTab === 'programs' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-950">Programs Management</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Manage course catalogue, descriptions, audience, and publication status.
                  </p>
                </div>
                <div className="flex gap-2">
                <button type="button" onClick={fetchAllData} disabled={loading} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold disabled:opacity-60">
                  Refresh Programs
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    setEditingProgram({
                      title: '',
                      short_description: '',
                      description: '',
                      duration: '2–3 months',
                      level: 'Foundation to Advanced',
                      target_audience: 'Students, job seekers, professionals',
                      is_published: true,
                    })
                  }
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Program</span>
                </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {programs.map((prog) => (
                  <div key={prog.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                    <div>
                      <img
                        src={prog.image_url || 'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80'}
                        alt={`${prog.title} program`}
                        loading="lazy"
                        className="mb-4 h-40 w-full rounded-xl object-cover bg-slate-100"
                      />
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            prog.is_published ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {prog.is_published ? 'Published' : 'Draft'}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">Level: {prog.level || 'General'}</span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">{prog.title}</h3>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-2">{prog.short_description}</p>
                      <div className="mt-3 text-xs text-slate-500 space-y-1">
                        <p><strong>Audience:</strong> {prog.target_audience}</p>
                        {prog.duration && <p><strong>Duration:</strong> {prog.duration}</p>}
                      </div>
                    </div>

                    <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => setViewingProgram(prog)}
                        className="text-xs font-bold text-slate-600 hover:underline cursor-pointer disabled:opacity-50"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => setEditingProgram(prog)}
                        className="text-xs font-bold text-orange-600 hover:underline cursor-pointer disabled:opacity-50"
                      >
                        Edit Details
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => handleDeleteProgram(prog.id)}
                        className="text-xs font-bold text-rose-600 hover:underline cursor-pointer disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {!programs.length && <p className="col-span-full p-8 text-center text-xs text-slate-400">{loading ? 'Loading programs...' : 'No programs found.'}</p>}
              </div>
            </div>
          )}

          {/* TAB 6: MEDIA GALLERY MANAGEMENT */}
          {activeTab === 'media' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-950">Media Gallery Management</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Manage published and draft photo and YouTube video entries for the public academy gallery.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                <button type="button" onClick={fetchAllData} disabled={loading} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold disabled:opacity-60">
                  Refresh Gallery
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    resetMediaForm();
                    setMediaForm((current) => ({ ...current, media_type: 'photo' }));
                    setActiveTab('media');
                  }}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Photo</span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    resetMediaForm();
                    setMediaForm((current) => ({ ...current, media_type: 'video' }));
                    setActiveTab('media');
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add YouTube Video</span>
                </button>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-slate-900">All Media Entries</h2>
                    <span className="text-[11px] font-bold text-slate-500">{mediaItems.length} total</span>
                  </div>

                  <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                    {mediaItems.length > 0 ? (
                      mediaItems.map((item) => (
                        <div key={item.id} className="border border-slate-200 rounded-2xl p-3">
                          <div className="flex items-start gap-3">
                            <div className="w-20 h-16 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shrink-0">
                              {(item.cover_image_url || item.media_url || (item.media_type === 'video' && item.youtube_video_id))
                                ? <img
                                    src={item.cover_image_url || item.media_url || `https://img.youtube.com/vi/${item.youtube_video_id}/hqdefault.jpg`}
                                    alt={item.alt_text || item.title}
                                    className="w-full h-full object-cover"
                                  />
                                : <div className="w-full h-full flex items-center justify-center text-slate-400"><Video className="w-6 h-6" aria-label="No preview available" /></div>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-bold text-slate-900 text-sm truncate">{item.title}</p>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${item.is_published ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                                  {item.is_published ? 'Published' : 'Draft'}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-1">{item.media_type === 'video' ? 'YouTube video' : 'Photo'} • Order {item.display_order || 0}</p>
                              <p className="text-[11px] text-slate-600 mt-2 line-clamp-2">{item.caption || 'No caption set.'}</p>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              disabled={loading}
                              onClick={() => handleToggleMediaPublished(item)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px] cursor-pointer disabled:opacity-50"
                            >
                              {item.is_published ? 'Unpublish' : 'Publish'}
                            </button>
                            <button
                              disabled={loading}
                              onClick={() => {
                                setEditingMediaId(item.id);
                                setMediaForm({
                                  ...item,
                                  media_file_base64: '',
                                  media_file_mime: '',
                                });
                                setMediaError(null);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-orange-50 text-orange-700 font-semibold text-[11px] cursor-pointer disabled:opacity-50"
                            >
                              Edit
                            </button>
                            <button
                              disabled={loading}
                              onClick={() => handleDeleteMedia(item.id)}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 font-semibold text-[11px] cursor-pointer disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 text-slate-400 text-xs">{loading ? 'Loading gallery...' : 'No media entries found yet.'}</div>
                    )}
                  </div>
                </div>

                <form onSubmit={handleSaveMedia} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-slate-900">{editingMediaId ? 'Edit Media' : 'Add Media'}</h2>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={resetMediaForm}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[11px] font-bold text-slate-700">Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setMediaForm((prev) => ({ ...prev, media_type: 'photo' }))}
                        className={`px-3 py-2 rounded-xl border text-xs font-semibold ${mediaForm.media_type === 'photo' ? 'bg-orange-600 text-white border-orange-600' : 'bg-slate-50 text-slate-700 border-slate-200'}`}
                      >
                        Photo
                      </button>
                      <button
                        type="button"
                        onClick={() => setMediaForm((prev) => ({ ...prev, media_type: 'video' }))}
                        className={`px-3 py-2 rounded-xl border text-xs font-semibold ${mediaForm.media_type === 'video' ? 'bg-orange-600 text-white border-orange-600' : 'bg-slate-50 text-slate-700 border-slate-200'}`}
                      >
                        YouTube Video
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Title</label>
                    <input
                      type="text"
                      value={mediaForm.title || ''}
                      onChange={(e) => setMediaForm((prev) => ({ ...prev, title: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                      placeholder="Classroom session / Student speaking practice"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">Caption</label>
                    <textarea
                      value={mediaForm.caption || ''}
                      onChange={(e) => setMediaForm((prev) => ({ ...prev, caption: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                    />
                  </div>

                  {mediaForm.media_type === 'photo' ? (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">Upload Photo</label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleMediaFileChange}
                        className="w-full text-[11px] text-slate-600"
                      />
                      {(mediaForm.media_file_base64 || mediaForm.media_url) && (
                        <div className="mt-2 rounded-xl overflow-hidden border border-slate-200">
                          <img src={mediaForm.media_file_base64 || mediaForm.media_url || ''} alt={mediaForm.alt_text || mediaForm.title || 'Photo preview'} className="w-full h-36 object-cover" />
                          {mediaForm.media_file_base64 && <p className="px-2 py-1 text-[10px] text-amber-700 bg-amber-50">Local preview — not saved until confirmed by the server.</p>}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">YouTube URL</label>
                        <input
                          type="url"
                          value={mediaForm.youtube_url || ''}
                          onChange={(e) => setMediaForm((prev) => ({ ...prev, youtube_url: e.target.value }))}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                          placeholder="https://www.youtube.com/watch?v=..."
                        />
                      </div>
                      {extractYouTubeId(mediaForm.youtube_url) && (
                        <div className="aspect-video overflow-hidden rounded-xl border border-slate-200">
                          <iframe
                            title={`${mediaForm.title || 'YouTube video'} preview`}
                            src={`https://www.youtube-nocookie.com/embed/${extractYouTubeId(mediaForm.youtube_url)}`}
                            className="w-full h-full"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">Cover Image (optional)</label>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleCoverFileChange}
                          className="w-full text-[11px] text-slate-600"
                        />
                        {(mediaForm.cover_file_base64 || mediaForm.cover_image_url) && (
                          <div className="mt-2 rounded-xl overflow-hidden border border-slate-200">
                            <img
                              src={mediaForm.cover_file_base64 || mediaForm.cover_image_url || ''}
                              alt="Cover image preview"
                              className="w-full h-36 object-cover"
                            />
                            {mediaForm.cover_file_base64 && (
                              <p className="px-2 py-1 text-[10px] text-amber-700 bg-amber-50">
                                Preview only — uploaded when you save.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">Alt Text</label>
                      <input
                        type="text"
                        value={mediaForm.alt_text || ''}
                        onChange={(e) => setMediaForm((prev) => ({ ...prev, alt_text: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">Display Order</label>
                      <input
                        type="number"
                        value={mediaForm.display_order ?? 0}
                        onChange={(e) => setMediaForm((prev) => ({ ...prev, display_order: Number(e.target.value) }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={mediaForm.is_published !== false}
                      onChange={(e) => setMediaForm((prev) => ({ ...prev, is_published: e.target.checked }))}
                    />
                    Published on the public gallery
                  </label>

                  {mediaError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-[11px] px-3 py-2">{mediaError}</div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl cursor-pointer disabled:opacity-60"
                  >
                    {loading ? 'Saving...' : editingMediaId ? 'Update Media Entry' : 'Save Media Entry'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 6: ANNOUNCEMENTS MANAGEMENT */}
          {activeTab === 'announcements' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h1 className="text-xl sm:text-2xl font-extrabold text-slate-950 leading-tight">Moving Banner Announcements</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Control active scrolling announcements displayed on the public website header.
                  </p>
                </div>
                <div className="grid grid-cols-1 xs:grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
                  <button type="button" onClick={fetchAllData} disabled={loading} className="w-full sm:w-auto px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold disabled:opacity-60">Refresh Announcements</button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setEditingAnnouncement({ content: '', is_active: true })}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Announcement</span>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs divide-y divide-slate-100">
                {announcements.map((ann) => (
                  <div key={ann.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                    <div className="space-y-2 min-w-0 sm:pr-4">
                      <p className="font-semibold text-slate-900 break-words leading-relaxed">{ann.content}</p>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          ann.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {ann.is_active ? 'Active on Public Site' : 'Inactive'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:flex items-stretch sm:items-center gap-2 w-full sm:w-auto shrink-0">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => handleToggleAnnouncement(ann)}
                        className="w-full sm:w-auto px-3 py-2 sm:py-1.5 bg-slate-100 rounded-lg text-slate-700 font-semibold hover:bg-slate-200 cursor-pointer disabled:opacity-50"
                      >
                        {ann.is_active ? 'Unpublish' : 'Publish'}
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => setEditingAnnouncement(ann)}
                        className="px-3 py-1.5 bg-slate-100 rounded-lg text-slate-700 font-semibold hover:bg-slate-200 cursor-pointer disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => handleDeleteAnnouncement(ann.id)}
                        className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg font-semibold hover:bg-rose-100 cursor-pointer disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                {!announcements.length && <p className="p-8 text-center text-xs text-slate-400">{loading ? 'Loading announcements...' : 'No announcements found.'}</p>}
              </div>
            </div>
          )}

          {activeTab === 'faqs' && isSuperAdmin && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-950">FAQ Management</h1>
                  <p className="text-xs text-slate-500 mt-1">Manage the existing public FAQ catalogue.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={fetchAllData} disabled={loading} className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold disabled:opacity-60">Refresh FAQs</button>
                  <button type="button" disabled={loading} onClick={() => setEditingFaq({ question: '', answer: '', is_published: true, display_order: faqs.length + 1 })} className="px-4 py-2 bg-orange-600 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 disabled:opacity-60">
                    <Plus className="w-4 h-4" /> Add FAQ
                  </button>
                </div>
              </div>

              {editingFaq && (
                <form onSubmit={handleSaveFaq} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                  <label className="block text-xs font-semibold text-slate-700">
                    Question
                    <input required maxLength={1000} value={editingFaq.question || ''} onChange={(event) => setEditingFaq({ ...editingFaq, question: event.target.value })} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg" />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    Answer
                    <textarea required maxLength={10000} rows={5} value={editingFaq.answer || ''} onChange={(event) => setEditingFaq({ ...editingFaq, answer: event.target.value })} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg" />
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={editingFaq.is_published !== false} onChange={(event) => setEditingFaq({ ...editingFaq, is_published: event.target.checked })} />
                    Published on public FAQs
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" disabled={loading} className="px-4 py-2 bg-orange-600 text-white text-xs font-bold rounded-lg disabled:opacity-60">{loading ? 'Saving...' : 'Save FAQ'}</button>
                    <button type="button" disabled={loading} onClick={() => setEditingFaq(null)} className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg disabled:opacity-60">Cancel</button>
                  </div>
                </form>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs divide-y divide-slate-100">
                {faqs.length ? faqs.map((faq) => (
                  <article key={faq.id} className="p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-bold text-slate-900">{faq.question}</h2>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${faq.is_published ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{faq.is_published ? 'Published' : 'Draft'}</span>
                      </div>
                      <p className="text-slate-600 whitespace-pre-wrap">{faq.answer}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button type="button" disabled={loading} onClick={() => setEditingFaq(faq)} className="font-bold text-orange-600 hover:underline disabled:opacity-50">Edit</button>
                      <button type="button" disabled={loading} onClick={() => handleDeleteFaq(faq.id)} className="font-bold text-rose-600 hover:underline disabled:opacity-50">Delete</button>
                    </div>
                  </article>
                )) : <p className="p-8 text-center text-xs text-slate-400">{loading ? 'Loading FAQs...' : 'No FAQs found.'}</p>}
              </div>
            </div>
          )}

          {/* TAB 7: EMAIL OUTBOX & RETRIES */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h1 className="text-xl sm:text-2xl font-extrabold text-slate-950 leading-tight">Email Notification Monitoring</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Track transactional emails dispatched via Resend, monitor status, and trigger retries for failed deliveries.
                  </p>
                </div>
              </div>

              <div className="bg-transparent sm:bg-white rounded-2xl sm:border sm:border-slate-200 sm:shadow-xs overflow-hidden">
                {/* Mobile-friendly notification cards */}
                <div className="grid grid-cols-1 gap-3 sm:hidden">
                  {notifications.length > 0 ? (
                    notifications.map((notif) => (
                      <article key={notif.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Email type</p>
                            <h2 className="mt-1 break-words text-sm font-bold capitalize text-slate-900">{notif.notification_type.replace('_', ' ')}</h2>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${notif.status === 'Sent' ? 'bg-emerald-100 text-emerald-800' : notif.status === 'Failed' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
                            {notif.status}
                          </span>
                        </div>
                        <div className="border-t border-slate-100 pt-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Recipient</p>
                          <p className="mt-1 break-all text-xs text-slate-700">{notif.recipient_email}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <p className="text-[10px] font-semibold text-slate-500">Attempts</p>
                            <p className="mt-1 text-sm font-bold text-slate-900">{notif.attempt_count}</p>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <p className="text-[10px] font-semibold text-slate-500">PDF attached</p>
                            <p className={`mt-1 text-xs font-bold ${notif.pdf_attached ? 'text-emerald-700' : 'text-slate-500'}`}>{notif.pdf_attached ? 'Yes' : 'No'}</p>
                          </div>
                        </div>
                        {(notif.error_message || notif.provider_message_id) && (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Error / details</p>
                            <p className="mt-1 break-words text-xs text-slate-600">{notif.error_message || notif.provider_message_id}</p>
                          </div>
                        )}
                        {notif.status === 'Failed' && (
                          <button type="button" onClick={() => handleRetryNotification(notif.id)} className="w-full rounded-xl bg-orange-600 px-4 py-3 text-sm font-bold text-white hover:bg-orange-700 active:bg-orange-800">
                            Retry email
                          </button>
                        )}
                      </article>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-400">No notifications logged in outbox.</div>
                  )}
                </div>
                {/* Desktop/tablet table */}
                <div className="hidden overflow-x-auto overscroll-x-contain sm:block">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="px-4 sm:px-5 py-3.5">Type</th>
                      <th className="px-5 py-3.5">Recipient</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5">Attempts</th>
                      <th className="px-5 py-3.5">PDF Attached</th>
                      <th className="px-5 py-3.5">Error / Details</th>
                      <th className="px-5 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {notifications.length > 0 ? (
                      notifications.map((notif) => (
                        <tr key={notif.id} className="hover:bg-slate-50">
                          <td className="px-5 py-4 font-bold text-slate-900 capitalize">
                            {notif.notification_type.replace('_', ' ')}
                          </td>
                          <td className="px-5 py-4 font-mono text-slate-600">{notif.recipient_email}</td>
                          <td className="px-5 py-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                notif.status === 'Sent'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : notif.status === 'Failed'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {notif.status}
                            </span>
                          </td>
                          <td className="px-5 py-4">{notif.attempt_count}</td>
                          <td className="px-5 py-4">
                            {notif.pdf_attached ? (
                              <span className="text-emerald-700 font-semibold">Yes (Official PDF)</span>
                            ) : (
                              <span className="text-slate-400">None</span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-slate-500 text-[11px] max-w-xs truncate">
                            {notif.error_message || notif.provider_message_id || 'Delivered to gateway'}
                          </td>
                          <td className="px-5 py-4 text-right">
                            {notif.status === 'Failed' && (
                              <button
                                onClick={() => handleRetryNotification(notif.id)}
                                className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg cursor-pointer"
                              >
                                Retry
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-slate-400">
                          No notifications logged in outbox.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB: SITE BRANDING & ASSETS */}
          {activeTab === 'branding' && (
            <div className="space-y-6 max-w-4xl">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-950">Site Branding & Assets</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Configure the academy visual brand identity, logos, favicon, and theme colors stored in the database.
                </p>
              </div>

              {editingBranding ? (
                <form onSubmit={handleSaveBranding} className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Academy Name</label>
                      <input
                        type="text"
                        required
                        value={editingBranding.academy_name || ''}
                        onChange={(e) => setEditingBranding({ ...editingBranding, academy_name: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Tagline</label>
                      <input
                        type="text"
                        value={editingBranding.tagline || ''}
                        onChange={(e) => setEditingBranding({ ...editingBranding, tagline: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4 space-y-4">
                    <h3 className="font-bold text-slate-900 text-sm">Logo & Visual Brand Assets</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Main Logo URL</label>
                        <input
                          type="text"
                          value={editingBranding.logo_url || ''}
                          onChange={(e) => setEditingBranding({ ...editingBranding, logo_url: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-[11px]"
                        />
                      </div>
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Main Logo Alt Text (main_logo_alt)</label>
                        <input
                          type="text"
                          value={editingBranding.main_logo_alt || editingBranding.logo_alt || ''}
                          onChange={(e) => setEditingBranding({ ...editingBranding, main_logo_alt: e.target.value, logo_alt: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                          placeholder="e.g. Uptrend's English Academy Official Logo"
                        />
                      </div>
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Favicon URL (favicon_url)</label>
                        <input
                          type="text"
                          value={editingBranding.favicon_url || ''}
                          onChange={(e) => setEditingBranding({ ...editingBranding, favicon_url: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-[11px]"
                          placeholder="/favicon.ico or Cloudflare R2 URL"
                        />
                      </div>
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Footer Logo URL (footer_logo_url)</label>
                        <input
                          type="text"
                          value={editingBranding.footer_logo_url || ''}
                          onChange={(e) => setEditingBranding({ ...editingBranding, footer_logo_url: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono text-[11px]"
                          placeholder="Logo used in dark footer background"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4 space-y-4">
                    <h3 className="font-bold text-slate-900 text-sm">Theme Colors & Official Documents</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Primary Color</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={editingBranding.primary_color || '#ea580c'}
                            onChange={(e) => setEditingBranding({ ...editingBranding, primary_color: e.target.value })}
                            className="w-8 h-8 rounded border border-slate-200 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={editingBranding.primary_color || '#ea580c'}
                            onChange={(e) => setEditingBranding({ ...editingBranding, primary_color: e.target.value })}
                            className="flex-1 px-3 py-2 border border-slate-200 rounded-xl font-mono"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Secondary Color</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={editingBranding.secondary_color || '#0f172a'}
                            onChange={(e) => setEditingBranding({ ...editingBranding, secondary_color: e.target.value })}
                            className="w-8 h-8 rounded border border-slate-200 cursor-pointer"
                          />
                          <input
                            type="text"
                            value={editingBranding.secondary_color || '#0f172a'}
                            onChange={(e) => setEditingBranding({ ...editingBranding, secondary_color: e.target.value })}
                            className="flex-1 px-3 py-2 border border-slate-200 rounded-xl font-mono"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="font-bold text-slate-700 block mb-1">Official Fee Structure PDF Path</label>
                        <input
                          type="text"
                          value={editingBranding.official_pdf_url || ''}
                          onChange={(e) => setEditingBranding({ ...editingBranding, official_pdf_url: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl shadow-sm cursor-pointer"
                    >
                      Save Branding Configurations
                    </button>
                  </div>
                </form>
              ) : (
                <div className="bg-white p-8 rounded-2xl border text-center text-slate-500">
                  Loading site branding data...
                </div>
              )}
            </div>
          )}

          {/* TAB: ADMIN ROLES & ACCESS (SUPER ADMIN ONLY) */}
          {activeTab === 'roles' && isSuperAdmin && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold text-slate-950 leading-tight">Admin Roles & Access Control</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Manage staff and administrator privileges. Enforces strict server-side role validation in Supabase.
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[920px] text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="px-4 sm:px-5 py-3.5">Administrator</th>
                      <th className="px-5 py-3.5">Auth UID</th>
                      <th className="px-5 py-3.5">Role</th>
                      <th className="px-5 py-3.5">Status</th>
                      <th className="px-5 py-3.5">Last Login</th>
                      <th className="px-5 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {adminProfiles.length > 0 ? (
                      adminProfiles.map((adm) => (
                        <tr key={adm.id} className="hover:bg-slate-50">
                          <td className="px-5 py-4">
                            <div className="font-bold text-slate-900">{adm.full_name}</div>
                            <div className="text-[11px] text-slate-500">{adm.email}</div>
                          </td>
                          <td className="px-5 py-4 font-mono text-[11px] text-slate-500">
                            {adm.id}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`px-2.5 py-1 rounded text-[10px] font-extrabold uppercase ${
                                adm.role === 'super_admin'
                                  ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                  : adm.role === 'admin'
                                  ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              {adm.role}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                adm.is_active
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {adm.is_active ? 'Active' : 'Suspended'}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-slate-500 text-[11px]">
                            {adm.last_login ? new Date(adm.last_login).toLocaleString('en-IN') : 'Never'}
                          </td>
                          <td className="px-5 py-4 text-right space-x-2">
                            {adm.id !== currentAdmin.id && (
                              <div className="inline-flex items-center gap-2">
                                <select
                                  value={adm.role}
                                  onChange={(e) => handleUpdateAdminRole(adm.id, e.target.value as AdminRole, adm.is_active)}
                                  className="px-2 py-1 bg-slate-50 border border-slate-300 rounded text-xs font-semibold cursor-pointer"
                                >
                                  <option value="staff">Staff</option>
                                  <option value="admin">Admin</option>
                                  <option value="super_admin">Super Admin</option>
                                </select>
                                <button
                                  onClick={() => handleUpdateAdminRole(adm.id, adm.role, !adm.is_active)}
                                  className={`px-2 py-1 rounded text-xs font-bold cursor-pointer ${
                                    adm.is_active
                                      ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  }`}
                                >
                                  {adm.is_active ? 'Suspend' : 'Activate'}
                                </button>
                              </div>
                            )}
                            {adm.id === currentAdmin.id && (
                              <span className="text-[11px] font-semibold text-slate-400 italic">Current Session</span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-slate-400">
                          No admin profiles found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: SETTINGS & OFFICIAL PDF */}
          {activeTab === 'settings' && (
            <div className="space-y-8 max-w-4xl">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-950">Settings & Official PDF Configuration</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Manage official documents, verified academy contact coordinates, and brand assets.
                </p>
              </div>

<div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
  <div>
    <h3 className="font-bold text-slate-900 text-sm">
      Official Fee Structure & Terms PDF
    </h3>
    <p className="text-xs text-slate-600 mt-1">
      Edit the official academy details and course information.
      Save your settings before generating the final document.
    </p>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    {([
      ['academyName', 'Academy Name'],
      ['phone', 'Phone'],
      ['email', 'Email'],
      ['address', 'Address'],
      ['hours', 'Opening Hours'],
    ] as const).map(([field, label]) => (
      <label key={field} className="block space-y-1">
        <span className="text-xs font-semibold text-slate-700">
          {label}
        </span>
        <input
          value={officialDocumentSettings[field]}
          onChange={(e) =>
            setOfficialDocumentSettings((previous) => ({
              ...previous,
              [field]: e.target.value,
            }))
          }
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
    ))}
  </div>

  <div className="space-y-3 rounded-xl border border-slate-200 p-4">
    <div>
      <h4 className="font-bold text-slate-900 text-sm">Joining Information</h4>
      <p className="text-xs text-slate-600 mt-1">These values appear in the student-view demo PDF. Editing them here does not change student records or payments.</p>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {([
        ['joiningDate', 'Joining Date'],
        ['classSchedule', 'Class Schedule'],
        ['classTimings', 'Class Timings'],
        ['venue', 'Venue'],
      ] as const).map(([field, label]) => (
        <label key={field} className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700">{label}</span>
          <input
            value={officialDocumentSettings[field]}
            onChange={(e) => setOfficialDocumentSettings((previous) => ({ ...previous, [field]: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder={field === 'venue' ? 'Academy address or online' : 'To be confirmed'}
          />
        </label>
      ))}
    </div>
  </div>

  <label className="block space-y-1">
    <span className="text-xs font-semibold text-slate-700">
      Welcome Message
    </span>
    <textarea
      rows={3}
      value={officialDocumentSettings.welcomeMessage}
      onChange={(e) =>
        setOfficialDocumentSettings((previous) => ({
          ...previous,
          welcomeMessage: e.target.value,
        }))
      }
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
    />
  </label>

  <label className="block space-y-1">
    <span className="text-xs font-semibold text-slate-700">
      Terms and Conditions
    </span>
    <textarea
      rows={3}
      value={officialDocumentSettings.terms}
      onChange={(e) =>
        setOfficialDocumentSettings((previous) => ({
          ...previous,
          terms: e.target.value,
        }))
      }
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
    />
  </label>

  <div className="space-y-3">
    <h4 className="font-bold text-slate-900 text-sm">
      Courses, Durations & Fees
    </h4>

    {officialDocumentSettings.courses.map((course, index) => (
      <div
        key={index}
        className="rounded-xl border border-slate-200 p-4 space-y-3"
      >
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-700">
            Course Name
          </span>
          <input
            value={course.name}
            onChange={(e) =>
              setOfficialDocumentSettings((previous) => ({
                ...previous,
                courses: previous.courses.map((item, i) =>
                  i === index ? { ...item, name: e.target.value } : item
                ),
              }))
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">
              Duration
            </span>
            <input
              value={course.duration}
              onChange={(e) =>
                setOfficialDocumentSettings((previous) => ({
                  ...previous,
                  courses: previous.courses.map((item, i) =>
                    i === index
                      ? { ...item, duration: e.target.value }
                      : item
                  ),
                }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">
              Fee (leave blank until confirmed)
            </span>
            <input
              value={course.fee}
              onChange={(e) =>
                setOfficialDocumentSettings((previous) => ({
                  ...previous,
                  courses: previous.courses.map((item, i) =>
                    i === index
                      ? { ...item, fee: e.target.value }
                      : item
                  ),
                }))
              }
              placeholder="To be confirmed"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>
    ))}
  </div>

  <button
    type="button"
    onClick={saveOfficialDocumentSettings}
    className="rounded-lg bg-orange-600 px-5 py-3 text-sm font-bold text-white hover:bg-orange-700"
  >
    Save Official Settings
  </button>

 <button
  type="button"
  onClick={previewOfficialDocumentPdf}
  className="ml-3 rounded-lg bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
>
  Generate PDF Preview
</button>

{officialPdfPreviewUrl && (
  <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h4 className="font-bold text-slate-900">Student-view PDF Preview</h4>
        <p className="text-xs text-slate-600">Fictional demo student and sample payment figures only. Nothing has been saved.</p>
      </div>
      <div className="flex gap-3">
        <a href={officialPdfPreviewUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-orange-700 hover:underline">
          Open in new tab
        </a>
        <button type="button" onClick={() => setOfficialPdfPreviewUrl((url) => { if (url) URL.revokeObjectURL(url); return null; })} className="text-sm font-semibold text-slate-600 hover:underline">
          Close preview
        </button>
      </div>
    </div>
    <iframe title="Student-view demo PDF preview" src={officialPdfPreviewUrl} className="h-[75vh] min-h-[520px] w-full rounded-lg border border-slate-300 bg-white" />
  </div>
)}
</div>

            </div>
          )}
        </main>
      </div>

      {selectedCallback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="callback-detail-title" className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h2 id="callback-detail-title" className="text-lg font-bold text-slate-900">Callback Request</h2>
              <button type="button" aria-label="Close callback details" onClick={() => setSelectedCallback(null)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div><dt className="text-slate-500">Name</dt><dd className="font-semibold text-slate-900">{selectedCallback.full_name}</dd></div>
              <div><dt className="text-slate-500">Mobile</dt><dd className="font-semibold text-slate-900">{selectedCallback.mobile}</dd></div>
              <div><dt className="text-slate-500">Email</dt><dd className="font-semibold text-slate-900">{selectedCallback.email || '—'}</dd></div>
              <div><dt className="text-slate-500">Program</dt><dd className="font-semibold text-slate-900">{selectedCallback.program_name}</dd></div>
              <div><dt className="text-slate-500">Preferred time</dt><dd className="font-semibold text-slate-900">{selectedCallback.preferred_contact_time}</dd></div>
              <div><dt className="text-slate-500">Received</dt><dd className="font-semibold text-slate-900">{new Date(selectedCallback.created_at).toLocaleString('en-IN')}</dd></div>
            </dl>
            <p className="p-3 bg-slate-50 rounded-xl text-xs text-slate-700 whitespace-pre-wrap">{selectedCallback.message || 'No message provided.'}</p>
            <label className="block text-xs font-semibold text-slate-700">Status
              <select value={selectedCallback.status} disabled={loading} onChange={(event) => handleCallbackStatusChange(selectedCallback, event.target.value as CallbackRequest['status'])} className="ml-2 px-3 py-2 border border-slate-200 rounded-lg">
                {(['New', 'Contacted', 'Resolved'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
          </section>
        </div>
      )}

      {selectedContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="contact-detail-title" className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h2 id="contact-detail-title" className="text-lg font-bold text-slate-900">Contact Enquiry</h2>
              <button type="button" aria-label="Close contact details" onClick={() => setSelectedContact(null)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div><dt className="text-slate-500">Name</dt><dd className="font-semibold text-slate-900">{selectedContact.full_name}</dd></div>
              <div><dt className="text-slate-500">Email</dt><dd className="font-semibold text-slate-900">{selectedContact.email}</dd></div>
              <div><dt className="text-slate-500">Mobile</dt><dd className="font-semibold text-slate-900">{selectedContact.mobile || '—'}</dd></div>
              <div><dt className="text-slate-500">Received</dt><dd className="font-semibold text-slate-900">{new Date(selectedContact.created_at).toLocaleString('en-IN')}</dd></div>
            </dl>
            <h3 className="font-bold text-sm text-slate-900">{selectedContact.subject}</h3>
            <p className="p-3 bg-slate-50 rounded-xl text-xs text-slate-700 whitespace-pre-wrap">{selectedContact.message}</p>
            <label className="block text-xs font-semibold text-slate-700">Status
              <select value={selectedContact.status} disabled={loading} onChange={(event) => handleContactStatusChange(selectedContact, event.target.value as ContactEnquiry['status'])} className="ml-2 px-3 py-2 border border-slate-200 rounded-lg">
                {(['New', 'Replied', 'Archived'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
          </section>
        </div>
      )}

      {/* Application Review Details Modal */}
      {selectedApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 space-y-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-orange-600">
                  Application Review
                </span>
                <h3 className="text-xl font-extrabold text-slate-900">
                  {selectedApp.student_name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedApp(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-500 block">Reference Code</span>
                <span className="font-bold text-slate-900 font-mono text-sm">
                  {selectedApp.application_reference}
                </span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-500 block">Selected Course</span>
                <span className="font-bold text-slate-900">{selectedApp.program_name}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-500 block">Mobile</span>
                <span className="font-bold text-slate-900">{selectedApp.mobile}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-500 block">Email</span>
                <span className="font-bold text-slate-900">{selectedApp.email}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-500 block">Qualification</span>
                <span className="font-bold text-slate-900">{selectedApp.qualification}</span>
              </div>
              {selectedApp.date_of_birth && (
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-500 block">Date of Birth</span>
                  <span className="font-bold text-slate-900">{selectedApp.date_of_birth}</span>
                </div>
              )}
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-500 block">Submission Date</span>
                <span className="font-bold text-slate-900">
                  {new Date(selectedApp.created_at).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {selectedApp.address && (
              <div className="text-xs p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-500 block font-semibold mb-0.5">Address</span>
                <span className="text-slate-800">{selectedApp.address}</span>
              </div>
            )}

            {selectedApp.message && (
              <div className="text-xs p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-500 block font-semibold mb-0.5">Student Notes</span>
                <span className="text-slate-800">{selectedApp.message}</span>
              </div>
            )}

            {selectedApp.photo_data_url && (
              <div className="text-xs">
                <span className="text-slate-500 block font-semibold mb-2">Student Passport Photo</span>
                <button type="button" onClick={() => setAppPhotoModal(selectedApp.photo_data_url || null)} className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500">
                  <img
                    src={selectedApp.photo_data_url}
                    alt="View student passport photo"
                    className="w-28 h-36 object-cover rounded-xl border border-slate-300 shadow-xs"
                  />
                </button>
              </div>
            )}

            {selectedApp.status === 'Pending' && (
              <section className="p-5 rounded-2xl border border-orange-200 bg-orange-50/50 space-y-4">
                <div>
                  <h4 className="font-extrabold text-slate-900 text-sm">Joining Information</h4>
                  <p className="text-[11px] text-slate-600 mt-1">Complete all four fields before approving this application. These details will be included in the approval request for the official PDF.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <label className="block font-semibold text-slate-700">Joining Date
                    <input type="date" required value={applicationJoiningInfo.joiningDate === 'To be confirmed' ? '' : applicationJoiningInfo.joiningDate} onChange={(event) => setApplicationJoiningInfo((prev) => ({ ...prev, joiningDate: event.target.value }))} aria-label="Choose joining date" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 cursor-pointer" />
                  </label>
                  <label className="block font-semibold text-slate-700">Class Schedule
                    <input required value={applicationJoiningInfo.classSchedule} onChange={(event) => setApplicationJoiningInfo((prev) => ({ ...prev, classSchedule: event.target.value }))} placeholder="e.g. Monday to Saturday" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg bg-white" />
                  </label>
                  <label className="block font-semibold text-slate-700">Class Timings
                    <input required value={applicationJoiningInfo.classTimings} onChange={(event) => setApplicationJoiningInfo((prev) => ({ ...prev, classTimings: event.target.value }))} placeholder="e.g. 7:00 AM to 8:00 AM" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg bg-white" />
                  </label>
                  <label className="block font-semibold text-slate-700">Venue
                    <input required value={applicationJoiningInfo.venue} onChange={(event) => setApplicationJoiningInfo((prev) => ({ ...prev, venue: event.target.value }))} placeholder="Academy address or online" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg bg-white" />
                  </label>
                </div>
                {(['joiningDate', 'classSchedule', 'classTimings', 'venue'] as const).some((key) => !applicationJoiningInfo[key].trim() || applicationJoiningInfo[key].trim().toLowerCase() === 'to be confirmed') && (
                  <p className="text-[11px] font-semibold text-rose-700">Approval stays disabled until all fields contain final details (not “To be confirmed”).</p>
                )}
              </section>
            )}

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                Current Status: <strong className="text-slate-900">{selectedApp.status}</strong>
              </span>

              <div className="flex items-center gap-2">
                {isSuperAdmin && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleDeleteApplication(selectedApp.id)}
                    className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Record</span>
                  </button>
                )}

                {selectedApp.status === 'Pending' && (
                  <button
                    type="button"
                    disabled={loading || (['joiningDate', 'classSchedule', 'classTimings', 'venue'] as const).some((key) => !applicationJoiningInfo[key].trim() || applicationJoiningInfo[key].trim().toLowerCase() === 'to be confirmed')}
                    onClick={() => handleApproveApp(selectedApp.id)}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>Confirm Approval & Send Official PDF</span>
                  </button>
                )}
                {selectedApp.status === 'Accepted' && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleMarkApplicationPending(selectedApp.id)}
                    className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold text-xs rounded-xl disabled:opacity-50"
                  >
                    Mark Pending
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Payment Register Modal — independent of application approval */}
      {paymentApp && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-register-title"
            className="bg-white rounded-3xl max-w-4xl w-full p-6 sm:p-8 space-y-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
                  Manual Payment Register
                </span>
                <h2 id="payment-register-title" className="text-xl font-extrabold text-slate-900">
                  {paymentApp.student_name}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {paymentApp.application_reference} · {paymentApp.program_name || 'Course not specified'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Payment records do not change application approval status.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close payment register"
                onClick={() => {
                  setPaymentApp(null);
                  setPaymentData(null);
                  setPaymentError(null);
                  setEditingPaymentId(null);
                }}
                className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {paymentLoading && (
              <p role="status" className="text-sm text-slate-600 py-6">
                Loading payment records…
              </p>
            )}

            {paymentError && (
              <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-800">
                {paymentError}
                <button
                  type="button"
                  onClick={() => void loadApplicationPaymentData(paymentApp)}
                  className="ml-3 font-bold underline"
                >
                  Retry
                </button>
              </div>
            )}

            {!paymentLoading && paymentData && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                    <p className="text-xs text-slate-500">Agreed total fee</p>
                    <p className="text-xl font-extrabold text-slate-900 mt-1">
                      {paymentData.feeAgreement
                        ? `₹${Number(paymentData.feeAgreement.agreed_total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : 'Not set'}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
                    <p className="text-xs text-emerald-700">Total paid</p>
                    <p className="text-xl font-extrabold text-emerald-800 mt-1">
                      ₹{Number(paymentData.totalPaid).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4">
                    <p className="text-xs text-amber-700">Remaining balance</p>
                    <p className="text-xl font-extrabold text-amber-800 mt-1">
                      {paymentData.remainingBalance == null
                        ? 'Set fee first'
                        : `₹${Number(paymentData.remainingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <div>
                    <p className="font-bold text-slate-900">Student Enrollment & Fee Confirmation</p>
                    <p className="mt-1 text-xs text-slate-600">Downloads a separate PDF for this student and selected course using saved fee/payment records.</p>
                  </div>
                  <button
                    type="button"
                    disabled={paymentLoading || paymentSaving || paymentApp.status !== 'Accepted' || !paymentData}
                    onClick={() => void generateStudentConfirmationPdf()}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                    title={paymentApp.status !== 'Accepted' ? 'Approve this application first' : 'Download student confirmation PDF'}
                  >
                    <FileCheck className="h-4 w-4" />
                    Download Student PDF
                  </button>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                  <h3 className="font-bold text-slate-900">Agreed fee</h3>
                  {isAdminOrHigher ? (
                    <>
                      <label className="block text-xs font-semibold text-slate-600">
                        Total fee agreed with this student (INR)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={feeTotalInput}
                          onChange={(event) => setFeeTotalInput(event.target.value)}
                          disabled={paymentSaving}
                          placeholder="Enter the manually agreed fee"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                        />
                      </label>
                      <label className="block text-xs font-semibold text-slate-600">
                        Fee notes (optional)
                        <textarea
                          value={feeNotesInput}
                          onChange={(event) => setFeeNotesInput(event.target.value)}
                          disabled={paymentSaving}
                          maxLength={2000}
                          rows={2}
                          placeholder="Notes about the agreed fee"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={paymentSaving || paymentLoading || !feeTotalInput.trim()}
                        onClick={() => void saveAgreedFee()}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm disabled:opacity-50"
                      >
                        {paymentSaving ? 'Saving…' : 'Save agreed fee'}
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-slate-600">
                      Only admins and super admins can change the agreed fee.
                    </p>
                  )}
                  {paymentData.feeAgreement?.notes && (
                    <p className="text-xs text-slate-600">
                      <span className="font-semibold">Saved notes:</span> {paymentData.feeAgreement.notes}
                    </p>
                  )}
                </div>

                {isAdminOrHigher && paymentData.feeAgreement && (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
                    <h3 className="font-bold text-slate-900">
                      {editingPaymentId ? 'Edit payment' : 'Record payment'}
                    </h3>
                    <label className="block text-xs font-semibold text-slate-600">
                      Amount (INR)
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={paymentAmountInput}
                        onChange={(event) => setPaymentAmountInput(event.target.value)}
                        disabled={paymentSaving}
                        placeholder="Amount received"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="block text-xs font-semibold text-slate-600">
                        Payment method
                        <select
                          value={paymentMethodInput}
                          onChange={(event) => setPaymentMethodInput(event.target.value as PaymentMethod)}
                          disabled={paymentSaving}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          <option value="cash">Cash</option>
                          <option value="upi">UPI</option>
                          <option value="bank_transfer">Bank transfer</option>
                          <option value="card">Card</option>
                          <option value="cheque">Cheque</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                      <label className="block text-xs font-semibold text-slate-600">
                        Payment stage
                        <select
                          value={paymentStageInput}
                          onChange={(event) => setPaymentStageInput(event.target.value as PaymentStage)}
                          disabled={paymentSaving}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          <option value="first_fee">First fee</option>
                          <option value="second_fee">Second fee</option>
                          <option value="installment">Installment</option>
                          <option value="final_payment">Final payment</option>
                        </select>
                      </label>
                    </div>
                    <label className="block text-xs font-semibold text-slate-600">
                      Reference number (optional)
                      <input
                        type="text"
                        maxLength={200}
                        value={paymentReferenceInput}
                        onChange={(event) => setPaymentReferenceInput(event.target.value)}
                        disabled={paymentSaving}
                        placeholder="Transaction ID or receipt number"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </label>
                    <label className="block text-xs font-semibold text-slate-600">
                      Notes (optional)
                      <textarea
                        rows={2}
                        maxLength={2000}
                        value={paymentNotesInput}
                        onChange={(event) => setPaymentNotesInput(event.target.value)}
                        disabled={paymentSaving}
                        placeholder="Additional payment details"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={paymentSaving || paymentLoading || !paymentAmountInput.trim()}
                        onClick={() => void savePaymentEntry()}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm disabled:opacity-50"
                      >
                        {paymentSaving ? 'Saving…' : editingPaymentId ? 'Save changes' : 'Record payment'}
                      </button>
                      {editingPaymentId && (
                        <button
                          type="button"
                          disabled={paymentSaving}
                          onClick={resetPaymentForm}
                          className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-sm disabled:opacity-50"
                        >
                          Cancel edit
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-bold text-slate-900">Payment history</h3>
                    <span className="text-xs text-slate-500">
                      {paymentData.payments.length} record{paymentData.payments.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {paymentData.payments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                      No payments recorded for this application yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-3 py-3 font-bold">Recorded</th>
                            <th className="px-3 py-3 font-bold">Stage</th>
                            <th className="px-3 py-3 font-bold">Method</th>
                            <th className="px-3 py-3 font-bold text-right">Amount</th>
                            <th className="px-3 py-3 font-bold">Reference / notes</th>
                            <th className="px-3 py-3 font-bold">Recorded by</th>
                            {isAdminOrHigher && <th className="px-3 py-3 font-bold">Actions</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {paymentData.payments.map((payment) => (
                            <tr key={payment.id} className="align-top">
                              <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                                {new Date(payment.recorded_at).toLocaleString('en-IN')}
                              </td>
                              <td className="px-3 py-3 text-slate-700">
                                {payment.payment_stage.replaceAll('_', ' ')}
                              </td>
                              <td className="px-3 py-3 text-slate-700">
                                {payment.payment_method.replaceAll('_', ' ')}
                              </td>
                              <td className="px-3 py-3 text-right font-bold text-slate-900 whitespace-nowrap">
                                ₹{Number(payment.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="px-3 py-3 text-slate-600 min-w-36">
                                {payment.reference_number || '—'}
                                {payment.notes && <p className="mt-1 whitespace-pre-wrap">{payment.notes}</p>}
                              </td>
                              <td className="px-3 py-3 text-slate-600">
                                {payment.recorded_by_name || payment.recorded_by || '—'}
                              </td>
                              {isAdminOrHigher && (
                                <td className="px-3 py-3">
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      disabled={paymentSaving || paymentLoading}
                                      onClick={() => beginEditPayment(payment)}
                                      className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      disabled={paymentSaving || paymentLoading}
                                      onClick={() => void removePaymentEntry(payment)}
                                      className="rounded-lg border border-red-200 px-2.5 py-1.5 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setPaymentApp(null);
                  setPaymentData(null);
                  setPaymentError(null);
                  setEditingPaymentId(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Passport Photo Preview Modal */}
      {appPhotoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="bg-white p-4 rounded-2xl max-w-sm w-full space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="font-bold text-sm text-slate-800">Passport Photo Preview</h4>
              <button onClick={() => setAppPhotoModal(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <img src={appPhotoModal} alt="Passport" className="w-full h-auto rounded-lg shadow-inner" />
          </div>
        </div>
      )}

      {/* Program Add/Edit Modal */}
      {viewingProgram && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="program-detail-title" className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="program-detail-title" className="font-bold text-lg text-slate-900">{viewingProgram.title}</h2>
                <p className="text-xs text-slate-500">{viewingProgram.is_published ? 'Published' : 'Draft'}</p>
              </div>
              <button type="button" aria-label="Close program details" onClick={() => setViewingProgram(null)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            {viewingProgram.image_url && <img src={viewingProgram.image_url} alt="" className="w-full max-h-48 object-cover rounded-xl" />}
            <p className="text-sm text-slate-700">{viewingProgram.short_description}</p>
            <p className="text-xs text-slate-600 whitespace-pre-wrap">{viewingProgram.description}</p>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-slate-500">Level</dt><dd className="font-semibold">{viewingProgram.level || '—'}</dd></div>
              <div><dt className="text-slate-500">Duration</dt><dd className="font-semibold">{viewingProgram.duration || '—'}</dd></div>
              <div><dt className="text-slate-500">Target audience</dt><dd className="font-semibold">{viewingProgram.target_audience}</dd></div>
              <div><dt className="text-slate-500">Age range</dt><dd className="font-semibold">{viewingProgram.age_range || '—'}</dd></div>
            </dl>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setViewingProgram(null)} className="px-4 py-2 border rounded-xl text-slate-600">Close</button>
              <button type="button" onClick={() => { setEditingProgram(viewingProgram); setViewingProgram(null); }} className="px-4 py-2 bg-orange-600 text-white font-bold rounded-xl">Edit Program</button>
            </div>
          </section>
        </div>
      )}

      {editingProgram && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-lg text-slate-900">
              {editingProgram.id ? 'Edit Program' : 'Add New Program'}
            </h3>
            <form onSubmit={handleSaveProgram} className="space-y-3 text-xs max-h-[75vh] overflow-y-auto pr-1">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Program Image</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleProgramImageChange}
                  disabled={loading}
                  className="block w-full rounded-xl border border-slate-200 p-2 text-xs"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  JPEG, PNG, or WebP; maximum 5 MB. Leave empty to keep the current image.
                </p>
                {(editingProgram.image_file_base64 || editingProgram.image_url) && (
                  <img
                    src={editingProgram.image_file_base64 || editingProgram.image_url}
                    alt="Program image preview"
                    className="mt-3 h-40 w-full rounded-xl object-cover bg-slate-100"
                  />
                )}
                {editingProgram.image_file_base64 && (
                  <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                    New image selected — it will replace the current image when saved.
                  </p>
                )}
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={editingProgram.title || ''}
                  onChange={(e) => setEditingProgram({ ...editingProgram, title: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Short Description</label>
                <textarea
                  rows={2}
                  required
                  value={editingProgram.short_description || ''}
                  onChange={(e) => setEditingProgram({ ...editingProgram, short_description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Full Description</label>
                <textarea
                  rows={3}
                  required
                  value={editingProgram.description || ''}
                  onChange={(e) => setEditingProgram({ ...editingProgram, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Duration</label>
                  <input
                    type="text"
                    value={editingProgram.duration || ''}
                    onChange={(e) => setEditingProgram({ ...editingProgram, duration: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Level</label>
                  <input
                    type="text"
                    value={editingProgram.level || ''}
                    onChange={(e) => setEditingProgram({ ...editingProgram, level: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl"
                  />
                </div>
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Target Audience</label>
                <input
                  type="text"
                  required
                  value={editingProgram.target_audience || ''}
                  onChange={(e) => setEditingProgram({ ...editingProgram, target_audience: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl"
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="published"
                  checked={editingProgram.is_published ?? true}
                  onChange={(e) => setEditingProgram({ ...editingProgram, is_published: e.target.checked })}
                />
                <label htmlFor="published" className="font-semibold text-slate-700">Published on Website</label>
              </div>

              <div className="pt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setEditingProgram(null)}
                  className="px-4 py-2 border rounded-xl text-slate-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-orange-600 text-white font-bold rounded-xl disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save Program'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Announcement Add/Edit Modal */}
      {editingAnnouncement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-lg text-slate-900">
              {editingAnnouncement.id ? 'Edit Announcement' : 'New Announcement'}
            </h3>
            <form onSubmit={handleSaveAnnouncement} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Announcement Text</label>
                <textarea
                  rows={3}
                  required
                  value={editingAnnouncement.content || ''}
                  onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, content: e.target.value })}
                  placeholder="Enter notice text to scroll on website..."
                  className="w-full px-3 py-2 border rounded-xl"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ann-active"
                  checked={editingAnnouncement.is_active ?? true}
                  onChange={(e) => setEditingAnnouncement({ ...editingAnnouncement, is_active: e.target.checked })}
                />
                <label htmlFor="ann-active" className="font-semibold text-slate-700">Active (Visible in moving banner)</label>
              </div>

              <div className="pt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setEditingAnnouncement(null)}
                  className="px-4 py-2 border rounded-xl text-slate-600 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-orange-600 text-white font-bold rounded-xl disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save Notice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

function ClockIcon(props: any) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" strokeWidth="2" />
      <path d="M12 6v6l4 2" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
