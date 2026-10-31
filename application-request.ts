import {
  isValidContactEmail,
  normalizeContactEmail,
  normalizeIndianMobileNumber,
} from './contact-validation';

export type ApplicationQualificationCategory = 'Student' | 'Graduate' | 'Working';

export interface ApplicationCategoryFields {
  qualification_category: ApplicationQualificationCategory;
  qualification: string;
  parent_phone: string | null;
  parent_email: string | null;
  school_name: string | null;
  college_name: string | null;
  occupation: string | null;
  place: string;
  city: string;
}

export interface ApplicationPrimaryContact {
  mobile: string;
  email: string;
}

export type ApplicationCategoryField =
  | 'qualification_category'
  | 'qualification'
  | 'parent_phone'
  | 'parent_email'
  | 'school_name'
  | 'college_name'
  | 'occupation'
  | 'place'
  | 'city';

export type ApplicationCategoryFieldErrors = Partial<Record<ApplicationCategoryField, string>>;

export const getApplicationPrimaryContact = (
  categoryFields: ApplicationCategoryFields,
  fallback: ApplicationPrimaryContact,
): ApplicationPrimaryContact | null => {
  if (categoryFields.qualification_category !== 'Student') return fallback;
  if (!categoryFields.parent_phone || !categoryFields.parent_email) return null;
  return {
    mobile: categoryFields.parent_phone,
    email: categoryFields.parent_email,
  };
};

type ApplicationCategoryValidation =
  | { valid: true; value: ApplicationCategoryFields }
  | { valid: false; error: string; errors: ApplicationCategoryFieldErrors };

const requiredText = (value: unknown, label: string, maximumLength: number): string | null => {
  if (typeof value !== 'string' || !value.trim()) return `${label} is required.`;
  if (value.trim().length > maximumLength) return `${label} must be ${maximumLength} characters or fewer.`;
  return null;
};

export const validateApplicationCategoryFields = (input: unknown): ApplicationCategoryValidation => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      error: 'Application category details are required.',
      errors: { qualification_category: 'Select a qualification category.' },
    };
  }
  const body = input as Record<string, unknown>;
  const category = body.qualification_category;
  const errors: ApplicationCategoryFieldErrors = {};
  if (category !== 'Student' && category !== 'Graduate' && category !== 'Working') {
    errors.qualification_category = 'Select a qualification category.';
  }

  const placeError = requiredText(body.place, 'Place', 200);
  if (placeError) errors.place = placeError;
  const cityError = requiredText(body.city, 'City', 120);
  if (cityError) errors.city = cityError;
  const qualificationError = category === 'Student' || category === 'Graduate' || category === 'Working'
    ? requiredText(body.qualification, category === 'Student' ? 'Class you are studying' : 'Qualification', 500)
    : null;
  if (qualificationError) errors.qualification = qualificationError;

  if (category === 'Student') {
    const parentPhoneError = requiredText(body.parent_phone, 'Parent phone number', 30);
    let parentPhone: string | null = null;
    if (parentPhoneError) {
      errors.parent_phone = parentPhoneError;
    } else {
      parentPhone = normalizeIndianMobileNumber(body.parent_phone as string);
      if (!parentPhone) errors.parent_phone = 'Enter a valid Indian parent phone number.';
    }

    const parentEmailError = requiredText(body.parent_email, 'Parent email ID', 320);
    let parentEmail: string | null = null;
    if (parentEmailError) {
      errors.parent_email = parentEmailError;
    } else {
      parentEmail = normalizeContactEmail(body.parent_email as string);
      if (!isValidContactEmail(parentEmail)) errors.parent_email = 'Enter a valid parent email address.';
    }

    const schoolError = requiredText(body.school_name, 'School name', 200);
    if (schoolError) errors.school_name = schoolError;
    if (Object.keys(errors).length > 0) {
      return {
        valid: false,
        error: errors.qualification_category || errors.place || errors.city || errors.qualification
          || errors.parent_phone || errors.parent_email || errors.school_name
          || 'Application category details are required.',
        errors,
      };
    }
    return {
      valid: true,
      value: {
        qualification_category: category,
        qualification: (body.qualification as string).trim(),
        parent_phone: parentPhone,
        parent_email: parentEmail,
        school_name: (body.school_name as string).trim(),
        college_name: null,
        occupation: null,
        place: (body.place as string).trim(),
        city: (body.city as string).trim(),
      },
    };
  }

  if (category === 'Graduate') {
    const collegeError = requiredText(body.college_name, 'College name', 200);
    if (collegeError) errors.college_name = collegeError;
    if (Object.keys(errors).length > 0) {
      return {
        valid: false,
        error: errors.qualification_category || errors.place || errors.city || errors.qualification
          || errors.college_name || 'Application category details are required.',
        errors,
      };
    }
    return {
      valid: true,
      value: {
        qualification_category: category,
        qualification: (body.qualification as string).trim(),
        parent_phone: null,
        parent_email: null,
        school_name: null,
        college_name: (body.college_name as string).trim(),
        occupation: null,
        place: (body.place as string).trim(),
        city: (body.city as string).trim(),
      },
    };
  }

  if (category === 'Working') {
    const occupationError = requiredText(body.occupation, 'Occupation', 200);
    if (occupationError) errors.occupation = occupationError;
  }
  if (Object.keys(errors).length > 0 || category !== 'Working') {
    return {
      valid: false,
      error: errors.qualification_category || errors.place || errors.city || errors.qualification
        || errors.occupation || 'Select a qualification category.',
      errors,
    };
  }
  return {
    valid: true,
    value: {
      qualification_category: category,
      qualification: (body.qualification as string).trim(),
      parent_phone: null,
      parent_email: null,
      school_name: null,
      college_name: null,
      occupation: (body.occupation as string).trim(),
      place: (body.place as string).trim(),
      city: (body.city as string).trim(),
    },
  };
};