
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface OfficialCourse {
  name: string;
  duration: string;
  fee: string;
}

export interface OfficialDocumentSettings {
  academyName: string;
  address: string;
  phone: string;
  email: string;
  hours: string;
  welcomeMessage: string;
  terms: string;
  courses: OfficialCourse[];
}

export const DEFAULT_OFFICIAL_DOCUMENT_SETTINGS: OfficialDocumentSettings = {
  academyName: "Uptrend's English Academy",
  address:
    '#259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, Davangere, Karnataka 577002',
  phone: '+91 900 8000 211',
  email: 'uptrendsinstitute@gmail.com',
  hours: 'Monday to Saturday, 8:00 AM - 8:30 PM (Sunday Closed)',
  welcomeMessage:
    "Thank you for your approved application to Uptrend's English Academy. Please visit our academy office during regular hours for in-person orientation.",
  terms:
    'Regular attendance, active speaking practice, and respectful academy conduct.',
  courses: [
    {
      name: 'Spoken English Course - Beginner to Advanced',
      duration: '2-3 months',
      fee: '',
    },
    {
      name: 'Basic English Grammar & Vocabulary',
      duration: '2 months',
      fee: '',
    },
    {
      name: 'Kids English Course',
      duration: 'Ongoing',
      fee: '',
    },
    {
      name: 'Advanced English & Interview Preparation',
      duration: '1 month',
      fee: '',
    },
  ],
};

const printable = (value: string): string =>
  value
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?');

const MAIN_LOGO_URL =
  "https://gpnfznwqwaokfzmozpxo.supabase.co/storage/v1/object/public/Uptrend's%20English%20Academy-photos/main_logo/UEA_main_03.png";

export async function generateOfficialPdf(
  settings: OfficialDocumentSettings,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Load the existing website logo from Supabase Storage.
  let logoImage: import('pdf-lib').PDFImage | null = null;

  try {
    const response = await fetch(MAIN_LOGO_URL);

    if (response.ok) {
      const logoBytes = new Uint8Array(await response.arrayBuffer());
      logoImage = await pdf.embedPng(logoBytes);
    } else {
      console.warn('Academy logo could not be loaded:', response.status);
    }
  } catch (error) {
    console.warn(
      'Academy logo could not be loaded. Generating the PDF without it.',
      error,
    );
  }

  let page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const margin = 48;
  const lineHeight = 16;
  let y = height - 54;

  const addPageIfNeeded = (requiredHeight = lineHeight) => {
    if (y < margin + requiredHeight) {
      page = pdf.addPage([595.28, 841.89]);
      y = page.getHeight() - 54;
    }
  };

  const drawText = (
    text: string,
    options: { bold?: boolean; size?: number; indent?: number } = {},
  ) => {
    const size = options.size ?? 10;
    const font = options.bold ? bold : regular;
    const maxWidth = width - margin * 2 - (options.indent ?? 0);
    const words = printable(text).split(/\s+/);
    let line = '';

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;

      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        addPageIfNeeded(size + 6);

        page.drawText(line, {
          x: margin + (options.indent ?? 0),
          y,
          size,
          font,
          color: rgb(0.16, 0.2, 0.25),
        });

        y -= size + 6;
        line = word;
      } else {
        line = candidate;
      }
    }

    if (line) {
      addPageIfNeeded(size + 6);

      page.drawText(line, {
        x: margin + (options.indent ?? 0),
        y,
        size,
        font,
        color: rgb(0.16, 0.2, 0.25),
      });

      y -= size + 6;
    }
  };

  const heading = (text: string) => {
    y -= 5;
    addPageIfNeeded(28);
    drawText(text, { bold: true, size: 13 });
    y -= 5;
  };

  // Draw the logo in the top-left of the PDF header.
  if (logoImage) {
    const logoHeight = 58;
    const logoWidth = (logoImage.width / logoImage.height) * logoHeight;

    page.drawImage(logoImage, {
      x: margin,
      y: height - 112,
      width: Math.min(logoWidth, 76),
      height: logoHeight,
    });
  }

  // Keep the academy name aligned beside the logo.
  page.drawText(printable(settings.academyName), {
    x: margin + (logoImage ? 88 : 0),
    y: height - 72,
    size: 19,
    font: bold,
    color: rgb(0.75, 0.29, 0.08),
    maxWidth: width - margin * 2 - (logoImage ? 88 : 0),
  });

  // Leave space below the header.
  y = height - 132;

  drawText('OFFICIAL FEE STRUCTURE & TERMS AND CONDITIONS', {
    bold: true,
    size: 12,
  });
  y -= 8;

  drawText(`Address: ${settings.address}`);
  drawText(`Phone: ${settings.phone}`);
  drawText(`Email: ${settings.email}`);
  drawText(`Regular hours: ${settings.hours}`);

  heading('Course Details');

  for (const course of settings.courses) {
    drawText(course.name, { bold: true });
    drawText(`Duration: ${course.duration}`, { indent: 12 });
    drawText(`Fee: ${course.fee.trim() || 'To be confirmed'}`, {
      indent: 12,
    });
    y -= 5;
  }

  heading('Application Information');
  drawText(settings.welcomeMessage);

  heading('Terms and Conditions');
  drawText(settings.terms);

  y -= 16;
  addPageIfNeeded(28);

  page.drawText("Uptrend's English Academy - Davangere", {
    x: margin,
    y,
    size: 9,
    font: regular,
    color: rgb(0.4, 0.43, 0.47),
  });

  return pdf.save();
}
