/**
 * Generate an LCA lesson plan PDF (PDFKit).
 * Layout mirrors the teacher Create/Edit Lesson Plan form.
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatLongDateDisplay } from '../../../utils/dateUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHOOL_NAME = 'LITTLE CHAMPIONS ACADEMY INC.';

/** Strip HTML from rich-text lesson plan fields for PDF text. */
export function stripLessonPlanHtml(value) {
  const raw = String(value || '');
  if (!raw.trim()) return '';
  return raw
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveLogoPath(fileName) {
  const candidates = [
    path.resolve(__dirname, '../../../../frontend/public', fileName),
    path.resolve(__dirname, '../../../frontend/public', fileName),
    path.resolve(process.cwd(), 'frontend/public', fileName),
    path.resolve(process.cwd(), '../frontend/public', fileName),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function isWeekPhase(phase) {
  return /^Week\s*\d+/i.test(String(phase || '').trim());
}

/** Display number only (form dropdown style): "Phase 1" → "1", "Session 3 — topic" → "3". */
function displayNumberOnly(value, { week = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  if (week) {
    const w = raw.match(/Week\s*(\d+)/i);
    if (w) return w[1];
  }
  const session = raw.match(/Session\s*(\d+)/i);
  if (session) return session[1];
  const phase = raw.match(/Phase\s*(\d+)/i);
  if (phase) return phase[1];
  const bare = raw.match(/^(\d+)/);
  return bare ? bare[1] : raw;
}

function resolveObjectiveText(plan) {
  const o1 = String(plan.objective_1 || '').trim();
  const o2 = String(plan.objective_2 || '').trim();
  const o3 = String(plan.objective_3 || '').trim();
  if (!o2 && !o3) return o1;
  return [o1, o2, o3].filter(Boolean).join('\n\n');
}

function resolveClassCode(plan) {
  return plan.class_code || plan.class_label || plan.subject || '';
}

function resolveClassName(plan) {
  return plan.class_name || plan.class1_name || '';
}

function ensureSpace(doc, needed = 72, margin = 50) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
    doc.x = margin;
    doc.y = doc.page.margins.top;
  }
}

function drawRule(doc, margin) {
  ensureSpace(doc, 16, margin);
  const y = doc.y + 4;
  doc
    .moveTo(margin, y)
    .lineTo(doc.page.width - margin, y)
    .lineWidth(1.5)
    .strokeColor('#111111')
    .stroke();
  doc.y = y + 10;
}

function drawGroupHeading(doc, title, margin) {
  drawRule(doc, margin);
  ensureSpace(doc, 28, margin);
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#111111')
    .text(title, margin, doc.y, { width: doc.page.width - margin * 2 });
  doc.moveDown(0.35);
}

function drawFieldBlock(doc, title, body, { margin = 50 } = {}) {
  const contentWidth = doc.page.width - margin * 2;
  const text = stripLessonPlanHtml(body) || '—';

  ensureSpace(doc, 56, margin);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111111')
    .text(title, margin, doc.y, { width: contentWidth });
  doc.moveDown(0.2);

  const padX = 10;
  const padY = 8;
  const textWidth = contentWidth - padX * 2;

  doc.font('Helvetica').fontSize(10).fillColor('#111111');
  const textHeight = doc.heightOfString(text, { width: textWidth, align: 'left' });
  const boxHeight = Math.max(36, textHeight + padY * 2);

  ensureSpace(doc, boxHeight + 8, margin);
  const y = doc.y;

  doc
    .roundedRect(margin, y, contentWidth, boxHeight, 4)
    .lineWidth(0.8)
    .strokeColor('#e5e5e5')
    .fillColor('#ffffff')
    .fillAndStroke();

  doc
    .fillColor('#111111')
    .font('Helvetica')
    .fontSize(10)
    .text(text, margin + padX, y + padY, {
      width: textWidth,
      align: 'left',
    });

  doc.y = Math.max(doc.y, y + boxHeight) + 8;
  doc.x = margin;
}

/** Form-style field row: label then value (full width). */
function drawFormRow(doc, label, value, margin) {
  const contentWidth = doc.page.width - margin * 2;
  ensureSpace(doc, 22, margin);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
  doc.text(`${label} `, margin, y, { continued: true, width: contentWidth });
  doc.font('Helvetica').fontSize(10).text(String(value || '—'), { width: contentWidth });
  doc.moveDown(0.15);
  doc.x = margin;
}

function drawMetaPair(doc, left, right, margin) {
  const gap = 24;
  const colW = (doc.page.width - margin * 2 - gap) / 2;
  ensureSpace(doc, 20, margin);
  const y = doc.y;

  const drawOne = (item, x) => {
    if (!item) return;
    const [label, value] = item;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
    doc.text(`${label} `, x, y, {
      width: colW,
      continued: true,
      lineBreak: false,
    });
    doc.font('Helvetica').fontSize(10).fillColor('#111111').text(String(value || '—'), {
      width: colW,
      continued: false,
    });
  };

  drawOne(left, margin);
  const afterLeftY = doc.y;
  doc.y = y;
  drawOne(right, margin + colW + gap);
  doc.y = Math.max(afterLeftY, doc.y) + 4;
  doc.x = margin;
}

/**
 * @param {object} plan - mapped lesson plan row (API shape)
 * @returns {Promise<Buffer>}
 */
export function generateLessonPlanPdfBuffer(plan = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 40, bottom: 48, left: 48, right: 48 },
        info: {
          Title: `Lesson Plan — ${plan.topic || plan.lesson_plan_id || ''}`,
          Author: plan.teacher_name || 'Little Champions Academy',
        },
      });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const margin = 48;
      const pageWidth = doc.page.width;
      const contentWidth = pageWidth - margin * 2;

      const lcaLogo = resolveLogoPath('LCA-Icon.png');
      const depedSeal = resolveLogoPath('deped-seal.png');
      const logoSize = 72;
      const topY = 36;

      if (lcaLogo) {
        try {
          doc.image(lcaLogo, margin, topY, { width: logoSize, height: logoSize });
        } catch {
          /* optional branding */
        }
      }
      if (depedSeal) {
        try {
          doc.image(depedSeal, pageWidth - margin - logoSize, topY, {
            width: logoSize,
            height: logoSize,
          });
        } catch {
          /* optional branding */
        }
      }

      const region = String(plan.region || plan.deped_region || 'Region III').trim();
      const division = String(plan.division || plan.deped_division || 'Bulacan').trim();
      const letterheadRegion = /^region/i.test(region)
        ? region.toUpperCase()
        : `REGION ${region.toUpperCase()}`;
      const letterheadDivision = division
        ? /^schools division/i.test(division)
          ? String(division)
              .toUpperCase()
              .replace(/\bOFFICE\s+/g, '')
              .replace(/\s{2,}/g, ' ')
              .trim()
          : `SCHOOLS DIVISION OF ${division.toUpperCase()}`
        : 'SCHOOLS DIVISION OF BULACAN';

      doc.font('Times-Bold').fontSize(11).fillColor('#111111');
      doc.text('Republika ng Pilipinas', margin, topY + 6, {
        width: contentWidth,
        align: 'center',
      });
      doc.fontSize(14).text('Department of Education', { align: 'center' });
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text(letterheadRegion, { align: 'center' });
      doc.text(letterheadDivision, { align: 'center' });
      doc.text(SCHOOL_NAME, { align: 'center' });

      doc.moveDown(1.1);
      doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .text('LESSON PLAN', { align: 'center', underline: true });
      doc.moveDown(0.5);

      drawRule(doc, margin);

      const lessonDateLabel = plan.lesson_date
        ? formatLongDateDisplay(plan.lesson_date) || String(plan.lesson_date).slice(0, 10)
        : '—';
      const className = resolveClassName(plan) || '—';
      const classCode = resolveClassCode(plan) || '—';
      const weekMode = isWeekPhase(plan.phase);
      const phaseOrWeekLabel = weekMode ? 'Week' : 'Phase';
      const phaseOrWeekValue = displayNumberOnly(plan.phase, { week: weekMode });
      const sessionValue = displayNumberOnly(plan.session);

      // Match Create/Edit form field order
      drawMetaPair(
        doc,
        ['Lesson Date', lessonDateLabel],
        ['Grade Level', plan.grade_level || '—'],
        margin
      );
      drawFormRow(doc, 'Class', className, margin);
      drawFormRow(doc, 'Class Code', classCode, margin);
      drawMetaPair(
        doc,
        [phaseOrWeekLabel, phaseOrWeekValue],
        ['Session', sessionValue],
        margin
      );
      drawFormRow(doc, 'Topic', plan.topic || '—', margin);
      doc.moveDown(0.2);

      drawGroupHeading(doc, '1. Early Learning Goals', margin);
      drawFieldBlock(doc, 'Early Learning Goals', plan.early_learning_goals, { margin });

      drawGroupHeading(doc, '2. Learning Objectives', margin);
      drawFieldBlock(doc, 'Learning Objectives', resolveObjectiveText(plan), { margin });

      drawGroupHeading(doc, '3. Assessment', margin);
      drawFieldBlock(doc, 'Assessment Method', plan.assessment_method, { margin });
      drawFieldBlock(doc, 'Assessment Criteria', plan.assessment_criteria, { margin });

      drawGroupHeading(doc, '4. Materials Needed To Prepare', margin);
      drawFieldBlock(doc, 'Materials Needed', plan.materials_needed, { margin });

      drawGroupHeading(doc, '5. General Lesson Overview', margin);
      drawFieldBlock(doc, 'Preliminaries', plan.preliminaries_activity, { margin });
      drawFieldBlock(doc, 'Lesson Proper', plan.lesson_proper_activity, { margin });
      drawFieldBlock(doc, 'Conclusion', plan.conclusion_activity, { margin });

      drawGroupHeading(doc, '6. Class-Specific Adjustments', margin);
      drawFieldBlock(doc, 'Considerations', plan.class1_considerations, { margin });
      drawFieldBlock(doc, 'Adjustments', plan.class1_adjustments, { margin });

      drawGroupHeading(doc, "7. Teacher's Reflection", margin);
      drawFieldBlock(doc, 'Successes', plan.reflection_went_well, { margin });
      drawFieldBlock(doc, 'Amazing Moments', plan.reflection_amazing_moments, { margin });
      drawFieldBlock(doc, 'Challenges', plan.reflection_challenges, { margin });
      drawFieldBlock(doc, 'Improvements', plan.reflection_improvements, { margin });

      const hasHeadTeacher =
        stripLessonPlanHtml(plan.head_teacher_overall_assessment) ||
        stripLessonPlanHtml(plan.head_teacher_specific_feedback) ||
        stripLessonPlanHtml(plan.head_teacher_next_steps);

      if (hasHeadTeacher) {
        drawGroupHeading(doc, "Head Teacher's Review and Feedback", margin);
        drawFieldBlock(doc, 'Overall Assessment', plan.head_teacher_overall_assessment, {
          margin,
        });
        drawFieldBlock(doc, 'Specific Feedback', plan.head_teacher_specific_feedback, {
          margin,
        });
        drawFieldBlock(doc, 'Next Steps', plan.head_teacher_next_steps, { margin });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
