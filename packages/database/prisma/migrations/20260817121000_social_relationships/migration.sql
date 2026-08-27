-- Canonicalize every two-user relationship so inverse/concurrent creation has one database key.
ALTER TABLE "Friendship" ADD COLUMN "pairKey" VARCHAR(73);

DELETE FROM "Friendship" WHERE "requesterId" = "addresseeId";
DELETE FROM "Friendship" WHERE "status" = 'DECLINED';

ALTER TYPE "FriendshipStatus" RENAME TO "FriendshipStatus_old";
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');
ALTER TABLE "Friendship" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Friendship"
  ALTER COLUMN "status" TYPE "FriendshipStatus"
  USING ("status"::text::"FriendshipStatus");
ALTER TABLE "Friendship" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "FriendshipStatus_old";

UPDATE "Friendship"
SET "pairKey" = LEAST("requesterId"::text, "addresseeId"::text) || ':' ||
                GREATEST("requesterId"::text, "addresseeId"::text);

DELETE FROM "Friendship" current
USING "Friendship" duplicate
WHERE current."pairKey" = duplicate."pairKey"
  AND (
    CASE current."status" WHEN 'ACCEPTED' THEN 2 WHEN 'PENDING' THEN 1 ELSE 0 END,
    current."requestedAt",
    current.ctid
  ) < (
    CASE duplicate."status" WHEN 'ACCEPTED' THEN 2 WHEN 'PENDING' THEN 1 ELSE 0 END,
    duplicate."requestedAt",
    duplicate.ctid
  );

ALTER TABLE "Friendship" DROP CONSTRAINT "Friendship_pkey";
ALTER TABLE "Friendship" ALTER COLUMN "pairKey" SET NOT NULL;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_pkey" PRIMARY KEY ("pairKey");
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_no_self_check"
  CHECK ("requesterId" <> "addresseeId");
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_active_status_check"
  CHECK ("status" IN ('PENDING', 'ACCEPTED'));
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_canonical_pair_check"
  CHECK (
    "pairKey" = LEAST("requesterId"::text, "addresseeId"::text) || ':' ||
                GREATEST("requesterId"::text, "addresseeId"::text)
  );

ALTER TABLE "DirectConversation" ADD COLUMN "pairKey" VARCHAR(73);

UPDATE "DirectConversation" conversation
SET "pairKey" = members."pairKey"
FROM (
  SELECT "conversationId",
         MIN("userId"::text) || ':' || MAX("userId"::text) AS "pairKey"
  FROM "DirectConversationMember"
  GROUP BY "conversationId"
  HAVING COUNT(*) = 2 AND COUNT(DISTINCT "userId") = 2
) members
WHERE members."conversationId" = conversation."id";

WITH conversation_groups AS (
  SELECT "id",
         (MIN("id"::text) OVER (PARTITION BY "pairKey"))::uuid AS "keeperId"
  FROM "DirectConversation"
  WHERE "pairKey" IS NOT NULL
)
UPDATE "DirectMessage" message
SET "conversationId" = conversation_groups."keeperId"
FROM conversation_groups
WHERE message."conversationId" = conversation_groups."id"
  AND conversation_groups."id" <> conversation_groups."keeperId";

WITH conversation_groups AS (
  SELECT "id",
         (MIN("id"::text) OVER (PARTITION BY "pairKey"))::uuid AS "keeperId"
  FROM "DirectConversation"
  WHERE "pairKey" IS NOT NULL
)
DELETE FROM "DirectConversation" conversation
USING conversation_groups
WHERE conversation."id" = conversation_groups."id"
  AND conversation_groups."id" <> conversation_groups."keeperId";

ALTER TABLE "DirectConversation" ALTER COLUMN "pairKey" SET NOT NULL;
CREATE UNIQUE INDEX "DirectConversation_pairKey_key" ON "DirectConversation"("pairKey");

ALTER TABLE "DirectMessage" ADD COLUMN "clientNonce" VARCHAR(128);
UPDATE "DirectMessage" SET "clientNonce" = "id"::text;
ALTER TABLE "DirectMessage" ALTER COLUMN "clientNonce" SET NOT NULL;
CREATE UNIQUE INDEX "DirectMessage_conversationId_authorId_clientNonce_key"
  ON "DirectMessage"("conversationId", "authorId", "clientNonce");

DELETE FROM "Block" WHERE "blockerId" = "blockedId";
ALTER TABLE "Block" ADD CONSTRAINT "Block_no_self_check" CHECK ("blockerId" <> "blockedId");
