/**
 * Test script for unenrolling a student from a class
 * 
 * Usage: node backend/scripts/testUnenrollStudent.js [classId] [studentId]
 * 
 * This script tests the unenroll functionality by:
 * 1. Fetching all enrollments for a student in a class
 * 2. Displaying the enrollment IDs
 * 3. Optionally unenrolling the student (commented out for safety)
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const query = (text, params) => pool.query(text, params);

async function testUnenrollStudent(classId, studentId) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log(`\n🔍 Testing Unenroll Functionality`);
    console.log(`=====================================`);
    console.log(`Class ID: ${classId}`);
    console.log(`Student ID: ${studentId}\n`);
    
    // 1. Check if class exists
    const classCheck = await client.query(
      'SELECT class_id, class_name, branch_id FROM classestbl WHERE class_id = $1',
      [classId]
    );
    
    if (classCheck.rows.length === 0) {
      console.error('❌ Class not found');
      await client.query('ROLLBACK');
      return;
    }
    
    const classInfo = classCheck.rows[0];
    console.log(`✅ Class found: ${classInfo.class_name} (Branch: ${classInfo.branch_id})\n`);
    
    // 2. Check if student exists
    const studentCheck = await client.query(
      'SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1',
      [studentId]
    );
    
    if (studentCheck.rows.length === 0) {
      console.error('❌ Student not found');
      await client.query('ROLLBACK');
      return;
    }
    
    const studentInfo = studentCheck.rows[0];
    console.log(`✅ Student found: ${studentInfo.full_name} (${studentInfo.email})\n`);
    
    // 3. Fetch all enrollments for this student in this class
    const enrollmentsResult = await client.query(
      `SELECT 
        cs.classstudent_id,
        cs.enrolled_at,
        cs.enrolled_by,
        cs.phase_number,
        COALESCE(cs.enrollment_status, 'Active') as enrollment_status,
        cs.removed_at,
        cs.removed_reason,
        cs.removed_by
       FROM classstudentstbl cs
       WHERE cs.class_id = $1 AND cs.student_id = $2
       ORDER BY cs.phase_number`,
      [classId, studentId]
    );
    
    if (enrollmentsResult.rows.length === 0) {
      console.log('⚠️  No enrollments found for this student in this class');
      await client.query('ROLLBACK');
      return;
    }
    
    console.log(`📋 Found ${enrollmentsResult.rows.length} enrollment(s):\n`);
    enrollmentsResult.rows.forEach((enrollment, index) => {
      console.log(`  ${index + 1}. Enrollment ID: ${enrollment.classstudent_id}`);
      console.log(`     Phase: ${enrollment.phase_number || 'N/A'}`);
      console.log(`     Status: ${enrollment.enrollment_status}`);
      console.log(`     Enrolled At: ${enrollment.enrolled_at || 'N/A'}`);
      console.log(`     Enrolled By: ${enrollment.enrolled_by || 'N/A'}`);
      if (enrollment.removed_at) {
        console.log(`     ⚠️  Already Removed At: ${enrollment.removed_at}`);
        console.log(`     Reason: ${enrollment.removed_reason || 'N/A'}`);
      }
      console.log('');
    });
    
    // 4. Get enrollment IDs that are active (not removed)
    const activeEnrollments = enrollmentsResult.rows.filter(
      e => !e.removed_at && e.enrollment_status === 'Active'
    );
    
    if (activeEnrollments.length === 0) {
      console.log('⚠️  No active enrollments to unenroll (all are already removed)');
      await client.query('ROLLBACK');
      return;
    }
    
    console.log(`\n✅ Active enrollments to unenroll: ${activeEnrollments.length}`);
    console.log(`   Enrollment IDs: ${activeEnrollments.map(e => e.classstudent_id).join(', ')}\n`);
    
    // 5. Test the unenroll logic (simulate - don't actually delete)
    console.log('🧪 Simulating unenroll process...\n');
    
    for (const enrollment of activeEnrollments) {
      console.log(`   Processing Enrollment ID ${enrollment.classstudent_id} (Phase ${enrollment.phase_number})...`);
      
      // Check enrollment exists before deletion
      const checkEnrollment = await client.query(
        'SELECT * FROM classstudentstbl WHERE classstudent_id = $1',
        [enrollment.classstudent_id]
      );
      
      if (checkEnrollment.rows.length === 0) {
        console.log(`   ⚠️  Enrollment ${enrollment.classstudent_id} not found (may have been deleted)`);
        continue;
      }
      
      console.log(`   ✅ Enrollment ${enrollment.classstudent_id} exists`);
      console.log(`   📝 Would delete: classstudent_id = ${enrollment.classstudent_id}`);
      
      // UNCOMMENT THE FOLLOWING LINES TO ACTUALLY UNENROLL:
      // await client.query(
      //   'DELETE FROM classstudentstbl WHERE classstudent_id = $1',
      //   [enrollment.classstudent_id]
      // );
      // console.log(`   ✅ Deleted enrollment ${enrollment.classstudent_id}`);
    }
    
    console.log('\n✅ Test completed successfully!');
    console.log('\n⚠️  NOTE: No actual deletions were performed (simulation only)');
    console.log('   To actually unenroll, uncomment the DELETE query in the script\n');
    
    await client.query('ROLLBACK');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    throw error;
  } finally {
    client.release();
  }
}

// Main execution
const args = process.argv.slice(2);
const classId = args[0] ? parseInt(args[0]) : null;
const studentId = args[1] ? parseInt(args[1]) : null;

if (!classId || !studentId) {
  console.log('Usage: node backend/scripts/testUnenrollStudent.js [classId] [studentId]');
  console.log('\nExample: node backend/scripts/testUnenrollStudent.js 1 123');
  console.log('\nThis script will:');
  console.log('  1. Check if class and student exist');
  console.log('  2. List all enrollments for the student in the class');
  console.log('  3. Simulate the unenroll process (no actual deletion)');
  process.exit(1);
}

testUnenrollStudent(classId, studentId)
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  })
  .finally(() => {
    pool.end();
  });
