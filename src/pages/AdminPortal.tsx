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
} from 'lucide-react';

interface AdminPortalProps {
  currentAdmin: AdminProfile;
  onLogout: () => void;
  setCurrentPage: (page: string) => void;
}

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
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [systemStatus, setSystemStatus] = useState<any>(null);

  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Selected item modal preview states
  const [selectedApp, setSelectedApp] = useState<StudentApplication | null>(null);
  const [appPhotoModal, setAppPhotoModal] = useState<string | null>(null);

  // Program Edit Modal State
  const [editingProgram, setEditingProgram] = useState<Partial<Program> | null>(null);

  // Announcement New/Edit Modal State
  const [editingAnnouncement, setEditingAnnouncement] = useState<Partial<Announcement> | null>(null);

  // Search and filter states
  const [appSearch, setAppSearch] = useState('');
  const [appFilterStatus, setAppFilterStatus] = useState<'All' | 'Pending' | 'Accepted'>('All');
  const [notifFilterStatus, setNotifFilterStatus] = useState<'All' | 'Pending' | 'Sent' | 'Failed'>('All');

  // Role permissions checking
  const isSuperAdmin = currentAdmin.role === 'super_admin';
  const isAdminOrHigher = currentAdmin.role === 'admin' || isSuperAdmin;

  const fetchAllData = async () => {
    setLoading(true);
    setActionMessage(null);
    try {
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
        sysRes,
      ] = await Promise.all([
        fetch('/api/admin/applications').then((r) => r.json()),
        fetch('/api/admin/notifications').then((r) => r.json()),
        fetch('/api/admin/callbacks').then((r) => r.json()),
        fetch('/api/admin/contacts').then((r) => r.json()),
        fetch('/api/programs').then((r) => r.json()),
        fetch('/api/announcements').then((r) => r.json()),
        fetch('/api/reviews').then((r) => r.json()),
        fetch('/api/media').then((r) => r.json()),
        fetch('/api/faqs').then((r) => r.json()),
        fetch('/api/system-status').then((r) => r.json()),
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
      if (sysRes) setSystemStatus(sysRes);
    } catch (err: any) {
      console.error('Error fetching admin data:', err);
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
        headers: { 'Content-Type': 'application/json' },
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

  // Action: Retry Email Notification
  const handleRetryNotification = async (notifId: string) => {
    setActionMessage(null);
    setLoading(true);
    try {
      const res = await fetch('/api/retry-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    if (!editingProgram || !editingProgram.title) return;
    setLoading(true);
    try {
      const method = editingProgram.id ? 'PUT' : 'POST';
      const url = editingProgram.id ? `/api/admin/programs/${editingProgram.id}` : '/api/admin/programs';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingProgram),
      });
      if (!res.ok) throw new Error('Failed to save program');
      setEditingProgram(null);
      setActionMessage({ type: 'success', text: 'Program updated successfully!' });
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
      await fetch(`/api/admin/programs/${id}`, { method: 'DELETE' });
      setActionMessage({ type: 'success', text: 'Program deleted.' });
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
    if (!editingAnnouncement || !editingAnnouncement.content) return;
    setLoading(true);
    try {
      const method = editingAnnouncement.id ? 'PUT' : 'POST';
      const url = editingAnnouncement.id ? `/api/admin/announcements/${editingAnnouncement.id}` : '/api/admin/announcements';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingAnnouncement),
      });
      if (!res.ok) throw new Error('Failed to save announcement');
      setEditingAnnouncement(null);
      setActionMessage({ type: 'success', text: 'Announcement updated successfully!' });
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
      await fetch(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      setActionMessage({ type: 'success', text: 'Announcement deleted.' });
      await fetchAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
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
    { id: 'faqs', label: 'FAQs Management', icon: HelpCircle, minRole: 'super_admin' },
    { id: 'notifications', label: 'Email Outbox & Retries', icon: Send, minRole: 'super_admin' },
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
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        {systemStatus?.supabase?.configured ? 'Supabase Connected' : 'Local Fallback Active'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Resend Transactional Email</span>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                          systemStatus?.resend?.configured
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {systemStatus?.resend?.configured ? 'Resend API Active' : 'API Key Pending in .env'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Cloudflare R2 Storage</span>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                          systemStatus?.r2_storage?.configured
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {systemStatus?.r2_storage?.configured ? 'R2 Connected' : 'Local Uploads Active'}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Official Fee Structure PDF</span>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        {systemStatus?.official_pdf?.exists_on_disk ? 'Valid PDF Ready' : 'Configure PDF'}
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
                                onClick={() => setSelectedApp(app)}
                                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                              >
                                Review
                              </button>
                              {app.status === 'Pending' && (
                                <button
                                  onClick={() => handleApproveApp(app.id)}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer shadow-xs"
                                >
                                  Approve
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="text-center py-12 text-slate-400">
                            No applications found matching your criteria.
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
              <h1 className="text-2xl font-extrabold text-slate-950">Callback Requests</h1>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3.5">Name</th>
                      <th className="px-5 py-3.5">Mobile</th>
                      <th className="px-5 py-3.5">Program</th>
                      <th className="px-5 py-3.5">Preferred Time</th>
                      <th className="px-5 py-3.5">Message</th>
                      <th className="px-5 py-3.5">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {callbacks.map((cb) => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: CONTACT ENQUIRIES */}
          {activeTab === 'contacts' && (
            <div className="space-y-6">
              <h1 className="text-2xl font-extrabold text-slate-950">Contact Enquiries</h1>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3.5">Sender</th>
                      <th className="px-5 py-3.5">Subject</th>
                      <th className="px-5 py-3.5">Message</th>
                      <th className="px-5 py-3.5">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {contacts.map((cnt) => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: PROGRAMS MANAGEMENT (Admin/Super Admin only) */}
          {activeTab === 'programs' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-950">Programs Management</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Manage course catalogue, descriptions, audience, and publication status.
                  </p>
                </div>
                <button
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {programs.map((prog) => (
                  <div key={prog.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
                    <div>
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
                        onClick={() => setEditingProgram(prog)}
                        className="text-xs font-bold text-orange-600 hover:underline cursor-pointer"
                      >
                        Edit Details
                      </button>
                      <button
                        onClick={() => handleDeleteProgram(prog.id)}
                        className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
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
                <button
                  onClick={() => setEditingAnnouncement({ content: '', is_active: true })}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Announcement</span>
                </button>
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
                        onClick={() => setEditingAnnouncement(ann)}
                        className="px-3 py-1.5 bg-slate-100 rounded-lg text-slate-700 font-semibold hover:bg-slate-200 cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteAnnouncement(ann.id)}
                        className="px-3 py-1.5 bg-rose-50 text-rose-700 rounded-lg font-semibold hover:bg-rose-100 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
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
                <img
                  src={selectedApp.photo_data_url}
                  alt="Student Passport"
                  className="w-28 h-36 object-cover rounded-xl border border-slate-300 shadow-xs"
                />
              </div>
            )}

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                Current Status: <strong className="text-slate-900">{selectedApp.status}</strong>
              </span>

              {selectedApp.status === 'Pending' && (
                <button
                  onClick={() => handleApproveApp(selectedApp.id)}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>Confirm Approval & Send Official PDF</span>
                </button>
              )}
            </div>
          </div>
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
      {editingProgram && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-lg text-slate-900">
              {editingProgram.id ? 'Edit Program' : 'Add New Program'}
            </h3>
            <form onSubmit={handleSaveProgram} className="space-y-3 text-xs">
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
                  onClick={() => setEditingProgram(null)}
                  className="px-4 py-2 border rounded-xl text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-orange-600 text-white font-bold rounded-xl"
                >
                  Save Program
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
                  onClick={() => setEditingAnnouncement(null)}
                  className="px-4 py-2 border rounded-xl text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-orange-600 text-white font-bold rounded-xl"
                >
                  Save Notice
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
