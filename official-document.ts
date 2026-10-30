import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';

export type OfficialFontFamily = 'Helvetica' | 'TimesRoman' | 'Courier';
export type OfficialPageSize = 'A4' | 'Letter';
export type OfficialSection = 'student' | 'course' | 'fees' | 'joining' | 'payment' | 'terms';

export interface OfficialDocumentSettings {
  academyName: string;
  address: string;
  phone: string;
  email: string;
  hours: string;
  heading: string;
  subtitle: string;
  approvalMessage: string;
  welcomeMessage: string;
  sectionHeadings: Record<OfficialSection, string>;
  footerText: string;
  motivationalTagline: string;
  paymentInstructions: string;
  paymentMethods: string[];
  bankDetails: string;
  additionalPaymentNotes: string;
  terms: string[];
  logoObjectKey: string | null;
  graphicObjectKey: string | null;
  colors: {
    orange: string;
    green: string;
    navy: string;
    background: string;
  };
  typography: {
    fontFamily: OfficialFontFamily;
    titleSize: number;
    headingSize: number;
    bodySize: number;
  };
  layout: {
    pageSize: OfficialPageSize;
    spacing: number;
    showLogo: boolean;
    showStudentPhoto: boolean;
    showDecorations: boolean;
    showFooter: boolean;
    visibleSections: OfficialSection[];
    sectionOrder: OfficialSection[];
  };
}

export interface OfficialStudent {
  fullName: string;
  studentId: string;
  applicationNumber: string;
  qualification: string;
  programName: string;
  email: string;
  mobile: string;
  dateOfBirth: string | null;
  address: string | null;
}

export interface OfficialJoiningInformation {
  joiningDate: string;
  classSchedule: string;
  classTimings: string;
  venue: string;
}

export interface OfficialCourse {
  name: string;
  duration: string | null;
  level: string | null;
  tuitionFee: number | null;
  registrationFee: number;
  studyMaterialFee: number;
  otherCharges: number;
  discountType: 'amount' | 'percent';
  discountValue: number;
  discountAmount: number;
  finalPayable: number | null;
  agreedTotal: number | null;
}

export interface OfficialDocumentAssets {
  logo?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' };
  graphic?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' };
  studentPhoto?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' };
}

export interface OfficialDocumentInput {
  settings: OfficialDocumentSettings;
  student: OfficialStudent;
  course: OfficialCourse | null;
  joiningInformation?: OfficialJoiningInformation;
  assets?: OfficialDocumentAssets;
}

export const DEFAULT_OFFICIAL_DOCUMENT_SETTINGS: OfficialDocumentSettings = {
  academyName: "Uptrend's English Academy",
  address: '#259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, Davangere, Karnataka 577002',
  phone: '+91 900 8000 211',
  email: 'uptrendsinstitute@gmail.com',
  hours: 'Monday to Saturday, 8:00 AM - 8:30 PM (Sunday Closed)',
  heading: 'OFFICIAL ADMISSION & FEE CONFIRMATION',
  subtitle: 'A confident beginning to your English-learning journey',
  approvalMessage: 'APPLICATION APPROVED',
  welcomeMessage: "We are pleased to welcome you to Uptrend's English Academy. Please keep this document for your records.",
  sectionHeadings: {
    student: 'STUDENT INFORMATION',
    course: 'SELECTED COURSE',
    fees: 'FEE BREAKDOWN',
    joining: 'JOINING INFORMATION',
    payment: 'PAYMENT INFORMATION',
    terms: 'TERMS & CONDITIONS',
  },
  footerText: "Uptrend's English Academy - Davangere",
  motivationalTagline: 'Learn with confidence. Speak without limits.',
  paymentInstructions: 'Please contact the academy before making a payment and quote your application number.',
  paymentMethods: [],
  bankDetails: '',
  additionalPaymentNotes: '',
  terms: [
    'Course admission is subject to the academy’s confirmation and applicable policies.',
    'Students are expected to attend classes regularly and participate in learning activities.',
  ],
  logoObjectKey: null,
  graphicObjectKey: null,
  colors: {
    orange: '#f57400',
    green: '#176b48',
    navy: '#0b1f4d',
    background: '#fffaf2',
  },
  typography: {
    fontFamily: 'Helvetica',
    titleSize: 17,
    headingSize: 10,
    bodySize: 9,
  },
  layout: {
    pageSize: 'A4',
    spacing: 1,
    showLogo: true,
    showStudentPhoto: true,
    showDecorations: true,
    showFooter: true,
    visibleSections: ['student', 'course', 'fees', 'joining', 'payment', 'terms'],
    sectionOrder: ['student', 'course', 'fees', 'joining', 'payment', 'terms'],
  },
};

