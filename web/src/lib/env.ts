export const env = {
  appUrl: () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  emailFrom: () => process.env.EMAIL_FROM || 'CobSci <hello@cobsci.com>',
  supportEmail: () => process.env.SUPPORT_EMAIL || 'support@cobsci.com',
  resendKey: () => process.env.RESEND_API_KEY || '',
  stripeKey: () => process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET || '',
  cronSecret: () => process.env.CRON_SECRET || '',
  isProd: () => process.env.NODE_ENV === 'production',
}

/** Company and portal name. */
export const BRAND = 'CobSci'
/** The sensor's product name. */
export const PRODUCT = 'CO2 & You'
