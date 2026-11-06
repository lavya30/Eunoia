/** Format a Razorpay amount expressed in the currency's minor unit. */
export function formatBillingAmount(amountMinor: number, currency: string) {
  const code = currency.toUpperCase();
  const locale = code === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}
