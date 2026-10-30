import { normalizeIndianMobileNumber } from './contact-validation';

export type DemoClassQualificationCategory = 'Student' | 'Graduate' | 'Working';

export interface DemoClassRequestInput {
  full_name: string;
  mobile: string;
  email: string;
  qualification_category: DemoClassQualificationCategory;
  parent_name: string | null;
  school_or_college_name: string | null;
  college_name: string | null;
  profession: string | null;
  educational_qualification: string;
  date_of_birth: string;
  address: string;
  city: string;
  additional_information: string | null;
}

type ValidationResult =
  | { valid: true; value: DemoClassRequestInput }
  | { valid: false; error: string };

const requiredText = (
  body: Record<string, unknown>,
  field: string,
  label: string,
  maxLength: number,
): string | null => {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) return `${label} is required.`;
  if (value.trim().length > maxLength) return `${label} must be ${maxLength} characters or fewer.`;
  return null;
};

const optionalText = (
  body: Record<string, unknown>,
  field: string,
  label: string,
  maxLength: number,
): { value: string | null; error: string | null } => {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') return { value: null, error: null };
  if (typeof raw !== 'string') return { value: null, error: `${label} must be text.` };
  const value = raw.trim();
  if (value.length > maxLength) return { value: null, error: `${label} must be ${maxLength} characters or fewer.` };
  return { value: value || null, error: null };
};

export const isValidIndianMobileNumber = (value: string): boolean => {
  if (!/^\+?[\d\s()-]+$/.test(value.trim())) return false;
  return normalizeIndianMobileNumber(value) !== null;
};

export const validateDemoClassRequest = (input: unknown): ValidationResult => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, error: 'A demo class request object is required.' };
  }
  const body = input as Record<string, unknown>;

  const requiredFields: Array<[string, string, number]> = [
    ['full_name', 'Full name', 150],
    ['mobile', 'Mobile number', 30],
    ['email', 'Email address', 320],
    ['educational_qualification', 'Educational qualification / course', 200],
    ['date_of_birth', 'Date of birth', 10],
    ['address', 'Address', 2000],
    ['city', 'City', 120],
  ];
  for (const [field, label, maxLength] of requiredFields) {
    const error = requiredText(body, field, label, maxLength);
    if (error) return { valid: false, error };
  }

  const fullName = (body.full_name as string).trim();
  const mobile = (body.mobile as string).trim();
  const email = (body.email as string).trim();
  const educationalQualification = (body.educational_qualification as string).trim();
  const dateOfBirth = (body.date_of_birth as string).trim();
  const address = (body.address as string).trim();
  const city = (body.city as string).trim();

  if (!isValidIndianMobileNumber(mobile)) {
    return { valid: false, error: 'Enter a valid Indian mobile number.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return { valid: false, error: 'Enter a valid email address.' };
  }
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
    ? Date.parse(`${dateOfBirth}T00:00:00.000Z`)
    : Number.NaN;
  if (!Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== dateOfBirth) {
    return { valid: false, error: 'Enter a valid date of birth.' };
  }
  if (dateOfBirth > new Date().toISOString().slice(0, 10)) {
    return { valid: false, error: 'Date of birth cannot be in the future.' };
  }

  const category = body.qualification_category;
  if (category !== 'Student' && category !== 'Graduate' && category !== 'Working') {
    return { valid: false, error: 'Select a qualification category.' };
  }

  const parentName = optionalText(body, 'parent_name', 'Parent name', 150);
  const schoolOrCollege = optionalText(body, 'school_or_college_name', 'School or college name', 200);
  const collegeName = optionalText(body, 'college_name', 'College name', 200);
  const profession = optionalText(body, 'profession', 'Profession or occupation', 200);
  const additionalInformation = optionalText(body, 'additional_information', 'Additional information', 3000);
  for (const field of [parentName, schoolOrCollege, collegeName, profession, additionalInformation]) {
    if (field.error) return { valid: false, error: field.error };
  }

  if (category === 'Student' && (!parentName.value || !schoolOrCollege.value)) {
    return { valid: false, error: 'Parent name and school or college name are required for students.' };
  }
  if (category === 'Graduate' && !collegeName.value) {
    return { valid: false, error: 'College name is required for graduates.' };
  }
  if (category === 'Working' && !profession.value) {
    return { valid: false, error: 'Profession or occupation is required for working applicants.' };
  }

  return {
    valid: true,
    value: {
      full_name: fullName,
      mobile,
      email,
      qualification_category: category,
      parent_name: category === 'Student' ? parentName.value : null,
      school_or_college_name: category === 'Student' ? schoolOrCollege.value : null,
      college_name: category === 'Graduate' ? collegeName.value : null,
      profession: category === 'Working' ? profession.value : null,
      educational_qualification: educationalQualification,
      date_of_birth: dateOfBirth,
      address,
      city,
      additional_information: additionalInformation.value,
    },
  };
};
