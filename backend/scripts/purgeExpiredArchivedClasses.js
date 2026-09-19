/**
 * Permanently delete archived classes whose purge date has passed (days left = 0).
 * Usage: node scripts/purgeExpiredArchivedClasses.js
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { purgeExpiredArchivedClasses } from '../utils/classLifecycle/classLifecycleService.js';

const result = await purgeExpiredArchivedClasses(getClient);
console.log(JSON.stringify(result, null, 2));
process.exit(result.errors?.length ? 1 : 0);
