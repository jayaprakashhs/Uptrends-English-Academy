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

import { Program, Review, MediaItem, TeamMember, FAQ, AdminProfile, SiteBranding } from './types';

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

  // Initial Data Fetch
  useEffect(() => {
    fetch('/api/branding')
      .then((r) => r.json())
      .then((data) => {
        if (data && data.academy_name) {
          setBranding(data);
          if (data.favicon_url) {
            let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null;
            if (!link) {
              link = document.createElement('link');
              link.rel = 'shortcut icon';
              document.head.appendChild(link);
            }
            link.href = data.favicon_url;
          }
        }
      })
      .catch((e) => console.error('Error fetching branding:', e));

    fetch('/api/programs')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setPrograms(data);
      })
      .catch((e) => console.error('Error fetching programs:', e));

    fetch('/api/reviews')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setReviews(data);
      })
      .catch((e) => console.error('Error fetching reviews:', e));

    fetch('/api/media')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setMediaItems(data);
      })
      .catch((e) => console.error('Error fetching media:', e));

    fetch('/api/faqs')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setFaqs(data);
      })
      .catch((e) => console.error('Error fetching faqs:', e));
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

      {/* Page Routing */}
      <main className="flex-1">
        {currentPage === 'home' && (
          <Home
            programs={programs}
            reviews={reviews}
            mediaItems={mediaItems}
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
