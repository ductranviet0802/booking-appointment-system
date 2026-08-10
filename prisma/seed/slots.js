const { idFromNumber } = require("./ids");
const { doctors } = require("./doctors");

const SLOT_START_HOUR = 9;
const SLOT_END_HOUR = 17;
const SLOT_DURATION_MINUTES = 30;
const VN_UTC_OFFSET = 7; // Vietnam is UTC+7

function startOfUtcToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function addDays(date, days) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function atUtcTime(date, hour, minute) {
  // Convert Vietnam local time (UTC+7) to UTC before storing
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour - VN_UTC_OFFSET, minute, 0, 0));
}

function createSlots() {
  const slots = [];
  let idCursor = 12000;
  const seedAnchor = startOfUtcToday();

  for (const doctor of doctors) {
    for (let offset = 0; offset < 30; offset += 1) {
      const day = addDays(seedAnchor, offset);

      for (let hour = SLOT_START_HOUR; hour < SLOT_END_HOUR; hour += 1) {
        for (let minute = 0; minute < 60; minute += SLOT_DURATION_MINUTES) {
          const start = atUtcTime(day, hour, minute);
          const end = atUtcTime(day, hour, minute + SLOT_DURATION_MINUTES);

          slots.push({
            id: idFromNumber(idCursor),
            doctor_id: doctor.id,
            date: day,
            start_time: start,
            end_time: end,
            is_booked: false,
          });

          idCursor += 1;
        }
      }
    }
  }

  return slots;
}

module.exports = {
  createSlots,
};
