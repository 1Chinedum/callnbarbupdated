// All money is stored and calculated as integer kobo (1 NGN = 100 kobo). Never floats.

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

export function formatNaira(kobo: number): string {
  const sign = kobo < 0 ? '-' : '';
  const abs = Math.abs(kobo);
  const naira = Math.floor(abs / 100);
  const rem = abs % 100;
  const whole = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}₦${whole}${rem ? '.' + rem.toString().padStart(2, '0') : ''}`;
}

export interface FeeBreakdown {
  servicePriceKobo: number;
  customerFeeKobo: number;
  amountKobo: number; // total the customer pays
  commissionKobo: number; // platform cut of the service price
  platformFeeKobo: number; // commission + customer fee (everything the platform keeps)
  barberEarningKobo: number; // net to barber
}

export function computeFees(servicePriceKobo: number, customerFeeKobo: number, commissionBps: number): FeeBreakdown {
  if (!Number.isInteger(servicePriceKobo) || servicePriceKobo < 0) throw new Error('price must be integer kobo');
  const commissionKobo = Math.round((servicePriceKobo * commissionBps) / 10000);
  return {
    servicePriceKobo,
    customerFeeKobo,
    amountKobo: servicePriceKobo + customerFeeKobo,
    commissionKobo,
    platformFeeKobo: commissionKobo + customerFeeKobo,
    barberEarningKobo: servicePriceKobo - commissionKobo,
  };
}
