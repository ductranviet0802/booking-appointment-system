/* eslint-disable no-console */
require("dotenv/config");
const bcrypt = require("bcrypt");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const { Pool } = require("pg");
const { specialties } = require("./seed/specialties");
const { hospitals } = require("./seed/hospitals");
const { locations } = require("./seed/locations");
const { doctors } = require("./seed/doctors");
const { users } = require("./seed/users");
const { createSlots } = require("./seed/slots");
const { createBookings } = require("./seed/bookings");

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Please provide it before running seed.");
}

const needsSsl = databaseUrl.includes("sslmode=require");
const cleanUrl = needsSsl ? databaseUrl.replace(/[?&]sslmode=require/g, (m) => m.startsWith("?") ? "?" : "").replace(/\?&/, "?").replace(/\?$/, "") : databaseUrl;

const pool = new Pool({
  connectionString: cleanUrl,
  max: 10,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding started...");

  await prisma.booking.deleteMany();
  await prisma.doctorSlot.deleteMany();
  await prisma.doctor.deleteMany();
  await prisma.location.deleteMany();
  await prisma.hospital.deleteMany();
  await prisma.specialty.deleteMany();
  await prisma.user.deleteMany();

  await prisma.specialty.createMany({ data: specialties });
  await prisma.hospital.createMany({ data: hospitals });
  await prisma.location.createMany({
    data: locations.map((item) => ({
      id: item.id,
      hospitalId: item.hospital_id,
      address: item.address,
      city: item.city,
    })),
  });

  await prisma.doctor.createMany({
    data: doctors.map((doctor) => ({
      id: doctor.id,
      specialtyId: doctor.specialty_id,
      hospitalId: doctor.hospital_id,
      name: doctor.name,
      experience: doctor.experience,
      rating: doctor.rating,
      fee: doctor.fee,
      description: doctor.description,
      avatar: doctor.avatar,
    })),
  });

  const preparedUsers = await Promise.all(
    users.map(async (user) => ({
      id: user.id,
      email: user.email,
      password: await bcrypt.hash(user.password, 12),
      name: user.name,
      phone: user.phone,
      role: user.role,
    })),
  );

  await prisma.user.createMany({ data: preparedUsers });

  const slots = createSlots();

  await prisma.doctorSlot.createMany({
    data: slots.map((slot) => ({
      id: slot.id,
      doctorId: slot.doctor_id,
      date: slot.date,
      startTime: slot.start_time,
      endTime: slot.end_time,
      isBooked: false,
    })),
  });

  const bookings = createBookings({ slots, userId: preparedUsers[0].id });

  await prisma.booking.createMany({
    data: bookings.map((booking) => ({
      id: booking.id,
      userId: booking.user_id,
      slotId: booking.slot_id,
      status: booking.status,
      notes: booking.notes,
    })),
  });

  const bookedSlotIds = bookings.map((item) => item.slot_id);
  await prisma.doctorSlot.updateMany({
    where: {
      id: { in: bookedSlotIds },
    },
    data: {
      isBooked: true,
    },
  });

  console.log(`Seeded specialties: ${specialties.length}`);
  console.log(`Seeded hospitals: ${hospitals.length}`);
  console.log(`Seeded doctors: ${doctors.length}`);
  console.log(`Seeded users: ${users.length}`);
  console.log(`Seeded slots: ${slots.length}`);
  console.log(`Seeded bookings: ${bookings.length}`);
  console.log("Seeding completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
