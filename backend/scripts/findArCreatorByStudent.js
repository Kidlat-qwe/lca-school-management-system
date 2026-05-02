import '../config/loadEnv.js';

const NAME_ARG = process.argv.find((a) => a.startsWith('--name=')) || '';
const STUDENT_NAME = NAME_ARG ? NAME_ARG.slice('--name='.length).trim() : 'William Marcus Juance';
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit=')) || '';
const LIMIT = LIMIT_ARG ? Math.max(1, parseInt(LIMIT_ARG.slice('--limit='.length), 10) || 50) : 50;

function printUsage() {
  console.log('Find the creator of Acknowledgement Receipt(s) for a student name.');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/findArCreatorByStudent.js --name="William Marcus Juance" [--limit=50]');
  console.log('');
  console.log('Notes:');
  console.log('  - Matches ARs by `prospect_student_name` OR linked `student_id` -> `userstbl.full_name`.');
  console.log('  - Creator is `acknowledgement_receiptstbl.created_by` -> `userstbl`.');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

async function main() {
  const { getClient } = await import('../config/database.js');
  const client = await getClient();

  try {
    const q = `
      SELECT
        ar.ack_receipt_id,
        ar.ack_receipt_number,
        ar.status,
        ar.ar_type,
        ar.issue_date,
        ar.payment_method,
        ar.reference_number,
        ar.prospect_student_name,
        ar.prospect_student_email,
        linked_student.user_id AS linked_student_id,
        linked_student.full_name AS linked_student_name,
        COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
        creator.user_id AS creator_user_id,
        creator.full_name AS creator_full_name,
        creator.email AS creator_email,
        creator.user_type AS creator_user_type,
        verifier.user_id AS verified_by_user_id,
        verifier.full_name AS verified_by_full_name,
        verifier.email AS verified_by_email,
        ar.verified_at
      FROM acknowledgement_receiptstbl ar
      LEFT JOIN userstbl linked_student ON ar.student_id = linked_student.user_id
      LEFT JOIN branchestbl b ON ar.branch_id = b.branch_id
      LEFT JOIN userstbl creator ON ar.created_by = creator.user_id
      LEFT JOIN userstbl verifier ON ar.verified_by_user_id = verifier.user_id
      WHERE
        (ar.prospect_student_name ILIKE $1)
        OR (linked_student.full_name ILIKE $1)
      ORDER BY ar.ack_receipt_id DESC
      LIMIT $2
    `;

    const like = `%${STUDENT_NAME}%`;
    const result = await client.query(q, [like, LIMIT]);

    console.log('');
    console.log(`Search: ${STUDENT_NAME}`);
    console.log(`Matched AR rows: ${result.rowCount || 0}`);
    console.log('');

    if (!result.rows.length) return;

    for (const row of result.rows) {
      const studentLabel =
        row.linked_student_id != null
          ? `${row.linked_student_name || 'Student'} (user_id=${row.linked_student_id})`
          : `${row.prospect_student_name || 'Student'} (unlinked)`;

      const creatorLabel =
        row.creator_user_id != null
          ? `${row.creator_full_name || row.creator_email || 'Unknown'} (user_id=${row.creator_user_id}${
              row.creator_user_type ? `, type=${row.creator_user_type}` : ''
            })`
          : 'NULL (created_by is null)';

      const verifierLabel =
        row.verified_by_user_id != null
          ? `${row.verified_by_full_name || row.verified_by_email || 'Unknown'} (user_id=${row.verified_by_user_id})`
          : 'NULL';

      console.log(`AR #${row.ack_receipt_id}  ${row.ack_receipt_number || ''}`.trim());
      console.log(`  Student: ${studentLabel}`);
      console.log(`  Branch: ${row.branch_name || 'N/A'}`);
      console.log(
        `  Type/Status: ${row.ar_type || 'N/A'} / ${row.status || 'N/A'} | Issue: ${row.issue_date || 'N/A'} | Method: ${
          row.payment_method || 'N/A'
        }`
      );
      console.log(`  Reference: ${row.reference_number || 'N/A'}`);
      console.log(`  Creator: ${creatorLabel}`);
      console.log(`  Verified by: ${verifierLabel}${row.verified_at ? ` at ${row.verified_at}` : ''}`);
      console.log('');
    }
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Failed to find AR creator:', err?.message || err);
  process.exit(1);
});

