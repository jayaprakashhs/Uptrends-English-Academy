import React from 'react';

interface ApplicationCTAProps {
  openDemoClassModal: () => void;
  openCallbackModal: (programName?: string) => void;
}

export const ApplicationCTA: React.FC<ApplicationCTAProps> = ({
  openDemoClassModal,
  openCallbackModal,
}) => {
  const headingId = React.useId();

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-labelledby={headingId}>
      <div className="flex flex-col items-center justify-between gap-8 rounded-3xl bg-gradient-to-r from-orange-600 via-orange-500 to-amber-600 p-8 text-white shadow-xl md:flex-row sm:p-12">
        <div className="max-w-xl space-y-2 text-center md:text-left">
          <h2 id={headingId} className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            Ready to Speak with Confidence?
          </h2>
          <p className="text-sm text-orange-100">
            Request a free demo class to experience our training before deciding to join a course.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={openDemoClassModal}
            className="cursor-pointer rounded-xl bg-white px-7 py-3.5 text-sm font-bold text-orange-600 shadow-md transition-all hover:bg-orange-50"
          >
            Book Your Free Demo Class →
          </button>
          <button
            type="button"
            onClick={() => openCallbackModal('Admission Enquiry')}
            className="cursor-pointer rounded-xl bg-black/20 px-5 py-3.5 text-sm font-semibold text-white transition-all hover:bg-black/30"
          >
            Request a Call
          </button>
        </div>
      </div>
    </section>
  );
};
