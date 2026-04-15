/**
 * Global app alert (replaces window.alert). Register once via AlertModalProvider.
 * @param {string} message
 * @param {{ title?: string, variant?: 'info' | 'success' | 'error' }} [options]
 */
let showImpl = null;

export function registerAppAlert(fn) {
  showImpl = typeof fn === 'function' ? fn : null;
}

export function appAlert(message, options = {}) {
  if (showImpl) {
    showImpl(String(message), options);
    return;
  }
  console.warn('[appAlert] Modal not ready:', message);
}
