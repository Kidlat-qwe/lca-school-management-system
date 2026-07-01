import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const client = await getClient();
try {
  await client.query('BEGIN');
  await client.query(
    `UPDATE classstudentstbl
     SET program_enrollment_status = 're_enrolled'
     WHERE classstudent_id = 395`
  );
  await client.query('COMMIT');
  console.log('Updated Bronny James (classstudent_id 395) to re_enrolled');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
process.exit(0);
