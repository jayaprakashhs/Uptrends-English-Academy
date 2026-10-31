import React, { useState, useEffect, useRef } from 'react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import {
  DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
  type OfficialSection,
  type OfficialDocumentSettings,
} from '../../official-document';
import { supabase } from '../lib/supabase';


import {
  AdminProfile,
  AdminRole,
  StudentApplication,
  ApplicationNotification,
  CallbackRequest,
  Program,
  Announcement,
  MediaItem,
  FAQ,
  SiteBranding,
} from '../types';
import {
  LayoutDashboard,
  Users,
  PhoneCall,
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
  GraduationCap,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { extractYouTubeId } from '../lib/youtube';
import { fetchSystemStatus, type IntegrationHealth, type SystemStatus } from '../lib/systemStatus';
import { AdminDemoClassRequests } from '../components/AdminDemoClassRequests';

interface AdminPortalProps {
  currentAdmin: AdminProfile;
  onLogout: () => void;
  onSessionExpired: () => void;
  setCurrentPage: (page: string) => void;
}

type BrandingImageField =
  | 'logo_file_base64'
  | 'favicon_file_base64'
  | 'footer_logo_file_base64'
  | 'hero_photo_file_base64';

type BrandingEditor = Partial<SiteBranding> & Partial<Record<BrandingImageField, string>>;

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

interface ApplicationPhotoCleanupJob {
  id: string;
  application_reference: string;
  status: 'pending' | 'processing' | 'failed';
  attempt_count: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ProgramFeeConfiguration {
  program_id: string;
  tuition_fee: number | null;
  registration_fee: number;
  study_material_fee: number;
  other_charges: number;
  discount_type: 'amount' | 'percent';
  discount_value: number;
  final_payable: number | null;
  updated_at?: string;
}

type ProgramEditor = Partial<Program> & {
  image_file_base64?: string;
  feeConfiguration?: ProgramFeeConfiguration;
};

const emptyProgramFeeConfiguration = (programId = ''): ProgramFeeConfiguration => ({
  program_id: programId,
  tuition_fee: null,
  registration_fee: 0,
  study_material_fee: 0,
  other_charges: 0,
  discount_type: 'amount',
  discount_value: 0,
  final_payable: null,
});

const calculateProgramFinalPayable = (fee: ProgramFeeConfiguration | undefined): number | null => {
  if (!fee || fee.tuition_fee === null) return null;
  const subtotal = fee.tuition_fee + fee.registration_fee + fee.study_material_fee + fee.other_charges;
  const discount = fee.discount_type === 'percent'
    ? subtotal * fee.discount_value / 100
    : fee.discount_value;
  return Math.max(0, Number((subtotal - discount).toFixed(2)));
};

interface DashboardDemoRequest {
  id: string;
  full_name: string;
  city: string;
  status: string;
  created_at: string;
}

interface RequestEmailNotification {
  id: string;
  request_type: 'demo_class_requests' | 'callback_requests';
  request_id: string;
  notification_type: 'applicant_confirmation' | 'academy_notification';
  recipient_email: string;
  status: 'Pending' | 'Sent' | 'Failed';
  attempt_count: number;
  provider_message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
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
  onSessionExpired,
  setCurrentPage,
}) => {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [sessionNow, setSessionNow] = useState(Date.now());
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);

  useEffect(() => {
    const authClient = supabase;
    if (!authClient) {
      setSessionCheckFailed(true);
      return;
    }

    let active = true;
    let expirationCheckInProgress = false;
    let expirationHandled = false;
    let sessionCheckUnavailable = false;
    let nextSessionRetryAt = Date.now() + 5000;
    let currentExpiry: number | null = null;

    const updateSessionExpiry = (session: { expires_at?: number } | null) => {
      currentExpiry = typeof session?.expires_at === 'number' ? session.expires_at : null;
      sessionCheckUnavailable = false;
      setSessionExpiresAt(currentExpiry);
      setSessionNow(Date.now());
      setSessionCheckFailed(false);
    };

    const handleExpiredSession = () => {
      if (expirationHandled) return;
      expirationHandled = true;
      sessionStorage.removeItem('uptrends_access_token');
      onSessionExpired();
    };

    const verifyExpiredSession = async () => {
      if (!active || expirationCheckInProgress || expirationHandled) return;
      expirationCheckInProgress = true;
      sessionCheckUnavailable = false;
      setSessionCheckFailed(false);
      try {
        const { data, error } = await authClient.auth.getSession();
        if (error) {
          sessionCheckUnavailable = true;
          setSessionCheckFailed(true);
          console.error('Unable to verify the admin session before expiry handling.', error);
          return;
        }

        const session = data.session;
        if (!session) {
          handleExpiredSession();
          return;
        }

        updateSessionExpiry(session);
        if (typeof session.expires_at !== 'number' || session.expires_at * 1000 <= Date.now()) {
          try {
            const { error: signOutError } = await authClient.auth.signOut();
            if (signOutError) {
              console.error('Unable to sign out the expired admin session.', signOutError);
            }
          } catch (signOutError) {
            console.error('Unable to sign out the expired admin session.', signOutError);
          }
          handleExpiredSession();
        }
      } catch (error) {
        sessionCheckUnavailable = true;
        setSessionCheckFailed(true);
        console.error('Unable to verify the admin session before expiry handling.', error);
      } finally {
        expirationCheckInProgress = false;
      }
    };

    const { data: { subscription } } = authClient.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        handleExpiredSession();
        return;
      }
      if (session) updateSessionExpiry(session);
    });

    void authClient.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        sessionCheckUnavailable = true;
        setSessionCheckFailed(true);
        console.error('Unable to load the authenticated admin session.', error);
      } else if (!data.session) {
        handleExpiredSession();
      } else {
        updateSessionExpiry(data.session);
      }
    }).catch((error: unknown) => {
      if (!active) return;
      sessionCheckUnavailable = true;
      setSessionCheckFailed(true);
      console.error('Unable to load the authenticated admin session.', error);
    });

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setSessionNow(now);
      if (currentExpiry !== null && currentExpiry * 1000 <= now) {
        void verifyExpiredSession();
      } else if (sessionCheckUnavailable && now >= nextSessionRetryAt) {
        nextSessionRetryAt = now + 5000;
        void verifyExpiredSession();
      }
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      subscription.unsubscribe();
    };
  }, [onSessionExpired]);

  const remainingSessionSeconds = sessionExpiresAt === null
    ? null
    : Math.max(0, Math.ceil((sessionExpiresAt * 1000 - sessionNow) / 1000));
  const sessionCountdown = remainingSessionSeconds === null
    ? '—'
    : remainingSessionSeconds >= 3600
      ? `${String(Math.floor(remainingSessionSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((remainingSessionSeconds % 3600) / 60)).padStart(2, '0')}:${String(remainingSessionSeconds % 60).padStart(2, '0')}`
      : `${String(Math.floor(remainingSessionSeconds / 60)).padStart(2, '0')}:${String(remainingSessionSeconds % 60).padStart(2, '0')}`;
  const sessionTimerTone = sessionCheckFailed
    ? 'border-orange-200 bg-orange-50 text-orange-800'
    : remainingSessionSeconds !== null && remainingSessionSeconds <= 60
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : remainingSessionSeconds !== null && remainingSessionSeconds <= 300
        ? 'border-orange-200 bg-orange-50 text-orange-700'
        : 'border-slate-200 bg-slate-50 text-[#0B1F4D]';

  // Data states
  const [applications, setApplications] = useState<StudentApplication[]>([]);
  const [archivedApplications, setArchivedApplications] = useState<StudentApplication[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsError, setApplicationsError] = useState<string | null>(null);
  const [applicationDisplayLimit, setApplicationDisplayLimit] = useState(10);
  const [applicationPhotoCleanupJobs, setApplicationPhotoCleanupJobs] = useState<ApplicationPhotoCleanupJob[]>([]);
  const [programFeeConfigurations, setProgramFeeConfigurations] = useState<Record<string, ProgramFeeConfiguration>>({});
  const [demoRequests, setDemoRequests] = useState<DashboardDemoRequest[]>([]);
  const [demoRefreshToken, setDemoRefreshToken] = useState(0);
  const [notifications, setNotifications] = useState<ApplicationNotification[]>([]);
  const [requestEmailNotifications, setRequestEmailNotifications] = useState<RequestEmailNotification[]>([]);
  const [requestEmailError, setRequestEmailError] = useState<string | null>(null);
  const [callbacks, setCallbacks] = useState<CallbackRequest[]>([]);
  const [callbacksLoading, setCallbacksLoading] = useState(false);
  const [callbacksError, setCallbacksError] = useState<string | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [mediaFilter, setMediaFilter] = useState<'all' | 'photo' | 'video'>('all');
  const [mediaSearch, setMediaSearch] = useState('');
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [editingFaq, setEditingFaq] = useState<Partial<FAQ> | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [branding, setBranding] = useState<SiteBranding | null>(null);
  const [editingBranding, setEditingBranding] = useState<BrandingEditor | null>(null);
  
type JoiningInformationSettings = {
  joiningDate: string;
  classSchedule: string;
  classTimings: string;
  venue: string;
};

interface OfficialDocumentVersion {
  version_number: number;
  issuance_type: 'approval' | 'payment_update';
  status: 'pending' | 'processing' | 'ready' | 'failed';
  email_status: 'Pending' | 'Sent' | 'Failed';
  generated_at: string | null;
  created_at: string;
  payment_status: string;
  total_paid: number;
  outstanding_balance: number | null;
}

const DEFAULT_JOINING_INFORMATION: JoiningInformationSettings = {
  joiningDate: '',
  classSchedule: '',
  classTimings: '',
  venue: '',
};

const [officialDocumentSettings, setOfficialDocumentSettings] =
  useState<OfficialDocumentSettings>({ ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS });
