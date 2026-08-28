import { pgTable, text, timestamp, uuid, unique } from 'drizzle-orm/pg-core';

// v1 Shabbos/Yom Tov blackout dates — hand-maintained list.
// Shabbos is computed (Fri afternoon → Sat night in donor local tz);
// this table covers Yom Tov dates that need full-day blackouts.
export const yomTovDates = pgTable('yom_tov_dates', {
  id: uuid('id').primaryKey().defaultRandom(),
  gregorianDate: text('gregorian_date').notNull(), // 'YYYY-MM-DD'
  name: text('name').notNull(), // e.g. 'Rosh Hashana', 'Yom Kippur'
  // Local time (HH:MM) when blackout starts — accommodates erev (eve) starts
  blackoutStartsLocal: text('blackout_starts_local').notNull().default('14:00'),
  // Local time (HH:MM) when blackout ends (Motzei Yom Tov)
  blackoutEndsLocal: text('blackout_ends_local').notNull().default('22:00'),
}, (t) => ({
  uniqueDate: unique().on(t.gregorianDate),
}));

export type YomTovDate = typeof yomTovDates.$inferSelect;
export type NewYomTovDate = typeof yomTovDates.$inferInsert;
