/**
 * Download a lesson plan PDF from GET /lesson-plans/:id/pdf.
 */
import API_BASE_URL from '../../config/api';

/**
 * @param {number|string} lessonPlanId
 * @param {{ topic?: string }=} plan
 * @returns {Promise<void>}
 */
export async function downloadLessonPlanPdf(lessonPlanId, plan = {}) {
  const id = Number(lessonPlanId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid lesson plan id');
  }

  const token = localStorage.getItem('firebase_token');
  const response = await fetch(`${API_BASE_URL}/lesson-plans/${id}/pdf`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    let message = 'Failed to download lesson plan PDF';
    try {
      const err = await response.json();
      if (err?.message) message = err.message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const safeTopic = String(plan.topic || 'lesson-plan')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '') || 'lesson-plan';
  const a = document.createElement('a');
  a.href = url;
  a.download = `lesson-plan-${id}-${safeTopic}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
