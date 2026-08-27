-- Repair only servers created by the legacy bootstrap: one unsafe @everyone role
-- with the owner assigned to it and no dedicated Owner role. The masks correspond
-- to all permissions known at this migration (2047) and the restricted defaults
-- VIEW_CHANNEL | SEND_MESSAGES | CONNECT | SPEAK (771).
WITH legacy_servers AS (
  SELECT s."id", s."ownerId"
  FROM "Server" s
  JOIN "Role" everyone
    ON everyone."serverId" = s."id"
   AND everyone."name" = '@everyone'
   AND everyone."permissions" = 2047
   AND everyone."position" = 0
  JOIN "ServerMemberRole" owner_everyone
    ON owner_everyone."serverId" = s."id"
   AND owner_everyone."userId" = s."ownerId"
   AND owner_everyone."roleId" = everyone."id"
  WHERE NOT EXISTS (
    SELECT 1
    FROM "Role" owner_role
    WHERE owner_role."serverId" = s."id"
      AND owner_role."name" = 'Owner'
  )
)
INSERT INTO "Role" ("id", "serverId", "name", "permissions", "position", "createdAt")
SELECT (
  substr(md5(legacy_servers."id"::text || ':guilda-owner-role'), 1, 8) || '-' ||
  substr(md5(legacy_servers."id"::text || ':guilda-owner-role'), 9, 4) || '-' ||
  substr(md5(legacy_servers."id"::text || ':guilda-owner-role'), 13, 4) || '-' ||
  substr(md5(legacy_servers."id"::text || ':guilda-owner-role'), 17, 4) || '-' ||
  substr(md5(legacy_servers."id"::text || ':guilda-owner-role'), 21, 12)
)::uuid, legacy_servers."id", 'Owner', 2047, 1, CURRENT_TIMESTAMP
FROM legacy_servers;

INSERT INTO "ServerMemberRole" ("serverId", "userId", "roleId")
SELECT s."id", s."ownerId", owner_role."id"
FROM "Server" s
JOIN "Role" everyone
  ON everyone."serverId" = s."id"
 AND everyone."name" = '@everyone'
 AND everyone."permissions" = 2047
 AND everyone."position" = 0
JOIN "ServerMemberRole" owner_everyone
  ON owner_everyone."serverId" = s."id"
 AND owner_everyone."userId" = s."ownerId"
 AND owner_everyone."roleId" = everyone."id"
JOIN "Role" owner_role
  ON owner_role."serverId" = s."id"
 AND owner_role."name" = 'Owner'
 AND owner_role."permissions" = 2047
 AND owner_role."id" = md5(s."id"::text || ':guilda-owner-role')::uuid
ON CONFLICT ("serverId", "userId", "roleId") DO NOTHING;

UPDATE "Role" everyone
SET "permissions" = 771
FROM "Server" s
JOIN "Role" owner_role
  ON owner_role."serverId" = s."id"
 AND owner_role."name" = 'Owner'
 AND owner_role."permissions" = 2047
 AND owner_role."id" = md5(s."id"::text || ':guilda-owner-role')::uuid
JOIN "ServerMemberRole" owner_assignment
  ON owner_assignment."serverId" = s."id"
 AND owner_assignment."userId" = s."ownerId"
 AND owner_assignment."roleId" = owner_role."id"
WHERE everyone."serverId" = s."id"
  AND everyone."name" = '@everyone'
  AND everyone."permissions" = 2047
  AND everyone."position" = 0;
