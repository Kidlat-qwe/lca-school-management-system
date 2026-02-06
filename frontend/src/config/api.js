// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/sms';

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
    const contentType = response.headers.get('content-type');
    const isJson = contentType && contentType.includes('application/json');

    let data;
    if (isJson) {
      data = await response.json();
    } else {
      const text = await response.text();
      // 502/503/504: backend unreachable (proxy error page is often HTML)
      if (response.status >= 502 && response.status <= 504) {
        const error = new Error('Server unavailable. Please try again later.');
        error.response = { status: response.status };
        throw error;
      }
      const error = new Error(text || 'An error occurred');
      error.response = { status: response.status };
      throw error;
    }

    if (!response.ok) {
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
