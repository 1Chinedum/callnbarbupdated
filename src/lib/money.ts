/** Integer minor units (kobo for NGN). Never use floats for money. */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

export function formatMoney(kobo: number, currency = "NGN"): string {
  const naira = koboToNaira(kobo);
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(naira);
  } catch {
    return `${currency} ${naira.toLocaleString()}`;
  }
}

export function computeCommission(amountKobo: number, percent: number): {
  platformFeeKobo: number;
  barberEarningKobo: number;
} {
  const platformFeeKobo = Math.round((amountKobo * percent) / 100);
  return {
    platformFeeKobo,
    barberEarningKobo: amountKobo - platformFeeKobo,
  };
}

export function parseAmountKobo(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("Amount must be a non-negative integer in kobo.");
  }
  return n;
}
