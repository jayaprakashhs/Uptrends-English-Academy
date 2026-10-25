import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { AnnouncementBanner } from './components/AnnouncementBanner';
import { Footer } from './components/Footer';
import { CallbackModal } from './components/CallbackModal';
import { VideoModal } from './components/VideoModal';

// Pages
import { Home } from './pages/Home';
import { AboutUs } from './pages/AboutUs';
import { Programs } from './pages/Programs';
import { ProgramDetails } from './pages/ProgramDetails';
import { Reviews } from './pages/Reviews';
import { MediaGallery } from './pages/MediaGallery';
import { FAQs } from './pages/FAQs';
import { ContactUs } from './pages/ContactUs';
import { ApplyNow } from './pages/ApplyNow';
import { AdminLogin } from './pages/AdminLogin';
import { AdminPortal } from './pages/AdminPortal';
import { NotFound } from './pages/NotFound';
import { fetchPublicJson, getPublicApiErrorMessage, PublicApiError } from './lib/publicApi';

import { Program, Review, MediaItem, TeamMember, FAQ, AdminProfile, SiteBranding } from './types';

type PublicResource = 'branding' | 'programs' | 'reviews' | 'media' | 'faqs';
type PublicResourceStatus = { loading: boolean; error: string | null };
type PublicResourceStatuses = Record<PublicResource, PublicResourceStatus>;

const emptyPublicStatuses: PublicResourceStatuses = {
  branding: { loading: true, error: null },
  programs: { loading: true, error: null },
  reviews: { loading: true, error: null },
  media: { loading: true, error: null },
  faqs: { loading: true, error: null },
};