const [officialPdfPreviewUrl, setOfficialPdfPreviewUrl] = useState<string | null>(null);
const [officialPdfApplicationId, setOfficialPdfApplicationId] = useState('');
const [officialDocumentVersions, setOfficialDocumentVersions] = useState<OfficialDocumentVersion[]>([]);
const [pendingOfficialLogo, setPendingOfficialLogo] = useState<string | null>(null);
const [pendingOfficialGraphic, setPendingOfficialGraphic] = useState<string | null>(null);
const [officialLogoPreviewUrl, setOfficialLogoPreviewUrl] = useState<string | null>(null);
const [officialGraphicPreviewUrl, setOfficialGraphicPreviewUrl] = useState<string | null>(null);
useEffect(() => {
  if (!officialPdfPreviewUrl) return;

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') setOfficialPdfPreviewUrl(null);
  };
  window.addEventListener('keydown', closeOnEscape);

  return () => {
    window.removeEventListener('keydown', closeOnEscape);
    URL.revokeObjectURL(officialPdfPreviewUrl);
  };
}, [officialPdfPreviewUrl]);
useEffect(() => {
  if (!officialLogoPreviewUrl?.startsWith('blob:')) return;
  return () => URL.revokeObjectURL(officialLogoPreviewUrl);
}, [officialLogoPreviewUrl]);
useEffect(() => {
  if (!officialGraphicPreviewUrl?.startsWith('blob:')) return;
  return () => URL.revokeObjectURL(officialGraphicPreviewUrl);
}, [officialGraphicPreviewUrl]);
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

  const filteredMediaItems = mediaItems.filter((item) => {
    const matchesType = mediaFilter === 'all' || item.media_type === mediaFilter;
    const searchTerm = mediaSearch.trim().toLocaleLowerCase();
    const matchesSearch = !searchTerm || [item.title, item.alt_text, item.caption]
      .some((value) => value?.toLocaleLowerCase().includes(searchTerm));
    return matchesType && matchesSearch;
  });

  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

  const navigateToAdminSection = (tab: string) => {
    setActiveTab(tab);
    setSidebarOpen(false);
    setActionMessage(null);
  };

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
  const paymentCreationIntentRef = useRef<{ signature: string; key: string } | null>(null);

  const [selectedCallback, setSelectedCallback] = useState<CallbackRequest | null>(null);
  const [appPhotoModal, setAppPhotoModal] = useState<string | null>(null);

  // Program Edit Modal State
  const [editingProgram, setEditingProgram] = useState<ProgramEditor | null>(null);
  const [viewingProgram, setViewingProgram] = useState<Program | null>(null);

  // Announcement New/Edit Modal State
  const [editingAnnouncement, setEditingAnnouncement] = useState<Partial<Announcement> | null>(null);

  // Search and filter states
  const [appSearch, setAppSearch] = useState('');
  const [appFilterStatus, setAppFilterStatus] = useState<'All' | 'Pending' | 'Accepted' | 'Archived'>('All');
  const [callbackSearch, setCallbackSearch] = useState('');
  const [callbackFilterStatus, setCallbackFilterStatus] = useState<'All' | CallbackRequest['status']>('All');
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

  const fetchAdmin = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetch(url, init);
    if (response.status === 401) onSessionExpired();
    return response;
  };

  const requestJson = async (url: string, init?: RequestInit): Promise<any> => {
    const response = await fetchAdmin(url, init);
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
    paymentCreationIntentRef.current = null;
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
      const paymentPayload = {
        amount: Math.round(amount * 100) / 100,
        payment_method: paymentMethodInput,
        payment_stage: paymentStageInput,
        reference_number: paymentReferenceInput.trim() || null,
        notes: paymentNotesInput.trim() || null,
      };
      const headers = getAuthHeaders();
      if (!isEditing) {
        const signature = JSON.stringify(paymentPayload);
        if (paymentCreationIntentRef.current?.signature !== signature) {
          paymentCreationIntentRef.current = { signature, key: crypto.randomUUID() };
        }
        headers['Idempotency-Key'] = paymentCreationIntentRef.current.key;
      }

      const result = await requestJson(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(paymentPayload),
      });

      resetPaymentForm();
      await loadApplicationPaymentData(paymentApp);
      if (result?.document_update?.success === false) {
        setPaymentError('Payment was saved. Its official PDF or email update is queued for retry from Notifications.');
      }
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

  const loadApplications = async (includeArchived = appFilterStatus === 'Archived') => {
    setApplicationsLoading(true);
    setApplicationsError(null);
    try {
      const [activeData, archivedData] = await Promise.all([
        requestJson('/api/admin/applications', { headers: getAuthHeaders() }),
        includeArchived
          ? requestJson('/api/admin/applications?archived=true', { headers: getAuthHeaders() })
          : Promise.resolve(null),
      ]);
      if (!Array.isArray(activeData)) throw new Error('The applications response was invalid.');
      setApplications(activeData);
      if (Array.isArray(archivedData)) setArchivedApplications(archivedData);
    } catch (error) {
      setApplicationsError(error instanceof Error ? error.message : 'Unable to load applications.');
    } finally {
      setApplicationsLoading(false);
    }
  };

  const loadCallbackRequests = async () => {
    setCallbacksLoading(true);
    setCallbacksError(null);
    try {
      const data = await requestJson('/api/admin/callbacks', { headers: getAuthHeaders() });
      if (!Array.isArray(data)) throw new Error('The callback request response was invalid.');
      setCallbacks(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load callback requests.';
      setCallbacksError(message);
    } finally {
      setCallbacksLoading(false);
    }
  };

  const loadRequestEmailNotifications = async () => {
    if (!isSuperAdmin) return;
    setRequestEmailError(null);
    try {
      const data = await requestJson('/api/admin/request-email-notifications', { headers: getAuthHeaders() });
      if (!Array.isArray(data)) throw new Error('The request email notification response was invalid.');
      setRequestEmailNotifications(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load request email notifications.';
      setRequestEmailError(message);
    }
  };

  const fetchAllData = async () => {
    void fetchSystemStatus().then(setSystemStatus);
    setLoading(true);
    void loadApplications();
    void loadCallbackRequests();
    void loadRequestEmailNotifications();
    try {
      const headers = getAuthHeaders();
      const [
        cleanupJobsRes,
        demoRequestsRes,
        notifsRes,
        progsRes,
        programFeesRes,
        annsRes,
        mediaRes,
        faqsRes,
        brandingRes,
        profilesRes,
      ] = await Promise.all([
        isSuperAdmin
          ? requestJson('/api/admin/application-photo-cleanup-jobs', { headers }).catch((error) => {
            console.error('Unable to load application photo cleanup jobs.', error);
            return null;
          })
          : Promise.resolve([]),
        requestJson('/api/admin/demo-class-requests', { headers }),
        isSuperAdmin ? requestJson('/api/admin/notifications', { headers }) : Promise.resolve([]),
        requestJson(isAdminOrHigher ? '/api/admin/programs' : '/api/programs', isAdminOrHigher ? { headers } : undefined),
        isAdminOrHigher ? requestJson('/api/admin/program-fees', { headers }) : Promise.resolve([]),
        requestJson(isAdminOrHigher ? '/api/admin/announcements' : '/api/announcements', isAdminOrHigher ? { headers } : undefined),
        isAdminOrHigher ? requestJson('/api/admin/media', { headers }) : Promise.resolve([]),
        isSuperAdmin
          ? requestJson('/api/admin/faqs', { headers })
          : requestJson('/api/faqs'),
        requestJson('/api/branding'),
        isSuperAdmin
          ? requestJson('/api/admin/profiles', { headers })
          : Promise.resolve([]),
      ]);

      if (Array.isArray(cleanupJobsRes)) setApplicationPhotoCleanupJobs(cleanupJobsRes);
      if (Array.isArray(demoRequestsRes)) setDemoRequests(demoRequestsRes);
      if (Array.isArray(notifsRes)) setNotifications(notifsRes);
      if (Array.isArray(progsRes)) setPrograms(progsRes);
      if (Array.isArray(programFeesRes)) {
        setProgramFeeConfigurations(Object.fromEntries(
          (programFeesRes as ProgramFeeConfiguration[]).map((fee) => [fee.program_id, fee]),
        ));
      }
      if (Array.isArray(annsRes)) setAnnouncements(annsRes);
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

  const refreshRequestData = async () => {
    const requestLists = [
      {
        endpoint: '/api/admin/demo-class-requests',
        update: (data: DashboardDemoRequest[]) => setDemoRequests(data),
      },
    ];

    void loadApplications();
    void loadCallbackRequests();
    setDemoRefreshToken((current) => current + 1);
    await Promise.all(requestLists.map(async ({ endpoint, update }) => {
      try {
        const data = await requestJson(endpoint, { headers: getAuthHeaders() });
        if (!Array.isArray(data)) {
          throw new Error(`The ${endpoint} response was invalid.`);
        }
        update(data);
      } catch (error) {
        console.error(`Unable to refresh admin notification data from ${endpoint}.`, error);
      }
    }));
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  useEffect(() => {
    let refreshTimeout: number | undefined;
    const scheduleRequestRefresh = () => {
      window.clearTimeout(refreshTimeout);
      refreshTimeout = window.setTimeout(() => {
        void refreshRequestData();
      }, 200);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshRequestData();
    };

    const client = supabase;
    const channel = client
      ? client
          .channel('admin-request-badges', { config: { private: true } })
          .on('broadcast', { event: 'request_changed' }, scheduleRequestRefresh)
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              void refreshRequestData();
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.warn(`Admin request badge realtime channel ${status.toLowerCase()}; polling fallback remains active.`);
            }
          })
      : null;

    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRequestData();
    }, 30_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.clearInterval(refreshInterval);
      window.clearTimeout(refreshTimeout);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      if (client && channel) void client.removeChannel(channel);
    };
  }, [currentAdmin.id]);

  
  // Load official document settings and authenticated asset previews.
  const loadOfficialAssetPreview = async (type: 'logo' | 'graphic', configured: boolean) => {
  const setPreview = type === 'logo' ? setOfficialLogoPreviewUrl : setOfficialGraphicPreviewUrl;
  if (!configured) {
    setPreview(null);
    return;
  }
  const response = await fetchAdmin(`/api/admin/official-document/assets?type=${type}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Unable to load the saved PDF ${type}.`);
  }
  setPreview(URL.createObjectURL(await response.blob()));
};

const loadOfficialDocumentVersions = async (applicationId: string) => {
  if (!applicationId) {
    setOfficialDocumentVersions([]);
    return;
  }
  try {
    const versions = await requestJson(
      `/api/admin/official-document/versions?application_id=${encodeURIComponent(applicationId)}`,
      { headers: getAuthHeaders() },
    );
    setOfficialDocumentVersions(Array.isArray(versions) ? versions as OfficialDocumentVersion[] : []);
  } catch (error) {
    setOfficialDocumentVersions([]);
    setActionMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to load PDF version history.' });
  }
};

const fetchOfficialDocumentSettings = async () => {
  try {
    const result = await requestJson('/api/admin/official-document', {
      headers: getAuthHeaders(),
    });
    const settings: OfficialDocumentSettings = {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      ...result.settings,
      sectionHeadings: {
        ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.sectionHeadings,
        ...result.settings?.sectionHeadings,
      },
      colors: { ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.colors, ...result.settings?.colors },
      typography: { ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.typography, ...result.settings?.typography },
      layout: { ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.layout, ...result.settings?.layout },
    };
    setOfficialDocumentSettings(settings);
    await Promise.all([
      loadOfficialAssetPreview('logo', Boolean(settings.logoObjectKey)),
      loadOfficialAssetPreview('graphic', Boolean(settings.graphicObjectKey)),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load official document settings.';
    setActionMessage({ type: 'error', text: message });
  }
};

const saveOfficialDocumentSettings = async (): Promise<OfficialDocumentSettings> => {
  setLoading(true);
  try {
    const payload: Record<string, unknown> = { settings: officialDocumentSettings };
    if (pendingOfficialLogo) payload.logo_file_base64 = pendingOfficialLogo;
    if (pendingOfficialGraphic) payload.graphic_file_base64 = pendingOfficialGraphic;
    const result = await requestJson('/api/admin/official-document', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const settings: OfficialDocumentSettings = {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      ...result.settings,
      sectionHeadings: {
        ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.sectionHeadings,
        ...result.settings?.sectionHeadings,
      },
      colors: { ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.colors, ...result.settings?.colors },
      typography: { ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.typography, ...result.settings?.typography },
      layout: { ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.layout, ...result.settings?.layout },
    };
    setOfficialDocumentSettings(settings);
    setPendingOfficialLogo(null);
    setPendingOfficialGraphic(null);
    await Promise.all([
      loadOfficialAssetPreview('logo', Boolean(settings.logoObjectKey)),
      loadOfficialAssetPreview('graphic', Boolean(settings.graphicObjectKey)),
    ]);
    setActionMessage({ type: 'success', text: 'Official PDF settings saved successfully.' });
    return settings;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save official document settings.';
    setActionMessage({ type: 'error', text: message });
    throw error;
  } finally {
    setLoading(false);
  }
};

const handleOfficialAssetChange = (
  type: 'logo' | 'graphic',
  event: React.ChangeEvent<HTMLInputElement>,
) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    setActionMessage({ type: 'error', text: 'Official PDF images must be PNG or JPEG files.' });
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    setActionMessage({ type: 'error', text: 'Official PDF images must be 3 MB or smaller.' });
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => setActionMessage({ type: 'error', text: 'The selected PDF image could not be read.' });
  reader.onload = () => {
    if (typeof reader.result !== 'string' || !reader.result.startsWith('data:image/')) {
      setActionMessage({ type: 'error', text: 'The selected PDF image could not be read.' });
      return;
    }
    if (type === 'logo') {
      setPendingOfficialLogo(reader.result);
      setOfficialLogoPreviewUrl(reader.result);
    } else {
      setPendingOfficialGraphic(reader.result);
      setOfficialGraphicPreviewUrl(reader.result);
    }
    setActionMessage(null);
  };
  reader.readAsDataURL(file);
};

const previewOfficialDocumentPdf = async (download = false) => {
  try {
    await saveOfficialDocumentSettings();
    setLoading(true);
    const response = await fetchAdmin('/api/admin/official-document/preview', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ download }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `PDF generation failed (${response.status}).`);
    }
    const pdfUrl = URL.createObjectURL(await response.blob());
    if (download) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = 'Official_Document_PREVIEW.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 1000);
      setActionMessage({ type: 'success', text: 'Preview-only PDF downloaded. No student application data was used.' });
    } else {
      setOfficialPdfPreviewUrl(pdfUrl);
      setActionMessage(null);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate the official PDF.';
    setActionMessage({ type: 'error', text: message });
  } finally {
    setLoading(false);
  }
};