const printable = (value: unknown): string =>
  String(value ?? '')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?');

const colorFromHex = (value: string) => {
  const hex = value.replace('#', '');
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  );
};

const formatAmount = (value: number | null): string =>
  value === null ? 'To be confirmed' : `INR ${value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const pageDimensions = (pageSize: OfficialPageSize): [number, number] =>
  pageSize === 'Letter' ? [612, 792] : [595.28, 841.89];

export async function generateOfficialPdf({
  settings,
  student,
  course,
  joiningInformation,
  assets,
}: OfficialDocumentInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fontFamily = settings.typography.fontFamily;
  const regular = await pdf.embedFont(
    fontFamily === 'TimesRoman'
      ? StandardFonts.TimesRoman
      : fontFamily === 'Courier'
        ? StandardFonts.Courier
        : StandardFonts.Helvetica,
  );
  const bold = await pdf.embedFont(
    fontFamily === 'TimesRoman'
      ? StandardFonts.TimesRomanBold
      : fontFamily === 'Courier'
        ? StandardFonts.CourierBold
        : StandardFonts.HelveticaBold,
  );
  const colors = {
    orange: colorFromHex(settings.colors.orange),
    green: colorFromHex(settings.colors.green),
    navy: colorFromHex(settings.colors.navy),
    background: colorFromHex(settings.colors.background),
    white: rgb(1, 1, 1),
    ink: rgb(0.13, 0.17, 0.23),
    muted: rgb(0.38, 0.42, 0.48),
    line: rgb(0.88, 0.87, 0.83),
    paleOrange: rgb(1, 0.95, 0.88),
    paleGreen: rgb(0.91, 0.96, 0.92),
  };
  const [pageWidth, pageHeight] = pageDimensions(settings.layout.pageSize);
  const margin = 38;
  const contentWidth = pageWidth - margin * 2;
  const spacing = Math.max(0.75, Math.min(settings.layout.spacing, 1.75));
  const bodySize = settings.typography.bodySize;
  const headingSize = settings.typography.headingSize;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y: number;
  let logoImage: PDFImage | null = null;
  let studentPhoto: PDFImage | null = null;
  let decorativeGraphic: PDFImage | null = null;

  if (assets?.logo) {
    logoImage = assets.logo.mime === 'image/png'
      ? await pdf.embedPng(assets.logo.bytes)
      : await pdf.embedJpg(assets.logo.bytes);
  }
  if (assets?.studentPhoto && settings.layout.showStudentPhoto) {
    studentPhoto = assets.studentPhoto.mime === 'image/png'
      ? await pdf.embedPng(assets.studentPhoto.bytes)
      : await pdf.embedJpg(assets.studentPhoto.bytes);
  }
  if (assets?.graphic && settings.layout.showDecorations) {
    decorativeGraphic = assets.graphic.mime === 'image/png'
      ? await pdf.embedPng(assets.graphic.bytes)
      : await pdf.embedJpg(assets.graphic.bytes);
  }

  const paintPage = (target: PDFPage) => {
    target.drawRectangle({
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      color: colors.background,
    });
    if (settings.layout.showDecorations) {
      target.drawRectangle({ x: 0, y: pageHeight - 8, width: pageWidth, height: 8, color: colors.orange });
      target.drawRectangle({ x: 0, y: pageHeight - 11, width: pageWidth, height: 3, color: colors.green });
    }
  };

  const addPage = (firstPage = false) => {
    page = pdf.addPage([pageWidth, pageHeight]);
    pages.push(page);
    paintPage(page);
    y = pageHeight - (firstPage ? 148 : 62);
    if (!firstPage) {
      page.drawText(printable(settings.academyName), {
        x: margin,
        y: pageHeight - 39,
        size: 9,
        font: bold,
        color: colors.navy,
        maxWidth: contentWidth,
      });
      page.drawLine({
        start: { x: margin, y: pageHeight - 48 },
        end: { x: pageWidth - margin, y: pageHeight - 48 },
        thickness: 0.8,
        color: colors.line,
      });
    }
  };

  const ensureRoom = (height: number) => {
    if (y - height < margin + 30) addPage();
  };

  const drawWrapped = (
    value: unknown,
    x = margin,
    options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; maxWidth?: number; lineGap?: number } = {},
  ): number => {
    const font = options.font ?? regular;
    const size = options.size ?? bodySize;
    const maxWidth = options.maxWidth ?? pageWidth - margin - x;
    const lineGap = options.lineGap ?? size * 1.45 * spacing;
    const words = printable(value).split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        ensureRoom(lineGap);
        page.drawText(line, { x, y, size, font, color: options.color ?? colors.ink, maxWidth });
        y -= lineGap;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      ensureRoom(lineGap);
      page.drawText(line, { x, y, size, font, color: options.color ?? colors.ink, maxWidth });
      y -= lineGap;
    }
    return y;
  };

  const drawSectionTitle = (title: string) => {
    ensureRoom(36);
    y -= 6 * spacing;
    page.drawRectangle({
      x: margin,
      y: y - 16,
      width: 4,
      height: 20,
      color: colors.orange,
    });
    page.drawText(printable(title), {
      x: margin + 12,
      y: y - 11,
      size: headingSize,
      font: bold,
      color: colors.navy,
      maxWidth: contentWidth - 14,
    });
    y -= 28 * spacing;
  };

  const drawPair = (label: string, value: string, x: number, rowWidth: number) => {
    ensureRoom(19 * spacing);
    const labelWidth = Math.min(115, rowWidth * 0.42);
    page.drawText(printable(label), {
      x,
      y,
      size: bodySize - 0.5,
      font: bold,
      color: colors.muted,
      maxWidth: labelWidth,
    });
    drawWrapped(value || '—', x + labelWidth, {
      size: bodySize,
      maxWidth: rowWidth - labelWidth,
      lineGap: 12 * spacing,
    });
    y -= 3 * spacing;
  };

  addPage(true);
  if (settings.layout.showDecorations) {
    page.drawCircle({ x: pageWidth - 16, y: pageHeight - 31, size: 24, color: colors.paleOrange });
    page.drawCircle({ x: pageWidth - 35, y: pageHeight - 17, size: 12, color: colors.paleGreen });
  }
  if (decorativeGraphic) {
    const scale = Math.min(42 / decorativeGraphic.width, 42 / decorativeGraphic.height);
    page.drawImage(decorativeGraphic, {
      x: pageWidth - margin - decorativeGraphic.width * scale,
      y: pageHeight - 94,
      width: decorativeGraphic.width * scale,
      height: decorativeGraphic.height * scale,
    });
  }

  if (logoImage && settings.layout.showLogo) {
    const scale = Math.min(56 / logoImage.width, 56 / logoImage.height);
    page.drawImage(logoImage, {
      x: margin,
      y: pageHeight - 88,
      width: logoImage.width * scale,
      height: logoImage.height * scale,
    });
  }
  const academyX = margin + (logoImage && settings.layout.showLogo ? 68 : 0);
  page.drawText(printable(settings.academyName), {
    x: academyX,
    y: pageHeight - 47,
    size: Math.min(settings.typography.titleSize, 21),
    font: bold,
    color: colors.navy,
    maxWidth: pageWidth - margin - academyX,
  });
  page.drawText(printable(settings.address), {
    x: academyX,
    y: pageHeight - 62,
    size: 7.5,
    font: regular,
    color: colors.muted,
    maxWidth: pageWidth - margin - academyX,
  });
  page.drawText(`${printable(settings.phone)}  |  ${printable(settings.email)}`, {
    x: academyX,
    y: pageHeight - 74,
    size: 7.5,
    font: regular,
    color: colors.muted,
    maxWidth: pageWidth - margin - academyX,
  });
  page.drawText(printable(settings.hours), {
    x: academyX,
    y: pageHeight - 86,
    size: 7,
    font: regular,
    color: colors.muted,
    maxWidth: pageWidth - margin - academyX,
  });
  page.drawLine({
    start: { x: margin, y: pageHeight - 101 },
    end: { x: pageWidth - margin, y: pageHeight - 101 },
    thickness: 1,
    color: colors.line,
  });

  const bannerY = pageHeight - 137;
  page.drawRectangle({
    x: margin,
    y: bannerY - 38,
    width: contentWidth,
    height: 38,
    color: colors.navy,
  });
  page.drawRectangle({ x: margin, y: bannerY - 38, width: 5, height: 38, color: colors.orange });
  page.drawText(printable(settings.approvalMessage), {
    x: margin + 16,
    y: bannerY - 15,
    size: 10,
    font: bold,
    color: colors.white,
    maxWidth: contentWidth - 30,
  });
  page.drawText(printable(settings.heading), {
    x: margin,
    y: bannerY - 60,
    size: settings.typography.titleSize,
    font: bold,
    color: colors.navy,
    maxWidth: contentWidth,
  });
  page.drawText(printable(settings.subtitle), {
    x: margin,
    y: bannerY - 77,
    size: bodySize,
    font: regular,
    color: colors.green,
    maxWidth: contentWidth,
  });
  y = bannerY - 96;

  const drawStudent = () => {
    drawSectionTitle(settings.sectionHeadings.student);
    const photoWidth = studentPhoto ? 68 : 0;
    const leftWidth = contentWidth - (studentPhoto ? photoWidth + 18 : 0);
    const leftX = margin;
    drawPair('Student name', student.fullName, leftX, leftWidth);
    drawPair('Student ID', student.studentId, leftX, leftWidth);
    drawPair('Application number', student.applicationNumber, leftX, leftWidth);
    drawPair('Qualification', student.qualification, leftX, leftWidth);
    drawPair('Email', student.email, leftX, leftWidth);
    drawPair('Mobile', student.mobile, leftX, leftWidth);
    if (student.dateOfBirth) drawPair('Date of birth', student.dateOfBirth, leftX, leftWidth);
    if (student.address) drawPair('Address', student.address, leftX, leftWidth);
    if (studentPhoto) {
      const photoHeight = Math.min(88, studentPhoto.height * (68 / studentPhoto.width));
      ensureRoom(photoHeight + 8);
      page.drawImage(studentPhoto, {
        x: pageWidth - margin - photoWidth,
        y: y + 74 - photoHeight,
        width: photoWidth,
        height: photoHeight,
      });
      page.drawRectangle({
        x: pageWidth - margin - photoWidth,
        y: y + 74 - photoHeight,
        width: photoWidth,
        height: photoHeight,
        borderColor: colors.orange,
        borderWidth: 1,
      });
    }
    y -= 8 * spacing;
  };

  const drawCourse = () => {
    drawSectionTitle(settings.sectionHeadings.course);
    if (!course) {
      drawWrapped('No selected course information is available for this application.');
      return;
    }
    page.drawRectangle({
      x: margin,
      y: y - 54,
      width: contentWidth,
      height: 54,
      color: colors.paleOrange,
      borderColor: colors.line,
      borderWidth: 0.7,
    });
    page.drawText(printable(course.name), {
      x: margin + 12,
      y: y - 20,
      size: 12,
      font: bold,
      color: colors.navy,
      maxWidth: contentWidth - 24,
    });
    page.drawText(
      printable([course.duration && `Duration: ${course.duration}`, course.level && `Level: ${course.level}`].filter(Boolean).join('  |  ') || 'Course details'),
      {
        x: margin + 12,
        y: y - 39,
        size: bodySize,
        font: regular,
        color: colors.muted,
        maxWidth: contentWidth - 24,
      },
    );
    y -= 66 * spacing;
  };

  const drawFees = () => {
    drawSectionTitle(settings.sectionHeadings.fees);
    if (!course) {
      drawWrapped('Fee details are not configured for the selected course.');
      return;
    }
    const rows: Array<[string, number | null]> = [
      ['Course fee', course.tuitionFee],
      ['Registration fee', course.registrationFee],
      ['Study material fee', course.studyMaterialFee],
      ['Other charges', course.otherCharges],
      ['Discount', course.discountAmount ? -course.discountAmount : 0],
    ];
    for (const [label, amount] of rows) {
      ensureRoom(18 * spacing);
      page.drawText(printable(label), {
        x: margin + 4,
        y,
        size: bodySize,
        font: regular,
        color: colors.ink,
        maxWidth: contentWidth - 155,
      });
      const formatted = amount === null
        ? 'To be confirmed'
        : `${amount < 0 ? '- ' : ''}${formatAmount(Math.abs(amount))}`;
      const amountWidth = regular.widthOfTextAtSize(printable(formatted), bodySize);
      page.drawText(printable(formatted), {
        x: pageWidth - margin - amountWidth - 4,
        y,
        size: bodySize,
        font: regular,
        color: colors.ink,
        maxWidth: 145,
      });
      page.drawLine({
        start: { x: margin + 4, y: y - 5 },
        end: { x: pageWidth - margin - 4, y: y - 5 },
        thickness: 0.4,
        color: colors.line,
      });
      y -= 18 * spacing;
    }
    y -= 4 * spacing;
    ensureRoom(31 * spacing);
    page.drawRectangle({
      x: margin,
      y: y - 26,
      width: contentWidth,
      height: 26,
      color: colors.paleGreen,
    });
    const payable = course.agreedTotal ?? course.finalPayable;
    page.drawText('FINAL PAYABLE AMOUNT', {
      x: margin + 9,
      y: y - 17,
      size: bodySize,
      font: bold,
      color: colors.navy,
    });
    const total = formatAmount(payable);
    page.drawText(total, {
      x: pageWidth - margin - 10 - bold.widthOfTextAtSize(printable(total), bodySize + 1),
      y: y - 17,
      size: bodySize + 1,
      font: bold,
      color: colors.green,
    });
    y -= 38 * spacing;
  };

  const drawPayment = () => {
    drawSectionTitle(settings.sectionHeadings.payment);
    if (settings.paymentInstructions) drawWrapped(settings.paymentInstructions);
    if (settings.paymentMethods.length) {
      drawPair('Accepted methods', settings.paymentMethods.join(', '), margin, contentWidth);
    }
    if (settings.bankDetails) drawPair('Bank / UPI details', settings.bankDetails, margin, contentWidth);
    if (settings.additionalPaymentNotes) drawWrapped(settings.additionalPaymentNotes);
  };

  const drawJoining = () => {
    drawSectionTitle(settings.sectionHeadings.joining);
    if (!joiningInformation) {
      drawWrapped('Joining arrangements will be confirmed by the academy.');
      return;
    }
    drawPair('Joining date', joiningInformation.joiningDate, margin, contentWidth);
    drawPair('Class schedule', joiningInformation.classSchedule, margin, contentWidth);
    drawPair('Class timings', joiningInformation.classTimings, margin, contentWidth);
    drawPair('Venue', joiningInformation.venue, margin, contentWidth);
  };

  const drawTerms = () => {
    drawSectionTitle(settings.sectionHeadings.terms);
    for (const [index, term] of settings.terms.entries()) {
      ensureRoom(20 * spacing);
      page.drawCircle({ x: margin + 5, y: y + 3, size: 2.2, color: colors.orange });
      y = drawWrapped(`${index + 1}. ${term}`, margin + 14, { maxWidth: contentWidth - 14 });
    }
  };

  const sectionDrawers: Record<OfficialSection, () => void> = {
    student: drawStudent,
    course: drawCourse,
    fees: drawFees,
    joining: drawJoining,
    payment: drawPayment,
    terms: drawTerms,
  };
  for (const section of settings.layout.sectionOrder) {
    if (settings.layout.visibleSections.includes(section)) sectionDrawers[section]();
  }

  if (settings.welcomeMessage) {
    ensureRoom(38 * spacing);
    y -= 4 * spacing;
    drawWrapped(settings.welcomeMessage, margin, { color: colors.muted, size: bodySize - 0.25 });
  }
  if (settings.motivationalTagline) {
    ensureRoom(24 * spacing);
    y -= 4 * spacing;
    page.drawText(printable(settings.motivationalTagline), {
      x: margin,
      y,
      size: bodySize,
      font: bold,
      color: colors.green,
      maxWidth: contentWidth,
    });
    y -= 18 * spacing;
  }

  if (settings.layout.showFooter) {
    pages.forEach((currentPage, index) => {
      const footerY = 22;
      currentPage.drawLine({
        start: { x: margin, y: footerY + 13 },
        end: { x: pageWidth - margin, y: footerY + 13 },
        thickness: 0.7,
        color: colors.line,
      });
      currentPage.drawText(printable(settings.footerText || settings.academyName), {
        x: margin,
        y: footerY,
        size: 7.5,
        font: regular,
        color: colors.muted,
        maxWidth: contentWidth - 70,
      });
      const pageLabel = `${index + 1} / ${pages.length}`;
      currentPage.drawText(pageLabel, {
        x: pageWidth - margin - bold.widthOfTextAtSize(pageLabel, 7.5),
        y: footerY,
        size: 7.5,
        font: bold,
        color: colors.navy,
      });
    });
  }

  return pdf.save();
}

export const isValidOfficialDocumentSettings = (
  value: unknown,
): value is OfficialDocumentSettings => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Partial<OfficialDocumentSettings>;
  const isHexColor = (color: unknown): color is string =>
    typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
  const sections: OfficialSection[] = ['student', 'course', 'fees', 'joining', 'payment', 'terms'];
  return typeof settings.academyName === 'string' &&
    typeof settings.address === 'string' &&
    typeof settings.phone === 'string' &&
    typeof settings.email === 'string' &&
    typeof settings.heading === 'string' &&
    typeof settings.subtitle === 'string' &&
    typeof settings.approvalMessage === 'string' &&
    typeof settings.welcomeMessage === 'string' &&
    typeof settings.footerText === 'string' &&
    typeof settings.motivationalTagline === 'string' &&
    typeof settings.paymentInstructions === 'string' &&
    Array.isArray(settings.paymentMethods) &&
    settings.paymentMethods.every((method) => typeof method === 'string') &&
    typeof settings.bankDetails === 'string' &&
    typeof settings.additionalPaymentNotes === 'string' &&
    Array.isArray(settings.terms) &&
    settings.terms.every((term) => typeof term === 'string') &&
    settings.sectionHeadings !== undefined &&
    sections.every((section) => typeof settings.sectionHeadings?.[section] === 'string') &&
    settings.colors !== undefined &&
    isHexColor(settings.colors.orange) &&
    isHexColor(settings.colors.green) &&
    isHexColor(settings.colors.navy) &&
    isHexColor(settings.colors.background) &&
    settings.typography !== undefined &&
    ['Helvetica', 'TimesRoman', 'Courier'].includes(settings.typography.fontFamily) &&
    Number.isFinite(settings.typography.titleSize) &&
    Number.isFinite(settings.typography.headingSize) &&
    Number.isFinite(settings.typography.bodySize) &&
    settings.layout !== undefined &&
    ['A4', 'Letter'].includes(settings.layout.pageSize) &&
    Number.isFinite(settings.layout.spacing) &&
    typeof settings.layout.showLogo === 'boolean' &&
    typeof settings.layout.showStudentPhoto === 'boolean' &&
    typeof settings.layout.showDecorations === 'boolean' &&
    typeof settings.layout.showFooter === 'boolean' &&
    Array.isArray(settings.layout.visibleSections) &&
    settings.layout.visibleSections.every((section) => sections.includes(section)) &&
    Array.isArray(settings.layout.sectionOrder) &&
    settings.layout.sectionOrder.length === sections.length &&
    settings.layout.sectionOrder.every((section) => sections.includes(section)) &&
    (settings.logoObjectKey === null || typeof settings.logoObjectKey === 'string') &&
    (settings.graphicObjectKey === null || typeof settings.graphicObjectKey === 'string');
};

export const mergeOfficialDocumentSettings = (
  value: unknown,
): OfficialDocumentSettings | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const saved = value as Record<string, unknown>;
  const savedWithoutLegacyCourses = { ...saved };
  delete savedWithoutLegacyCourses.courses;
  const oldTerms = typeof saved.terms === 'string'
    ? saved.terms.split(/\r?\n/).map((term) => term.trim()).filter(Boolean)
    : saved.terms;
  const merged: OfficialDocumentSettings = {
    ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
    ...savedWithoutLegacyCourses,
    sectionHeadings: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.sectionHeadings,
      ...(saved.sectionHeadings && typeof saved.sectionHeadings === 'object'
        ? saved.sectionHeadings
        : {}),
    },
    terms: Array.isArray(oldTerms) ? oldTerms as string[] : [],
    paymentMethods: Array.isArray(saved.paymentMethods)
      ? saved.paymentMethods as string[]
      : DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.paymentMethods,
    colors: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.colors,
      ...(saved.colors && typeof saved.colors === 'object' ? saved.colors : {}),
    },
    typography: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.typography,
      ...(saved.typography && typeof saved.typography === 'object' ? saved.typography : {}),
    },
    layout: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.layout,
      ...(saved.layout && typeof saved.layout === 'object' ? saved.layout : {}),
    },
    logoObjectKey: typeof saved.logoObjectKey === 'string' ? saved.logoObjectKey : null,
    graphicObjectKey: typeof saved.graphicObjectKey === 'string' ? saved.graphicObjectKey : null,
  };
  return isValidOfficialDocumentSettings(merged) ? merged : null;
};
