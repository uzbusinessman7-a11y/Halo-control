const MAX_AUDIT_HEADER_LENGTH = 1800;

export const encodeHaloHeader = (value: string, maxLength = MAX_AUDIT_HEADER_LENGTH) => (
  encodeURIComponent(value).slice(0, maxLength)
);

export const decodeHaloHeader = (value: string | null, fallback: string) => {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
