import { prisma } from "./prisma";

const DEFAULTS: Record<string, string> = {
  commission_percent: "10",
  min_withdrawal_kobo: "500000",
  cancellation_hours: "2",
  refund_on_customer_cancel: "true",
  default_currency: "NGN",
  slot_minutes: "30",
};

export async function getSetting(key: string): Promise<string> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return row?.value ?? DEFAULTS[key] ?? "";
}

export async function getNumberSetting(key: string): Promise<number> {
  return Number(await getSetting(key));
}

export async function setSetting(key: string, value: string) {
  return prisma.platformSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getAllSettings() {
  const rows = await prisma.platformSetting.findMany();
  const map: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) map[row.key] = row.value;
  return map;
}
