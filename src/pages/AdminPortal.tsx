import React, { useState, useEffect } from 'react';
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

  // Action: Approve Application (with official PDF verification & email)
  const handleApproveApp = async (appId: string) => {
    setActionMessage(null);
    setLoading(true);
    try {
      const res = await fetch('/api/approve-application', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          application_id: appId,
          approved_by_name: currentAdmin.full_name,
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
    <div className="min-h-screen bg-slate-100 flex flex-col">
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
              <span className="font-extrabold text-orange-500 text-lg tracking-tight">UPTREND’S</span>
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
                  <h1 className="text-2xl font-extrabold text-slate-950">Student Applications</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Review incoming student submissions, verify photographs, and execute official admission approval.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={fetchAllData} disabled={loading} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold disabled:opacity-60">
                    Refresh Applications
                  </button>
                  <span className="text-xs font-semibold text-slate-500">Filter Status:</span>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-200">
                      <tr>
                        <th className="px-5 py-3.5">Reference</th>
                        <th className="px-5 py-3.5">Student Details</th>
                        <th className="px-5 py-3.5">Program</th>
                        <th className="px-5 py-3.5">Photo</th>
                        <th className="px-5 py-3.5">Status</th>
                        <th className="px-5 py-3.5">Submitted</th>
                        <th className="px-5 py-3.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {filteredApplications.length > 0 ? (
                        filteredApplications.map((app) => (
                          <tr key={app.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-5 py-4 font-mono font-bold text-orange-600">
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
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                                  app.status === 'Accepted'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {app.status}
                              </span>
                            </td>
                            <td className="px-5 py-4 text-slate-500 text-[11px]">
                              {new Date(app.created_at).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="px-5 py-4 text-right space-x-2">
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => setSelectedApp(app)}
                                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer disabled:opacity-50"
                              >
                                Review
                              </button>
                              <button
                                type="button"
                                disabled={loading || paymentLoading}
                                onClick={() => void loadApplicationPaymentData(app)}
                                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer disabled:opacity-50"
                              >
                                Payment
                              </button>
                              {app.status === 'Pending' && (
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => handleApproveApp(app.id)}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer shadow-xs disabled:opacity-50"
                                >
                                  Approve
                                </button>
                              )}
                              {isSuperAdmin && (
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => handleDeleteApplication(app.id)}
                                  className="px-2 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold cursor-pointer disabled:opacity-50"
                                  title="Permanently Delete Application (Super Admin only)"
                                >
                                  <Trash2 className="w-3.5 h-3.5 inline" />
                                </button>
                              )}
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
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
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
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-950">Moving Banner Announcements</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Control active scrolling announcements displayed on the public website header.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={fetchAllData} disabled={loading} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold disabled:opacity-60">Refresh Announcements</button>
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
                  <div key={ann.id} className="p-5 flex items-center justify-between text-xs">
                    <div className="space-y-1 pr-4">
                      <p className="font-semibold text-slate-900">{ann.content}</p>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          ann.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {ann.is_active ? 'Active on Public Site' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => handleToggleAnnouncement(ann)}
                        className="px-3 py-1.5 bg-slate-100 rounded-lg text-slate-700 font-semibold hover:bg-slate-200 cursor-pointer disabled:opacity-50"
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
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-950">Email Notification Monitoring</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Track transactional emails dispatched via Resend, monitor status, and trigger retries for failed deliveries.
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3.5">Type</th>
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
                <h1 className="text-2xl font-extrabold text-slate-950">Admin Roles & Access Control</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Manage staff and administrator privileges. Enforces strict server-side role validation in Supabase.
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3.5">Administrator</th>
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

              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                <h3 className="font-bold text-slate-900 text-sm">Official Fee Structure & Terms PDF</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Per strict academy policy, when an authorized staff member approves an application, the system automatically checks for the verified official PDF document and attaches it to the student approval email.
                </p>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Configured File:</span>
                    <span className="font-mono text-emerald-700 font-bold">
                      Uptrends_Fee_Structure_and_Terms.pdf
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Disk Status:</span>
                    <span className="text-emerald-700 font-bold">Verified on Disk</span>
                  </div>
                </div>

                <a
                  href="/assets/docs/Uptrends_Fee_Structure_and_Terms.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-600 hover:underline pt-2"
                >
                  <FileText className="w-4 h-4" />
                  <span>Preview Official PDF Document</span>
                </a>
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
                    disabled={loading}
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
