/**
 * Login identifiers. Drivers sign in with the name-based username that is shown in
 * the console (for example `rakesh.patel` or `Rakesh Patel`), and the full address
 * (`rakesh.patel@jeevansetu.in`) also works. Pure module: safe for client and server.
 */
export const LOGIN_DOMAIN = "jeevansetu.in";

/** "Rakesh Patel" -> "rakesh.patel" (also used to build driver logins). */
export function slugName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
}

/** Accepts an email, a username or a display name and returns the account email. */
export function normalizeLoginName(input: string): string {
  const value = input.trim().toLowerCase();
  if (!value) return "";
  if (value.includes("@")) return value;
  const slug = slugName(value);
  return slug ? `${slug}@${LOGIN_DOMAIN}` : value;
}

/**
 * Driver names can be any name: letters from any language, with spaces, dots, apostrophes and
 * hyphens (Ketan Thakkar, Mary-Ann D'Souza, Dr. A. Khan). Returns an error message, or null when valid.
 */
export function driverNameProblem(name: string): string | null {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (cleaned.length < 2) return "Enter the driver's name (at least 2 characters).";
  if (cleaned.length > 80) return "The name is too long (80 characters at most).";
  if (!/\p{L}/u.test(cleaned)) return "The name must contain letters.";
  if (!/^[\p{L}\p{M} .'-]+$/u.test(cleaned)) return "Use letters only, with spaces, dots, apostrophes or hyphens.";
  return null;
}

/** Base for a driver's login: "Ketan Thakkar" -> "ketan.thakkar"; names with no Latin letters -> "driver". */
export function loginBaseFor(name: string): string {
  return slugName(name) || "driver";
}
