import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function findTestEnrollment() {
  try {
    const result = await pool.query(`
      SELECT 
        cs.class_id, 
        cs.student_id, 
        cs.classstudent_id, 
        c.class_name, 
        u.full_name,
        cs.phase_number
      FROM classstudentstbl cs 
      JOIN classestbl c ON cs.class_id = c.class_id 
      JOIN userstbl u ON cs.student_id = u.user_id 
      WHERE cs.removed_at IS NULL 
      LIMIT 5
    `);
    
    if (result.rows.length === 0) {
      console.log('No active enrollments found in database.');
      return null;
    }
    
    console.log('\nFound active enrollments:\n');
    result.rows.forEach((r, i) => {
      console.log(`${i+1}. Class ID: ${r.class_id} (${r.class_name})`);
      console.log(`   Student ID: ${r.student_id} (${r.full_name})`);
      console.log(`   Enrollment ID: ${r.classstudent_id}`);
      console.log(`   Phase: ${r.phase_number || 'N/A'}\n`);
    });
    
    const first = result.rows[0];
    console.log(`\n✅ Using for test: Class ID ${first.class_id}, Student ID ${first.student_id}\n`);
    
    return { classId: first.class_id, studentId: first.student_id };
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  } finally {
    await pool.end();
  }
}

findTestEnrollment();