const downloadIssuedOfficialDocument = async (versionNumber?: number) => {
  const application = applications.find((item) =>
    item.id === officialPdfApplicationId && item.status === 'Accepted' && Boolean(item.student_id),
  );
  if (!application) {
    setActionMessage({ type: 'error', text: 'Select an approved application with a permanent Student ID first.' });
    return;
  }
  setLoading(true);
  try {
    const response = await fetchAdmin(
      `/api/admin/official-document/issued?application_id=${encodeURIComponent(application.id)}${versionNumber ? `&version=${versionNumber}` : ''}`,
      { headers: getAuthHeaders() },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `Unable to download the issued PDF (${response.status}).`);
    }
    const pdfUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = `Issued_V${versionNumber || 'latest'}_${application.application_reference.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 1000);
    setActionMessage({ type: 'success', text: 'The original issued PDF snapshot was downloaded.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to download the issued official PDF.';
    setActionMessage({ type: 'error', text: message });
  } finally {
    setLoading(false);
  }
};

const resetOfficialDocumentSettings = () => {
  setOfficialDocumentSettings({ ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS });
  setPendingOfficialLogo(null);
  setPendingOfficialGraphic(null);
  setOfficialLogoPreviewUrl(null);
  setOfficialGraphicPreviewUrl(null);
  setActionMessage({ type: 'success', text: 'Defaults loaded. Save changes to persist them.' });
};

const updateOfficialTerm = (index: number, value: string) => {
  setOfficialDocumentSettings((current) => ({
    ...current,
    terms: current.terms.map((term, termIndex) => termIndex === index ? value : term),
  }));
};

const moveOfficialTerm = (index: number, offset: -1 | 1) => {
  setOfficialDocumentSettings((current) => {
    const target = index + offset;
    if (target < 0 || target >= current.terms.length) return current;
    const terms = [...current.terms];
    [terms[index], terms[target]] = [terms[target], terms[index]];
    return { ...current, terms };
  });
};

const moveOfficialSection = (section: OfficialSection, offset: -1 | 1) => {
  setOfficialDocumentSettings((current) => {
    const index = current.layout.sectionOrder.indexOf(section);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= current.layout.sectionOrder.length) return current;
    const sectionOrder = [...current.layout.sectionOrder];
    [sectionOrder[index], sectionOrder[target]] = [sectionOrder[target], sectionOrder[index]];
    return { ...current, layout: { ...current.layout, sectionOrder } };
  });
};

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

      // Reuse the configured official PDF logo.
      try {
        const response = await fetchAdmin('/api/admin/official-document/assets?type=logo', {
          headers: getAuthHeaders(),
        });
        if (response.ok) {
          const logoBytes = new Uint8Array(await response.arrayBuffer());
          const contentType = response.headers.get('content-type') || '';
          const logo = contentType.includes('png')
            ? await pdf.embedPng(logoBytes)
            : contentType.includes('jpeg') || contentType.includes('jpg')
              ? await pdf.embedJpg(logoBytes)
              : null;
          if (!logo) throw new Error('Configured PDF logo is not a PNG or JPEG image.');
          const logoDims = logo.scale(Math.min(58 / logo.width, 48 / logo.height));
          page.drawImage(logo, { x: left, y: y - 48, width: logoDims.width, height: logoDims.height });
        } else if (response.status !== 404) {
          throw new Error('Configured PDF logo could not be loaded.');
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
    if (isSuperAdmin) void fetchOfficialDocumentSettings();
  }, [isSuperAdmin]);



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
      const res = await fetchAdmin('/api/approve-application', {
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
      const res = await fetchAdmin(`/api/admin/applications/${appId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.status === 409 && data.archive_required) {
        if (!confirm(`${data.error}\n\nArchive this application instead? Payment and agreed fee records will remain attached.`)) {
          setActionMessage({ type: 'error', text: data.error || 'Application was not deleted.' });
          return;
        }
        const archiveResponse = await fetchAdmin(`/api/admin/applications/${appId}/archive`, {
          method: 'POST',
          headers: getAuthHeaders(),
        });
        const archiveData = await archiveResponse.json();
        if (!archiveResponse.ok) throw new Error(archiveData.error || 'Failed to archive application.');
        setActionMessage({ type: 'success', text: 'Application archived. Its payment and agreed fee records remain attached.' });
        if (selectedApp?.id === appId) setSelectedApp(null);
        await fetchAllData();
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Failed to delete application.');

      setActionMessage({
        type: data.photo_cleanup_status && data.photo_cleanup_status !== 'completed' ? 'warning' : 'success',
        text: data.message || 'Application record deleted successfully.',
      });
      if (selectedApp?.id === appId) setSelectedApp(null);
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Error deleting application.' });
    } finally {
      setLoading(false);
    }
  };

  const handleArchiveApplication = async (appId: string) => {
    if (!confirm('Archive this application? It will remain available in the Archived filter, and any payment or agreed fee records will remain attached.')) return;
    setActionMessage(null);
    setLoading(true);
    try {
      const response = await fetchAdmin(`/api/admin/applications/${appId}/archive`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to archive application.');
      setActionMessage({ type: 'success', text: 'Application archived. Payment records remain attached.' });
      if (selectedApp?.id === appId) setSelectedApp(null);
      await fetchAllData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to archive application.';
      setActionMessage({ type: 'error', text: message });
    } finally {
      setLoading(false);
    }
  };

  const handleRetryApplicationPhotoCleanup = async (jobId: string) => {
    setLoading(true);
    setActionMessage(null);
    try {
      const response = await fetchAdmin(`/api/admin/application-photo-cleanup-jobs/${jobId}/retry`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || 'Photo cleanup retry failed.');
      const jobs = await requestJson('/api/admin/application-photo-cleanup-jobs', {
        headers: getAuthHeaders(),
      });
      if (Array.isArray(jobs)) setApplicationPhotoCleanupJobs(jobs);
      setActionMessage({ type: 'success', text: data.message || 'Application photo cleanup completed.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to retry application photo cleanup.';
      setActionMessage({ type: 'error', text: message });
    } finally {
      setLoading(false);
    }
  };

  const handleApplicationFilterChange = (status: 'All' | 'Pending' | 'Accepted' | 'Archived') => {
    setAppFilterStatus(status);
    setApplicationDisplayLimit(10);
    setActionMessage(null);
    if (status !== 'Archived') return;
    void loadApplications(true);
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

  const handleDeleteCallback = async (callback: CallbackRequest) => {
    if (!confirm('Are you sure you want to delete this callback request? This action cannot be undone.')) return;
    setLoading(true);
    setActionMessage(null);
    try {
      await requestJson(`/api/admin/callbacks/${encodeURIComponent(callback.id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      setCallbacks((items) => items.filter((item) => item.id !== callback.id));
      setSelectedCallback((selected) => selected?.id === callback.id ? null : selected);
      setActionMessage({ type: 'success', text: 'Callback request deleted successfully.' });
      await refreshRequestData();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to delete callback request.',
      });
    } finally {
      setLoading(false);
    }
  };

  // Action: Retry Email Notification
  const handleRetryNotification = async (notifId: string) => {
    setActionMessage(null);
    setLoading(true);
    try {
      const res = await fetchAdmin('/api/retry-notification', {
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

  const handleRetryRequestEmailNotification = async (notificationId: string) => {
    setActionMessage(null);
    setLoading(true);
    try {
      const result = await requestJson(
        `/api/admin/request-email-notifications/${encodeURIComponent(notificationId)}/retry`,
        { method: 'POST', headers: getAuthHeaders() },
      );
      setActionMessage({
        type: result.success ? 'success' : 'error',
        text: result.message || 'Request email retry completed.',
      });
      await loadRequestEmailNotifications();
    } catch (error) {
      setActionMessage({ type: 'error', text: error instanceof Error ? error.message : 'Unable to retry request email.' });
    } finally {
      setLoading(false);
    }
  };

  const updateEditingProgramFee = <K extends keyof ProgramFeeConfiguration,>(
    key: K,
    value: ProgramFeeConfiguration[K],
  ) => {
    setEditingProgram((current) => current ? {
      ...current,
      feeConfiguration: {
        ...emptyProgramFeeConfiguration(current.id),
        ...current.feeConfiguration,
        [key]: value,
      },
    } : current);
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
const { image_object_key: _imageObjectKey, feeConfiguration, ...programPayload } = editingProgram;

const res = await fetchAdmin(url, {
  method,
  headers: getAuthHeaders(),
  body: JSON.stringify(programPayload),
});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save program');
      const savedProgramId = editingProgram.id || data.id;
      if (savedProgramId) {
        setEditingProgram((current) => current ? {
          ...current,
          id: savedProgramId,
          image_url: data.image_url || current.image_url,
          image_file_base64: undefined,
        } : current);
      }
      if (!savedProgramId || !feeConfiguration) {
        throw new Error('Program details were saved, but the course fee configuration is unavailable.');
      }
      const feeResponse = await fetchAdmin(`/api/admin/programs/${savedProgramId}/fee`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          tuition_fee: feeConfiguration.tuition_fee,
          registration_fee: feeConfiguration.registration_fee,
          study_material_fee: feeConfiguration.study_material_fee,
          other_charges: feeConfiguration.other_charges,
          discount_type: feeConfiguration.discount_type,
          discount_value: feeConfiguration.discount_value,
        }),
      });
      const feeResult = await feeResponse.json();
      if (!feeResponse.ok) {
        throw new Error(`Program details were saved, but course fees were not saved: ${feeResult.error || 'Unknown error.'}`);
      }
      setEditingProgram(null);
      setActionMessage({ type: 'success', text: 'Program details and course fees were saved successfully.' });
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
      const res = await fetchAdmin(`/api/admin/programs/${id}`, {
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
      const res = await fetchAdmin(url, {
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
      const res = await fetchAdmin(`/api/admin/announcements/${id}`, {
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

  // Action: Save Site Branding
  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranding) return;
    const body = isSuperAdmin
      ? editingBranding
      : editingBranding.hero_photo_file_base64
        ? { hero_photo_file_base64: editingBranding.hero_photo_file_base64 }
        : editingBranding.hero_photo_url === null
          ? { hero_photo_url: null }
          : null;
    if (!body) {
      setActionMessage({ type: 'error', text: 'Choose a hero photo or remove the current photo before saving.' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetchAdmin('/api/admin/branding', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update branding');
      setBranding(data as SiteBranding);
      setEditingBranding({
        ...data,
        main_logo_alt: data.logo_alt || data.main_logo_alt,
        primary_color: data.primary_orange || data.primary_color,
        secondary_color: data.primary_green || data.secondary_color,
      });
      setActionMessage({
        type: 'success',
        text: isSuperAdmin ? 'Branding and logo configurations updated successfully!' : 'Hero section photo updated successfully.',
      });
      notifyPublicDataChanged();
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleBrandingFileChange = (
    field: BrandingImageField,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file || !editingBranding) return;
    const clearPendingUpload = () => {
      setEditingBranding((current) => {
        if (!current) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    };

    const isFavicon = field === 'favicon_file_base64';
    const isHeroPhoto = field === 'hero_photo_file_base64';
    const maxFileSize = isFavicon ? 1024 * 1024 : 3 * 1024 * 1024;
    const supportedTypes = isFavicon
      ? ['image/jpeg', 'image/png', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']
      : ['image/jpeg', 'image/png', 'image/webp'];
    if (!supportedTypes.includes(file.type)) {
      setActionMessage({
        type: 'error',
        text: isFavicon
          ? 'Choose an ICO, JPEG, PNG, or WebP favicon.'
          : isHeroPhoto
            ? 'Choose a PNG, JPG, JPEG, or WebP hero photo.'
            : 'Choose a JPEG, PNG, or WebP branding image.',
      });
      clearPendingUpload();
      event.target.value = '';
      return;
    }
    if (file.size > maxFileSize) {
      setActionMessage({ type: 'error', text: `Branding images must be ${isFavicon ? '1' : '3'} MB or smaller.` });
      clearPendingUpload();
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const readDataUrl = String(reader.result || '');
      const dataUrl = isFavicon && file.type === 'image/vnd.microsoft.icon'
        ? readDataUrl.replace(/^data:image\/vnd\.microsoft\.icon;/, 'data:image/x-icon;')
        : readDataUrl;
      const normalizedMime = isFavicon && file.type === 'image/vnd.microsoft.icon'
        ? 'image/x-icon'
        : file.type;
      if (!dataUrl.startsWith(`data:${normalizedMime};base64,`)) {
        setActionMessage({ type: 'error', text: 'Unable to read this image. Please choose another file.' });
        clearPendingUpload();
        return;
      }
      setEditingBranding((current) => {
        if (!current) return current;
        const next = { ...current, [field]: dataUrl };
        if (field === 'hero_photo_file_base64') delete next.hero_photo_url;
        return next;
      });
      setActionMessage(null);
    };
    reader.onerror = () => {
      setActionMessage({ type: 'error', text: 'Unable to read this image. Please choose another file.' });
      clearPendingUpload();
    };
    reader.readAsDataURL(file);
  };

  // Action: Update Admin Role / Status (Super Admin only)
  const handleUpdateAdminRole = async (profileId: string, newRole: AdminRole, newStatus: boolean) => {
    setLoading(true);
    try {
      const res = await fetchAdmin(`/api/admin/profiles/${profileId}`, {
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
    setMediaError(null);

    try {
      const displayOrder = Number(mediaForm.display_order ?? 0);
      if (!Number.isInteger(displayOrder)) {
        throw new Error('Display order must be a whole number.');
      }
      const conflictingMedia = mediaItems.find((item) =>
        item.display_order === displayOrder && item.id !== editingMediaId
      );
      if (conflictingMedia) {
        throw new Error(`This display order number is already taken by "${conflictingMedia.title}". Please choose another number.`);
      }

      setLoading(true);
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
        display_order: displayOrder,
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
      const res = await fetchAdmin(url, {
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
      const res = await fetchAdmin(`/api/admin/media/${itemId}`, {
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
      const res = await fetchAdmin(`/api/admin/media/${item.id}`, {
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
    { id: 'demo-class-requests', label: 'Demo Class Requests', icon: GraduationCap, minRole: 'staff' },
    { id: 'callbacks', label: 'Callback Requests', icon: PhoneCall, minRole: 'staff' },
    { id: 'programs', label: 'Programs Management', icon: BookOpen, minRole: 'admin' },
    { id: 'media', label: 'Media & Testimonials', icon: Video, minRole: 'admin' },
    { id: 'announcements', label: 'Announcements', icon: Volume2, minRole: 'admin' },
    { id: 'branding', label: 'Site Branding & Assets', icon: Palette, minRole: 'admin' },
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

  const pendingRequestCounts = {
    applications: applications.filter((application) => application.status === 'Pending').length,
    demoClassRequests: demoRequests.filter((request) => request.status === 'Pending').length,
    callbacks: callbacks.filter((callback) => callback.status === 'Pending').length,
  };

  // Filtered applications
  const filteredApplications = (appFilterStatus === 'Archived' ? archivedApplications : applications)
    .filter((app) => {
      const matchesSearch =
        app.student_name.toLowerCase().includes(appSearch.toLowerCase()) ||
        app.application_reference.toLowerCase().includes(appSearch.toLowerCase()) ||
        app.mobile.includes(appSearch) ||
        app.email.toLowerCase().includes(appSearch.toLowerCase());

      const matchesStatus = appFilterStatus === 'Archived'
        ? Boolean(app.archived_at)
        : !app.archived_at && (appFilterStatus === 'All' || app.status === appFilterStatus);
      return matchesSearch && matchesStatus;
    })
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  const visibleApplications = filteredApplications.slice(0, applicationDisplayLimit);

  const filteredCallbacks = callbacks.filter((callback) => {
    const query = callbackSearch.toLowerCase();
    const matchesSearch = [callback.full_name, callback.mobile, callback.email || '', callback.program_name, callback.message || '']
      .some((value) => value.toLowerCase().includes(query));
    return matchesSearch && (callbackFilterStatus === 'All' || callback.status === callbackFilterStatus);
  });

  const applicationTrend = Array.from({ length: 6 }, (_, index) => {
    const month = new Date();
    month.setDate(1);
    month.setMonth(month.getMonth() - (5 - index));
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const count = applications.filter((application) => {
      const createdAt = new Date(application.created_at);
      return createdAt.getFullYear() === year && createdAt.getMonth() === monthIndex;
    }).length;
    return { label: month.toLocaleDateString('en', { month: 'short' }), count };
  });
  const maxTrendCount = Math.max(1, ...applicationTrend.map((month) => month.count));
  const trendPoints = applicationTrend
    .map((month, index) => `${index * 120},${150 - (month.count / maxTrendCount) * 125}`)
    .join(' ');
  const recentApplications = [...applications]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 5);
  const recentDemoRequests = [...demoRequests]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 5);
  const recentCallbacks = [...callbacks]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="admin-responsive-shell h-screen flex flex-col">
      <style>{`
        .admin-responsive-shell, .admin-responsive-shell * { box-sizing: border-box; }
        .admin-responsive-shell {
          width: 100%; max-width: 100vw; overflow: hidden;
          background: #f7f8fc; color: #0b1f4d;
        }
        .admin-responsive-shell > header { width: 100%; }
        .admin-responsive-shell > header > div { min-width: 0; gap: .75rem; }
        .admin-responsive-shell > header button { flex-shrink: 0; }
        .admin-responsive-shell > div.flex-1 { min-width: 0; width: 100%; min-height: 0; }
        .admin-responsive-shell aside { flex-shrink: 0; }
        .admin-responsive-shell main {
          min-width: 0; max-width: 100%; overflow-x: auto; overflow-y: auto;
          overscroll-behavior: contain;
          background:
            radial-gradient(ellipse at 92% 3%, rgba(5,150,105,.07), transparent 28rem),
            radial-gradient(ellipse at 8% 0%, rgba(234,88,12,.07), transparent 30rem),
            #f7f8fc;
        }
        .admin-responsive-shell main > * { min-width: 0; }
        .admin-responsive-shell table { border-collapse: separate; border-spacing: 0; }
        .admin-responsive-shell main > div table { min-width: 1050px; width: max-content; }
        .admin-responsive-shell main > div .overflow-x-auto { display: block; width: 100%; max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
        .admin-responsive-shell input, .admin-responsive-shell select, .admin-responsive-shell textarea { max-width: 100%; min-width: 0; }
        .admin-responsive-shell img, .admin-responsive-shell iframe, .admin-responsive-shell video { max-width: 100%; }
        .admin-responsive-shell [role="dialog"], .admin-responsive-shell .fixed.inset-0 > div { max-width: calc(100vw - 1.5rem); }
        .admin-responsive-shell .whitespace-nowrap { white-space: nowrap; }
        .admin-responsive-shell > header {
          color: white; border-color: rgba(255,255,255,.12);
          background: linear-gradient(112deg, #0b1f4d 0%, #14285d 62%, #26356f 100%);
          box-shadow: 0 8px 24px rgba(11,31,77,.18);
        }
        .admin-responsive-shell > header > div { border-bottom: 2px solid #ea580c; }
        .admin-responsive-shell > header img {
          padding: 0; border-radius: 0;
          background: transparent; box-shadow: none;
        }
        .admin-responsive-shell > header .text-slate-900,
        .admin-responsive-shell > header .text-slate-600 { color: #fff8ef; }
        .admin-responsive-shell > header .text-blue-600 { color: #a7f3d0; }
        .admin-responsive-shell > header button:not([aria-label="Logout"]) {
          border-color: rgba(255,255,255,.2); background-color: rgba(255,255,255,.1);
          color: #fff8ef;
        }
        .admin-responsive-shell > header button:not([aria-label="Logout"]):hover { background-color: rgba(255,255,255,.18); }
        .admin-responsive-shell > header button[aria-label="Logout"] { background: #fff8ef; }
        .admin-responsive-shell > header button:focus-visible,
        .admin-responsive-shell aside button:focus-visible,
        .admin-responsive-shell main button:focus-visible,
        .admin-responsive-shell main a:focus-visible {
          outline: 3px solid #f59e0b; outline-offset: 2px;
        }
        .admin-responsive-shell aside {
          color: #e2e8f0; border-color: rgba(255,255,255,.08);
          background: linear-gradient(180deg, #0b1f4d 0%, #111d45 55%, #1b2250 100%);
        }
        .admin-responsive-shell aside > div:first-child > div:first-child { color: #fbbf8a; }
        .admin-responsive-shell aside button { color: #dbe4f3; }
        .admin-responsive-shell aside button:hover {
          color: white; background: rgba(255,255,255,.09);
        }
        .admin-responsive-shell aside button[class*="bg-blue-50"] {
          color: white; border-left-color: #ea580c;
          background: linear-gradient(95deg, rgba(234,88,12,.27), rgba(5,150,105,.16));
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
        }
        .admin-responsive-shell aside button[class*="bg-blue-50"] svg { color: #fdba74; }
        .admin-responsive-shell aside > div:last-child {
          border-color: rgba(255,255,255,.1); background: rgba(3,10,31,.26);
        }
        .admin-responsive-shell aside > div:last-child button {
          color: #fff8ef; border-color: rgba(255,255,255,.2);
          background: rgba(255,255,255,.08);
        }
        .admin-responsive-shell main section.rounded-2xl.border,
        .admin-responsive-shell main form.rounded-2xl.border {
          border-color: #e3e8f2; box-shadow: 0 8px 24px rgba(11,31,77,.055);
        }
        .admin-responsive-shell main section.rounded-2xl.border:hover {
          border-color: #d4ddeb;
        }
        .admin-responsive-shell main input:not([type="checkbox"]):not([type="radio"]):not([type="color"]),
        .admin-responsive-shell main select,
        .admin-responsive-shell main textarea {
          border-color: #dbe2ee; border-radius: .75rem;
        }
        .admin-responsive-shell main input:focus,
        .admin-responsive-shell main select:focus,
        .admin-responsive-shell main textarea:focus {
          border-color: #ea580c; outline: 2px solid rgba(234,88,12,.16); outline-offset: 1px;
        }
        .admin-responsive-shell main table thead { background-color: #f2f5fb; }
        .admin-responsive-shell main table tbody tr:hover { background-color: #fff8ef; }
        .admin-responsive-shell .fixed.inset-0 > div {
          border: 1px solid rgba(255,255,255,.7);
          box-shadow: 0 24px 70px rgba(11,31,77,.28);
        }
        .admin-responsive-shell main button:not(:disabled) {
          transition-property: color, background-color, border-color, box-shadow, transform;
          transition-duration: 160ms;
        }
        .admin-responsive-shell .dashboard-welcome {
          position: relative; overflow: hidden; border: 1px solid #f3d8c4;
          border-radius: 1.25rem; padding: 1.25rem;
          background: linear-gradient(115deg, #fff8ef 0%, #fff 58%, #ecfdf5 100%);
          box-shadow: 0 10px 28px rgba(11,31,77,.06);
        }
        .admin-responsive-shell .dashboard-welcome::after {
          position: absolute; right: -2rem; top: -4rem; width: 13rem; height: 13rem;
          content: ""; border-radius: 9999px;
          background: radial-gradient(circle, rgba(234,88,12,.11), rgba(5,150,105,.05) 62%, transparent 70%);
          pointer-events: none;
        }
        .admin-responsive-shell .dashboard-stat[data-tone="orange"] { border-color: #fed7aa; background: linear-gradient(145deg,#fff7ed,#fff 75%); }
        .admin-responsive-shell .dashboard-stat[data-tone="green"] { border-color: #a7f3d0; background: linear-gradient(145deg,#ecfdf5,#fff 75%); }
        .admin-responsive-shell .dashboard-stat[data-tone="blue"] { border-color: #bfdbfe; background: linear-gradient(145deg,#eff6ff,#fff 75%); }
        .admin-responsive-shell .dashboard-stat[data-tone="violet"] { border-color: #ddd6fe; background: linear-gradient(145deg,#f5f3ff,#fff 75%); }
        .admin-responsive-shell .dashboard-stat[data-tone="teal"] { border-color: #99f6e4; background: linear-gradient(145deg,#f0fdfa,#fff 75%); }
        .admin-responsive-shell .dashboard-stat[data-tone="amber"] { border-color: #fde68a; background: linear-gradient(145deg,#fffbeb,#fff 75%); }
        .admin-responsive-shell .dashboard-stat:hover { box-shadow: 0 14px 28px rgba(11,31,77,.12); }
        @keyframes admin-notification-attention {
          0%, 100% { transform: scale(1); }
          12% { transform: scale(1.12); }
          24% { transform: scale(1.03); }
          36% { transform: scale(1); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .admin-responsive-shell .admin-notification-badge { animation: admin-notification-attention 2s ease-in-out infinite; }
        }
        .admin-responsive-shell .dashboard-chart {
          overflow: hidden; border-radius: 1rem; padding: .5rem;
          background: linear-gradient(180deg,#fff8ef 0%,#fff 60%,#f0fdfa 100%);
        }
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
        @media (prefers-reduced-motion: reduce) {
          .admin-responsive-shell *, .admin-responsive-shell *::before, .admin-responsive-shell *::after {
            scroll-behavior: auto !important;
            transition-duration: .01ms !important;
            animation-duration: .01ms !important;
          }
        }
      `}</style>
      {/* Top Admin Bar */}
      <header className="sticky top-0 z-30 shrink-0 border-b border-slate-200 text-slate-900">
        <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2 sm:gap-3">
              <img
                src={branding?.logo_url || "https://gpnfznwqwaokfzmozpxo.supabase.co/storage/v1/object/public/Uptrend's%20English%20Academy-photos/main_logo/UEA_main_03.png"}
                alt="Uptrend's English Academy logo"
                className="block shrink-0 object-contain"
                style={{ width: 'clamp(92px, 11vw, 155px)', height: '48px', maxWidth: '155px', maxHeight: '48px' }}
              />
              <span className="hidden text-xs uppercase bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded border border-blue-100 sm:inline-flex">
                Admin Portal
              </span>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <button
              onClick={fetchAllData}
              disabled={loading}
              className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600 hover:text-blue-700 bg-white hover:bg-blue-50 px-2 sm:px-3 py-2 rounded-lg border border-slate-200 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-60"
              title="Refresh Data from Supabase"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Data</span>
            </button>

            <div
              role="timer"
              aria-label={remainingSessionSeconds === null
                ? 'Session expiry unavailable'
                : `Session expires in ${sessionCountdown}`}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold sm:gap-2 sm:px-3 ${sessionTimerTone}`}
              title={sessionCheckFailed ? 'Unable to verify session expiry; checking again automatically.' : 'Supabase session expiry'}
            >
              <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Session expires in</span>
              <span className="font-mono tabular-nums">{sessionCountdown}</span>
            </div>

            <div className="hidden items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 sm:flex">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-emerald-500 text-xs font-extrabold text-white shadow-sm">
                {currentAdmin.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <span className="flex flex-col text-right">
                <span className="text-xs font-bold text-white">{currentAdmin.full_name}</span>
                <span className="text-[10px] uppercase font-bold text-emerald-200">{currentAdmin.role.replace('_', ' ')}</span>
              </span>
            </div>

            <button
              type="button"
              onClick={onLogout}
              aria-label="Logout"
              className="flex shrink-0 items-center gap-1 text-xs text-rose-700 hover:text-rose-800 bg-white hover:bg-rose-50 px-2 sm:px-3 py-2 rounded-lg border border-rose-200 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-600"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-16 z-10 bg-slate-950/30 lg:hidden"
          />
        )}
        <aside
          aria-label="Admin navigation"
          className={`fixed inset-y-16 left-0 z-20 w-64 border-r border-slate-200 flex flex-col justify-between transition-transform duration-200 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:translate-x-0 ${
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
              const pendingCount = item.id === 'applications'
                ? pendingRequestCounts.applications
                : item.id === 'demo-class-requests'
                  ? pendingRequestCounts.demoClassRequests
                  : item.id === 'callbacks'
                    ? pendingRequestCounts.callbacks
                    : 0;
              const accessibleLabel = pendingCount > 0
                ? `${item.label}, ${pendingCount} pending`
                : item.label;
              return (
                <button
                  key={item.id}
                  title={accessibleLabel}
                  aria-label={accessibleLabel}
                  onClick={() => {
                    navigateToAdminSection(item.id);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 font-bold border-l-4 border-blue-600'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {pendingCount > 0 && (
                    <span
                      aria-hidden="true"
                      className={`admin-notification-badge ml-auto inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full border px-2 text-[11px] font-bold leading-none tabular-nums tracking-normal text-white shadow-sm transition-colors ${
                        pendingCount <= 3
                          ? 'border-emerald-300/40 bg-emerald-600 shadow-[0_2px_7px_rgba(5,150,105,0.28)]'
                          : pendingCount <= 10
                            ? 'border-amber-300/40 bg-amber-500 shadow-[0_2px_7px_rgba(245,158,11,0.3)]'
                            : 'border-rose-300/40 bg-rose-600 shadow-[0_2px_7px_rgba(225,29,72,0.3)]'
                      }`}
                    >
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="p-4 border-t border-slate-100 bg-slate-50">
            <button
              type="button"
              onClick={() => setCurrentPage('home')}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-700 py-2.5 border border-slate-200 rounded-lg bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
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
                  : actionMessage.type === 'warning'
                    ? 'bg-amber-50 text-amber-900 border border-amber-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {actionMessage.type === 'success' ? (
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : actionMessage.type === 'warning' ? (
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 leading-relaxed">{actionMessage.text}</div>
            </div>
          )}

          {/* TAB 1: DASHBOARD OVERVIEW */}
          {activeTab === 'dashboard' && (
            <div className="mx-auto max-w-[1600px] space-y-6">
              <div className="dashboard-welcome flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-[.16em] text-orange-700">Dashboard overview</p>
                  <h1 className="text-2xl font-extrabold tracking-tight text-[#0B1F4D] sm:text-3xl">Welcome back, {currentAdmin.full_name}</h1>
                  <p className="mt-1 text-sm text-slate-500">Live operational overview for Uptrend’s English Academy.</p>
                </div>
                <p className="relative z-10 rounded-xl border border-emerald-100 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm">
                  {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>

              <section aria-label="Academy statistics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                {[
                  { label: 'Total Applications', value: applications.length, detail: 'All student submissions', icon: Users, tone: 'blue', target: 'applications' },
                  { label: 'Pending Applications', value: applications.filter((app) => app.status === 'Pending').length, detail: 'Awaiting review', icon: ClockIcon, tone: 'amber', target: 'applications', filter: 'Pending' as const },
                  { label: 'Demo Class Requests', value: demoRequests.length, detail: 'Separate demo enquiries', icon: GraduationCap, tone: 'violet', target: 'demo-class-requests' },
                  { label: 'Callback Requests', value: callbacks.length, detail: 'Requests for a call', icon: PhoneCall, tone: 'teal', target: 'callbacks' },
                  { label: 'Active Programs', value: programs.filter((program) => program.is_published).length, detail: 'Currently published', icon: BookOpen, tone: 'green', target: 'programs' },
                ].map((stat) => {
                  const Icon = stat.icon;
                  const canNavigate = allowedNavItems.some((item) => item.id === stat.target);
                  const iconTone: Record<string, string> = {
                    blue: 'bg-blue-50 text-blue-600',
                    amber: 'bg-amber-50 text-amber-600',
                    violet: 'bg-violet-50 text-violet-600',
                    teal: 'bg-teal-50 text-teal-600',
                    orange: 'bg-orange-50 text-orange-600',
                    green: 'bg-emerald-50 text-emerald-600',
                  };
                  const cardContent = (
                    <>
                      <div className="flex items-start justify-between gap-3 text-left">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold leading-5 text-slate-500">{stat.label}</p>
                          <p className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">{loading ? '—' : stat.value}</p>
                        </div>
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconTone[stat.tone]}`}>
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                      </div>
                      <p className="mt-3 text-left text-[11px] text-slate-400">{stat.detail}</p>
                    </>
                  );
                  return (
                    canNavigate ? (
                      <button
                        key={stat.label}
                        type="button"
                        data-tone={stat.tone}
                        onClick={() => {
                          if (stat.target === 'applications') {
                            setAppFilterStatus(stat.filter || 'All');
                          }
                          navigateToAdminSection(stat.target);
                        }}
                        aria-label={`View ${stat.label} results in Admin Portal`}
                        className="dashboard-stat group min-w-0 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-reduce:transform-none motion-reduce:transition-none"
                      >
                        {cardContent}
                        <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-blue-700">
                          View results in Admin Portal
                          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                        </span>
                      </button>
                    ) : (
                      <article key={stat.label} data-tone={stat.tone} aria-label={`${stat.label}: ${stat.value}`} className="dashboard-stat min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        {cardContent}
                      </article>
                    )
                  );
                })}
              </section>

              <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.8fr)]">
                <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">Application trends</h2>
                      <p className="mt-1 text-xs text-slate-500">Submissions received over the last six months</p>
                    </div>
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-50 text-orange-700">
                      <TrendingUp className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </div>
                  {applications.length ? (
                    <div className="dashboard-chart min-w-0">
                      <svg viewBox="0 0 600 190" role="img" aria-label="Monthly application trend for the last six months" className="h-44 w-full overflow-visible">
                        <defs>
                          <linearGradient id="application-trend-fill" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="#EA580C" stopOpacity=".22" />
                            <stop offset="100%" stopColor="#059669" stopOpacity=".02" />
                          </linearGradient>
                        </defs>
                        {[25, 67, 109, 151].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 5" />)}
                        <polygon points={`${trendPoints} 600,151 0,151`} fill="url(#application-trend-fill)" />
                        <polyline points={trendPoints} fill="none" stroke="#EA580C" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                        {applicationTrend.map((month, index) => {
                          const x = index * 120;
                          const y = 150 - (month.count / maxTrendCount) * 125;
                          return <g key={`${month.label}-${index}`}><circle cx={x} cy={y} r="5" fill="#fff" stroke="#059669" strokeWidth="3" /><text x={x} y="180" textAnchor={index === 0 ? 'start' : index === 5 ? 'end' : 'middle'} fill="#64748b" fontSize="12">{month.label}</text></g>;
                        })}
                      </svg>
                    </div>
                  ) : (
                    <p className="grid h-44 place-items-center text-center text-sm text-slate-400">
                      {loading ? 'Loading application trends…' : 'No application data available yet.'}
                    </p>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">Application status</h2>
                      <p className="mt-1 text-xs text-slate-500">Current application breakdown</p>
                    </div>
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-700">
                      <FileCheck className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </div>
                  {applications.length ? (
                    <div className="space-y-5" role="img" aria-label={`${applications.filter((app) => app.status === 'Pending').length} pending and ${applications.filter((app) => app.status === 'Accepted').length} accepted applications`}>
                      {(['Pending', 'Accepted'] as const).map((status) => {
                        const count = applications.filter((app) => app.status === status).length;
                        const percentage = (count / applications.length) * 100;
                        return (
                          <div key={status}>
                            <div className="mb-2 flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-600">{status}</span>
                              <span className="font-bold text-slate-900">{count} <span className="font-medium text-slate-400">({Math.round(percentage)}%)</span></span>
                            </div>
                            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                              <div className={`h-full rounded-full ${status === 'Pending' ? 'bg-orange-500' : 'bg-emerald-600'}`} style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="grid h-32 place-items-center text-center text-sm text-slate-400">
                      {loading ? 'Loading application statuses…' : 'No application status data available.'}
                    </p>
                  )}
                </section>
              </div>

              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Recent applications</h2>
                    <p className="mt-1 text-xs text-slate-500">The latest student admissions activity</p>
                  </div>
                  <button type="button" onClick={() => navigateToAdminSection('applications')} className="rounded-lg px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                    View all applications
                  </button>
                </div>
                {recentApplications.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr><th className="px-5 py-3 font-semibold sm:px-6">Applicant</th><th className="px-5 py-3 font-semibold">Program</th><th className="px-5 py-3 font-semibold">Submitted</th><th className="px-5 py-3 font-semibold">Status</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {recentApplications.map((application) => (
                          <tr key={application.id} className="text-slate-700">
                            <td className="px-5 py-3.5 sm:px-6"><p className="font-semibold text-slate-900">{application.student_name}</p><p className="mt-1 text-[11px] text-slate-500">{application.application_reference}</p></td>
                            <td className="max-w-[220px] truncate px-5 py-3.5">{application.program_name}</td>
                            <td className="whitespace-nowrap px-5 py-3.5">{new Date(application.created_at).toLocaleDateString('en-IN')}</td>
                            <td className="px-5 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${application.status === 'Accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{application.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="px-5 py-8 text-center text-sm text-slate-400">{loading ? 'Loading applications…' : 'No student applications submitted yet.'}</p>}
              </section>

              <div className="grid min-w-0 gap-5 xl:grid-cols-2">
                <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                    <div><h2 className="text-sm font-bold text-slate-900">Recent demo class requests</h2><p className="mt-1 text-xs text-slate-500">Requests managed separately from admissions</p></div>
                    <button type="button" onClick={() => navigateToAdminSection('demo-class-requests')} className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">View all</button>
                  </div>
                  {recentDemoRequests.length ? (
                    <div className="divide-y divide-slate-100 px-5">
                      {recentDemoRequests.map((request) => (
                        <div key={request.id} className="flex min-w-0 items-center justify-between gap-3 py-3">
                          <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-900">{request.full_name}</p><p className="mt-1 truncate text-[11px] text-slate-500">{request.city} · {new Date(request.created_at).toLocaleDateString('en-IN')}</p></div>
                          <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">{request.status}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="px-5 py-8 text-center text-sm text-slate-400">{loading ? 'Loading demo requests…' : 'No demo class requests yet.'}</p>}
                </section>

                <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
                    <div><h2 className="text-sm font-bold text-slate-900">Recent callback requests</h2><p className="mt-1 text-xs text-slate-500">Prospective learners requesting a call</p></div>
                    <button type="button" onClick={() => navigateToAdminSection('callbacks')} className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">View all</button>
                  </div>
                  {recentCallbacks.length ? (
                    <div className="divide-y divide-slate-100 px-5">
                      {recentCallbacks.map((callback) => (
                        <div key={callback.id} className="flex min-w-0 items-center justify-between gap-3 py-3">
                          <div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-900">{callback.full_name}</p><p className="mt-1 truncate text-[11px] text-slate-500">{callback.program_name} · {new Date(callback.created_at).toLocaleDateString('en-IN')}</p></div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${callback.status === 'Completed' ? 'bg-emerald-50 text-emerald-700' : callback.status === 'Contacted' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{callback.status}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="px-5 py-8 text-center text-sm text-slate-400">{loading ? 'Loading callback requests…' : 'No callback requests yet.'}</p>}
                </section>
              </div>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="mb-4"><h2 className="text-sm font-bold text-slate-900">Quick actions</h2><p className="mt-1 text-xs text-slate-500">Jump to sections available for your role</p></div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                  {allowedNavItems.filter((item) => item.id !== 'dashboard').slice(0, 10).map((item) => {
                    const Icon = item.icon;
                    return <button type="button" key={item.id} onClick={() => navigateToAdminSection(item.id)} className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{item.label}</span></button>;
                  })}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <h2 className="mb-4 text-sm font-bold text-slate-900">Integration status & connectivity</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-xs"><span className="font-semibold text-slate-700">Database & persistence</span><span className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold ${integrationStatusClass(systemStatus?.supabase)}`}>{integrationStatusLabel(systemStatus?.supabase, 'Supabase Not Configured')}</span></div>
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-xs"><span className="font-semibold text-slate-700">Resend transactional email</span><span className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold ${integrationStatusClass(systemStatus?.resend)}`}>{integrationStatusLabel(systemStatus?.resend, 'API key missing')}</span></div>
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-xs"><span className="font-semibold text-slate-700">Cloudflare R2 storage</span><span className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold ${integrationStatusClass(systemStatus?.r2_storage)}`}>{integrationStatusLabel(systemStatus?.r2_storage, 'R2 Not Configured')}</span></div>
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-xs"><span className="font-semibold text-slate-700">Official fee structure PDF</span><span className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold ${integrationStatusClass(systemStatus?.official_pdf)}`}>{systemStatus?.official_pdf?.available ? 'PDF Ready' : integrationStatusLabel(systemStatus?.official_pdf, 'Configure PDF')}</span></div>
                </div>
              </section>
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
                  {(['All', 'Pending', 'Accepted', 'Archived'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => handleApplicationFilterChange(status)}
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

              <section
                aria-label="Accepted application total"
                className="flex max-w-sm items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-4 shadow-sm"
              >
                <div>
                  <p className="text-xs font-bold text-emerald-800">Total Accepted Applications</p>
                  <p className="mt-1 text-[11px] text-slate-500">Applications approved by the academy</p>
                </div>
                <span className="grid h-12 min-w-12 place-items-center rounded-xl bg-emerald-600 px-3 text-xl font-extrabold tabular-nums text-white shadow-sm">
                  {applications.filter((application) => application.status === 'Accepted').length}
                </span>
              </section>

              {/* Search Bar */}
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Search by student name, ref, mobile, or email..."
                  value={appSearch}
                  onChange={(e) => {
                    setAppSearch(e.target.value);
                    setApplicationDisplayLimit(10);
                  }}
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-orange-500 focus:outline-hidden"
                />
              </div>

              {applicationsError && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {applicationsError}
                  <button type="button" onClick={() => void loadApplications()} className="ml-3 font-bold underline">Retry</button>
                </div>
              )}

              {isSuperAdmin && applicationPhotoCleanupJobs.length > 0 && (
                <section aria-label="Application photo cleanup retries" className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div>
                    <h2 className="text-sm font-bold text-amber-950">Application photo cleanup needs attention</h2>
                    <p className="mt-1 text-xs text-amber-800">Application records were deleted; retry these private R2 photo cleanups.</p>
                  </div>
                  {applicationPhotoCleanupJobs.map((job) => (
                    <div key={job.id} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800">{job.application_reference}</p>
                        <p className="mt-1 text-[11px] text-slate-600">
                          {job.status} · {job.attempt_count} attempt{job.attempt_count === 1 ? '' : 's'}
                          {job.error_message ? ` · ${job.error_message}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void handleRetryApplicationPhotoCleanup(job.id)}
                        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        Retry photo cleanup
                      </button>
                    </div>
                  ))}
                </section>
              )}

              <div className="space-y-4">
                {visibleApplications.length > 0 ? (
                  visibleApplications.map((app) => (
                    <article
                      key={app.id}
                      className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs transition-shadow hover:shadow-sm"
                    >
                      <div className="flex min-w-0 flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Application reference</p>
                          <p className="mt-1 break-all font-mono text-sm font-bold text-orange-700">{app.application_reference}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className={`inline-flex w-max items-center rounded-full border px-3 py-1 text-xs font-bold ${
                              app.status === 'Accepted'
                                ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                                : 'border-amber-200 bg-amber-100 text-amber-800'
                            }`}
                          >
                            {app.status}
                          </span>
                          {app.archived_at && (
                            <span className="inline-flex w-max items-center rounded-full border border-slate-300 bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                              Archived
                            </span>
                          )}
                          <p className="text-xs text-slate-500">
                            Submitted{' '}
                            <span className="font-semibold text-slate-700">
                              {new Date(app.created_at).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="grid min-w-0 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-center">
                        <div className="flex min-w-0 items-start gap-3">
                          {app.photo_data_url ? (
                            <button
                              type="button"
                              onClick={() => setAppPhotoModal(app.photo_data_url!)}
                              className="h-16 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 transition-colors hover:border-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
                              title={`View ${app.student_name}'s photo`}
                              aria-label={`View ${app.student_name}'s photo`}
                            >
                              <img src={app.photo_data_url} alt="" className="h-full w-full object-cover" />
                            </button>
                          ) : (
                            <div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-[10px] text-slate-400">
                              No photo
                            </div>
                          )}
                          <div className="min-w-0 space-y-1">
                            <h2 className="break-words text-sm font-bold text-slate-950">{app.student_name}</h2>
                            <a href={`mailto:${app.email}`} className="block break-all text-xs text-blue-700 hover:underline">
                              {app.email}
                            </a>
                            <a href={`tel:${app.mobile.replace(/[^\d+]/g, '')}`} className="block break-words text-xs text-slate-600 hover:underline">
                              {app.mobile}
                            </a>
                          </div>
                        </div>

                        <div className="min-w-0 space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Program</p>
                          <p className="break-words text-sm font-semibold text-slate-800">{app.program_name}</p>
                          <p className="text-xs text-slate-600">
                            <span className="font-semibold text-slate-700">Qualification:</span> {app.qualification}
                          </p>
                        </div>

                        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-2 lg:w-56">
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => { setApplicationJoiningInfo({ ...DEFAULT_JOINING_INFORMATION }); setSelectedApp(app); }}
                            className="min-h-10 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50"
                          >
                            Review
                          </button>
                          <button
                            type="button"
                            disabled={loading || paymentLoading}
                            onClick={() => void loadApplicationPaymentData(app)}
                            className="min-h-10 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                          >
                            Payment
                          </button>
                          {app.status === 'Pending' && (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => { setApplicationJoiningInfo({ ...DEFAULT_JOINING_INFORMATION }); setSelectedApp(app); }}
                              className="col-span-2 min-h-10 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
                              title="Open review and complete joining information before approval"
                            >
                              Review &amp; Approve
                            </button>
                          )}
                          {isSuperAdmin && (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => handleDeleteApplication(app.id)}
                              className="col-span-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50"
                              title="Permanently Delete Application (Super Admin only)"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Delete application
                            </button>
                          )}
                          {isAdminOrHigher && !app.archived_at && (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => void handleArchiveApplication(app.id)}
                              className="col-span-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                              title="Archive this application while preserving linked payments"
                            >
                              Archive application
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">
                    {applicationsLoading ? 'Loading applications...' : 'No applications found matching your criteria.'}
                  </div>
                )}
              </div>
              {visibleApplications.length < filteredApplications.length && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setApplicationDisplayLimit((current) => current + 10)}
                    className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Load 10 more applications ({filteredApplications.length - visibleApplications.length} remaining)
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'demo-class-requests' && (
            <AdminDemoClassRequests
              currentAdmin={currentAdmin}
              onRequestsChanged={refreshRequestData}
              onSessionExpired={onSessionExpired}
                      refreshToken={demoRefreshToken}
            />
          )}

          {/* TAB 3: CALLBACK REQUESTS */}
          {activeTab === 'callbacks' && (
            <div className="mx-auto max-w-[1600px] space-y-6">
              <header className="flex flex-col gap-4 rounded-2xl bg-gradient-to-br from-[#0B1F4D] via-[#123365] to-[#1B4778] p-5 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between sm:p-7">
                <div className="flex items-start gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 text-orange-300 ring-1 ring-white/15">
                    <PhoneCall className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-200">Learner follow-up</p>
                    <h1 className="mt-1 text-xl font-extrabold sm:text-2xl">Callback Requests</h1>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-blue-100 sm:text-sm">
                      Keep track of prospective learners and their preferred time to hear from the academy.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void loadCallbackRequests()}
                  disabled={callbacksLoading}
                  className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-300 disabled:opacity-60 sm:self-auto"
                >
                  <RefreshCw className={`h-4 w-4 ${callbacksLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  Refresh Callbacks
                </button>
              </header>

              <section aria-label="Callback request totals" className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: 'Total Requests', count: callbacks.length, description: 'All callback enquiries', icon: PhoneCall, styles: 'border-blue-100 bg-blue-50 text-blue-800', iconStyles: 'bg-blue-100 text-blue-700' },
                  { label: 'Pending', count: callbacks.filter((callback) => callback.status === 'Pending').length, description: 'Awaiting first contact', icon: ClockIcon, styles: 'border-orange-100 bg-orange-50 text-orange-800', iconStyles: 'bg-orange-100 text-orange-700' },
                  { label: 'Contacted', count: callbacks.filter((callback) => callback.status === 'Contacted').length, description: 'Follow-up in progress', icon: Users, styles: 'border-violet-100 bg-violet-50 text-violet-800', iconStyles: 'bg-violet-100 text-violet-700' },
                  { label: 'Completed', count: callbacks.filter((callback) => callback.status === 'Completed').length, description: 'Requests completed', icon: CheckCircle, styles: 'border-emerald-100 bg-emerald-50 text-emerald-800', iconStyles: 'bg-emerald-100 text-emerald-700' },
                ].map(({ label, count, description, icon: Icon, styles, iconStyles }) => (
                  <article key={label} className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${styles}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold">{label}</p>
                        <p className="mt-2 text-3xl font-extrabold tracking-tight text-[#0B1F4D]">{callbacksLoading ? '—' : count}</p>
                        <p className="mt-1 text-[11px] opacity-80">{description}</p>
                      </div>
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconStyles}`}>
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                    </div>
                  </article>
                ))}
              </section>

              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:p-4">
                <label className="relative block">
                  <span className="sr-only">Search callback requests</span>
                  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    aria-label="Search callback requests"
                    value={callbackSearch}
                    onChange={(event) => setCallbackSearch(event.target.value)}
                    placeholder="Search name, phone, email, program, or message"
                    className="min-h-11 w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </label>
                <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 sm:justify-start">
                  Status
                  <select
                    aria-label="Filter callback requests by status"
                    value={callbackFilterStatus}
                    onChange={(event) => setCallbackFilterStatus(event.target.value as typeof callbackFilterStatus)}
                    className="min-h-9 min-w-32 rounded-lg bg-white px-2 text-sm text-[#0B1F4D] outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                  >
                    {(['All', 'Pending', 'Contacted', 'Completed'] as const).map((status) => <option key={status} value={status}>{status === 'All' ? 'All statuses' : status}</option>)}
                  </select>
                </label>
              </div>

              {callbacksError && filteredCallbacks.length > 0 && (
                <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  Could not refresh callback requests: {callbacksError}
                </p>
              )}

              {filteredCallbacks.length > 0 ? (
                <>
                  <section className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:block">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1050px] text-left text-xs">
                        <thead className="bg-[#F2F5FB] text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                          <tr>
                            <th scope="col" className="px-5 py-4">Name</th>
                            <th scope="col" className="px-4 py-4">Contact</th>
                            <th scope="col" className="px-4 py-4">Program</th>
                            <th scope="col" className="px-4 py-4">Preferred time</th>
                            <th scope="col" className="px-4 py-4">Message</th>
                            <th scope="col" className="px-4 py-4">Received</th>
                            <th scope="col" className="px-4 py-4">Status</th>
                            <th scope="col" className="px-5 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {filteredCallbacks.map((callback) => (
                            <tr key={callback.id} className="align-top transition-colors hover:bg-orange-50/40">
                              <td className="px-5 py-4">
                                <p className="font-bold text-[#0B1F4D]">{callback.full_name}</p>
                                {callback.email && <p className="mt-1 max-w-48 truncate text-[11px] text-slate-500">{callback.email}</p>}
                              </td>
                              <td className="px-4 py-4">
                                <a href={`tel:${callback.mobile.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:text-emerald-800">
                                  <PhoneCall className="h-3.5 w-3.5" aria-hidden="true" />{callback.mobile}
                                </a>
                              </td>
                              <td className="max-w-44 px-4 py-4 font-medium text-slate-700">{callback.program_name}</td>
                              <td className="px-4 py-4">
                                <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-bold text-orange-800">{callback.preferred_contact_time}</span>
                              </td>
                              <td className="max-w-52 px-4 py-4 text-slate-500" title={callback.message || undefined}>
                                <span className="block truncate">{callback.message || 'No message provided'}</span>
                              </td>
                              <td className="whitespace-nowrap px-4 py-4 text-slate-500">
                                {new Date(callback.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                              </td>
                              <td className="px-4 py-4">
                                <label className="sr-only" htmlFor={`callback-status-${callback.id}`}>Status for {callback.full_name}</label>
                                <select
                                  id={`callback-status-${callback.id}`}
                                  value={callback.status}
                                  disabled={loading}
                                  onChange={(event) => handleCallbackStatusChange(callback, event.target.value as CallbackRequest['status'])}
                                  className={`min-h-9 w-32 rounded-lg border px-2.5 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-60 ${callback.status === 'Completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : callback.status === 'Contacted' ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
                                >
                                  {(['Pending', 'Contacted', 'Completed'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
                                </select>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex justify-end gap-2">
                                  <button type="button" disabled={loading} onClick={() => setSelectedCallback(callback)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-60">View</button>
                                  <button
                                    type="button"
                                    disabled={loading}
                                    onClick={() => void handleDeleteCallback(callback)}
                                    aria-label={`Delete callback request from ${callback.full_name}`}
                                    title="Delete callback request"
                                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 font-bold text-rose-700 transition-colors hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:opacity-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <div className="grid gap-3 md:grid-cols-2 xl:hidden">
                    {filteredCallbacks.map((callback) => (
                      <article key={callback.id} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
                        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                          <div className="min-w-0">
                            <h2 className="break-words font-bold text-[#0B1F4D]">{callback.full_name}</h2>
                            <p className="mt-1 text-[11px] text-slate-500">
                              Received {new Date(callback.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                          </div>
                          <label className="w-32 shrink-0 space-y-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Status
                            <select
                              aria-label={`Status for ${callback.full_name}`}
                              value={callback.status}
                              disabled={loading}
                              onChange={(event) => handleCallbackStatusChange(callback, event.target.value as CallbackRequest['status'])}
                              className={`min-h-9 w-full rounded-lg border px-2 text-xs font-bold normal-case tracking-normal outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-60 ${callback.status === 'Completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : callback.status === 'Contacted' ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
                            >
                              {(['Pending', 'Contacted', 'Completed'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
                            </select>
                          </label>
                        </div>
                        <div className="grid gap-3 text-xs sm:grid-cols-2">
                          <a href={`tel:${callback.mobile.replace(/[^\d+]/g, '')}`} className="flex min-w-0 items-center gap-2 break-all font-semibold text-emerald-700 hover:text-emerald-800">
                            <PhoneCall className="h-4 w-4 shrink-0" aria-hidden="true" />{callback.mobile}
                          </a>
                          {callback.email && <a href={`mailto:${callback.email}`} className="min-w-0 break-all text-slate-600 hover:text-orange-700">{callback.email}</a>}
                          <p className="text-slate-700"><span className="font-bold text-slate-500">Program: </span>{callback.program_name}</p>
                          <p><span className="font-bold text-slate-500">Preferred time: </span><span className="font-semibold text-orange-800">{callback.preferred_contact_time}</span></p>
                        </div>
                        <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-400">Message</span>
                          {callback.message || 'No message provided.'}
                        </p>
                        <div className="flex gap-2 border-t border-slate-100 pt-3">
                          <button type="button" disabled={loading} onClick={() => setSelectedCallback(callback)} className="min-h-10 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">View details</button>
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => void handleDeleteCallback(callback)}
                            aria-label={`Delete callback request from ${callback.full_name}`}
                            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />Delete
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center shadow-sm">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-600">
                    <PhoneCall className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <h2 className="mt-4 font-bold text-[#0B1F4D]">
                    {callbacksLoading ? 'Loading callback requests…' : callbacksError && !callbacks.length ? 'Unable to load callback requests' : callbacks.length ? 'No matching requests' : 'No callback requests yet'}
                  </h2>
                  <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                    {callbacksError || (callbacks.length ? 'Try adjusting your search or status filter.' : 'New callback enquiries will appear here when prospective learners contact the academy.')}
                  </p>
                  {callbacksError && <button type="button" onClick={() => void loadCallbackRequests()} className="mt-3 text-xs font-bold text-orange-700 underline">Retry loading requests</button>}
                </div>
              )}
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
                      feeConfiguration: emptyProgramFeeConfiguration(),
                    })
                  }
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Program</span>
                </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {programs.map((prog) => (
                  <div key={prog.id} className="min-w-0 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
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
                        <p><strong>Fee:</strong> {programFeeConfigurations[prog.id]?.final_payable == null
                          ? 'Not configured'
                          : `INR ${Number(programFeeConfigurations[prog.id].final_payable).toLocaleString('en-IN')}`}</p>
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
                        onClick={() => setEditingProgram({
                          ...prog,
                          feeConfiguration: programFeeConfigurations[prog.id] || emptyProgramFeeConfiguration(prog.id),
                        })}
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
            <div className="space-y-5">
              <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                    <Video className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-600">Gallery workspace</p>
                    <h1 className="text-xl font-extrabold leading-tight text-[#0B1F4D] sm:text-2xl">Media & Testimonials Management</h1>
                    <p className="mt-1 text-xs text-slate-500">
                    Manage published and draft photo and YouTube video entries for the public academy gallery.
                    </p>
                  </div>
                </div>
                <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:flex-wrap lg:justify-end">
                <button type="button" onClick={fetchAllData} disabled={loading} className="col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 lg:col-span-1">
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
                  className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 lg:px-4"
                >
                  <Plus className="w-4 h-4" />
                  <span className="whitespace-nowrap">Add Photo</span>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    resetMediaForm();
                    setMediaForm((current) => ({ ...current, media_type: 'video' }));
                    setActiveTab('media');
                  }}
                  className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#0B1F4D] px-3 py-2.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B1F4D] disabled:opacity-60 lg:px-4"
                >
                  <Plus className="w-4 h-4" />
                  <span className="whitespace-nowrap">Add Testimonial</span>
                </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
                <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
                  <div className="mb-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-base font-bold text-[#0B1F4D] sm:text-lg">All Media Entries</h2>
                        <p className="mt-0.5 text-[11px] text-slate-500">Browse and manage your gallery content.</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                        {filteredMediaItems.length} of {mediaItems.length} entries
                      </span>
                    </div>
                    <div className="flex flex-col gap-2 border-y border-slate-100 py-3 sm:flex-row sm:items-center">
                      <div className="flex w-fit max-w-full items-center gap-1 rounded-xl bg-slate-100 p-1">
                      {([
                        { value: 'all', label: 'All' },
                        { value: 'photo', label: 'Photos' },
                        { value: 'video', label: 'Testimonials' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={mediaFilter === value}
                          onClick={() => setMediaFilter(value)}
                          className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 ${
                            mediaFilter === value
                              ? 'bg-white text-[#0B1F4D] shadow-sm'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      </div>
                      <label className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        <input
                          type="search"
                          value={mediaSearch}
                          onChange={(event) => setMediaSearch(event.target.value)}
                          placeholder="Search by name..."
                          aria-label="Search media by name"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs transition focus:border-orange-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-100"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="max-h-[620px] space-y-3 overflow-y-auto pr-1">
                    {filteredMediaItems.length > 0 ? (
                      filteredMediaItems.map((item) => (
                        <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-orange-200 hover:bg-orange-50/20">
                          <div className="flex items-start gap-3">
                            <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                              {(item.cover_image_url || item.media_url || (item.media_type === 'video' && item.youtube_video_id))
                                ? <img
                                    src={item.cover_image_url || item.media_url || `https://img.youtube.com/vi/${item.youtube_video_id}/hqdefault.jpg`}
                                    alt={item.alt_text || item.title}
                                    className="w-full h-full object-cover"
                                  />
                                : <div className="w-full h-full flex items-center justify-center text-slate-400"><Video className="w-6 h-6" aria-label="No preview available" /></div>}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-bold text-slate-900 text-sm truncate">{item.title}</p>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${item.is_published ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
                                  {item.is_published ? 'Published' : 'Draft'}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500">{item.media_type === 'video' ? 'Testimonial video' : 'Photo'} · Order {item.display_order || 0}</p>
                              <p className="text-[11px] text-slate-600 mt-2 line-clamp-2">{item.caption || 'No caption set.'}</p>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-2.5">
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
                      <div className="text-center py-12 text-slate-400 text-xs">
                        {loading
                          ? 'Loading gallery...'
                          : mediaItems.length
                            ? 'No entries match your filter or search.'
                            : 'No media entries found yet.'}
                      </div>
                    )}
                  </div>
                </div>

                <form onSubmit={handleSaveMedia} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-600">
                        {editingMediaId ? 'Update gallery' : 'Create gallery entry'}
                      </p>
                      <h2 className="mt-0.5 text-base font-bold text-[#0B1F4D] sm:text-lg">
                        {editingMediaId ? 'Edit Media' : 'Add Media'}
                      </h2>
                    </div>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={resetMediaForm}
                      className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 disabled:opacity-50"
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
                        Testimonial
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

              <section aria-label="Demo and callback email notifications" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Demo and Callback Notifications</h2>
                  <p className="mt-1 text-xs text-slate-500">Delivery attempts for requests saved outside the application workflow.</p>
                </div>
                {requestEmailError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{requestEmailError}</p>}
                {requestEmailNotifications.length ? (
                  <div className="divide-y divide-slate-100">
                    {requestEmailNotifications.map((notification) => (
                      <article key={notification.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-bold text-slate-900">
                            {notification.request_type === 'demo_class_requests' ? 'Demo class' : 'Callback'} · {notification.notification_type.replace('_', ' ')}
                          </p>
                          <p className="break-all text-xs text-slate-600">{notification.recipient_email}</p>
                          <p className="text-[11px] text-slate-500">
                            {notification.status} · {notification.attempt_count} attempt{notification.attempt_count === 1 ? '' : 's'}
                            {notification.error_message ? ` · ${notification.error_message}` : ''}
                          </p>
                        </div>
                        {notification.status !== 'Sent' && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => void handleRetryRequestEmailNotification(notification.id)}
                            className="min-h-9 shrink-0 rounded-lg bg-orange-600 px-3 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-50"
                          >
                            Retry email
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-500">
                    {loading ? 'Loading request email notifications…' : 'No demo or callback email attempts logged.'}
                  </p>
                )}
              </section>

              <div className="bg-transparent sm:bg-white rounded-2xl sm:border sm:border-slate-200 sm:shadow-xs overflow-hidden">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:hidden">
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
                <div className="hidden overflow-x-auto overscroll-x-contain 2xl:block">
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
            <div className="max-w-6xl space-y-5">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                  <Palette className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-600">Website appearance</p>
                  <h1 className="text-xl font-extrabold leading-tight text-[#0B1F4D] sm:text-2xl">Site Branding & Assets</h1>
                  <p className="mt-1 text-xs text-slate-500">
                  {isSuperAdmin
                    ? 'Manage site-wide branding and visual assets.'
                    : 'Update the photo shown in the homepage hero section.'}
                  </p>
                </div>
              </div>

              {editingBranding ? (
                <form onSubmit={handleSaveBranding} className="space-y-5 text-xs">
                  {isSuperAdmin && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5" aria-labelledby="logo-assets-heading">
                    <div className="mb-4 border-b border-slate-100 pb-3">
                      <h2 id="logo-assets-heading" className="text-sm font-bold text-[#0B1F4D]">Logo & Visual Brand Assets</h2>
                      <p className="mt-1 text-[11px] text-slate-500">Upload the logos used in navigation, browser tabs, and the footer.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                      <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                        <label className="mb-1.5 block font-bold text-slate-700">Main Logo</label>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(event) => handleBrandingFileChange('logo_file_base64', event)}
                          className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px]"
                        />
                        {(editingBranding.logo_file_base64 || editingBranding.logo_url) && (
                          <img
                            src={editingBranding.logo_file_base64 || editingBranding.logo_url}
                            alt="Main logo preview"
                            className="mt-2 h-24 w-full rounded-lg border border-slate-200 bg-white p-2 object-contain"
                          />
                        )}
                        <p className="mt-1 text-[10px] text-slate-500">PNG, JPEG, or WebP; maximum 3 MB.</p>
                        <label className="mb-1 mt-3 block font-bold text-slate-700">Logo Alt Text</label>
                        <input
                          type="text"
                          value={editingBranding.main_logo_alt || editingBranding.logo_alt || ''}
                          onChange={(e) => setEditingBranding({ ...editingBranding, main_logo_alt: e.target.value, logo_alt: e.target.value })}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2"
                          placeholder="Describe the academy logo"
                        />
                      </div>
                      <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                        <label className="mb-1.5 block font-bold text-slate-700">Favicon</label>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,.ico,image/x-icon,image/vnd.microsoft.icon"
                          onChange={(event) => handleBrandingFileChange('favicon_file_base64', event)}
                          className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px]"
                        />
                        {(editingBranding.favicon_file_base64 || editingBranding.favicon_url) && (
                          <img
                            src={editingBranding.favicon_file_base64 || editingBranding.favicon_url}
                            alt="Favicon preview"
                            className="mt-2 h-24 w-full rounded-lg border border-slate-200 bg-white p-2 object-contain"
                          />
                        )}
                        <p className="mt-1 text-[10px] text-slate-500">ICO, PNG, JPEG, or WebP; maximum 1 MB.</p>
                      </div>
                      <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                        <label className="mb-1.5 block font-bold text-slate-700">Footer Logo</label>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(event) => handleBrandingFileChange('footer_logo_file_base64', event)}
                          className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px]"
                        />
                        {(editingBranding.footer_logo_file_base64 || editingBranding.footer_logo_url) && (
                          <img
                            src={editingBranding.footer_logo_file_base64 || editingBranding.footer_logo_url}
                            alt="Footer logo preview"
                            className="mt-2 h-24 w-full rounded-lg border border-slate-200 bg-white p-2 object-contain"
                          />
                        )}
                        <p className="mt-1 text-[10px] text-slate-500">PNG, JPEG, or WebP; maximum 3 MB.</p>
                      </div>
                    </div>
                  </section>}

                  <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5" aria-labelledby="hero-photo-heading">
                    <div className="border-b border-slate-100 pb-3">
                      <h2 id="hero-photo-heading" className="font-bold text-[#0B1F4D] text-sm">Hero Section Photo</h2>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                        This photo appears on the homepage and is shown using its full aspect ratio on desktop and mobile. A transparent PNG is recommended for a student cutout image.
                      </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(220px,.7fr)] sm:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2">
                          <label className={`inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-700 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-700 ${loading ? 'pointer-events-none opacity-60' : ''}`}>
                            <span>{editingBranding.hero_photo_file_base64 ? 'Change Photo' : 'Upload / Change Photo'}</span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,.jpg,.jpeg"
                              disabled={loading}
                              onChange={(event) => handleBrandingFileChange('hero_photo_file_base64', event)}
                              className="sr-only"
                            />
                          </label>
                          {(editingBranding.hero_photo_url || editingBranding.hero_photo_file_base64) && (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => {
                                if (!window.confirm('Remove the current hero photo and use the website default instead?')) return;
                                setEditingBranding((current) => {
                                  if (!current) return current;
                                  const next = { ...current, hero_photo_url: null };
                                  delete next.hero_photo_file_base64;
                                  return next;
                                });
                                setActionMessage(null);
                              }}
                              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:opacity-60"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              Remove Photo
                            </button>
                          )}
                        </div>
                        <p className="mt-2 text-[10px] text-slate-500">PNG, JPG, JPEG, or WebP; maximum 3 MB. Select a photo, then save to upload it.</p>
                        {loading && (
                          <p role="status" className="mt-2 text-xs font-medium text-blue-700">
                            Uploading and saving hero photo…
                          </p>
                        )}
                      </div>
                      <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-[#fff8ef]">
                        <img
                          src={editingBranding.hero_photo_file_base64 || (editingBranding.hero_photo_url === null ? '/assets/hero-students-reference.png' : editingBranding.hero_photo_url || '/assets/hero-students-reference.png')}
                          alt="Homepage hero photo preview"
                          className="aspect-video w-full object-contain"
                        />
                        <p className="border-t border-slate-200 bg-white px-3 py-2 text-[10px] font-semibold text-slate-500">
                          {editingBranding.hero_photo_file_base64
                            ? 'Selected photo preview — save to publish'
                            : editingBranding.hero_photo_url
                              ? 'Current saved hero photo'
                              : 'Default hero photo'}
                        </p>
                      </div>
                    </div>
                  </section>

                  <div className="sticky bottom-0 flex justify-end rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:p-4">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl shadow-sm cursor-pointer disabled:cursor-wait disabled:opacity-60"
                    >
                      {loading ? 'Saving…' : isSuperAdmin ? 'Save Branding Configurations' : 'Save Hero Photo'}
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

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:hidden">
                {adminProfiles.length > 0 ? (
                  adminProfiles.map((adm) => (
                    <article key={adm.id} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="break-words text-sm font-bold text-slate-900">{adm.full_name}</h2>
                          <p className="mt-1 break-all text-xs text-slate-500">{adm.email}</p>
                        </div>
                        <span
                          className={`shrink-0 rounded px-2.5 py-1 text-[10px] font-extrabold uppercase ${
                            adm.role === 'super_admin'
                              ? 'border border-purple-200 bg-purple-100 text-purple-800'
                              : adm.role === 'admin'
                              ? 'border border-blue-200 bg-blue-100 text-blue-800'
                              : 'border border-emerald-200 bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {adm.role.replace('_', ' ')}
                        </span>
                      </div>
                      <dl className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Auth UID</dt>
                          <dd className="mt-1 break-all font-mono text-[11px] text-slate-600">{adm.id}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Status</dt>
                          <dd className="mt-1">
                            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${adm.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                              {adm.is_active ? 'Active' : 'Suspended'}
                            </span>
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Last Login</dt>
                          <dd className="mt-1 text-[11px] text-slate-600">{adm.last_login ? new Date(adm.last_login).toLocaleString('en-IN') : 'Never'}</dd>
                        </div>
                      </dl>
                      <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center">
                        {adm.id !== currentAdmin.id ? (
                          <>
                            <select
                              value={adm.role}
                              aria-label={`Role for ${adm.full_name}`}
                              onChange={(e) => handleUpdateAdminRole(adm.id, e.target.value as AdminRole, adm.is_active)}
                              className="min-w-0 flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-2 text-xs font-semibold cursor-pointer"
                            >
                              <option value="staff">Staff</option>
                              <option value="admin">Admin</option>
                              <option value="super_admin">Super Admin</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => handleUpdateAdminRole(adm.id, adm.role, !adm.is_active)}
                              className={`rounded px-3 py-2 text-xs font-bold cursor-pointer ${
                                adm.is_active
                                  ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              }`}
                            >
                              {adm.is_active ? 'Suspend' : 'Activate'}
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] font-semibold italic text-slate-400">Current Session</span>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-400">
                    No admin profiles found.
                  </p>
                )}
              </div>

              <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs 2xl:block">
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
            <div className="mx-auto max-w-6xl space-y-5">
              <header className="rounded-2xl border border-orange-100 bg-gradient-to-r from-[#fff8ef] via-white to-emerald-50 p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[.16em] text-orange-700">Official documents</p>
                <h1 className="mt-1 text-xl font-extrabold text-[#0B1F4D] sm:text-2xl">Settings & Official PDF Configuration</h1>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">Configure the branded PDF template. Student-specific information is read directly from an approved application and cannot be edited here.</p>
              </header>

              <section className="space-y-4 rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="official-student-preview-heading">
                <div>
                  <h2 id="official-student-preview-heading" className="font-bold text-[#0B1F4D]">Template preview</h2>
                  <p className="mt-1 text-xs text-slate-500">Preview PDFs use clearly marked placeholder details only. They are never issued or emailed to applicants.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={loading} onClick={() => void previewOfficialDocumentPdf()} className="min-h-11 rounded-xl bg-[#0B1F4D] px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:cursor-not-allowed disabled:opacity-50">Preview PDF</button>
                  <button type="button" disabled={loading} onClick={() => void previewOfficialDocumentPdf(true)} className="min-h-11 rounded-xl border border-orange-300 bg-white px-4 py-2.5 text-xs font-bold text-orange-800 transition-colors hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:cursor-not-allowed disabled:opacity-50">Download Preview PDF</button>
                </div>
              </section>

              <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="official-issued-document-heading">
                <div>
                  <h2 id="official-issued-document-heading" className="font-bold text-[#0B1F4D]">Issued student document</h2>
                  <p className="mt-1 text-xs text-slate-500">Select an approved application to inspect its real data and download its issued PDF. This selection is not used by the template preview.</p>
                </div>
                <label className="block max-w-2xl text-xs font-semibold text-slate-700">
                  Application history
                  <select
                    value={officialPdfApplicationId}
                    onChange={(event) => {
                      setOfficialPdfApplicationId(event.target.value);
                      void loadOfficialDocumentVersions(event.target.value);
                    }}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="">Select an approved application</option>
                    {applications.filter((application) => application.status === 'Accepted' && application.student_id).map((application) => (
                      <option key={application.id} value={application.id}>
                        {application.student_name} ? {application.application_reference} ? {application.program_name}
                      </option>
                    ))}
                  </select>
                </label>
                {(() => {
                  const application = applications.find((item) => item.id === officialPdfApplicationId && item.status === 'Accepted' && item.student_id);
                  if (!application) return <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{applications.some((item) => item.status === 'Accepted' && item.student_id) ? 'Choose an application to inspect its issued document history.' : 'No approved applications with permanent Student IDs are available yet.'}</p>;
                  return (
                    <dl className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
                      {([
                        ['Student name', application.student_name],
                        ['Student ID', application.student_id],
                        ['Application number', application.application_reference],
                        ['Qualification', application.qualification],
                        ['Selected course', application.program_name],
                        ['Email', application.email],
                        ['Mobile', application.mobile],
                        ['Date of birth', application.date_of_birth || 'Not provided'],
                        ['Address', application.address || 'Not provided'],
                      ] as const).map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="font-semibold text-slate-500">{label}</dt>
                          <dd className="mt-1 break-words font-bold text-[#0B1F4D]">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  );
                })()}
                {officialPdfApplicationId && (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {officialDocumentVersions.length ? officialDocumentVersions.map((version) => (
                      <div key={version.version_number} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-xs">
                        <div className="min-w-0">
                          <p className="font-bold text-[#0B1F4D]">Version {version.version_number} · {version.issuance_type.replace('_', ' ')}</p>
                          <p className="mt-1 text-slate-500">PDF: {version.status} · Email: {version.email_status} · Payment: {version.payment_status.replaceAll('_', ' ')}</p>
                          <p className="mt-1 text-slate-500">Paid: INR {Number(version.total_paid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}{version.generated_at ? ` · Generated ${new Date(version.generated_at).toLocaleString('en-IN')}` : ''}</p>
                        </div>
                        <button type="button" disabled={loading || version.status !== 'ready'} onClick={() => void downloadIssuedOfficialDocument(version.version_number)} className="min-h-9 rounded-lg border border-emerald-300 px-3 font-bold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">Download V{version.version_number}</button>
                      </div>
                    )) : <p className="p-3 text-xs text-slate-500">No issued PDF versions are available.</p>}
                  </div>
                )}
                <button type="button" disabled={loading || !applications.some((item) => item.id === officialPdfApplicationId && item.status === 'Accepted' && item.student_id)} onClick={() => void downloadIssuedOfficialDocument()} className="min-h-11 rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-xs font-bold text-emerald-800 transition-colors hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">Download Latest Issued PDF</button>
              </section>

              <form onSubmit={(event) => { event.preventDefault(); void saveOfficialDocumentSettings().catch(() => undefined); }} className="space-y-4">
                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div>
                    <h2 className="font-bold text-[#0B1F4D]">Branding and typography</h2>
                    <p className="mt-1 text-xs text-slate-500">Images are stored in private R2 and fetched through authenticated admin routes.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-3 rounded-xl border border-slate-100 p-3">
                      <label className="block text-xs font-semibold text-slate-700">Academy logo (PNG/JPEG, up to 3 MB)
                        <input type="file" accept="image/png,image/jpeg" onChange={(event) => handleOfficialAssetChange('logo', event)} className="mt-2 block w-full text-xs" />
                      </label>
                      {officialLogoPreviewUrl && <img src={officialLogoPreviewUrl} alt="Official PDF academy logo preview" className="h-24 w-full rounded-lg border border-slate-200 bg-white p-2 object-contain" />}
                      <button type="button" onClick={() => { setPendingOfficialLogo(null); setOfficialDocumentSettings((current) => ({ ...current, logoObjectKey: null })); setOfficialLogoPreviewUrl(null); }} className="text-xs font-semibold text-rose-700 underline">Remove logo</button>
                    </div>
                    <div className="space-y-3 rounded-xl border border-slate-100 p-3">
                      <label className="block text-xs font-semibold text-slate-700">Footer building / decorative image (PNG/JPEG, up to 3 MB)
                        <input type="file" accept="image/png,image/jpeg" onChange={(event) => handleOfficialAssetChange('graphic', event)} className="mt-2 block w-full text-xs" />
                      </label>
                      {officialGraphicPreviewUrl && <img src={officialGraphicPreviewUrl} alt="Official PDF footer image preview" className="h-24 w-full rounded-lg border border-slate-200 bg-white p-2 object-contain" />}
                      <button type="button" onClick={() => { setPendingOfficialGraphic(null); setOfficialDocumentSettings((current) => ({ ...current, graphicObjectKey: null })); setOfficialGraphicPreviewUrl(null); }} className="text-xs font-semibold text-rose-700 underline">Remove graphic</button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {([
                      ['orange', 'Academy orange'],
                      ['green', 'Academy green'],
                      ['navy', 'Navy typography'],
                      ['background', 'PDF background'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
                        <input type="color" value={officialDocumentSettings.colors[key]} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, colors: { ...current.colors, [key]: event.target.value } }))} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0" />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-xs font-semibold text-slate-700">Font family
                      <select value={officialDocumentSettings.typography.fontFamily} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, typography: { ...current.typography, fontFamily: event.target.value as OfficialDocumentSettings['typography']['fontFamily'] } }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2">
                        {(['Helvetica', 'TimesRoman', 'Courier'] as const).map((font) => <option key={font} value={font}>{font}</option>)}
                      </select>
                    </label>
                    {([
                      ['titleSize', 'Title size', 12, 24],
                      ['headingSize', 'Section heading size', 8, 16],
                      ['bodySize', 'Body size', 7, 14],
                    ] as const).map(([key, label, min, max]) => (
                      <label key={key} className="text-xs font-semibold text-slate-700">{label}
                        <input type="number" min={min} max={max} step="1" value={officialDocumentSettings.typography[key]} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, typography: { ...current.typography, [key]: Number(event.target.value) } }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3" />
                      </label>
                    ))}
                  </div>
                </section>

                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <h2 className="font-bold text-[#0B1F4D]">Document content and academy contact</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {([
                      ['academyName', 'Academy name'], ['heading', 'Main heading'], ['subtitle', 'Subtitle'],
                      ['approvalMessage', 'Approval banner'], ['address', 'Academy address'], ['phone', 'Phone number'],
                      ['email', 'Academy email'], ['hours', 'Opening hours'], ['footerText', 'Footer text'],
                      ['motivationalTagline', 'Academy tagline'],
                    ] as const).map(([field, label]) => (
                      <label key={field} className="text-xs font-semibold text-slate-700">{label}
                        <input value={officialDocumentSettings[field]} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, [field]: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3" />
                      </label>
                    ))}
                    <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Introductory message
                      <textarea rows={3} value={officialDocumentSettings.welcomeMessage} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, welcomeMessage: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(Object.entries(officialDocumentSettings.sectionHeadings) as [OfficialSection, string][]).map(([section, heading]) => (
                      <label key={section} className="text-xs font-semibold text-slate-700">{section} section heading
                        <input value={heading} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, sectionHeadings: { ...current.sectionHeadings, [section]: event.target.value } }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3" />
                      </label>
                    ))}
                  </div>
                </section>

                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><h2 className="font-bold text-[#0B1F4D]">Terms and conditions</h2><p className="mt-1 text-xs text-slate-500">Edit, remove, and reorder terms. Preview the saved terms in the PDF above.</p></div>
                    <button type="button" disabled={officialDocumentSettings.terms.length >= 100} onClick={() => setOfficialDocumentSettings((current) => ({ ...current, terms: [...current.terms, ''] }))} className="min-h-9 rounded-lg border border-orange-200 px-3 text-xs font-bold text-orange-800 disabled:opacity-50">Add term</button>
                  </div>
                  {officialDocumentSettings.terms.map((term, index) => (
                    <div key={`term-${index}`} className="flex items-start gap-2">
                      <span className="pt-3 text-xs font-bold text-slate-500">{index + 1}.</span>
                      <textarea aria-label={`Term ${index + 1}`} rows={2} maxLength={1000} value={term} onChange={(event) => updateOfficialTerm(index, event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                      <div className="flex flex-col gap-1">
                        <button type="button" aria-label={`Move term ${index + 1} up`} disabled={index === 0} onClick={() => moveOfficialTerm(index, -1)} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Up</button>
                        <button type="button" aria-label={`Move term ${index + 1} down`} disabled={index === officialDocumentSettings.terms.length - 1} onClick={() => moveOfficialTerm(index, 1)} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Up</button>
                        <button type="button" aria-label={`Delete term ${index + 1}`} onClick={() => setOfficialDocumentSettings((current) => ({ ...current, terms: current.terms.filter((_, termIndex) => termIndex !== index) }))} className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700">Delete</button>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <h2 className="font-bold text-[#0B1F4D]">Payment configuration</h2>
                  <label className="block text-xs font-semibold text-slate-700">Payment instructions
                    <textarea rows={2} value={officialDocumentSettings.paymentInstructions} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, paymentInstructions: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-semibold text-slate-700">Payment methods (one per line)
                      <textarea rows={3} value={officialDocumentSettings.paymentMethods.join('\n')} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, paymentMethods: event.target.value.split('\n').map((method) => method.trim()).filter(Boolean) }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
                    </label>
                    <label className="text-xs font-semibold text-slate-700">Bank or UPI details
                      <textarea rows={3} value={officialDocumentSettings.bankDetails} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, bankDetails: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
                    </label>
                  </div>
                  <label className="block text-xs font-semibold text-slate-700">Additional payment notes
                    <textarea rows={2} value={officialDocumentSettings.additionalPaymentNotes} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, additionalPaymentNotes: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2" />
                  </label>
                </section>

                <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <h2 className="font-bold text-[#0B1F4D]">Layout configuration</h2>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="text-xs font-semibold text-slate-700">Page size
                      <select value={officialDocumentSettings.layout.pageSize} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, layout: { ...current.layout, pageSize: event.target.value as OfficialDocumentSettings['layout']['pageSize'] } }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2"><option value="A4">A4</option><option value="Letter">Letter</option></select>
                    </label>
                    <label className="text-xs font-semibold text-slate-700">Spacing
                      <input type="number" min="0.75" max="1.75" step="0.05" value={officialDocumentSettings.layout.spacing} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, layout: { ...current.layout, spacing: Number(event.target.value) } }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3" />
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {([
                      ['showLogo', 'Show academy logo'], ['showStudentPhoto', 'Show student photo'],
                      ['showDecorations', 'Show decorations'], ['showFooter', 'Show branded footer'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-100 px-3 text-xs font-semibold text-slate-700"><input type="checkbox" checked={officialDocumentSettings.layout[key]} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, layout: { ...current.layout, [key]: event.target.checked } }))} />{label}</label>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-slate-700">Section visibility and order</h3>
                    {officialDocumentSettings.layout.sectionOrder.map((section, index) => (
                      <div key={section} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-100 px-3">
                        <input type="checkbox" aria-label={`Show ${section} section`} checked={officialDocumentSettings.layout.visibleSections.includes(section)} onChange={(event) => setOfficialDocumentSettings((current) => ({ ...current, layout: { ...current.layout, visibleSections: event.target.checked ? [...current.layout.visibleSections, section] : current.layout.visibleSections.filter((item) => item !== section) } }))} />
                        <span className="flex-1 text-xs font-semibold capitalize text-slate-700">{section}</span>
                        <button type="button" aria-label={`Move ${section} section up`} disabled={index === 0} onClick={() => moveOfficialSection(section, -1)} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Up</button>
                        <button type="button" aria-label={`Move ${section} section down`} disabled={index === officialDocumentSettings.layout.sectionOrder.length - 1} onClick={() => moveOfficialSection(section, 1)} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Up</button>
                      </div>
                    ))}
                  </div>
                </section>

                <div className="sticky bottom-2 flex flex-wrap justify-end gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
                  <button type="button" disabled={loading} onClick={resetOfficialDocumentSettings} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Reset to Defaults</button>
                  <button type="submit" disabled={loading} className="min-h-11 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-50">{loading ? 'Saving...' : 'Save Changes'}</button>
                </div>
              </form>
            </div>
          )}
        </main>
      </div>

      {officialPdfPreviewUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-2 backdrop-blur-sm sm:p-5"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOfficialPdfPreviewUrl(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="official-pdf-preview-title"
            className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl"
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-[#0B1F4D] to-[#173B70] px-4 py-3 text-white sm:px-6">
              <div>
                <h2 id="official-pdf-preview-title" className="font-bold">
                  Official PDF Template Preview
                </h2>
                <p className="mt-1 text-xs text-blue-100">
                  Uses preview-only placeholders; this document is not issued or emailed.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <a
                  href={officialPdfPreviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
                >
                  Open in new tab
                </a>
                <button
                  type="button"
                  aria-label="Close PDF preview"
                  onClick={() => setOfficialPdfPreviewUrl(null)}
                  className="rounded-lg p-2 text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </header>
            <iframe
              title="Student-view demo PDF preview"
              src={officialPdfPreviewUrl}
              className="min-h-0 flex-1 bg-slate-100"
            />
          </section>
        </div>
      )}

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
                {(['Pending', 'Contacted', 'Completed'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
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
              {selectedApp.qualification_category && (
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-500 block">Qualification Category</span>
                  <span className="font-bold text-slate-900">{selectedApp.qualification_category}</span>
                </div>
              )}
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-500 block">{selectedApp.qualification_category === 'Student' ? 'Class Studying' : 'Qualification'}</span>
                <span className="font-bold text-slate-900">{selectedApp.qualification}</span>
              </div>
              {selectedApp.qualification_category === 'Student' && (
                <>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-500 block">Parent Phone Number</span>
                    <span className="font-bold text-slate-900">{selectedApp.parent_phone || '—'}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-500 block">Parent Email ID</span>
                    <span className="break-all font-bold text-slate-900">{selectedApp.parent_email || '—'}</span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-500 block">School Name</span>
                    <span className="font-bold text-slate-900">{selectedApp.school_name || '—'}</span>
                  </div>
                </>
              )}
              {selectedApp.qualification_category === 'Graduate' && (
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-500 block">College Name</span>
                  <span className="font-bold text-slate-900">{selectedApp.college_name || '—'}</span>
                </div>
              )}
              {selectedApp.qualification_category === 'Working' && (
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-500 block">Occupation</span>
                  <span className="font-bold text-slate-900">{selectedApp.occupation || '—'}</span>
                </div>
              )}
              {selectedApp.place && (
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-500 block">Place</span>
                  <span className="font-bold text-slate-900">{selectedApp.place}</span>
                </div>
              )}
              {selectedApp.city && (
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-500 block">City</span>
                  <span className="font-bold text-slate-900">{selectedApp.city}</span>
                </div>
              )}
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
          <div
            className="bg-white p-4 rounded-2xl space-y-4"
            style={{ width: 'min(22rem, calc(100vw - 2rem))' }}
          >
            <div className="flex justify-between items-center">
              <h4 className="font-bold text-sm text-slate-800">Passport Photo Preview</h4>
              <button onClick={() => setAppPhotoModal(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={appPhotoModal}
              alt="Passport"
              className="mx-auto max-h-[420px] max-w-[320px] rounded-lg object-contain shadow-inner"
            />
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
              <button type="button" onClick={() => {
                setEditingProgram({
                  ...viewingProgram,
                  feeConfiguration: programFeeConfigurations[viewingProgram.id] || emptyProgramFeeConfiguration(viewingProgram.id),
                });
                setViewingProgram(null);
              }} className="px-4 py-2 bg-orange-600 text-white font-bold rounded-xl">Edit Program</button>
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
              <fieldset className="space-y-3 rounded-xl border border-orange-100 bg-orange-50/40 p-4">
                <legend className="px-1 font-bold text-[#0B1F4D]">Course fees (INR)</legend>
                <p className="text-[11px] leading-relaxed text-slate-600">Fee changes are recorded as history and do not alter any existing application’s agreed fee.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    ['tuition_fee', 'Course fee'],
                    ['registration_fee', 'Registration fee'],
                    ['study_material_fee', 'Study material fee'],
                    ['other_charges', 'Other charges'],
                  ] as const).map(([field, label]) => (
                    <label key={field} className="font-semibold text-slate-700">{label}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editingProgram.feeConfiguration?.[field] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value === '' && field === 'tuition_fee' ? null : Number(event.target.value);
                          updateEditingProgramFee(field, value);
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                      />
                    </label>
                  ))}
                  <label className="font-semibold text-slate-700">Discount type
                    <select
                      value={editingProgram.feeConfiguration?.discount_type || 'amount'}
                      onChange={(event) => updateEditingProgramFee('discount_type', event.target.value as ProgramFeeConfiguration['discount_type'])}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    >
                      <option value="amount">Fixed amount (INR)</option>
                      <option value="percent">Percentage</option>
                    </select>
                  </label>
                  <label className="font-semibold text-slate-700">Discount
                    <input
                      type="number"
                      min="0"
                      max={editingProgram.feeConfiguration?.discount_type === 'percent' ? 100 : undefined}
                      step="0.01"
                      value={editingProgram.feeConfiguration?.discount_value ?? 0}
                      onChange={(event) => updateEditingProgramFee('discount_value', Number(event.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                    />
                  </label>
                </div>
                <p className="text-sm font-extrabold text-[#0B1F4D]">Final payable: {calculateProgramFinalPayable(editingProgram.feeConfiguration) === null ? 'Set a course fee to calculate' : `INR ${calculateProgramFinalPayable(editingProgram.feeConfiguration)?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}</p>
              </fieldset>
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
              <div>
                <label htmlFor="ann-button-action" className="font-bold text-slate-700 block mb-1">
                  Optional Banner Button
                </label>
                <select
                  id="ann-button-action"
                  value={editingAnnouncement.button_action ?? ''}
                  onChange={(e) => setEditingAnnouncement({
                    ...editingAnnouncement,
                    button_action: e.target.value === 'application' || e.target.value === 'demo'
                      ? e.target.value
                      : null,
                  })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <option value="">No button</option>
                  <option value="application">Application Form</option>
                  <option value="demo">Book Your Free Demo</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Add an optional call-to-action button to this moving announcement.
                </p>
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
