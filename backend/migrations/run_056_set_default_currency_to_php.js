import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import pool from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Migration: Set default currency to PHP for all branches
 * 
 * This migration:
 * 1. Updates all existing branches with NULL currency to 'PHP'
 * 2. Sets the default value for the currency column to 'PHP'
 * 
 * Run with: node backend/migrations/run_056_set_default_currency_to_php.js
 */
async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting migration: 056_set_default_currency_to_php.sql');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Migration Purpose:');
    console.log('   1. Update all existing branches with NULL currency to "PHP"');
    console.log('   2. Set the default value for the currency column to "PHP"');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Check current state before migration
    console.log('📊 Checking current state...');
    const beforeCheck = await client.query(`
      SELECT 
        COUNT(*) as total_branches,
        COUNT(currency) as branches_with_currency,
        COUNT(*) FILTER (WHERE currency IS NULL) as branches_with_null_currency,
        COUNT(*) FILTER (WHERE currency = 'PHP') as branches_with_php
      FROM branchestbl
    `);
    
    const beforeStats = beforeCheck.rows[0];
    console.log(`   Total branches: ${beforeStats.total_branches}`);
    console.log(`   Branches with currency set: ${beforeStats.branches_with_currency}`);
    console.log(`   Branches with NULL currency: ${beforeStats.branches_with_null_currency}`);
    console.log(`   Branches with PHP currency: ${beforeStats.branches_with_php}\n`);
    
    // Read the migration SQL file
    const migrationPath = resolve(__dirname, '056_set_default_currency_to_php.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    console.log('🔄 Executing migration...\n');
    
    // Execute the migration within a transaction
    await client.query('BEGIN');
    
    try {
      // Execute the entire migration SQL
      await client.query(migrationSQL);
      
      // Verify the migration
      console.log('\n✅ Migration executed successfully');
      console.log('📊 Verifying changes...\n');
      
      const afterCheck = await client.query(`
        SELECT 
          COUNT(*) as total_branches,
          COUNT(currency) as branches_with_currency,
          COUNT(*) FILTER (WHERE currency IS NULL) as branches_with_null_currency,
          COUNT(*) FILTER (WHERE currency = 'PHP') as branches_with_php
        FROM branchestbl
      `);
      
      const afterStats = afterCheck.rows[0];
      console.log(`   Total branches: ${afterStats.total_branches}`);
      console.log(`   Branches with currency set: ${afterStats.branches_with_currency}`);
      console.log(`   Branches with NULL currency: ${afterStats.branches_with_null_currency}`);
      console.log(`   Branches with PHP currency: ${afterStats.branches_with_php}`);
      
      // Check default value
      const defaultCheck = await client.query(`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_name = 'branchestbl' AND column_name = 'currency'
      `);
      
      if (defaultCheck.rows.length > 0) {
        const defaultValue = defaultCheck.rows[0].column_default;
        console.log(`\n   Default value for currency column: ${defaultValue || 'NULL'}`);
        
        if (defaultValue && defaultValue.includes("'PHP'")) {
          console.log('   ✅ Default value set to PHP successfully');
        } else {
          console.log('   ⚠️  Default value may not be set correctly');
        }
      }
      
      // Commit the transaction
      await client.query('COMMIT');
      
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🎉 Migration completed successfully!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      // Summary
      const updatedCount = parseInt(beforeStats.branches_with_null_currency) || 0;
      if (updatedCount > 0) {
        console.log(`📝 Summary:`);
        console.log(`   • Updated ${updatedCount} branch(es) from NULL to PHP`);
        console.log(`   • Set default currency to PHP for future branches\n`);
      } else {
        console.log(`📝 Summary:`);
        console.log(`   • No branches needed updating (all already had currency set)`);
        console.log(`   • Set default currency to PHP for future branches\n`);
      }
      
    } catch (error) {
      // Rollback on error
      await client.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
runMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
