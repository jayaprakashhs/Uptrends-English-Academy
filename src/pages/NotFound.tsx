import React from 'react';
import { ArrowLeft, Home, Compass } from 'lucide-react';

interface NotFoundProps {
  setCurrentPage: (page: string) => void;
}

export const NotFound: React.FC<NotFoundProps> = ({ setCurrentPage }) => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center py-20 px-4 text-center">
      <div className="max-w-md w-full space-y-6">
        <div className="w-24 h-24 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center mx-auto text-4xl font-extrabold shadow-sm">
          404
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold text-slate-950">Page Not Found</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            The page you are looking for does not exist or has been moved. You can return to our homepage or explore our English programs.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setCurrentPage('home')}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Home className="w-4 h-4" />
            <span>Go to Homepage</span>
          </button>
          <button
            onClick={() => setCurrentPage('programs')}
            className="w-full sm:w-auto px-6 py-3 rounded-xl border border-slate-300 hover:border-slate-400 text-slate-800 font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Compass className="w-4 h-4" />
            <span>Explore Programs</span>
          </button>
        </div>
      </div>
    </div>
  );
};
