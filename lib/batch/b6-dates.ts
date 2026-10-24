// B6 / A06 period arithmetic (no database: the A06 client uses it too). 06 B6 Trigger: a period is at most 31 days, both ends counted.
import { dbDate } from "@/lib/datetime";

export const MAX_PERIOD_DAYS = 31;
/** days of [from, to], both included */
export const periodDays = (from: string, to: string) => Math.round((dbDate(to).getTime() - dbDate(from).getTime()) / 86_400_000) + 1;
