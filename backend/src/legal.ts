// Placeholder legal copy. These are NOT legally reviewed. Have a Nigerian lawyer review
// every page (including NDPA data-protection obligations) before public launch.

const NOTE = 'DRAFT — placeholder text pending legal review. Not legal advice.';

export const LEGAL: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: 'Terms & Conditions',
    body: [
      NOTE,
      'CallNBarb connects customers with independent barbers who travel to the customer\'s location in Delta State, Nigeria.',
      'Barbers are independent providers, not employees of CallNBarb. [LEGAL REVIEW: define the relationship and liability.]',
      'Customers pay through the app. Funds are held by CallNBarb and released to the barber after the customer\'s appointment QR code is scanned.',
      'We may suspend accounts that breach these terms or the safety guidelines.',
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    body: [
      NOTE,
      'We collect your name, email, phone number, saved addresses and appointment location to provide the service.',
      'Customer addresses are shared with a barber only after the barber accepts your booking.',
      'Barber identity documents are stored privately and are visible only to authorised CallNBarb administrators for verification.',
      '[LEGAL REVIEW: data controller details, retention periods, NDPA compliance, data-subject rights, contact for complaints.]',
    ],
  },
  cancellation: {
    title: 'Cancellation Policy',
    body: [
      NOTE,
      'Cancel before your barber accepts: full refund.',
      'Cancel after acceptance but before the free-cancellation window closes: full refund. The window is set by CallNBarb and shown in the app.',
      'Late cancellations receive a partial refund as shown in the app. If a barber cancels, you receive a full refund.',
    ],
  },
  refund: {
    title: 'Refund Policy',
    body: [
      NOTE,
      'Approved refunds are returned to your original payment method through Paystack. Timing depends on your bank.',
      'Disputes about completed services are reviewed by CallNBarb. [LEGAL REVIEW: dispute timelines and outcomes.]',
    ],
  },
  'barber-agreement': {
    title: 'Barber Agreement',
    body: [
      NOTE,
      'Barbers must provide accurate identity information and maintain hygiene and professional standards.',
      'CallNBarb charges a commission on each completed service, shown in your earnings breakdown.',
      'Earnings are credited to your wallet only after the customer\'s QR code has been scanned. Withdrawals are subject to the minimum amount and review.',
      '[LEGAL REVIEW: independent contractor terms, tax responsibilities, termination.]',
    ],
  },
  safety: {
    title: 'Customer Safety Guidelines',
    body: [
      NOTE,
      'Only let in the barber named in your booking, and check their name and profile photo in the app.',
      'Ask the barber to scan your QR code only when they arrive and the service is complete.',
      'If you feel unsafe at any time, end the appointment and contact support or local emergency services.',
      'Never pay a barber in cash outside the app — you will not be protected by CallNBarb.',
    ],
  },
};
