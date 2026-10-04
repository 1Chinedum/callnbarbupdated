import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "./prisma";
import { appConfig } from "./env";
import { AppError } from "./errors";
import { paymentReference } from "./crypto";
import { confirmPaidBooking } from "./bookings";
import { notify } from "./notify";

const PAYSTACK_BASE = "https://api.paystack.co";

async function paystack(path: string, init?: RequestInit) {
  if (!appConfig.paystackSecretKey) {
    throw new AppError(
      "Paystack is not configured. Set PAYSTACK_SECRET_KEY on the server.",
      503,
    );
  }
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${appConfig.paystackSecretKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status === false) {
    throw new AppError(body.message ?? "Payment provider error.", 502);
  }
  return body;
}

export async function initializePayment(bookingId: string, customerEmail: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { customer: true },
  });
  if (!booking || booking.customer.email !== customerEmail) {
    throw new AppError("Booking not found.");
  }
  if (booking.status !== "PENDING_PAYMENT") {
    throw new AppError("This booking is not awaiting payment.");
  }

  const existing = await prisma.payment.findFirst({
    where: { bookingId, status: "PENDING" },
  });
  const reference = existing?.reference ?? paymentReference();

  if (appConfig.allowDevPayments && !appConfig.paystackSecretKey) {
    const payment =
      existing ??
      (await prisma.payment.create({
        data: {
          bookingId,
          customerId: booking.customerId,
          amountKobo: booking.amountKobo,
          currency: booking.currency,
          provider: "paystack_dev",
          reference,
          status: "PENDING",
        },
      }));
    return {
      authorizationUrl: `${appConfig.url}/api/payments/dev-complete?reference=${payment.reference}`,
      reference: payment.reference,
      accessCode: "DEV_ACCESS",
      publicKey: "",
      amountKobo: booking.amountKobo,
      email: customerEmail,
      dev: true,
    };
  }

  const init = await paystack("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: customerEmail,
      amount: booking.amountKobo,
      currency: booking.currency,
      reference,
      callback_url: `${appConfig.url}/app/bookings/${bookingId}/confirm`,
      metadata: { bookingId, customerId: booking.customerId },
    }),
  });

  const payment =
    existing ??
    (await prisma.payment.create({
      data: {
        bookingId,
        customerId: booking.customerId,
        amountKobo: booking.amountKobo,
        currency: booking.currency,
        provider: "paystack",
        reference,
        accessCode: init.data.access_code,
        status: "PENDING",
      },
    }));

  if (existing) {
    await prisma.payment.update({
      where: { id: existing.id },
      data: { accessCode: init.data.access_code },
    });
  }

  return {
    authorizationUrl: init.data.authorization_url,
    reference: payment.reference,
    accessCode: init.data.access_code,
    publicKey: appConfig.paystackPublicKey,
    amountKobo: booking.amountKobo,
    email: customerEmail,
    dev: false,
  };
}

export async function verifyAndConfirm(reference: string) {
  const payment = await prisma.payment.findUnique({
    where: { reference },
    include: { booking: true },
  });
  if (!payment) throw new AppError("Payment not found.");
  if (payment.status === "SUCCESSFUL" && payment.verified) {
    return payment;
  }

  let verifiedAmount = payment.amountKobo;
  let providerPayload = "";

  if (payment.provider === "paystack_dev") {
    if (!appConfig.allowDevPayments) {
      throw new AppError("Development payments are disabled.");
    }
    providerPayload = JSON.stringify({ dev: true, reference });
  } else {
    const verified = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    const data = verified.data;
    if (data.status !== "success") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", providerPayload: JSON.stringify(data) },
      });
      throw new AppError("Payment could not be completed. Please try again.");
    }
    verifiedAmount = Number(data.amount);
    if (verifiedAmount !== payment.amountKobo) {
      throw new AppError("Payment amount mismatch.");
    }
    providerPayload = JSON.stringify(data);
  }

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.payment.findUnique({ where: { id: payment.id } });
    if (fresh?.status === "SUCCESSFUL" && fresh.verified) return;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCESSFUL",
        verified: true,
        verifiedAt: new Date(),
        providerPayload,
        amountKobo: verifiedAmount,
      },
    });
    await confirmPaidBooking(payment.bookingId, tx);
  });

  return prisma.payment.findUnique({ where: { id: payment.id } });
}

export function verifyWebhookSignature(rawBody: string, signature: string | null) {
  const secret = appConfig.paystackWebhookSecret || appConfig.paystackSecretKey;
  if (!secret || !signature) return false;
  const hash = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function handleWebhook(event: { event?: string; data?: { reference?: string } }) {
  const reference = event.data?.reference;
  if (!reference) return;
  if (event.event === "charge.success") {
    await verifyAndConfirm(reference);
  }
}

export async function refundPayment(params: {
  paymentId: string;
  amountKobo: number;
  reason: string;
  adminId?: string;
}) {
  const payment = await prisma.payment.findUnique({ where: { id: params.paymentId } });
  if (!payment || payment.status !== "SUCCESSFUL") {
    throw new AppError("Payment cannot be refunded.");
  }

  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      amountKobo: params.amountKobo,
      reason: params.reason,
      reference: `CNB-RF-${payment.reference}`,
      status: "PENDING",
    },
  });

  if (payment.provider === "paystack" && appConfig.paystackSecretKey) {
    const body = await paystack("/refund", {
      method: "POST",
      body: JSON.stringify({
        transaction: payment.reference,
        amount: params.amountKobo,
        merchant_note: params.reason,
      }),
    });
    await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: "SUCCESSFUL",
        providerRef: String(body.data?.id ?? ""),
        processedAt: new Date(),
      },
    });
  } else if (appConfig.allowDevPayments) {
    await prisma.refund.update({
      where: { id: refund.id },
      data: { status: "SUCCESSFUL", processedAt: new Date() },
    });
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "REFUNDED" },
  });
  await prisma.booking.update({
    where: { id: payment.bookingId },
    data: { status: "REFUNDED" },
  });
  await notify({
    userId: payment.customerId,
    title: "Refund processed",
    message: "A refund has been processed for your booking.",
    type: "refund",
    data: { paymentId: payment.id },
  });
  return refund;
}
