-- Day 9 invariant:
-- Ensure one active CONFIRMED booking per slot at the database level.
-- Abort migration if legacy data already violates the invariant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "bookings"
    WHERE "status" = 'CONFIRMED'
    GROUP BY "slot_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot apply booking invariant: duplicate CONFIRMED bookings exist for at least one slot.';
  END IF;
END $$;

CREATE UNIQUE INDEX "bookings_confirmed_slot_unique_idx"
  ON "bookings"("slot_id")
  WHERE "status" = 'CONFIRMED';
