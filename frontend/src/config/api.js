// API Configuration
// When deployed (not localhost), always use production API so login/auth works even if build had wrong env
const isLocalhost = typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location?.origin || '');
const API_BASE_URL = isLocalhost
  ? 'http://localhost:3000/api/sms'
  : 'https://cms.little-champion.com/api/sms';

export default API_BASE_URL;

/**
 * Make an API request with authentication
 */
export const apiRequest = async (endpoint, options = {}) => {
  const token = localStorage.getItem('firebase_token');
  
  const defaultHeaders = {};

  // Only set Content-Type for JSON (not for FormData)
  if (options.body && !(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  // Stringify body if it's a plain object (not FormData, Blob, or already a string)
  if (config.body && 
      typeof config.body === 'object' && 
      !(config.body instanceof FormData) && 
      !(config.body instanceof Blob) &&
      config.body.constructor === Object &&
      ['POST', 'PUT', 'PATCH'].includes(config.method?.toUpperCase() || '')) {
    config.body = JSON.stringify(config.body);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
    const data = await response.json();

    if (!response.ok) {
      // Create an error object that preserves the response data
      const error = new Error(data.message || 'An error occurred');
      error.response = { data, status: response.status };
      throw error;
    }

    return data;
  } catch (error) {
    console.error('API Request Error:', error);
    throw error;
  }
};
