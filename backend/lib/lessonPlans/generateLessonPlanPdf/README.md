# Lesson plan PDF generator

`generateLessonPlanPdfBuffer(plan)` builds a Letter-size PDF (PDFKit) that mirrors the **teacher Create/Edit Lesson Plan form**.

## Layout

1. DepEd letterhead (LCA + DepEd seals, region / division / school, **LESSON PLAN** title)
2. Meta (same order as the form):
   - Lesson Date | Grade Level
   - **Class** (full width — class name)
   - **Class Code** (full width)
   - Phase/Week | Session (**numbers only**)
   - Topic
3. Numbered groups with ruled headings and bordered field boxes:
   - **1. Early Learning Goals**
   - **2. Learning Objectives**
   - **3. Assessment**
   - **4. Materials Needed To Prepare**
   - **5. General Lesson Overview** (Preliminaries, Lesson Proper, Conclusion)
   - **6. Class-Specific Adjustments**
   - **7. Teacher's Reflection**
   - **Head Teacher's Review and Feedback** (when present)

Rich-text HTML is stripped for PDF body text.

Used by `GET /api/sms/lesson-plans/:id/pdf`.
