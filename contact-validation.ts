export const normalizeContactEmail = (value: string): string => value.trim().toLowerCase();

export const normalizeIndianMobileNumber = (value: string): string | null => {
  const formattedValue = value.trim();
  if (!/^\+?[\d\s()-]+$/.test(formattedValue)) return null;
  let digits = formattedValue.replace(/\D/g, '');

  if (digits.startsWith('0091') && (digits.length === 14 || digits.length === 15)) {
    digits = digits.slice(4);
  } else if (digits.startsWith('91') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
};

export const isValidContactEmail = (value: string): boolean => {
  const normalized = normalizeContactEmail(value);
  return normalized.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
};
