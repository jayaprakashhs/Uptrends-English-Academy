import React from 'react';
import { TeamMember } from '../types';
import { Target, Compass, Heart, Play, Clock, MapPin, Phone, Mail, Award, CheckCircle } from 'lucide-react';
import { getYouTubeThumbnail, extractYouTubeId } from '../lib/youtube';

interface AboutUsProps {
  teamMembers: TeamMember[];
  openVideoModal: (url: string, title: string) => void;
  openCallbackModal: () => void;
  setCurrentPage: (page: string) => void;
}

export const AboutUs: React.FC<AboutUsProps> = ({
  teamMembers,
  openVideoModal,
  openCallbackModal,
  setCurrentPage,
}) => {
  const publishedTeam = teamMembers.filter((m) => m.is_published);

  // Approved YouTube introduction URLs (Managed by admin)
  const teamTalkUrl = 'https://www.youtube.com/watch?v=ScMzIvxBSi4';
  const recentBatchUrl = 'https://www.youtube.com/watch?v=ScMzIvxBSi4';

  const teamTalkThumb = getYouTubeThumbnail(extractYouTubeId(teamTalkUrl));
  const recentBatchThumb = getYouTubeThumbnail(extractYouTubeId(recentBatchUrl));

  return (
    <div className="space-y-16 py-12">
      {/* 1. Header Banner & About the Academy */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 text-orange-800 text-xs font-bold uppercase tracking-wider">
            <span>About Uptrend’s English Academy</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-950 tracking-tight">
            Building English Communication in Davangere
          </h1>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed">
            Uptrend’s English Academy was established to help people in Davangere overcome linguistic hesitation, build natural conversational fluency, and speak English with confidence and poise.
          </p>
        </div>
      </section>

      {/* 2. Our Philosophy (Vision, Mission, Values) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            Educational Foundation
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 mt-1">
            Our Core Philosophy
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Vision */}
          <div className="bg-white p-8 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-lg transition-all flex flex-col justify-between border-t-4 border-t-orange-500">
            <div>
              <div className="w-12 h-12 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center mb-5">
                <Target className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Our Vision</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                To empower every learner in Davangere and surrounding regions with natural, articulate English communication skills, unlocking global opportunities and lifelong personal confidence.
              </p>
            </div>
            <div className="pt-6 mt-6 border-t border-slate-100 flex items-center gap-2 text-xs font-semibold text-orange-600">
              <CheckCircle className="w-4 h-4" />
              <span>Empowering Every Learner</span>
            </div>
          </div>

          {/* Mission */}
          <div className="bg-white p-8 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-lg transition-all flex flex-col justify-between border-t-4 border-t-emerald-500">
            <div>
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-5">
                <Compass className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Our Mission</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                To provide high-quality, practical spoken English and grammar training through interactive classroom sessions, supportive mentorship, and real-world conversation practice.
              </p>
            </div>
            <div className="pt-6 mt-6 border-t border-slate-100 flex items-center gap-2 text-xs font-semibold text-emerald-600">
              <CheckCircle className="w-4 h-4" />
              <span>Interactive & Practical Pedagogy</span>
            </div>
          </div>

          {/* Values */}
          <div className="bg-white p-8 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-lg transition-all flex flex-col justify-between border-t-4 border-t-amber-500">
            <div>
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center mb-5">
                <Heart className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Our Values</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Integrity, student-centric mentorship, continuous speaking practice, mutual respect, encouragement, and practical applicability in career and social settings.
              </p>
            </div>
            <div className="pt-6 mt-6 border-t border-slate-100 flex items-center gap-2 text-xs font-semibold text-amber-600">
              <CheckCircle className="w-4 h-4" />
              <span>Integrity & Encouragement</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Our Journey (25+ years of dedicated training) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-slate-900 text-white rounded-3xl p-8 sm:p-12 border border-slate-800 shadow-xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-8 space-y-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-orange-600/20 text-orange-300 text-xs font-bold uppercase tracking-wider">
                <Award className="w-4 h-4 text-orange-400" />
                <span>Our Heritage in Davangere</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                25+ Years of Building English-Speaking Confidence
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                With 25+ years of dedicated English language training in Davangere, Karnataka, Uptrend’s English Academy has continually evolved its methods to help learners break through language barriers.
              </p>
              <p className="text-sm text-slate-400 leading-relaxed">
                Located conveniently at Ram And Co Circle, Devi Building, we take pride in offering focused spoken training that respects the individual learning pace of students, graduates, working professionals, and homemakers alike.
              </p>
            </div>

            <div className="lg:col-span-4 flex flex-col items-center justify-center p-6 bg-slate-800/80 rounded-2xl border border-slate-700/60 text-center">
              <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-300">
                25+
              </span>
              <span className="text-sm font-bold text-white mt-1 uppercase tracking-wider">
                Years of Training
              </span>
              <p className="text-xs text-slate-400 mt-2">
                Continual commitment to English communication excellence in Davangere.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Our Team Talk & Hear from Our Recent Batch (YouTube Embeds) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="text-xs font-bold uppercase tracking-wider text-orange-600">
            Academy In Action
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 mt-1">
            Video Introductions
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Watch our introductory video and hear thoughts from recent learners.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Video 1: Our Team Talk */}
          <div className="bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-md">
            <div
              className="relative aspect-video bg-slate-900 cursor-pointer group"
              onClick={() => openVideoModal(teamTalkUrl, 'Academy Introduction — Our Team Talk')}
            >
              <img
                src={teamTalkThumb}
                alt="Our Team Talk Video Cover"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-black/40 group-hover:bg-black/25 transition-colors flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-orange-600 text-white flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
                  <Play className="w-6 h-6 fill-current ml-1" />
                </div>
              </div>
              <div className="absolute bottom-3 left-3 bg-black/70 px-2.5 py-1 rounded text-white text-xs font-semibold">
                Introduction Video
              </div>
            </div>
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-1">Our Team Talk</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                An introduction to our training approach, spoken practice modules, and teaching philosophy at Uptrend’s English Academy.
              </p>
            </div>
          </div>

          {/* Video 2: Hear from Our Recent Batch */}
          <div className="bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-md">
            <div
              className="relative aspect-video bg-slate-900 cursor-pointer group"
              onClick={() => openVideoModal(recentBatchUrl, 'Hear from Our Recent Batch')}
            >
              <img
                src={recentBatchThumb}
                alt="Hear from Our Recent Batch Video Cover"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-black/40 group-hover:bg-black/25 transition-colors flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform">
                  <Play className="w-6 h-6 fill-current ml-1" />
                </div>
              </div>
              <div className="absolute bottom-3 left-3 bg-black/70 px-2.5 py-1 rounded text-white text-xs font-semibold">
                Learner Perspective
              </div>
            </div>
            <div className="p-6">
              <h3 className="text-lg font-bold text-slate-900 mb-1">Hear from Our Recent Batch</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Approved video impressions shared by learners after completing their spoken English training modules in Davangere.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Meet Our Team (Admin managed, no invented staff) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            Academic Mentors
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 mt-1">
            Meet Our Instructors
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Experienced mentors dedicated to student progress and spoken English excellence.
          </p>
        </div>

        {publishedTeam.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {publishedTeam.map((member) => (
              <div key={member.id} className="bg-white rounded-2xl border border-slate-200 p-6 text-center shadow-xs">
                {member.photo_url ? (
                  <img
                    src={member.photo_url}
                    alt={member.full_name}
                    className="w-24 h-24 rounded-full mx-auto object-cover mb-4 border-2 border-orange-500"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-orange-100 text-orange-600 font-bold text-2xl flex items-center justify-center mx-auto mb-4 border-2 border-orange-300">
                    {member.full_name.charAt(0)}
                  </div>
                )}
                <h3 className="font-bold text-slate-900 text-lg">{member.full_name}</h3>
                <p className="text-xs text-orange-600 font-semibold mb-3">{member.designation}</p>
                <p className="text-xs text-slate-600 leading-relaxed">{member.bio}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center max-w-xl mx-auto">
            <p className="text-sm font-semibold text-slate-700">
              Instructor profiles are managed through the secure academy portal.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Visit our center at Ram And Co Circle to meet our faculty in person.
            </p>
          </div>
        )}
      </section>

      {/* 6. Contact Details & Business Hours */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-3xl border border-slate-200/80 p-8 sm:p-10 shadow-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-orange-600">
                Direct Contact
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950">
                Visit or Call the Academy
              </h2>
              <div className="space-y-3 pt-2 text-sm text-slate-700">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                  <span>
                    #259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, opposite Ganesha Temple, above Sangeetha Mobiles, Prince Jayachamaraja Wodeyar, Davangere, Karnataka 577002, India
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-emerald-600 shrink-0" />
                  <a href="tel:+919008000211" className="font-bold hover:text-orange-600">
                    +91 900 8000 211
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-orange-600 shrink-0" />
                  <a href="mailto:uptrendsinstitute@gmail.com" className="hover:text-orange-600">
                    uptrendsinstitute@gmail.com
                  </a>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Clock className="w-5 h-5 text-orange-600" />
                <span>Regular Business Hours</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-600">Monday – Saturday</span>
                  <span className="font-semibold text-slate-900">8:00 AM – 8:30 PM</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-600">Sunday</span>
                  <span className="font-semibold text-rose-600">Closed</span>
                </div>
              </div>
              <div className="pt-2 flex gap-3">
                <button
                  onClick={openCallbackModal}
                  className="w-full py-2.5 rounded-lg bg-orange-600 text-white font-bold text-xs hover:bg-orange-500 transition-colors cursor-pointer"
                >
                  Request a Call
                </button>
                <button
                  onClick={() => {
                    setCurrentPage('contact');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="w-full py-2.5 rounded-lg border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  View Map & Directions
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
