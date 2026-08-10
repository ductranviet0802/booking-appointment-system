const VN_UTC_OFFSET_MS = 7 * 60 * 60 * 1000; // Vietnam is UTC+7

export function combineDateAndTime(dateValue: Date, timeValue: Date) {
  return new Date(
    Date.UTC(
      dateValue.getUTCFullYear(),
      dateValue.getUTCMonth(),
      dateValue.getUTCDate(),
      timeValue.getUTCHours(),
      timeValue.getUTCMinutes(),
      timeValue.getUTCSeconds(),
      0,
    ),
  );
}

export function isSameUtcDate(left: Date, right: Date) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

export function toIsoDate(value: Date) {
  const vnDate = new Date(value.getTime() + VN_UTC_OFFSET_MS);
  return vnDate.toISOString().slice(0, 10);
}

export function toIsoTime(value: Date) {
  const vnDate = new Date(value.getTime() + VN_UTC_OFFSET_MS);
  return vnDate.toISOString().slice(11, 16);
}
