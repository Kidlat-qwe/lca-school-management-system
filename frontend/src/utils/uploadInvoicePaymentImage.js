import API_BASE_URL from '../config/api';

/**
 * Upload a proof-of-payment image to the same endpoint used by Record Payment on invoices.
 * @param {File} file
 * @returns {Promise<string>} Public image URL
 */
export async function uploadInvoicePaymentImage(file) {
  const formData = new FormData();
  formData.append('image', file);
  const token = localStorage.getItem('firebase_token');
  const res = await fetch(`${API_BASE_URL}/upload/invoice-payment-image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.message || 'Upload failed');
  }
  return data.imageUrl || '';
}