export function App() {
  const [currentPage, setCurrentPage] = useState<string>('home');
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);

  // Global Callback Modal State
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackProgram, setCallbackProgram] = useState<string>('General English Training');

  // Global Video Modal State
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState('');

  // Admin Session State
  const [currentAdmin, setCurrentAdmin] = useState<AdminProfile | null>(null);

  // Data Collections
  const [programs, setPrograms] = useState<Program[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [branding, setBranding] = useState<SiteBranding | null>(null);
  const [publicStatuses, setPublicStatuses] = useState<PublicResourceStatuses>(emptyPublicStatuses);

  const loadPublicResource = async (
    resource: PublicResource,
    signal?: AbortSignal,
  ): Promise<void> => {
    setPublicStatuses((statuses) => ({
      ...statuses,
      [resource]: { loading: true, error: null },
    }));

    try {
      const data: unknown = await fetchPublicJson(`/api/${resource}`, signal);
      if (resource === 'branding') {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PublicApiError('unexpected_response');
        const nextBranding = data as SiteBranding;
        if (nextBranding.academy_name) setBranding(nextBranding);
        if (nextBranding.favicon_url) {
          let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null;
          if (!link) {
            link = document.createElement('link');
            link.rel = 'shortcut icon';
            document.head.appendChild(link);
          }
          link.href = nextBranding.favicon_url;
        }
      } else {
        if (!Array.isArray(data)) throw new PublicApiError('unexpected_response');
        if (resource === 'programs') setPrograms(data as Program[]);
        if (resource === 'reviews') setReviews(data as Review[]);
        if (resource === 'media') setMediaItems(data as MediaItem[]);
        if (resource === 'faqs') setFaqs(data as FAQ[]);
      }
      setPublicStatuses((statuses) => ({
        ...statuses,
        [resource]: { loading: false, error: null },
      }));
    } catch (error) {
      if (signal?.aborted) return;
      setPublicStatuses((statuses) => ({
        ...statuses,
        [resource]: { loading: false, error: getPublicApiErrorMessage(error) },
      }));
    }
  };

  const refreshPublicCatalogue = async () => {
    await Promise.all(
      (['branding', 'programs', 'reviews', 'media', 'faqs'] as const).map((resource) =>
        loadPublicResource(resource),
      ),
    );
  };

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(
      (['branding', 'programs', 'reviews', 'media', 'faqs'] as const).map((resource) =>
        loadPublicResource(resource, controller.signal),
      ),
    );
    window.addEventListener('admin-data-updated', refreshPublicCatalogue);
    return () => {
      controller.abort();
      window.removeEventListener('admin-data-updated', refreshPublicCatalogue);
    };
  }, []);

  const openCallbackModal = (progName?: string) => {
    setCallbackProgram(progName || 'General English Training');
    setCallbackOpen(true);
  };

  const openVideoModal = (url: string, title: string) => {
    setVideoUrl(url);
    setVideoTitle(title);
    setVideoOpen(true);
  };

  const handleAdminLoginSuccess = (profile: AdminProfile) => {
    setCurrentAdmin(profile);
    setCurrentPage('admin-portal');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAdminLogout = () => {
    setCurrentAdmin(null);
    setCurrentPage('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // If in admin portal
  if (currentPage === 'admin' || currentPage === 'admin-portal') {
    if (!currentAdmin) {
      return (
        <AdminLogin
          onLoginSuccess={handleAdminLoginSuccess}
          setCurrentPage={setCurrentPage}
        />
      );
    }
    return (
      <AdminPortal
        currentAdmin={currentAdmin}
        onLogout={handleAdminLogout}
        setCurrentPage={setCurrentPage}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 antialiased selection:bg-orange-500 selection:text-white">
      {/* Moving Announcement Banner (Section 6.B - no close button, Supabase driven) */}
      <AnnouncementBanner />

      {/* Main Navigation Header */}
      <Header
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        openCallbackModal={openCallbackModal}
        branding={branding}
      />

      {Object.entries(publicStatuses).some(([, status]) => status.error) && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm text-amber-900" role="status" aria-live="polite">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <span>
              Some academy content could not be loaded:{' '}
              {Object.entries(publicStatuses)
                .filter(([, status]) => status.error)
                .map(([resource, status]) => `${resource}: ${status.error}`)
                .join(' · ')}
            </span>
            <button
              type="button"
              onClick={() => void refreshPublicCatalogue()}
              className="font-semibold underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Page Routing */}
      <main className="flex-1">
        {currentPage === 'home' && (
          <Home
            programs={programs}
            reviews={reviews}
            mediaItems={mediaItems}
            dataStatuses={publicStatuses}
            onRetryData={(resource) => void loadPublicResource(resource)}
            setCurrentPage={setCurrentPage}
            setSelectedProgram={setSelectedProgram}
            openCallbackModal={openCallbackModal}
            openVideoModal={openVideoModal}
          />
        )}

        {currentPage === 'about' && (
          <AboutUs
            teamMembers={teamMembers}
            openVideoModal={openVideoModal}
            openCallbackModal={openCallbackModal}
            setCurrentPage={setCurrentPage}
          />
        )}

        {currentPage === 'programs' && (
          <Programs
            programs={programs}
            setSelectedProgram={setSelectedProgram}
            setCurrentPage={setCurrentPage}
            openCallbackModal={openCallbackModal}
          />
        )}

        {currentPage === 'program-details' && (
          <ProgramDetails
            program={selectedProgram || programs[0]}
            setCurrentPage={setCurrentPage}
            openCallbackModal={openCallbackModal}
          />
        )}

        {currentPage === 'reviews' && <Reviews reviews={reviews} />}

        {currentPage === 'media' && (
          <MediaGallery
            mediaItems={mediaItems}
            openVideoModal={openVideoModal}
          />
        )}

        {currentPage === 'faqs' && (
          <FAQs
            faqs={faqs}
            openCallbackModal={openCallbackModal}
            setCurrentPage={setCurrentPage}
          />
        )}

        {currentPage === 'contact' && <ContactUs />}

        {currentPage === 'apply' && (
          <ApplyNow
            programs={programs}
            selectedProgram={selectedProgram}
            setCurrentPage={setCurrentPage}
          />
        )}

        {currentPage === 'admin-login' && (
          <AdminLogin
            onLoginSuccess={handleAdminLoginSuccess}
            setCurrentPage={setCurrentPage}
          />
        )}

        {![
          'home',
          'about',
          'programs',
          'program-details',
          'reviews',
          'media',
          'faqs',
          'contact',
          'apply',
          'admin-login',
          'admin-portal',
          'admin',
        ].includes(currentPage) && <NotFound setCurrentPage={setCurrentPage} />}
      </main>

      {/* Footer */}
      <Footer
        setCurrentPage={setCurrentPage}
        openCallbackModal={openCallbackModal}
        branding={branding}
      />

      {/* Global Modals */}
      <CallbackModal
        isOpen={callbackOpen}
        onClose={() => setCallbackOpen(false)}
        prefilledProgram={callbackProgram}
      />

      <VideoModal
        isOpen={videoOpen}
        onClose={() => setVideoOpen(false)}
        videoUrlOrId={videoUrl}
        title={videoTitle}
      />
    </div>
  );
}

export default App;
