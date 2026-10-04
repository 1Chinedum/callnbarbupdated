import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 12);

  await prisma.auditLog.deleteMany();
  await prisma.ticketMessage.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.review.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.qrScan.deleteMany();
  await prisma.qrToken.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.withdrawal.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.barberService.deleteMany();
  await prisma.portfolioItem.deleteMany();
  await prisma.verificationDocument.deleteMany();
  await prisma.blockedDate.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.barberProfile.deleteMany();
  await prisma.address.deleteMany();
  await prisma.passwordReset.deleteMany();
  await prisma.serviceCategory.deleteMany();
  await prisma.platformSetting.deleteMany();
  await prisma.user.deleteMany();

  const settings: Record<string, string> = {
    commission_percent: "10",
    min_withdrawal_kobo: "500000",
    cancellation_hours: "2",
    refund_on_customer_cancel: "true",
    default_currency: "NGN",
    brand_tagline: "Call a Barber. Get Fresh.",
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.platformSetting.create({ data: { key, value } });
  }

  const categories = [
    ["Haircut", "haircut", "Classic professional haircut"],
    ["Low Cut", "low-cut", "Clean low cut"],
    ["Fade", "fade", "Taper and fade styles"],
    ["Skin Fade", "skin-fade", "Skin fade specialist"],
    ["Afro", "afro", "Afro shaping and care"],
    ["Beard Trim", "beard-trim", "Beard lineup and trim"],
    ["Hair + Beard", "hair-beard", "Full grooming"],
    ["Kids Haircut", "kids-haircut", "Kids cuts"],
    ["Home Service", "home-service", "At-home barbing"],
    ["Other", "other", "Other grooming services"],
  ];
  const catRows = [];
  for (let i = 0; i < categories.length; i++) {
    const [name, slug, description] = categories[i];
    catRows.push(
      await prisma.serviceCategory.create({
        data: { name, slug, description, sortOrder: i },
      }),
    );
  }

  const admin = await prisma.user.create({
    data: {
      role: "ADMIN",
      name: "CallNBarb Admin",
      email: "admin@callnbarb.test",
      phone: "+2348000000001",
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      referralCode: "CNBADMIN",
    },
  });

  const customer = await prisma.user.create({
    data: {
      role: "CUSTOMER",
      name: "Amaka Okonkwo",
      email: "customer@callnbarb.test",
      phone: "+2348000000002",
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      referralCode: "AMAKA10",
    },
  });

  await prisma.notificationPreference.create({ data: { userId: customer.id } });
  await prisma.notificationPreference.create({ data: { userId: admin.id } });

  const address = await prisma.address.create({
    data: {
      userId: customer.id,
      label: "Home",
      address: "14 Admiralty Way, Lekki Phase 1",
      city: "Lagos",
      state: "Lagos",
      landmark: "Near the roundabout",
      latitude: 6.4474,
      longitude: 3.4723,
      isDefault: true,
    },
  });

  const barberUser = await prisma.user.create({
    data: {
      role: "BARBER",
      name: "Tunde Fade",
      email: "barber@callnbarb.test",
      phone: "+2348000000003",
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      referralCode: "TUNDEFADE",
    },
  });
  await prisma.notificationPreference.create({ data: { userId: barberUser.id } });

  const barber = await prisma.barberProfile.create({
    data: {
      userId: barberUser.id,
      bio: "Award-style fades and clean lineups. I come to you, fully equipped.",
      experienceYears: 8,
      verificationStatus: "VERIFIED",
      serviceArea: "Lekki, Victoria Island, Ikoyi",
      addressLine: "Lekki Phase 1",
      city: "Lagos",
      state: "Lagos",
      latitude: 6.45,
      longitude: 3.47,
      ratingAvg: 4.9,
      totalReviews: 1,
      completedJobs: 128,
      homeService: true,
      bankName: "GTBank",
      accountNumber: "0123456789",
      accountName: "Tunde Fade",
    },
  });

  await prisma.wallet.create({
    data: {
      barberId: barber.id,
      availableKobo: 4500000,
      totalEarnedKobo: 9200000,
      totalWithdrawnKobo: 4700000,
    },
  });

  for (let d = 1; d <= 6; d++) {
    await prisma.availability.create({
      data: {
        barberId: barber.id,
        dayOfWeek: d,
        startTime: "09:00",
        endTime: "19:00",
        breakStart: "13:30",
        breakEnd: "14:00",
        active: true,
      },
    });
  }

  const svcHair = await prisma.barberService.create({
    data: {
      barberId: barber.id,
      categoryId: catRows[0].id,
      name: "Haircut",
      description: "Precision cut with consultation",
      priceKobo: 500000,
      durationMin: 45,
    },
  });
  await prisma.barberService.create({
    data: {
      barberId: barber.id,
      categoryId: catRows[2].id,
      name: "Fade",
      description: "Skin-to-blend fade",
      priceKobo: 700000,
      durationMin: 50,
    },
  });
  await prisma.barberService.create({
    data: {
      barberId: barber.id,
      categoryId: catRows[6].id,
      name: "Haircut + Beard",
      description: "Full head and beard",
      priceKobo: 800000,
      durationMin: 70,
    },
  });
  await prisma.barberService.create({
    data: {
      barberId: barber.id,
      categoryId: catRows[7].id,
      name: "Kids Haircut",
      description: "Ages 12 and under",
      priceKobo: 400000,
      durationMin: 30,
    },
  });

  const pendingBarberUser = await prisma.user.create({
    data: {
      role: "BARBER",
      name: "Chidi Lines",
      email: "pending.barber@callnbarb.test",
      phone: "+2348000000004",
      passwordHash,
      status: "ACTIVE",
      referralCode: "CHIDI",
    },
  });
  await prisma.barberProfile.create({
    data: {
      userId: pendingBarberUser.id,
      bio: "Sharp lineups across Abuja.",
      experienceYears: 4,
      verificationStatus: "PENDING",
      serviceArea: "Wuse, Maitama",
      city: "Abuja",
      state: "FCT",
    },
  });

  const booking = await prisma.booking.create({
    data: {
      publicRef: "CNB-DEMO01",
      customerId: customer.id,
      barberId: barber.id,
      serviceId: svcHair.id,
      addressId: address.id,
      bookingDate: "2026-09-20",
      startTime: "11:00",
      endTime: "11:45",
      amountKobo: 500000,
      platformFeeKobo: 50000,
      barberEarningKobo: 450000,
      status: "COMPLETED",
      verifiedAt: new Date("2026-09-20T10:55:00Z"),
      startedAt: new Date("2026-09-20T11:00:00Z"),
      completedAt: new Date("2026-09-20T11:40:00Z"),
    },
  });

  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      customerId: customer.id,
      amountKobo: 500000,
      currency: "NGN",
      provider: "paystack",
      reference: "CNB-PAY-DEMO01",
      status: "SUCCESSFUL",
      verified: true,
      verifiedAt: new Date("2026-09-20T10:00:00Z"),
    },
  });

  await prisma.review.create({
    data: {
      bookingId: booking.id,
      customerId: customer.id,
      barberId: barber.id,
      rating: 5,
      comment: "Tunde was on time and the fade was perfect.",
    },
  });

  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { barberId: barber.id } });
  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      bookingId: booking.id,
      type: "SERVICE_EARNING",
      amountKobo: 450000,
      balanceBefore: 4050000,
      balanceAfter: 4500000,
      description: "Service earning credited (demo)",
      status: "SUCCESSFUL",
    },
  });

  console.log("Seeded CallNBarb demo data.");
  console.log("  Admin     admin@callnbarb.test / Password123!");
  console.log("  Customer  customer@callnbarb.test / Password123!");
  console.log("  Barber    barber@callnbarb.test / Password123!");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
