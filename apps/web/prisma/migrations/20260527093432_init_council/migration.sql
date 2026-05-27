-- CreateTable
CREATE TABLE "CouncilSession" (
    "id" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "normalizedPrompt" TEXT,
    "taskType" TEXT NOT NULL,
    "evidenceMode" TEXT NOT NULL DEFAULT 'ai_only',
    "status" TEXT NOT NULL,
    "currentRound" TEXT,
    "riskLevel" TEXT,
    "confidenceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "CouncilSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentResponse" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT,
    "round" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rawResponse" JSONB,
    "parsedResponse" JSONB,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "tokenUsage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCritique" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT,
    "round" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rawResponse" JSONB,
    "parsedResponse" JSONB,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCritique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalAnswer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "finalMarkdown" TEXT NOT NULL,
    "businessReadyAnswer" TEXT,
    "internalMemo" TEXT,
    "evidenceBackedClaims" JSONB,
    "assumptions" JSONB,
    "missingEvidence" JSONB,
    "unsafePhrases" JSONB,
    "recommendedSafeWording" JSONB,
    "unresolvedDisagreements" JSONB,
    "riskLevel" TEXT,
    "confidenceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinalAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCallLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "round" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "timeoutMs" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "modelRequested" TEXT,
    "modelUsed" TEXT,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "rawResponse" TEXT,
    "parsedResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAttemptLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "round" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "attemptIndex" INTEGER NOT NULL,
    "chainIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "timeoutMs" INTEGER NOT NULL,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "retryAfterMs" INTEGER,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAttemptLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "category" TEXT,
    "version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "chunkIndex" INTEGER NOT NULL,
    "metadata" JSONB,
    "embedding" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CouncilSession_createdAt_idx" ON "CouncilSession"("createdAt");

-- CreateIndex
CREATE INDEX "CouncilSession_status_idx" ON "CouncilSession"("status");

-- CreateIndex
CREATE INDEX "CouncilSession_taskType_idx" ON "CouncilSession"("taskType");

-- CreateIndex
CREATE INDEX "AgentResponse_sessionId_idx" ON "AgentResponse"("sessionId");

-- CreateIndex
CREATE INDEX "AgentResponse_providerId_round_idx" ON "AgentResponse"("providerId", "round");

-- CreateIndex
CREATE INDEX "AgentCritique_sessionId_idx" ON "AgentCritique"("sessionId");

-- CreateIndex
CREATE INDEX "AgentCritique_providerId_round_idx" ON "AgentCritique"("providerId", "round");

-- CreateIndex
CREATE INDEX "FinalAnswer_sessionId_idx" ON "FinalAnswer"("sessionId");

-- CreateIndex
CREATE INDEX "ProviderCallLog_sessionId_idx" ON "ProviderCallLog"("sessionId");

-- CreateIndex
CREATE INDEX "ProviderCallLog_providerId_round_idx" ON "ProviderCallLog"("providerId", "round");

-- CreateIndex
CREATE INDEX "ProviderCallLog_status_idx" ON "ProviderCallLog"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCallLog_sessionId_providerId_round_key" ON "ProviderCallLog"("sessionId", "providerId", "round");

-- CreateIndex
CREATE INDEX "ProviderAttemptLog_sessionId_idx" ON "ProviderAttemptLog"("sessionId");

-- CreateIndex
CREATE INDEX "ProviderAttemptLog_sessionId_providerId_round_idx" ON "ProviderAttemptLog"("sessionId", "providerId", "round");

-- CreateIndex
CREATE INDEX "ProviderAttemptLog_providerId_round_status_idx" ON "ProviderAttemptLog"("providerId", "round", "status");

-- CreateIndex
CREATE INDEX "ProviderAttemptLog_status_idx" ON "ProviderAttemptLog"("status");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

-- AddForeignKey
ALTER TABLE "AgentResponse" ADD CONSTRAINT "AgentResponse_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CouncilSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCritique" ADD CONSTRAINT "AgentCritique_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CouncilSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalAnswer" ADD CONSTRAINT "FinalAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CouncilSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCallLog" ADD CONSTRAINT "ProviderCallLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CouncilSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAttemptLog" ADD CONSTRAINT "ProviderAttemptLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CouncilSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
