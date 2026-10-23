-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "role" AS ENUM ('PATIENT', 'RECEPTION', 'ADMIN', 'DOCTOR');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('PENDING', 'ACTIVE', 'LOCKED', 'DISABLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "language" AS ENUM ('JA', 'EN', 'VI');

-- CreateEnum
CREATE TYPE "notify_channel" AS ENUM ('MAIL', 'LINE', 'SMS');

-- CreateEnum
CREATE TYPE "name_type" AS ENUM ('JP', 'ROMAJI');

-- CreateEnum
CREATE TYPE "sex" AS ENUM ('1', '2');

-- CreateEnum
CREATE TYPE "relation" AS ENUM ('SELF', 'CHILD', 'SPOUSE', 'PARENT', 'OTHER');

-- CreateEnum
CREATE TYPE "band" AS ENUM ('AM', 'PM');

-- CreateEnum
CREATE TYPE "calendar_kind" AS ENUM ('CLOSED', 'AM_CLOSED', 'PM_CLOSED', 'SPECIAL_OPEN');

-- CreateEnum
CREATE TYPE "shift_exception_kind" AS ENUM ('OFF', 'EXTRA', 'SUBSTITUTE');

-- CreateEnum
CREATE TYPE "visit_category" AS ENUM ('FIRST', 'REPEAT', 'SELF_PAY');

-- CreateEnum
CREATE TYPE "doctor_title" AS ENUM ('DIRECTOR', 'VICE_DIRECTOR', 'DOCTOR', 'PART_TIME');

-- CreateEnum
CREATE TYPE "slot_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('RESERVED', 'CHECKED_IN', 'NO_SHOW', 'CANCELED');

-- CreateEnum
CREATE TYPE "booking_channel" AS ENUM ('WEB', 'PHONE', 'COUNTER');

-- CreateEnum
CREATE TYPE "actor_kind" AS ENUM ('PATIENT', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "cancel_reason" AS ENUM ('RECOVERED', 'SCHEDULE', 'RESCHEDULE', 'CLINIC', 'OTHER');

-- CreateEnum
CREATE TYPE "notification_event" AS ENUM ('NT01_BOOKED', 'NT02_REMIND', 'NT03_CHANGED', 'NT04_CANCELED', 'NT05_PW_RESET', 'NT06_VERIFY', 'NT07_ADJUST');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'BOUNCED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "batch_status" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "clinics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL,
    "name_ja" VARCHAR(100) NOT NULL,
    "name_en" VARCHAR(100),
    "name_vi" VARCHAR(100),
    "name_kana" VARCHAR(100) NOT NULL,
    "postcode" CHAR(7) NOT NULL,
    "prefecture" VARCHAR(10) NOT NULL,
    "city" VARCHAR(50) NOT NULL,
    "address_line" VARCHAR(200) NOT NULL,
    "address_en" VARCHAR(300),
    "phone" VARCHAR(11) NOT NULL,
    "access_ja" TEXT NOT NULL,
    "access_en" TEXT,
    "access_vi" TEXT,
    "map_url" VARCHAR(500),
    "notice_ja" TEXT,
    "notice_en" TEXT,
    "notice_vi" TEXT,
    "ip_allowlist" TEXT,
    "display_order" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_business_hours" (
    "clinic_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "band" "band" NOT NULL,
    "open_time" TIME(0) NOT NULL,
    "close_time" TIME(0) NOT NULL,
    "reception_end_time" TIME(0),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_business_hours_pkey" PRIMARY KEY ("clinic_id","weekday","band")
);

-- CreateTable
CREATE TABLE "clinic_calendar_days" (
    "clinic_id" UUID NOT NULL,
    "cal_date" DATE NOT NULL,
    "kind" "calendar_kind" NOT NULL,
    "am_open" TIME(0),
    "am_close" TIME(0),
    "pm_open" TIME(0),
    "pm_close" TIME(0),
    "note_ja" VARCHAR(200),
    "note_en" VARCHAR(200),
    "note_vi" VARCHAR(200),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_calendar_days_pkey" PRIMARY KEY ("clinic_id","cal_date")
);

-- CreateTable
CREATE TABLE "holidays" (
    "holiday_date" DATE NOT NULL,
    "name_ja" VARCHAR(50) NOT NULL,
    "name_en" VARCHAR(100),
    "name_vi" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("holiday_date")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL,
    "name_ja" VARCHAR(50) NOT NULL,
    "name_en" VARCHAR(50),
    "name_vi" VARCHAR(50),
    "name_kana" VARCHAR(50) NOT NULL,
    "display_order" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_departments" (
    "clinic_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "display_order" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_departments_pkey" PRIMARY KEY ("clinic_id","department_id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(20) NOT NULL,
    "family_name" VARCHAR(50) NOT NULL,
    "given_name" VARCHAR(50) NOT NULL,
    "family_name_kana" VARCHAR(50) NOT NULL,
    "given_name_kana" VARCHAR(50) NOT NULL,
    "name_romaji" VARCHAR(100) NOT NULL,
    "title" "doctor_title" NOT NULL,
    "photo_url" VARCHAR(500),
    "profile_ja" TEXT NOT NULL,
    "profile_en" TEXT,
    "profile_vi" TEXT,
    "qualifications_ja" TEXT,
    "qualifications_en" TEXT,
    "qualifications_vi" TEXT,
    "languages" VARCHAR(10)[] DEFAULT ARRAY['ja']::VARCHAR(10)[],
    "primary_clinic_id" UUID NOT NULL,
    "account_id" UUID,
    "display_order" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_departments" (
    "doctor_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_departments_pkey" PRIMARY KEY ("doctor_id","department_id")
);

-- CreateTable
CREATE TABLE "doctor_shift_patterns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "band" "band" NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_shift_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_shift_exceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "shift_date" DATE NOT NULL,
    "kind" "shift_exception_kind" NOT NULL,
    "clinic_id" UUID,
    "department_id" UUID,
    "band" "band",
    "start_time" TIME(0),
    "end_time" TIME(0),
    "substitute_doctor_id" UUID,
    "note" VARCHAR(200),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_shift_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "category" "visit_category" NOT NULL,
    "name_ja" VARCHAR(50) NOT NULL,
    "name_en" VARCHAR(50),
    "name_vi" VARCHAR(50),
    "duration_frames" SMALLINT NOT NULL,
    "price_yen" INTEGER,
    "web_bookable" BOOLEAN NOT NULL DEFAULT true,
    "questionnaire_required" BOOLEAN NOT NULL,
    "notice_ja" TEXT,
    "notice_en" TEXT,
    "notice_vi" TEXT,
    "display_order" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_policies" (
    "clinic_id" UUID NOT NULL,
    "frame_minutes" SMALLINT NOT NULL DEFAULT 15,
    "frame_capacity" SMALLINT NOT NULL DEFAULT 1,
    "booking_window_days" SMALLINT NOT NULL DEFAULT 30,
    "same_day_cutoff_minutes" SMALLINT NOT NULL DEFAULT 30,
    "cancel_deadline_type" VARCHAR(16) NOT NULL DEFAULT 'PREV_DAY_TIME',
    "cancel_deadline_time" TIME(0) DEFAULT '23:59:00'::time,
    "cancel_deadline_hours" SMALLINT,
    "per_person_daily_limit" SMALLINT NOT NULL DEFAULT 1,
    "reminder_time" TIME(0) NOT NULL DEFAULT '10:00:00'::time,
    "phone_message_ja" VARCHAR(300) NOT NULL,
    "phone_message_en" VARCHAR(300),
    "phone_message_vi" VARCHAR(300),
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_policies_pkey" PRIMARY KEY ("clinic_id")
);

-- CreateTable
CREATE TABLE "slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "slot_date" DATE NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "reserved_count" SMALLINT NOT NULL DEFAULT 0,
    "status" "slot_status" NOT NULL,
    "closed_reason" VARCHAR(20),
    "generated_run_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "role" NOT NULL,
    "status" "account_status" NOT NULL,
    "language" "language" NOT NULL DEFAULT 'JA',
    "display_name" VARCHAR(50),
    "all_clinics" BOOLEAN NOT NULL DEFAULT false,
    "notify_channel" "notify_channel" DEFAULT 'MAIL',
    "line_user_id" VARCHAR(64),
    "line_friend" VARCHAR(12),
    "sms_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMPTZ(6),
    "email_bounced_at" TIMESTAMPTZ(6),
    "pending_email" VARCHAR(254),
    "failed_login_count" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "withdrawn_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID,
    "relation" "relation",
    "name_type" "name_type" NOT NULL,
    "family_name" VARCHAR(50) NOT NULL,
    "given_name" VARCHAR(50) NOT NULL,
    "family_name_kana" VARCHAR(50) NOT NULL,
    "given_name_kana" VARCHAR(50) NOT NULL,
    "birth_date" DATE NOT NULL,
    "sex" "sex" NOT NULL,
    "postcode" CHAR(7) NOT NULL,
    "prefecture" VARCHAR(10) NOT NULL,
    "city" VARCHAR(50) NOT NULL,
    "town" VARCHAR(100),
    "address_line" VARCHAR(200) NOT NULL,
    "building" VARCHAR(100),
    "phone" VARCHAR(11),
    "sms_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "merged_into_id" UUID,
    "created_by_kind" "actor_kind" NOT NULL,
    "anonymized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_cards" (
    "patient_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "card_no" VARCHAR(20) NOT NULL,
    "entered_by_kind" "actor_kind" NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_cards_pkey" PRIMARY KEY ("patient_id","clinic_id")
);

-- CreateTable
CREATE TABLE "staff_clinics" (
    "account_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_clinics_pkey" PRIMARY KEY ("account_id","clinic_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" CHAR(64) NOT NULL,
    "account_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "clinic_id" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "token_hash" CHAR(64) NOT NULL,
    "account_id" UUID NOT NULL,
    "purpose" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "consent_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(10) NOT NULL,
    "version" VARCHAR(10) NOT NULL,
    "language" "language" NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "version" VARCHAR(10) NOT NULL,
    "agreed_at" TIMESTAMPTZ(6) NOT NULL,
    "ip" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_no" CHAR(8) NOT NULL,
    "clinic_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "visit_type_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "doctor_requested" BOOLEAN NOT NULL,
    "patient_id" UUID NOT NULL,
    "booked_by_account_id" UUID,
    "channel" "booking_channel" NOT NULL,
    "slot_date" DATE NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'RESERVED',
    "price_yen" INTEGER,
    "notes" BYTEA,
    "checked_in_at" TIMESTAMPTZ(6),
    "no_show_candidate_at" TIMESTAMPTZ(6),
    "adjust_required_at" TIMESTAMPTZ(6),
    "adjust_notified_at" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "canceled_by_kind" "actor_kind",
    "canceled_by_account_id" UUID,
    "cancel_reason_code" "cancel_reason",
    "cancel_reason_text" VARCHAR(200),
    "change_count" SMALLINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "anonymized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_slots" (
    "booking_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_slots_pkey" PRIMARY KEY ("booking_id","slot_id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "id" BIGSERIAL NOT NULL,
    "booking_id" UUID NOT NULL,
    "event" VARCHAR(24) NOT NULL,
    "actor_kind" "actor_kind" NOT NULL,
    "actor_account_id" UUID,
    "channel" "booking_channel",
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionnaires" (
    "booking_id" UUID NOT NULL,
    "form_version" VARCHAR(10) NOT NULL,
    "language" "language" NOT NULL,
    "answers" BYTEA NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "purge_after" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questionnaires_pkey" PRIMARY KEY ("booking_id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "event" "notification_event" NOT NULL,
    "channel" "notify_channel" NOT NULL,
    "language" "language" NOT NULL,
    "subject" VARCHAR(100),
    "body" TEXT NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event" "notification_event" NOT NULL,
    "channel" "notify_channel" NOT NULL,
    "language" "language" NOT NULL,
    "account_id" UUID,
    "patient_id" UUID,
    "booking_id" UUID,
    "to_address" VARCHAR(254) NOT NULL,
    "status" "notification_status" NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "provider_message_id" VARCHAR(100),
    "last_error" VARCHAR(500),
    "queued_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "trigger" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "period_from" DATE,
    "period_to" DATE,
    "changed_since" TIMESTAMPTZ(6),
    "patient_id" UUID,
    "file_name" VARCHAR(100) NOT NULL,
    "storage_key" VARCHAR(300),
    "row_count" INTEGER,
    "warning_count" INTEGER,
    "sha256" CHAR(64),
    "run_id" UUID,
    "created_by" UUID,
    "download_count" SMALLINT NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_code" VARCHAR(4) NOT NULL,
    "trigger" VARCHAR(10) NOT NULL,
    "clinic_id" UUID,
    "params" JSONB,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "status" "batch_status" NOT NULL,
    "read_count" INTEGER NOT NULL,
    "written_count" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "account_id" UUID,
    "role" "role",
    "action" VARCHAR(40) NOT NULL,
    "target_type" VARCHAR(30),
    "target_id" UUID,
    "clinic_id" UUID,
    "ip" VARCHAR(45),
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(50) NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinics_code_key" ON "clinics"("code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_code_key" ON "doctors"("code");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_account_id_key" ON "doctors"("account_id");

-- CreateIndex
CREATE INDEX "doctor_shift_patterns_clinic_id_weekday_idx" ON "doctor_shift_patterns"("clinic_id", "weekday");

-- CreateIndex
CREATE INDEX "doctor_shift_patterns_doctor_id_idx" ON "doctor_shift_patterns"("doctor_id");

-- CreateIndex
CREATE INDEX "doctor_shift_exceptions_doctor_id_shift_date_idx" ON "doctor_shift_exceptions"("doctor_id", "shift_date");

-- CreateIndex
CREATE INDEX "doctor_shift_exceptions_shift_date_idx" ON "doctor_shift_exceptions"("shift_date");

-- CreateIndex
CREATE UNIQUE INDEX "visit_types_clinic_id_code_key" ON "visit_types"("clinic_id", "code");

-- CreateIndex
CREATE INDEX "slots_clinic_id_slot_date_status_idx" ON "slots"("clinic_id", "slot_date", "status");

-- CreateIndex
CREATE INDEX "slots_department_id_slot_date_idx" ON "slots"("department_id", "slot_date");

-- CreateIndex
CREATE UNIQUE INDEX "slots_doctor_id_slot_date_start_time_key" ON "slots"("doctor_id", "slot_date", "start_time");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_line_user_id_key" ON "accounts"("line_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_active_key" ON "accounts"("email") WHERE (status <> 'WITHDRAWN');

-- CreateIndex
CREATE INDEX "patients_account_id_idx" ON "patients"("account_id");

-- CreateIndex
CREATE INDEX "patients_family_name_kana_given_name_kana_idx" ON "patients"("family_name_kana", "given_name_kana");

-- CreateIndex
CREATE INDEX "patients_phone_idx" ON "patients"("phone");

-- CreateIndex
CREATE INDEX "patients_birth_date_idx" ON "patients"("birth_date");

-- CreateIndex
CREATE UNIQUE INDEX "patients_one_self_per_account" ON "patients"("account_id") WHERE (relation = 'SELF');

-- CreateIndex
CREATE UNIQUE INDEX "patient_cards_clinic_id_card_no_key" ON "patient_cards"("clinic_id", "card_no");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_account_id_idx" ON "sessions"("account_id");

-- CreateIndex
CREATE INDEX "auth_tokens_account_id_purpose_idx" ON "auth_tokens"("account_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "consent_documents_kind_version_language_key" ON "consent_documents"("kind", "version", "language");

-- CreateIndex
CREATE INDEX "consents_account_id_kind_idx" ON "consents"("account_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_no_key" ON "bookings"("booking_no");

-- CreateIndex
CREATE INDEX "bookings_clinic_id_slot_date_status_idx" ON "bookings"("clinic_id", "slot_date", "status");

-- CreateIndex
CREATE INDEX "bookings_patient_id_slot_date_idx" ON "bookings"("patient_id", "slot_date");

-- CreateIndex
CREATE INDEX "bookings_booked_by_account_id_status_idx" ON "bookings"("booked_by_account_id", "status");

-- CreateIndex
CREATE INDEX "booking_slots_slot_id_idx" ON "booking_slots"("slot_id");

-- CreateIndex
CREATE INDEX "booking_events_booking_id_at_idx" ON "booking_events"("booking_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_clinic_id_event_channel_language_key" ON "notification_templates"("clinic_id", "event", "channel", "language");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notifications_account_id_idx" ON "notifications"("account_id");

-- CreateIndex
CREATE INDEX "notifications_patient_id_idx" ON "notifications"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_remind_once" ON "notifications"("booking_id", "channel") WHERE (event = 'NT02_REMIND');

-- CreateIndex
CREATE INDEX "export_files_clinic_id_kind_created_at_idx" ON "export_files"("clinic_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "batch_runs_job_code_started_at_idx" ON "batch_runs"("job_code", "started_at");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- CreateIndex
CREATE INDEX "audit_logs_account_id_at_idx" ON "audit_logs"("account_id", "at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "clinic_business_hours" ADD CONSTRAINT "clinic_business_hours_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_calendar_days" ADD CONSTRAINT "clinic_calendar_days_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_calendar_days" ADD CONSTRAINT "clinic_calendar_days_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_last_run_id_fkey" FOREIGN KEY ("last_run_id") REFERENCES "batch_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_departments" ADD CONSTRAINT "clinic_departments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_departments" ADD CONSTRAINT "clinic_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_primary_clinic_id_fkey" FOREIGN KEY ("primary_clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_departments" ADD CONSTRAINT "doctor_departments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_departments" ADD CONSTRAINT "doctor_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_shift_patterns" ADD CONSTRAINT "doctor_shift_patterns_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_shift_patterns" ADD CONSTRAINT "doctor_shift_patterns_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_shift_patterns" ADD CONSTRAINT "doctor_shift_patterns_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_shift_exceptions" ADD CONSTRAINT "doctor_shift_exceptions_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_shift_exceptions" ADD CONSTRAINT "doctor_shift_exceptions_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_shift_exceptions" ADD CONSTRAINT "doctor_shift_exceptions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_shift_exceptions" ADD CONSTRAINT "doctor_shift_exceptions_substitute_doctor_id_fkey" FOREIGN KEY ("substitute_doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_shift_exceptions" ADD CONSTRAINT "doctor_shift_exceptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_types" ADD CONSTRAINT "visit_types_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_types" ADD CONSTRAINT "visit_types_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_generated_run_id_fkey" FOREIGN KEY ("generated_run_id") REFERENCES "batch_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_cards" ADD CONSTRAINT "patient_cards_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_cards" ADD CONSTRAINT "patient_cards_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_clinics" ADD CONSTRAINT "staff_clinics_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_clinics" ADD CONSTRAINT "staff_clinics_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_visit_type_id_fkey" FOREIGN KEY ("visit_type_id") REFERENCES "visit_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booked_by_account_id_fkey" FOREIGN KEY ("booked_by_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_canceled_by_account_id_fkey" FOREIGN KEY ("canceled_by_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_slots" ADD CONSTRAINT "booking_slots_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaires" ADD CONSTRAINT "questionnaires_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_files" ADD CONSTRAINT "export_files_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_files" ADD CONSTRAINT "export_files_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_files" ADD CONSTRAINT "export_files_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "batch_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_files" ADD CONSTRAINT "export_files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_runs" ADD CONSTRAINT "batch_runs_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===== ver1 rules Prisma cannot express (03 §3; hand-written, keep when regenerating) =====
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 3.1 clinics
ALTER TABLE "clinics"
  ADD CONSTRAINT "clinics_code_format" CHECK (code ~ '^[a-z0-9-]+$'),
  ADD CONSTRAINT "clinics_postcode_digits" CHECK (postcode ~ '^[0-9]{7}$'),
  ADD CONSTRAINT "clinics_phone_digits" CHECK (phone ~ '^[0-9]{10,11}$'),
  ADD CONSTRAINT "clinics_map_url_https" CHECK (map_url IS NULL OR map_url LIKE 'https://%');

-- 3.2 clinic_business_hours (AM.close <= PM.open spans two rows: checked by A01)
ALTER TABLE "clinic_business_hours"
  ADD CONSTRAINT "cbh_weekday" CHECK (weekday BETWEEN 0 AND 6),
  ADD CONSTRAINT "cbh_open_before_close" CHECK (open_time < close_time),
  ADD CONSTRAINT "cbh_reception_end" CHECK (reception_end_time IS NULL OR reception_end_time <= close_time);

-- 3.3 clinic_calendar_days
ALTER TABLE "clinic_calendar_days"
  ADD CONSTRAINT "ccd_band_pairs" CHECK ((am_open IS NULL) = (am_close IS NULL) AND (pm_open IS NULL) = (pm_close IS NULL)),
  ADD CONSTRAINT "ccd_band_order" CHECK ((am_open IS NULL OR am_open < am_close) AND (pm_open IS NULL OR pm_open < pm_close)),
  ADD CONSTRAINT "ccd_special_open_band" CHECK (kind <> 'SPECIAL_OPEN' OR am_open IS NOT NULL OR pm_open IS NOT NULL);

-- 3.5 departments.code is immutable after creation (selects the 問診 block of 10)
CREATE FUNCTION departments_code_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'departments.code is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "departments_code_immutable" BEFORE UPDATE OF code ON "departments"
  FOR EACH ROW EXECUTE FUNCTION departments_code_immutable();

-- 3.9 doctor_shift_patterns: no two patterns of one doctor overlap in weekday, time and validity, across clinics (F3-04).
-- The clinic_departments / doctor_departments links are checked by A02 at save, not by a foreign key (Q-004).
ALTER TABLE "doctor_shift_patterns"
  ADD CONSTRAINT "dsp_weekday" CHECK (weekday BETWEEN 0 AND 6),
  ADD CONSTRAINT "dsp_time_order" CHECK (start_time < end_time),
  ADD CONSTRAINT "dsp_valid_order" CHECK (valid_to IS NULL OR valid_to >= valid_from),
  ADD CONSTRAINT "dsp_no_overlap" EXCLUDE USING gist (
    doctor_id WITH =,
    weekday WITH =,
    tsrange(DATE '2000-01-01' + start_time, DATE '2000-01-01' + end_time) WITH &&,
    daterange(valid_from, valid_to, '[]') WITH &&
  );

-- 3.10 doctor_shift_exceptions
ALTER TABLE "doctor_shift_exceptions"
  ADD CONSTRAINT "dse_clinic_dept" CHECK (kind = 'OFF' OR (clinic_id IS NOT NULL AND department_id IS NOT NULL)),
  ADD CONSTRAINT "dse_extra_times" CHECK (kind <> 'EXTRA' OR (start_time IS NOT NULL AND end_time IS NOT NULL)),
  ADD CONSTRAINT "dse_time_order" CHECK (start_time IS NULL OR end_time IS NULL OR start_time < end_time),
  ADD CONSTRAINT "dse_substitute" CHECK (
    (kind = 'SUBSTITUTE') = (substitute_doctor_id IS NOT NULL) AND substitute_doctor_id IS DISTINCT FROM doctor_id
  );

-- 3.11 visit_types
ALTER TABLE "visit_types"
  ADD CONSTRAINT "vt_duration" CHECK (duration_frames BETWEEN 1 AND 8),
  ADD CONSTRAINT "vt_price_self_pay" CHECK ((category = 'SELF_PAY') = (price_yen IS NOT NULL) AND (price_yen IS NULL OR price_yen >= 0)),
  ADD CONSTRAINT "vt_questionnaire_first" CHECK (questionnaire_required = (category = 'FIRST'));

-- 3.12 booking_policies
ALTER TABLE "booking_policies"
  ADD CONSTRAINT "bp_frame_minutes" CHECK (frame_minutes IN (5, 10, 15, 20, 30)),
  ADD CONSTRAINT "bp_frame_capacity" CHECK (frame_capacity BETWEEN 1 AND 10),
  ADD CONSTRAINT "bp_window" CHECK (booking_window_days BETWEEN 7 AND 180),
  ADD CONSTRAINT "bp_cutoff" CHECK (same_day_cutoff_minutes BETWEEN 0 AND 240),
  ADD CONSTRAINT "bp_deadline_type" CHECK (
    (cancel_deadline_type = 'PREV_DAY_TIME' AND cancel_deadline_time IS NOT NULL)
    OR (cancel_deadline_type = 'HOURS_BEFORE' AND cancel_deadline_hours IS NOT NULL)
  ),
  ADD CONSTRAINT "bp_deadline_hours" CHECK (cancel_deadline_hours IS NULL OR cancel_deadline_hours BETWEEN 1 AND 72),
  ADD CONSTRAINT "bp_daily_limit" CHECK (per_person_daily_limit BETWEEN 1 AND 3),
  ADD CONSTRAINT "bp_reminder_time" CHECK (reminder_time BETWEEN TIME '07:00' AND TIME '20:00');

-- 3.13 slots: a frame is never booked beyond its capacity (F4-07)
ALTER TABLE "slots"
  ADD CONSTRAINT "slots_capacity" CHECK (capacity >= 1),
  ADD CONSTRAINT "slots_not_overbooked" CHECK (reserved_count >= 0 AND reserved_count <= capacity),
  ADD CONSTRAINT "slots_time_order" CHECK (start_time < end_time),
  ADD CONSTRAINT "slots_closed_reason" CHECK (closed_reason IS NULL OR closed_reason IN ('HOLIDAY', 'CLINIC_CLOSED', 'DOCTOR_OFF'));

-- 3.14 accounts
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_email_lower" CHECK (email = lower(email)),
  ADD CONSTRAINT "accounts_pending_email_lower" CHECK (pending_email IS NULL OR pending_email = lower(pending_email)),
  ADD CONSTRAINT "accounts_all_clinics_admin" CHECK (NOT all_clinics OR role = 'ADMIN'),
  ADD CONSTRAINT "accounts_staff_display_name" CHECK (role = 'PATIENT' OR display_name IS NOT NULL),
  ADD CONSTRAINT "accounts_patient_channel" CHECK (role <> 'PATIENT' OR notify_channel IS NOT NULL),
  ADD CONSTRAINT "accounts_line_friend" CHECK (line_friend IS NULL OR line_friend IN ('FOLLOWING', 'UNFOLLOWED')),
  ADD CONSTRAINT "accounts_failed_login_count" CHECK (failed_login_count >= 0);

-- 3.15 patients (name / kana formats are input rules, checked by the screens; B5 anonymises to 削除済)
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_relation_with_account" CHECK (account_id IS NULL OR relation IS NOT NULL),
  ADD CONSTRAINT "patients_birth_date_min" CHECK (birth_date >= DATE '1900-01-01'),
  ADD CONSTRAINT "patients_postcode" CHECK (postcode ~ '^[0-9]{7}$' OR anonymized_at IS NOT NULL),
  ADD CONSTRAINT "patients_phone" CHECK (phone IS NULL OR phone ~ '^[0-9]{10,11}$' OR anonymized_at IS NOT NULL),
  ADD CONSTRAINT "patients_phone_required" CHECK (phone IS NOT NULL OR NOT (relation = 'SELF' OR (account_id IS NULL AND created_by_kind = 'STAFF'))),
  ADD CONSTRAINT "patients_not_merged_into_self" CHECK (merged_into_id IS DISTINCT FROM id);

-- 3.16 patient_cards
ALTER TABLE "patient_cards"
  ADD CONSTRAINT "patient_cards_card_no_format" CHECK (card_no ~ '^[0-9A-Za-z-]+$');

-- 3.19 / 3.20 / 3.21
ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_purpose" CHECK (purpose IN ('PASSWORD_RESET', 'EMAIL_VERIFY', 'EMAIL_CHANGE'));
ALTER TABLE "consent_documents"
  ADD CONSTRAINT "consent_documents_kind" CHECK (kind IN ('TERMS', 'PRIVACY'));
ALTER TABLE "consents"
  ADD CONSTRAINT "consents_kind" CHECK (kind IN ('TERMS', 'PRIVACY'));

-- 3.22 bookings
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_booking_no_format" CHECK (booking_no ~ '^[A-HJ-NP-Z]{4}[0-9]{4}$'),
  ADD CONSTRAINT "bookings_time_order" CHECK (start_time < end_time),
  ADD CONSTRAINT "bookings_canceled_data" CHECK (
    status <> 'CANCELED' OR (canceled_at IS NOT NULL AND canceled_by_kind IS NOT NULL AND cancel_reason_code IS NOT NULL)
  ),
  ADD CONSTRAINT "bookings_counters" CHECK (change_count >= 0 AND version >= 0);

-- 3.24 booking_events
ALTER TABLE "booking_events"
  ADD CONSTRAINT "booking_events_event" CHECK (event IN (
    'CREATED', 'CHANGED', 'CANCELED', 'CHECKED_IN', 'CHECKIN_UNDONE', 'NO_SHOW_CANDIDATE', 'NO_SHOW',
    'NO_SHOW_CORRECTED', 'ADJUST_REQUIRED', 'ADJUST_NOTIFIED', 'ADJUST_CLEARED', 'DOCTOR_SUBSTITUTED'
  ));

-- 3.26 notification_templates
ALTER TABLE "notification_templates"
  ADD CONSTRAINT "nt_mail_subject" CHECK (channel <> 'MAIL' OR subject IS NOT NULL);

-- 3.28 export_files
ALTER TABLE "export_files"
  ADD CONSTRAINT "ef_kind" CHECK (kind IN ('PATIENTS', 'BOOKINGS', 'DISCLOSURE')),
  ADD CONSTRAINT "ef_trigger" CHECK (trigger IN ('BATCH', 'MANUAL')),
  ADD CONSTRAINT "ef_status" CHECK (status IN ('BUILDING', 'DONE', 'FAILED')),
  ADD CONSTRAINT "ef_bookings_period" CHECK (kind <> 'BOOKINGS' OR (period_from IS NOT NULL AND period_to IS NOT NULL)),
  ADD CONSTRAINT "ef_patients_since" CHECK (kind <> 'PATIENTS' OR changed_since IS NOT NULL),
  ADD CONSTRAINT "ef_disclosure_patient" CHECK ((kind = 'DISCLOSURE') = (patient_id IS NOT NULL)),
  ADD CONSTRAINT "ef_done_file" CHECK (
    (status = 'DONE') = (storage_key IS NOT NULL) AND (status = 'DONE') = (row_count IS NOT NULL)
    AND (status = 'DONE') = (warning_count IS NOT NULL) AND (status = 'DONE') = (sha256 IS NOT NULL)
  ),
  ADD CONSTRAINT "ef_expires" CHECK ((status = 'BUILDING') = (expires_at IS NULL));

-- 3.29 batch_runs
ALTER TABLE "batch_runs"
  ADD CONSTRAINT "batch_runs_job_code" CHECK (job_code IN ('B1', 'B2', 'B3', 'B4', 'B5', 'B6')),
  ADD CONSTRAINT "batch_runs_trigger" CHECK (trigger IN ('SCHEDULE', 'MANUAL', 'EVENT'));

-- 3.30 audit_logs: append-only. UPDATE is refused; DELETE stays possible for the B5 5-year purge (Q-002)
CREATE FUNCTION audit_logs_no_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER "audit_logs_no_update" BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_no_update();
