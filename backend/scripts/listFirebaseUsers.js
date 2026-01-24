import admin from '../config/firebase.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Get the directory of this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from backend directory
dotenv.config({ path: resolve(__dirname, '../.env') });

/**
 * Script to list all users in Firebase Authentication
 * 
 * Usage: node scripts/listFirebaseUsers.js [options]
 * 
 * Options:
 *   --limit <number>    Maximum number of users to retrieve (default: 1000)
 *   --format <json|table>  Output format (default: table)
 *   --email <email>     Filter by email (partial match)
 *   --uid <uid>         Get specific user by UID
 */

const DEFAULT_LIMIT = 1000;
const MAX_USERS_PER_PAGE = 1000; // Firebase Admin SDK limit

async function listAllUsers(options = {}) {
  const {
    limit = DEFAULT_LIMIT,
    format = 'table',
    emailFilter = null,
    uid = null,
  } = options;

  try {
    const auth = admin.auth();

    // If UID is provided, get specific user
    if (uid) {
      try {
        const userRecord = await auth.getUser(uid);
        const users = [userRecord];
        displayUsers(users, format);
        console.log(`\n✅ Found 1 user with UID: ${uid}`);
        return;
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          console.error(`❌ User with UID "${uid}" not found`);
          return;
        }
        throw error;
      }
    }

    // List all users with pagination
    let allUsers = [];
    let nextPageToken;
    let totalRetrieved = 0;

    console.log('🔍 Fetching users from Firebase Authentication...\n');

    do {
      const listUsersResult = await auth.listUsers(
        Math.min(MAX_USERS_PER_PAGE, limit - totalRetrieved),
        nextPageToken
      );

      allUsers = allUsers.concat(listUsersResult.users);
      nextPageToken = listUsersResult.pageToken;
      totalRetrieved = allUsers.length;

      console.log(`📊 Retrieved ${totalRetrieved} users...`);

      if (totalRetrieved >= limit) {
        break;
      }
    } while (nextPageToken);

    // Apply email filter if provided
    if (emailFilter) {
      const filterLower = emailFilter.toLowerCase();
      allUsers = allUsers.filter(user => 
        user.email && user.email.toLowerCase().includes(filterLower)
      );
      console.log(`\n🔎 Filtered to ${allUsers.length} users matching email: "${emailFilter}"`);
    }

    // Display users
    displayUsers(allUsers, format);

    // Summary
    console.log(`\n✅ Total users found: ${allUsers.length}`);
    if (totalRetrieved >= limit) {
      console.log(`⚠️  Limited to ${limit} users. There may be more users in Firebase.`);
    }

  } catch (error) {
    console.error('❌ Error listing users:', error.message);
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }

    // Check for permission errors
    if (error.code === 'permission-denied' || 
        error.message?.includes('PERMISSION_DENIED') ||
        error.message?.includes('does not have required permission')) {
      console.error('\n🔒 PERMISSION ERROR DETECTED');
      console.error('='.repeat(80));
      console.error('\nThe Firebase service account does not have the required permissions.');
      console.error('\nTo fix this, you need to grant the service account the necessary roles:');
      console.error('\n1. Go to Google Cloud Console IAM:');
      console.error('   https://console.cloud.google.com/iam-admin/iam?project=psms-b9ca7');
      console.error('\n2. Find the service account:');
      console.error('   firebase-adminsdk-fbsvc@psms-b9ca7.iam.gserviceaccount.com');
      console.error('\n3. Click "Edit" (pencil icon) and add the following roles:');
      console.error('   - Firebase Admin SDK Administrator Service Agent');
      console.error('   - Service Usage Consumer (roles/serviceusage.serviceUsageConsumer)');
      console.error('\n   OR');
      console.error('\n   - Firebase Admin SDK Administrator Service Agent (recommended)');
      console.error('     This role includes all necessary permissions for Firebase Admin operations.');
      console.error('\n4. Save the changes and wait a few minutes for propagation.');
      console.error('\nAlternative: Enable Firebase Authentication API');
      console.error('   Go to: https://console.cloud.google.com/apis/library/identitytoolkit.googleapis.com?project=psms-b9ca7');
      console.error('   Click "Enable" if not already enabled.');
      console.error('\n' + '='.repeat(80));
    }

    process.exit(1);
  }
}

