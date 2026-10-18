export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/**
 * Validates a new-password submission before any token lookup or hashing.
 * Returns a user-facing error message, or null when the input is acceptable.
 */
export function validateNewPassword(
  password: string,
  confirmPassword: string,
): string | null {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return `Use a password between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }
  return null;
}

export function validatePasswordResetSubmission(input: {
  email: string;
  token: string;
  password: string;
  confirmPassword: string;
}): string | null {
  if (!isPlausibleEmail(input.email) || !input.token) {
    return "This reset link is invalid or incomplete. Request a new one.";
  }
  return validateNewPassword(input.password, input.confirmPassword);
}
