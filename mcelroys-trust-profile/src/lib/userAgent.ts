// Builds the User-Agent header sent to external data sources.
//
// WHY: Open Food Facts / Open Beauty Facts ask every API client to identify
// itself with an app name and a contact email, so they can reach you about a
// problem instead of just blocking you. SEC EDGAR goes further and REJECTS
// requests (HTTP 403) that don't include one.
//
// The address lives in .env (CONTACT_EMAIL) rather than in each script, so it
// stays out of the code and changes in one place.
import 'dotenv/config'

export function userAgent(): string {
  const email = process.env.CONTACT_EMAIL?.trim()

  // Fail loudly rather than send a placeholder. A missing contact isn't
  // something to discover after hours of a bulk run got rate-limited.
  if (!email || !email.includes('@') || email.endsWith('example.com')) {
    throw new Error(
      'CONTACT_EMAIL is missing or still a placeholder in .env. ' +
        'Set it to a real, monitored address, e.g. CONTACT_EMAIL=hello@rootify.app'
    )
  }

  // Format both OFF and SEC accept: "AppName/Version (contact email)"
  return `Rootify/1.0 (${email})`
}
