import '../config/loadEnv.js';
import { query } from '../config/database.js';
const PHYSICAL = "Lewis Marcus L. Medina|Johan Caeleb Ragos Apasan|Ysabel Heloise R. Ochoa|Daniel Sungcang Hicban|Skyler Dempo|Yanis Roenisio A Mondero|Madeline Jane S. Ison|Caleb Aiden Tumang|Iesha Lynneth C. Ancheta|Kayleigh Beatrix Jao|Aiben Jollop B. Dioco|Dacia Candice L. Saco|Agila C. Metuge Kogeh|Hunter Blair Mendoza|Selah Amelia V. Ercilla|Hiraya Versoza|Queen Hyzelyn Almanza|Sebastian Tyler Lusaya|Xhyra Ellery Albitus|Jett Lucas M. Chan|Joey Selene F. Buhain|Nathalia Jayne S. Bautista|Lucia Trajano|Alexandra Michaela Montales|Lucio Kendrick Ardina|Chloe Skye Agad|Athalia Kalista Pinpin|Athalia Yrella R. Roa|Nia Amaya Selise C. Magongcar|Liam Austin Belmonte Hansen|Rowan Calix D. Natividad|Khalila Ellerie L. Gagalang|Lucia Aurelie V Aranza|Renato Evangelista III|Lorenzo Khalil Ardina|Pablo Zaid L. Lacson|Nathaniel Pierre Gadon|Johnzel Mauru G. De Jesus|Alissandro Monton Susano|Erin Aaliyah Ortega|Romeo Cash Mendoza|Mishka Mari S. Comia|Uriah Seth Beliber|Yara Melisaiah Artugue|Atasha Brielle Gimeno|Caden Luis Niebres|Joe Isaac Maragrag|Tian Yi Wen|Shawn Brian P. Low|Athena Louise Manuel|William Marcus Juance|Benicio Miguel Villar|Talia Rei Remigio|Kirsten Celesse Mahinay|Aadam June Cawili|Jaliyah Callie Almendras|Mariasha Luzia B. Pangilin|Jrue Amari Machado|Jace Lacson|Victoria Taylor S. Bautista|Zion Gabriel Nieves|Samara Kiara P. De Leon|Miguel Sebastian Bohol|Eun Hyeok Jo|Jesse Faith De La Cruz|Hiraya Cabiles|Galateia Luna D. Gomez|Juan Elias Soriano|Julian Altair C. Bautista|Lz Grace Lutrania Perlado|Jaiden Skyler D. Kotico|Zayn Y. Fayyad|Keith Ezequiel Sia|Patrizio Marcus M. Omandam|Lily Isabel Igna|Athena Rae Guinto|Luke Martin Esparrago|Lionel Alexander Louis N. Farman|Marco Sebastian Lopez|Aven Sachiel Anzures|Julia Kalie Tiburan|Yara Gabrielle Jacinto|Kalliope Astrid Loise Jeneza|Amanda Brielle Beltijar|Ava Anaelle Aquino Anoos|Ozaias Tashi F. Perez|Yeshua Rapha U. Carambas|Mico Felixto Cuarteron|Kamilah Formaran|Sire Blaze Angelo Casona|Kezaiah Violet Lopez|Emery Alison Jimenez|Keena Amelia A. Cruz|Psalm-David Awoyemi|Zayan Adriel A. De Luzon|Xion Fritz De Castro|Sandrei Primo Paragas|Cara Mikaela Castro|Margarette Celine P. Endico|Maxyne Elouise O. Argamaso|Chase Arthur Martinez|Chance Avery Martinez|Christian Alonzo Caligner|Paola Anaya L. Andaya|Anayah Chuahu|Azikiel F. Tecson|Jaellie Bautista|Anikka Jon|Meruem Gray P. Añes|Caden Jacob Solis|Hudson David Gabriel Sañez|Jane Miraflor A. Añes|Yumi Celestine Balauro|Matteo Arvian Abenion";
const physicalNames = PHYSICAL.split("|").map(s=>s.trim()).filter(Boolean);
const norm=n=>String(n||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\./g,"").replace(/,/g," ").replace(/\s+/g," ").trim();
const tokens=n=>norm(n).split(" ").filter(Boolean).sort().join(" ");
const namesMatch=(a,b)=>tokens(a)===tokens(b);
const branchRes=await query("SELECT branch_id, branch_name FROM branchestbl WHERE LOWER(branch_name) LIKE $1 ORDER BY branch_id",["%cavite%"]);
const branch=branchRes.rows[0];
const branchId=branch.branch_id;
const activeRes=await query(`SELECT ss.student_id, COALESCE(ss.student_name,u.full_name) AS full_name FROM student_statustbl ss JOIN userstbl u ON u.user_id=ss.student_id WHERE u.branch_id=$1 AND u.user_type='Student' AND ss.status='active' ORDER BY full_name`,[branchId]);
const systemActive=activeRes.rows;
const allStudents=await query(`SELECT u.user_id,u.full_name,u.branch_id,b.branch_name,ss.status FROM userstbl u LEFT JOIN student_statustbl ss ON ss.student_id=u.user_id LEFT JOIN branchestbl b ON b.branch_id=u.branch_id WHERE u.user_type='Student'`);
function findStudent(physicalName){
  const exact=allStudents.rows.filter(s=>namesMatch(s.full_name,physicalName));
  if(exact.length===1) return {student:exact[0],match:"exact"};
  const n=norm(physicalName);
  const partial=allStudents.rows.filter(s=>{const sn=norm(s.full_name); return sn.includes(n)||n.includes(sn);});
  if(partial.length===1) return {student:partial[0],match:"partial"};
  const pt=new Set(norm(physicalName).split(" "));
  let best=null,bestScore=0;
  for(const s of allStudents.rows){
    const st=new Set(norm(s.full_name).split(" "));
    let inter=0; for(const t of pt) if(st.has(t)) inter++;
    const score=inter/new Set([...pt,...st]).size;
    if(score>bestScore){bestScore=score; best=s;}
  }
  if(best&&bestScore>=0.55) return {student:best,match:"fuzzy",score:bestScore};
  return {student:null,match:"none"};
}
const physicalNotActive=[]; const physicalMatchedActive=[];
for(const p of physicalNames){
  const {student,match}=findStudent(p);
  const sysRow=student?systemActive.find(s=>s.student_id===student.user_id):null;
  if(sysRow) physicalMatchedActive.push({physical:p,db:student.full_name,id:student.user_id,match});
  else {
    let reason="not in DB";
    if(student){
      if(Number(student.branch_id)!==Number(branchId)) reason="wrong branch: "+student.branch_name;
      else if(student.status!=="active") reason="inactive ("+(student.status||"none")+")";
      else reason="not active";
    }
    const enr = student ? await query(`SELECT cs.phase_number, cs.program_enrollment_status, TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled_at, c.class_name FROM classstudentstbl cs JOIN classestbl c ON c.class_id=cs.class_id WHERE cs.student_id=$1 AND c.branch_id=$2 AND cs.removed_at IS NULL ORDER BY cs.enrolled_at DESC LIMIT 3`, [student.user_id, branchId]) : {rows:[]};
    physicalNotActive.push({physical:p,reason,db:student?.full_name,id:student?.user_id,match,latest_enrollments:enr.rows});
  }
}
const systemExtra=[];
for(const s of systemActive){
  const onList=physicalNames.some(p=>{ const f=findStudent(p); return f.student?.user_id===s.student_id||namesMatch(p,s.full_name); });
  if(!onList) systemExtra.push({id:s.student_id,name:s.full_name});
}
const dupes=[]; const seen=new Map();
for(const p of physicalNames){ const k=tokens(p); if(seen.has(k)) dupes.push({name:p,first:seen.get(k)}); else seen.set(k,p); }
const inactiveRes=await query(`SELECT COUNT(*)::int AS c FROM student_statustbl ss JOIN userstbl u ON u.user_id=ss.student_id WHERE u.branch_id=$1 AND u.user_type='Student' AND ss.status='inactive'`,[branchId]);
const pendingRes=await query(`SELECT COUNT(DISTINCT cs.student_id)::int AS c FROM classstudentstbl cs JOIN classestbl c ON c.class_id=cs.class_id JOIN userstbl u ON u.user_id=cs.student_id WHERE c.branch_id=$1 AND u.user_type='Student' AND cs.program_enrollment_status='pending_enrollment' AND cs.removed_at IS NULL`,[branchId]);
console.log(JSON.stringify({branch,counts:{physical_list:physicalNames.length,physical_unique:seen.size,system_active:systemActive.length,system_inactive:inactiveRes.rows[0].c,pending_enrollment_cavite:pendingRes.rows[0].c,physical_matched_active:physicalMatchedActive.length,physical_not_active:physicalNotActive.length,system_extra:systemExtra.length,dupes},physical_not_active:physicalNotActive,system_extra:systemExtra},null,2));
