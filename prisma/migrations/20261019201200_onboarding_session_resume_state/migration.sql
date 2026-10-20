-- Durable Academic setup defer/resume state (unfinished draft, not answers).
ALTER TABLE "onboarding_sessions" ADD COLUMN "resumeQuestionIndex" INTEGER;
ALTER TABLE "onboarding_sessions" ADD COLUMN "resumeQuestionId" TEXT;
ALTER TABLE "onboarding_sessions" ADD COLUMN "resumeDraftJson" JSONB;