function displayUsers(users, format) {
  if (users.length === 0) {
    console.log('📭 No users found.');
    return;
  }

  if (format === 'json') {
    // JSON format
    const usersData = users.map(user => ({
      uid: user.uid,
      email: user.email || 'N/A',
      emailVerified: user.emailVerified || false,
      displayName: user.displayName || 'N/A',
      phoneNumber: user.phoneNumber || 'N/A',
      disabled: user.disabled || false,
      metadata: {
        creationTime: user.metadata.creationTime,
        lastSignInTime: user.metadata.lastSignInTime || 'Never',
        lastRefreshTime: user.metadata.lastRefreshTime || 'N/A',
      },
      providerData: user.providerData.map(provider => ({
        providerId: provider.providerId,
        uid: provider.uid,
        email: provider.email || 'N/A',
        displayName: provider.displayName || 'N/A',
      })),
      customClaims: user.customClaims || {},
    }));

    console.log(JSON.stringify(usersData, null, 2));
  } else {
    // Table format
    console.log('\n' + '='.repeat(120));
    console.log('FIREBASE AUTHENTICATION USERS');
    console.log('='.repeat(120) + '\n');

    users.forEach((user, index) => {
      console.log(`\n[${index + 1}] User Details:`);
      console.log(`  UID:              ${user.uid}`);
      console.log(`  Email:            ${user.email || 'N/A'}`);
      console.log(`  Email Verified:   ${user.emailVerified ? '✅ Yes' : '❌ No'}`);
      console.log(`  Display Name:     ${user.displayName || 'N/A'}`);
      console.log(`  Phone Number:     ${user.phoneNumber || 'N/A'}`);
      console.log(`  Disabled:         ${user.disabled ? '⚠️  Yes' : '✅ No'}`);
      console.log(`  Created:          ${user.metadata.creationTime}`);
      console.log(`  Last Sign In:     ${user.metadata.lastSignInTime || 'Never'}`);
      
      if (user.providerData && user.providerData.length > 0) {
        console.log(`  Providers:        ${user.providerData.map(p => p.providerId).join(', ')}`);
      }

      if (user.customClaims && Object.keys(user.customClaims).length > 0) {
        console.log(`  Custom Claims:    ${JSON.stringify(user.customClaims)}`);
      }

      console.log('-'.repeat(120));
    });
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--format' && args[i + 1]) {
      options.format = args[i + 1];
      if (!['json', 'table'].includes(options.format)) {
        console.error('❌ Invalid format. Use "json" or "table"');
        process.exit(1);
      }
      i++;
    } else if (arg === '--email' && args[i + 1]) {
      options.emailFilter = args[i + 1];
      i++;
    } else if (arg === '--uid' && args[i + 1]) {
      options.uid = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Firebase Users Listing Script

Usage: node scripts/listFirebaseUsers.js [options]

Options:
  --limit <number>       Maximum number of users to retrieve (default: 1000)
  --format <json|table>  Output format (default: table)
  --email <email>        Filter by email (partial match, case-insensitive)
  --uid <uid>            Get specific user by UID
  --help, -h             Show this help message

Examples:
  node scripts/listFirebaseUsers.js
  node scripts/listFirebaseUsers.js --limit 500
  node scripts/listFirebaseUsers.js --format json
  node scripts/listFirebaseUsers.js --email "@gmail.com"
  node scripts/listFirebaseUsers.js --uid "abc123xyz"
      `);
      process.exit(0);
    }
  }

  return options;
}

// Main execution
const options = parseArgs();
listAllUsers(options).then(() => {
  console.log('\n✅ Script completed successfully');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Script failed:', error);
  process.exit(1);
});

