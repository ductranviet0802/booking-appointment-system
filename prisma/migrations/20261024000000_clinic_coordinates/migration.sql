-- demo add-on: map, not in ver1 spec. Clinic coordinates (WGS84) for the OpenStreetMap pins; no coordinate → no map.
ALTER TABLE "clinics" ADD COLUMN "latitude" DOUBLE PRECISION, ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_coordinates_check" CHECK (
  (latitude IS NULL AND longitude IS NULL)
  -- IS NOT NULL: one NULL would make the range test NULL, and a NULL CHECK passes
  OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
