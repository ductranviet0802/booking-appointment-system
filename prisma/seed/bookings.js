const { idFromNumber } = require("./ids");

function createBookings({ slots, userId }) {
  const now = new Date();
  const pastSlots = slots.filter((slot) => slot.start_time.getTime() < now.getTime());
  const futureSlots = slots.filter((slot) => slot.start_time.getTime() > now.getTime());

  const bookings = [];
  let idCursor = 25000;

  const pastCount = Math.min(10, pastSlots.length);
  const futureConfirmedCount = Math.min(10, futureSlots.length);
  const futureCanceledCount = Math.min(5, Math.max(0, futureSlots.length - futureConfirmedCount));

  for (let index = 0; index < pastCount; index += 1) {
    const slot = pastSlots[index];
    bookings.push({
      id: idFromNumber(idCursor++),
      user_id: userId,
      slot_id: slot.id,
      status: "CONFIRMED",
      notes: "Tái khám định kỳ",
    });
  }

  for (let index = 0; index < futureConfirmedCount; index += 1) {
    const slot = futureSlots[index];
    bookings.push({
      id: idFromNumber(idCursor++),
      user_id: userId,
      slot_id: slot.id,
      status: "CONFIRMED",
      notes: "Khám theo lịch hẹn",
    });
  }

  for (let index = 0; index < futureCanceledCount; index += 1) {
    const slot = futureSlots[futureConfirmedCount + index];
    bookings.push({
      id: idFromNumber(idCursor++),
      user_id: userId,
      slot_id: slot.id,
      status: "CANCELED",
      notes: "Đã hủy vì bận việc",
    });
  }

  return bookings;
}

module.exports = {
  createBookings,
};
