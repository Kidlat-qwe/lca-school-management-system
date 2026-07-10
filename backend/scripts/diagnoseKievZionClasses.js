import '../config/loadEnv.js';
import { query } from '../config/database.js';

const r = await query(
  `SELECT class_id, class_name,
    TO_CHAR(start_date,'YYYY-MM-DD') AS start_date,
    TO_CHAR(end_date,'YYYY-MM-DD') AS end_date
   FROM classestbl WHERE class_id IN (110, 120) ORDER BY class_id`
);
console.table(r.rows);
process.exit(0);
