ALTER TABLE "OAuthConnection" ADD COLUMN "credentialGeneration" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OAuthState" ADD COLUMN "expectedConnectionGeneration" INTEGER;
