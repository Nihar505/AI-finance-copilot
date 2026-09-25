/**
 * scripts/grant_platform_admin.ts
 *
 * One-off administrative CLI tool to grant platform admin privileges to a user.
 * Platform admin privileges grant authority to approve global statutory TDS rules.
 *
 * Usage:
 *   npx tsx scripts/grant_platform_admin.ts <email_or_user_id>
 */

import { getDb } from '../src/lib/db';

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/grant_platform_admin.ts <email_or_user_id>');
    process.exit(1);
  }

  const db = await getDb();
  const userRes = await db.query(
    `SELECT id, name, email, role, is_platform_admin FROM users WHERE id = $1 OR LOWER(email) = LOWER($1);`,
    [target]
  );

  if (userRes.rows.length === 0) {
    console.error(`Error: User "${target}" not found in database.`);
    process.exit(1);
  }

  const user = userRes.rows[0];
  await db.query(
    `UPDATE users SET is_platform_admin = TRUE WHERE id = $1;`,
    [user.id]
  );

  console.log(`[platform-admin] Successfully granted platform admin privileges to ${user.name} (${user.email}, ID: ${user.id}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[platform-admin] Error granting privileges:', err);
  process.exit(1);
});
