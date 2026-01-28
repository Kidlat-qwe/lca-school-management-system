/**
 * Migration Script: Generate Sessions for Existing Classes
 * 
 * This script generates class sessions for all existing classes that have:
 * - start_date
 * - room schedules (roomschedtbl)
 * - curriculum with phases and sessions (through program)
 * 
 * Usage:
 *   node backend/migrations/012_generate_sessions_for_existing_classes.js
 * 
 * IMPORTANT: Backup your database before running this script!
 */

import dotenv from 'dotenv';
import pkg from 'pg';
import { generateClassSessions } from '../utils/sessionCalculation.js';
import { getNationalHolidaySetForYears } from '../utils/holidayService.js';

// Load environment variables
dotenv.config();

const { Pool } = pkg;

// Database connection configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'physical_school_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Main migration function
 */
async function generateSessionsForAllClasses() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting migration: Generate Sessions for Existing Classes');
    console.log('=' .repeat(70));
    
    // Get all active classes with their program and curriculum info
    // Convert start_date to string format (YYYY-MM-DD) for compatibility
    const classesResult = await client.query(
      `SELECT 
        c.class_id,
        TO_CHAR(c.start_date, 'YYYY-MM-DD') as start_date,
        TO_CHAR(c.end_date, 'YYYY-MM-DD') as end_date,
        c.teacher_id,
        c.status,
        p.program_id,
        p.curriculum_id,
        cu.number_of_phase,
        cu.number_of_session_per_phase,
        cu.curriculum_name
       FROM classestbl c
       LEFT JOIN programstbl p ON c.program_id = p.program_id
       LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
       WHERE c.status = 'Active'
       ORDER BY c.class_id`
    );

    const classes = classesResult.rows;
    console.log(`📋 Found ${classes.length} active classes to process\n`);

    if (classes.length === 0) {
      console.log('✅ No classes to process. Migration complete.');
      return;
    }

    let totalSessionsGenerated = 0;
    let totalSessionsSkipped = 0;
    let classesProcessed = 0;
    let classesSkipped = 0;
    let classesWithErrors = 0;

    // Process each class
    for (const classData of classes) {
      const classId = classData.class_id;
      const className = `Class ID: ${classId}`;
      
      console.log(`\n📚 Processing ${className}...`);

      // Check if class has required data
      if (!classData.start_date) {
        console.log(`   ⚠️  Skipped: Missing start_date`);
        classesSkipped++;
        continue;
      }

      if (!classData.number_of_phase || !classData.number_of_session_per_phase) {
        console.log(`   ⚠️  Skipped: Missing curriculum phases/sessions (phases: ${classData.number_of_phase}, sessions per phase: ${classData.number_of_session_per_phase})`);
        classesSkipped++;
        continue;
      }

      if (!classData.curriculum_id) {
        console.log(`   ⚠️  Skipped: No curriculum linked to program`);
        classesSkipped++;
        continue;
      }

      try {
        // Get schedules for this class
        const schedulesResult = await client.query(
          `SELECT day_of_week, start_time, end_time 
           FROM roomschedtbl 
           WHERE class_id = $1 
           ORDER BY day_of_week`,
          [classId]
        );

        if (schedulesResult.rows.length === 0) {
          console.log(`   ⚠️  Skipped: No schedules found for this class`);
          classesSkipped++;
          continue;
        }

        console.log(`   📅 Found ${schedulesResult.rows.length} schedule(s)`);

        // Get phase sessions for this curriculum
        const phaseSessionsResult = await client.query(
          `SELECT phasesessiondetail_id, phase_number, phase_session_number 
           FROM phasesessionstbl 
           WHERE curriculum_id = $1 
           ORDER BY phase_number, phase_session_number`,
          [classData.curriculum_id]
        );

        console.log(`   📖 Found ${phaseSessionsResult.rows.length} phase session(s) in curriculum`);

        // Format days of week for utility function
        const formattedDaysOfWeek = schedulesResult.rows.map(day => ({
          day_of_week: day.day_of_week,
          start_time: day.start_time,
          end_time: day.end_time,
          enabled: true
        }));

        const startYear = Number(String(classData.start_date).slice(0, 4));
        const years = Number.isInteger(startYear) ? [startYear, startYear + 1, startYear + 2, startYear + 3] : [];
        const { dateSet: holidayDateSet } = getNationalHolidaySetForYears(years);

        // Generate sessions using utility function
        const sessions = generateClassSessions(
          {
            class_id: classId,
            teacher_id: classData.teacher_id || null,
            start_date: classData.start_date
          },
          formattedDaysOfWeek,
          phaseSessionsResult.rows,
          classData.number_of_phase,
          classData.number_of_session_per_phase,
          null, // No created_by for migration script
          null, // No session duration here
          holidayDateSet
        );

        console.log(`   🔢 Generated ${sessions.length} session(s)`);

        if (sessions.length === 0) {
          console.log(`   ⚠️  No sessions generated (check session calculation logic)`);
          classesSkipped++;
          continue;
        }

        // Check how many sessions already exist
        const existingSessionsResult = await client.query(
          `SELECT COUNT(*) as count 
           FROM classsessionstbl 
           WHERE class_id = $1`,
          [classId]
        );

        const existingCount = parseInt(existingSessionsResult.rows[0].count);
        console.log(`   📊 ${existingCount} session(s) already exist in database`);

        // Insert sessions (skip duplicates)
        let sessionsCreated = 0;
        let sessionsSkipped = 0;

        await client.query('BEGIN');

        for (const session of sessions) {
          try {
            const insertResult = await client.query(
              `INSERT INTO classsessionstbl (
                class_id, phasesessiondetail_id, phase_number, phase_session_number,
                scheduled_date, scheduled_start_time, scheduled_end_time,
                original_teacher_id, assigned_teacher_id, status, created_by
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (class_id, phase_number, phase_session_number, scheduled_date) DO NOTHING
              RETURNING classsession_id`,
              [
                session.class_id,
                session.phasesessiondetail_id,
                session.phase_number,
                session.phase_session_number,
                session.scheduled_date,
                session.scheduled_start_time,
                session.scheduled_end_time,
                session.original_teacher_id,
                session.assigned_teacher_id,
                session.status,
                session.created_by
              ]
            );

            if (insertResult.rows.length > 0) {
              sessionsCreated++;
            } else {
              sessionsSkipped++;
            }
          } catch (sessionError) {
            console.error(`   ❌ Error inserting session (Phase ${session.phase_number}, Session ${session.phase_session_number}):`, sessionError.message);
            sessionsSkipped++;
          }
        }

        await client.query('COMMIT');

        totalSessionsGenerated += sessionsCreated;
        totalSessionsSkipped += sessionsSkipped;
        classesProcessed++;

        console.log(`   ✅ Completed: Created ${sessionsCreated} session(s), Skipped ${sessionsSkipped} duplicate(s)`);

      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`   ❌ Error processing ${className}:`, error.message);
        console.error(`   Stack:`, error.stack);
        classesWithErrors++;
      }
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(70));
    console.log(`✅ Classes Processed: ${classesProcessed}`);
    console.log(`⚠️  Classes Skipped: ${classesSkipped}`);
    console.log(`❌ Classes With Errors: ${classesWithErrors}`);
    console.log(`📅 Total Sessions Generated: ${totalSessionsGenerated}`);
    console.log(`⏭️  Total Sessions Skipped (duplicates): ${totalSessionsSkipped}`);
    console.log('='.repeat(70));
    console.log('✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
generateSessionsForAllClasses()
  .then(() => {
    console.log('Migration script finished.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });

