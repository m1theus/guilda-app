-- Screen sharing is a normal member capability, not an administrative permission.
-- Upgrade only the exact previously shipped default mask (771) to include STREAM (1024).
UPDATE "Role"
SET "permissions" = 1795
WHERE "name" = '@everyone'
  AND "position" = 0
  AND "permissions" = 771;
