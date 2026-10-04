import { z } from "zod";

export const registerSchema = z
  .object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
    phone: z.string().min(8).max(20),
    password: z.string().min(8).max(100),
    confirmPassword: z.string(),
    role: z.enum(["CUSTOMER", "BARBER"]),
    referralCode: z.string().max(32).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const forgotSchema = z.object({ email: z.string().email() });
export const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8),
});

export const addressSchema = z.object({
  label: z.string().max(40).optional(),
  address: z.string().min(4).max(200),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  landmark: z.string().max(120).optional(),
  instructions: z.string().max(240).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isDefault: z.boolean().optional(),
});

export const bookingSchema = z.object({
  barberId: z.string().min(1),
  serviceId: z.string().min(1),
  addressId: z.string().min(1),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export const barberServiceSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(2).max(80),
  description: z.string().max(400).optional(),
  priceKobo: z.number().int().positive(),
  durationMin: z.number().int().min(15).max(240),
  active: z.boolean().optional(),
});

export const availabilitySchema = z.object({
  days: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: z.string(),
      endTime: z.string(),
      breakStart: z.string().nullable().optional(),
      breakEnd: z.string().nullable().optional(),
      active: z.boolean(),
    }),
  ),
  slotMinutes: z.number().int().min(15).max(120).optional(),
  maxDailyAppointments: z.number().int().min(1).max(40).optional(),
});

export const withdrawalSchema = z.object({
  amountKobo: z.number().int().positive(),
  bankName: z.string().min(2).max(80),
  accountNumber: z.string().min(8).max(20),
  accountName: z.string().min(2).max(80),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(600).optional(),
});

export const ticketSchema = z.object({
  category: z.enum([
    "Payment issue",
    "Booking issue",
    "Barber issue",
    "Customer issue",
    "Refund",
    "Withdrawal",
    "Technical problem",
    "Other",
  ]),
  subject: z.string().min(3).max(120),
  description: z.string().min(8).max(2000),
  bookingId: z.string().optional(),
});

export const disputeSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(3).max(80),
  description: z.string().min(8).max(2000),
  evidence: z.string().max(2000).optional(),
});
