import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
const PHYSICAL = `Lewis Marcus L. Medina|Johan Caeleb Ragos Apasan|Ysabel Heloise R. Ochoa|Daniel Sungcang Hicban|Skyler Dempo|Yanis Roenisio A Mondero|Madeline Jane S. Ison|Caleb Aiden Tumang|Iesha Lynneth C. Ancheta|Kayleigh Beatrix Jao|Aiben Jollop B. Dioco|Dacia Candice L. Saco|Agila C. Metuge Kogeh|Hunter Blair Mendoza|Selah Amelia V. Ercilla|Hiraya Versoza|Queen Hyzelyn Almanza|Sebastian Tyler Lusaya|Xhyra Ellery Albitus|Jett Lucas M. Chan|Joey Selene F. Buhain|Nathalia Jayne S. Bautista|Lucia Trajano|Alexandra Michaela Montales|Lucio Kendrick Ardina|Chloe Skye Agad|Athalia Kalista Pinpin|Athalia Yrella R. Roa|Nia Amaya Selise C. Magongcar|Liam Austin Belmonte Hansen|Rowan Calix D. Natividad|Khalila Ellerie L. Gagalang|Lucia Aurelie V Aranza|Renato Evangelista III|Lorenzo Khalil Ardina|Pablo Zaid L. Lacson|Nathaniel Pierre Gadon|Johnzel Mauru G. De Jesus|Alissandro Monton Susano|Erin Aaliyah Ortega|Romeo Cash Mendoza|Mishka Mari S. Comia|Uriah Seth Beliber|Yara Melisaiah Artugue|Atasha Brielle Gimeno|Caden Luis Niebres|Joe Isaac Maragrag|Tian Yi Wen|Shawn Brian P. Low|Athena Louise Manuel|William Marcus Juance|Benicio Miguel Villar|Talia Rei Remigio|Kirsten Celesse Mahinay|Aadam June Cawili|Jaliyah Callie Almendras|Mariasha Luzia B. Pangilin|Jrue Amari Machado|Jace Lacson|Victoria Taylor S. Bautista|Zion Gabriel Nieves|Samara Kiara P. De Leon|Miguel Sebastian Bohol|Eun Hyeok Jo|Jesse Faith De La Cruz|Hiraya Cabiles|Galateia Luna D. Gomez|Juan Elias Soriano|Julian Altair C. Bautista|Lz Grace Lutrania Perlado|Jaiden Skyler D. Kotico|Zayn Y. Fayyad|Keith Ezequiel Sia|Patrizio Marcus M. Omandam|Lily Isabel Igna|Athena Rae Guinto|Luke Martin Esparrago|Lionel Alexander Louis N. Farman|Marco Sebastian Lopez|Aven Sachiel Anzures|Julia Kalie Tiburan|Yara Gabrielle Jacinto|Kalliope Astrid Loise Jeneza|Amanda Brielle Beltijar|Ava Anaelle Aquino Anoos|Ozaias Tashi F. Perez|Yeshua Rapha U. Carambas|Mico Felixto Cuarteron|Kamilah Formaran|Sire Blaze Angelo Casona|Kezaiah Violet Lopez|Emery Alison Jimenez|Keena Amelia A. Cruz|Psalm-David Awoyemi|Zayan Adriel A. De Luzon|Xion Fritz De Castro|Sandrei Primo Paragas|Cara Mikaela Castro|Margarette Celine P. Endico|Maxyne Elouise O. Argamaso|Chase Arthur Martinez|Chance Avery Martinez|Christian Alonzo Caligner|Paola Anaya L. Andaya|Anayah Chuahu|Azikiel F. Tecson|Jaellie Bautista|Anikka Jon|Meruem Gray P. Añes|Caden Jacob Solis|Hudson David Gabriel Sañez|Jane Miraflor A. Añes|Matteo Arvian Abenion`;
const physical = PHYSICAL.split('|').map((s) => s.trim());
const norm = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (n) => norm(n).split(' ').filter(Boolean).sort().join(' ');
const namesMatch = (a, b) => tokens(a) === tokens(b);
const branchId = 3;
const monthKey = '2026-07';
const DASH_LABELS = new Set(['new', 're-enrolled', 'rejoin', 'completed']);
const all = await query("SELECT u.user_id, u.full_name, ss.status FROM userstbl u LEFT JOIN student_statustbl ss ON ss.student_id = u.user_id WHERE u.user_type = 'Student'");
const matrix = await loadStudentMonthEnrollmentMatrix(query, { branchId, year: 2026 });
function findStudent(physicalName) {
  const exact = all.rows.filter((s) => namesMatch(s.full_name, physicalName));
  if (exact.length === 1) return { student: exact[0], match: 'exact' };
  const pt = new Set(norm(physicalName).split(' '));
  let best = null, bestScore = 0;
  for (const s of all.rows) {
    const st = new Set(norm(s.full_name).split(' '));
    let inter = 0;
    for (const t of pt) if (st.has(t)) inter++;
    const score = inter / new Set([...pt, ...st]).size;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (best && bestScore >= 0.55) return { student: best, match: 'fuzzy', score: bestScore };
  return { student: null, match: 'none' };
}
const notInDashboard100 = [];
for (const p of physical) {
  const { student, match } = findStudent(p);
  if (!student) {
    notInDashboard100.push({ physical: p, reason: 'Not registered in CMS', cms_name: null });
    continue;
  }
  const tracks = (matrix.students || []).filter((s) => s.student_id === student.user_id);
  const julyCells = [];
  for (const t of tracks) {
    const c = t.months?.[monthKey];
    if (c?.label) julyCells.push({ label: c.label, status: c.status, class: t.class_name });
  }
  const in100 = julyCells.some((c) => DASH_LABELS.has(c.label));
  if (!in100) {
    let reason = student.status !== 'active' ? 'Inactive in Student Status (' + (student.status || 'none') + ')' : 'Active but no July dashboard cell';
    if (julyCells.length) reason = 'July matrix only: ' + julyCells.map((x) => x.label).join(', ');
    notInDashboard100.push({ physical: p, reason, cms_name: student.full_name, student_id: student.user_id, match, julyCells });
  }
}
console.log(JSON.stringify({ physical_count: physical.length, not_in_dashboard_100_count: notInDashboard100.length, names: notInDashboard100 }, null, 2));
process.exit(0);
