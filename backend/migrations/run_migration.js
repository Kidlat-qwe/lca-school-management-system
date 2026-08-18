import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import '../config/loadEnv.js';
import pool from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  const client = await pool.connect();
  
  try {
    // Determine which migration file to run
    const migrationFile = process.argv[2] || 'add_gender_type_to_merchandise.sql';
    
    console.log(`🚀 Starting migration: ${migrationFile}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Read the migration SQL file
    const migrationPath = resolve(__dirname, migrationFile);
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    // Remove comments and split by semicolons
    const cleanedSQL = migrationSQL
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');
    
    // Split by semicolons to execute each statement separately
    const statements = cleanedSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip pure comments
      if (!statement || statement.split('\n').every(line => line.trim().startsWith('--'))) {
        continue;
      }
      
      console.log(`\n[${i + 1}/${statements.length}] Executing statement...`);
      
      try {
        const result = await client.query(statement);
        
        // For SELECT statements, show results
        if (statement.trim().toUpperCase().startsWith('SELECT')) {
          console.log(`✅ Query executed successfully`);
          if (result.rows && result.rows.length > 0) {
            console.log(`📊 Results (${result.rows.length} rows):`);
            console.table(result.rows);
          } else {
            console.log('   No rows returned');
          }
        } else if (statement.trim().toUpperCase().startsWith('UPDATE')) {
          console.log(`✅ Updated ${result.rowCount || 0} rows`);
        } else if (statement.trim().toUpperCase().startsWith('ALTER')) {
          console.log(`✅ Table structure modified successfully`);
        } else {
          console.log(`✅ Statement executed successfully`);
        }
      } catch (error) {
        // Check if error is about column already existing
        if (error.message.includes('already exists')) {
          console.log(`⚠️  Column/constraint already exists (skipping): ${error.message}`);
        } else if (error.message.includes('does not exist') && error.message.includes('remarks')) {
          console.log(`⚠️  Remarks column already dropped (skipping)`);
        } else {
          console.error(`❌ Error executing statement:`, error.message);
          throw error;
        }
      }
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Migration completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
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
