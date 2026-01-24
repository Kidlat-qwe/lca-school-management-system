/**
 * Generate Class Code
 * Format: {program_code}_{MMDDYY}_{HHMM}{AM/PM}_{ClassName}
 * Example: pk_072225_1000AM_Bees
 */

/**
 * Format time to HHMMAM/PM format
 * @param {string} timeString - Time string in HH:MM:SS or HH:MM format
 * @returns {string} - Formatted time like "1000AM" or "0230PM"
 */
const formatTimeForClassCode = (timeString) => {
  if (!timeString) return '';
  
  // Parse time
  const [hours, minutes] = timeString.split(':').map(Number);
  
  // Determine AM/PM
  const period = hours >= 12 ? 'PM' : 'AM';
  
  // Convert to 12-hour format
  let hour12 = hours % 12;
  if (hour12 === 0) hour12 = 12;
  
  // Format with leading zeros
  const formattedHour = hour12.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  
  return `${formattedHour}${formattedMinutes}${period}`;
};

/**
 * Format date to MMDDYY format
 * @param {string|Date} dateString - Date string or Date object
 * @returns {string} - Formatted date like "072225"
 */
const formatDateForClassCode = (dateString) => {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const year = date.getFullYear().toString().slice(-2);
  
  return `${month}${day}${year}`;
};

/**
 * Sanitize class name for use in class code
 * @param {string} className - Original class name
 * @returns {string} - Sanitized class name (alphanumeric only, spaces removed)
 */
const sanitizeClassName = (className) => {
  if (!className) return '';
  
  // Remove special characters, keep only alphanumeric
  // Replace spaces with empty string
  return className
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '');
};

/**
 * Generate class code
 * @param {string} programCode - Program code (e.g., "pk", "sc", "nc", "kg")
 * @param {string} startDate - Class start date (YYYY-MM-DD format)
 * @param {string} startTime - Class start time (HH:MM:SS or HH:MM format)
 * @param {string} className - Class name
 * @returns {string} - Generated class code (e.g., "pk_072225_1000AM_Bees")
 */
export const generateClassCode = (programCode, startDate, startTime, className) => {
  try {
    // Validate inputs
    if (!programCode || !startDate || !startTime || !className) {
      throw new Error('Missing required parameters for class code generation');
    }
    
    // Format components
    const code = (programCode || '').toLowerCase().trim();
    const formattedDate = formatDateForClassCode(startDate);
    const formattedTime = formatTimeForClassCode(startTime);
    const formattedName = sanitizeClassName(className);
    
    // Construct class code
    const classCode = `${code}_${formattedDate}_${formattedTime}_${formattedName}`;
    
    return classCode;
  } catch (error) {
    console.error('Error generating class code:', error);
    return null;
  }
};

/**
 * Extract start time from days_of_week schedule
 * @param {Array} daysOfWeek - Array of schedule objects with day, start_time, end_time
 * @returns {string|null} - Start time from first enabled day, or null
 */
export const extractStartTimeFromSchedule = (daysOfWeek) => {
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
    return null;
  }
  
  // Find first enabled day with start_time
  const firstDay = daysOfWeek.find(day => 
    day && day.start_time && (day.enabled !== false)
  );
  
  return firstDay?.start_time || null;
};

export default {
  generateClassCode,
  extractStartTimeFromSchedule,
  formatTimeForClassCode,
  formatDateForClassCode,
  sanitizeClassName,
};

