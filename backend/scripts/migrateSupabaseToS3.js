/**
 * Migration Script: Supabase Storage to AWS S3
 * 
 * This script migrates existing images from Supabase Storage to AWS S3
 * and updates the database URLs accordingly.
 * 
 * Usage:
 * node scripts/migrateSupabaseToS3.js
 * 
 * Prerequisites:
 * - AWS credentials configured in .env
 * - Supabase credentials configured in .env
 * - Database access configured
 */

import { createClient } from '@supabase/supabase-js';
import { uploadToS3 } from '../utils/s3Upload.js';
import { query, getClient } from '../config/database.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

// Supabase configuration (add to .env temporarily for migration)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service role key (not anon key)

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Download file from Supabase
 */
const downloadFromSupabase = async (bucket, path) => {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    
    if (error) {
      throw error;
    }
    
    // Convert blob to buffer
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    return buffer;
  } catch (error) {
    console.error(`Error downloading from Supabase: ${bucket}/${path}`, error);
    return null;
  }
};

/**
 * Extract file path from Supabase URL
 */
const extractPathFromUrl = (url) => {
  try {
    // Example URL: https://xxx.supabase.co/storage/v1/object/public/merchandise-images/merchandise/...
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    
    // Find bucket and path
    const publicIndex = pathParts.indexOf('public');
    if (publicIndex !== -1 && pathParts.length > publicIndex + 1) {
      // Get everything after 'public'
      return pathParts.slice(publicIndex + 1).join('/');
    }
    
    // Fallback: try to extract from signed URL
    const signedIndex = pathParts.indexOf('sign');
    if (signedIndex !== -1) {
      // Signed URLs have different structure
      // Try to parse from query params
      const searchParams = new URLSearchParams(urlObj.search);
      const token = searchParams.get('token');
      if (token) {
        // Decode token to get path (complex, may need adjustment)
        return null; // Return null to skip signed URLs for now
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing URL:', error);
    return null;
  }
};

/**
 * Migrate merchandise images
 */
const migrateMerchandiseImages = async () => {
  console.log('\n📦 Migrating merchandise images...');
  
  try {
    // Get all merchandise with image URLs
    const result = await query(
      'SELECT merchandise_id, merchandise_name, image_url FROM merchandisestbl WHERE image_url IS NOT NULL'
    );
    
    const merchandiseList = result.rows;
    console.log(`Found ${merchandiseList.length} merchandise items with images`);
    
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    
    for (const merchandise of merchandiseList) {
      try {
        const { merchandise_id, merchandise_name, image_url } = merchandise;
        
        // Check if already migrated to S3
        if (image_url.includes('s3.amazonaws.com') || image_url.includes('amazonaws')) {
          console.log(`⏭️  Skipping ${merchandise_name} (already on S3)`);
          skipCount++;
          continue;
        }
        
        console.log(`\n🔄 Migrating: ${merchandise_name}`);
        console.log(`   Old URL: ${image_url}`);
        
        // Extract path from URL
        const filePath = extractPathFromUrl(image_url);
        
        if (!filePath) {
          console.log(`   ⚠️  Could not extract path from URL, trying direct download...`);
          
          // Try direct download from URL
          const response = await fetch(image_url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const contentType = response.headers.get('content-type') || 'image/jpeg';
          
          // Generate filename for S3
          const sanitizedName = merchandise_name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          const timestamp = Date.now();
          const fileName = `merchandise-images/merchandise/${sanitizedName}_${merchandise_id}_${timestamp}.jpg`;
          
          // Upload to S3
          const uploadResult = await uploadToS3(buffer, fileName, contentType, {
            migratedFrom: 'supabase',
            merchandiseId: merchandise_id.toString(),
          });
          
          // Update database
          await query(
            'UPDATE merchandisestbl SET image_url = $1 WHERE merchandise_id = $2',
            [uploadResult.url, merchandise_id]
          );
          
          console.log(`   ✅ Migrated successfully`);
          console.log(`   New URL: ${uploadResult.url}`);
          successCount++;
          
        } else {
          // Download from Supabase
          const imageBuffer = await downloadFromSupabase('merchandise-images', filePath);
          
          if (!imageBuffer) {
            throw new Error('Failed to download from Supabase');
          }
          
          // Generate filename for S3
          // Path structure: psms/merchandise-images/merchandise/{name}_{id}_{timestamp}.jpg
          const sanitizedName = merchandise_name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          const timestamp = Date.now();
          const fileName = `psms/merchandise-images/merchandise/${sanitizedName}_${merchandise_id}_${timestamp}.jpg`;
          
          // Upload to S3
          const uploadResult = await uploadToS3(imageBuffer, fileName, 'image/jpeg', {
            migratedFrom: 'supabase',
            merchandiseId: merchandise_id.toString(),
          });
          
          // Update database
          await query(
            'UPDATE merchandisestbl SET image_url = $1 WHERE merchandise_id = $2',
            [uploadResult.url, merchandise_id]
          );
          
          console.log(`   ✅ Migrated successfully`);
          console.log(`   New URL: ${uploadResult.url}`);
          successCount++;
        }
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`   ❌ Error migrating ${merchandise.merchandise_name}:`, error.message);
        failCount++;
      }
    }
    
    console.log(`\n📊 Merchandise Images Migration Summary:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   ⏭️  Skipped: ${skipCount}`);
    
  } catch (error) {
    console.error('Error in merchandise migration:', error);
  }
};

/**
 * Migrate user avatars
 */
const migrateUserAvatars = async () => {
  console.log('\n👤 Migrating user avatars...');
  
  try {
    // Get all users with profile pictures
    const result = await query(
      'SELECT user_id, full_name, profile_picture_url FROM userstbl WHERE profile_picture_url IS NOT NULL'
    );
    
    const usersList = result.rows;
    console.log(`Found ${usersList.length} users with profile pictures`);
    
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    
    for (const user of usersList) {
      try {
        const { user_id, full_name, profile_picture_url } = user;
        
        // Check if already migrated to S3
        if (profile_picture_url.includes('s3.amazonaws.com') || profile_picture_url.includes('amazonaws')) {
          console.log(`⏭️  Skipping ${full_name} (already on S3)`);
          skipCount++;
          continue;
        }
        
        console.log(`\n🔄 Migrating: ${full_name}`);
        console.log(`   Old URL: ${profile_picture_url}`);
        
        // Try direct download from URL
        const response = await fetch(profile_picture_url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
          // Generate filename for S3
          // Path structure: psms/user-avatars/{userId}_{timestamp}.jpg
          const timestamp = Date.now();
          const fileName = `psms/user-avatars/${user_id}_${timestamp}.jpg`;
        
        // Upload to S3
        const uploadResult = await uploadToS3(buffer, fileName, contentType, {
          migratedFrom: 'supabase',
          userId: user_id.toString(),
        });
        
        // Update database
        await query(
          'UPDATE userstbl SET profile_picture_url = $1 WHERE user_id = $2',
          [uploadResult.url, user_id]
        );
        
        console.log(`   ✅ Migrated successfully`);
        console.log(`   New URL: ${uploadResult.url}`);
        successCount++;
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`   ❌ Error migrating ${user.full_name}:`, error.message);
        failCount++;
      }
    }
    
    console.log(`\n📊 User Avatars Migration Summary:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   ⏭️  Skipped: ${skipCount}`);
    
  } catch (error) {
    console.error('Error in user avatars migration:', error);
  }
};

/**
 * Main migration function
 */
const main = async () => {
  console.log('🚀 Starting Supabase to S3 Migration...\n');
  console.log('⚠️  WARNING: This will modify your database. Make sure you have a backup!\n');
  
  // Confirm before proceeding
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  try {
    // Migrate merchandise images
    await migrateMerchandiseImages();
    
    // Migrate user avatars
    await migrateUserAvatars();
    
    console.log('\n✅ Migration completed!');
    console.log('\nNext steps:');
    console.log('1. Verify images are accessible at new S3 URLs');
    console.log('2. Update frontend components to use S3 upload components');
    console.log('3. Test new image uploads');
    console.log('4. Once confirmed working, you can delete old images from Supabase');
    console.log('5. Remove Supabase dependencies from package.json');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
};

// Run migration
main();

