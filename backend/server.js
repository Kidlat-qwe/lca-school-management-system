import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Import routes
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import branchesRoutes from './routes/branches.js';
import classesRoutes from './routes/classes.js';
import studentsRoutes from './routes/students.js';
import programsRoutes from './routes/programs.js';
import roomsRoutes from './routes/rooms.js';
import curriculumRoutes from './routes/curriculum.js';
import packagesRoutes from './routes/packages.js';
import pricinglistsRoutes from './routes/pricinglists.js';
import merchandiseRoutes from './routes/merchandise.js';
import merchandiseRequestsRoutes from './routes/merchandiserequests.js';
import invoicesRoutes from './routes/invoices.js';
import installmentInvoicesRoutes from './routes/installmentinvoices.js';
import guardiansRoutes from './routes/guardians.js';
import phasesessionsRoutes from './routes/phasesessions.js';
import paymentsRoutes from './routes/payments.js';
import reservationsRoutes from './routes/reservations.js';
import dashboardRoutes from './routes/dashboard.js';
import calendarRoutes from './routes/calendar.js';
import promosRoutes from './routes/promos.js';
import referralsRoutes from './routes/referrals.js';
import attendanceRoutes from './routes/attendance.js';
import announcementsRoutes from './routes/announcements.js';
import suspensionsRoutes from './routes/suspensions.js';
import uploadRoutes from './routes/upload.js';
import holidaysRoutes from './routes/holidays.js';
import settingsRoutes from './routes/settings.js';

// Import middleware
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Import configs (this will initialize database and Firebase connections)
import './config/database.js';
import './config/firebase.js';

// Import scheduled jobs
import { startInstallmentInvoiceScheduler } from './jobs/installmentInvoiceScheduler.js';
import { startInstallmentDelinquencyScheduler } from './jobs/installmentDelinquencyScheduler.js';
import { startOverdueInvoiceEmailScheduler } from './jobs/overdueInvoiceEmailScheduler.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Production (Linode): use .env on server. Development: use .env.development locally.
const envFile = process.env.NODE_ENV === 'production'
  ? resolve(__dirname, '.env')
  : resolve(__dirname, '.env.development');
dotenv.config({ path: envFile });

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration - Support Replit and local development
const getAllowedOrigins = () => {
  const origins = [];
  
  // Add local development origin
  if (process.env.CORS_ORIGIN) {
    origins.push(process.env.CORS_ORIGIN);
  }
  
  // Add Replit frontend URL if provided
  if (process.env.REPLIT_FRONTEND_URL) {
    origins.push(process.env.REPLIT_FRONTEND_URL);
  }
  
  // Add common Replit patterns
  origins.push('http://localhost:5173');
  origins.push('https://*.id.repl.co');
  origins.push('https://*.repl.co');
  
  return origins;
};

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = getAllowedOrigins();
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      // Support wildcard patterns for Replit
      if (allowedOrigin.includes('*')) {
        // Escape special regex characters and convert * to .*
        const pattern = allowedOrigin
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
          .replace(/\*/g, '.*'); // Convert * to .*
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(origin);
      }
      return origin === allowedOrigin;
    });
    
    // In development, allow all origins for easier testing
    if (isAllowed || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

// API routes
const API_VERSION = '/api/sms';

app.use(`${API_VERSION}/auth`, authRoutes);
app.use(`${API_VERSION}/users`, usersRoutes);
app.use(`${API_VERSION}/branches`, branchesRoutes);
app.use(`${API_VERSION}/classes`, classesRoutes);
app.use(`${API_VERSION}/students`, studentsRoutes);
app.use(`${API_VERSION}/programs`, programsRoutes);
app.use(`${API_VERSION}/rooms`, roomsRoutes);
app.use(`${API_VERSION}/curriculum`, curriculumRoutes);
app.use(`${API_VERSION}/packages`, packagesRoutes);
app.use(`${API_VERSION}/pricinglists`, pricinglistsRoutes);
app.use(`${API_VERSION}/merchandise`, merchandiseRoutes);
app.use(`${API_VERSION}/merchandise-requests`, merchandiseRequestsRoutes);
app.use(`${API_VERSION}/invoices`, invoicesRoutes);
app.use(`${API_VERSION}/installment-invoices`, installmentInvoicesRoutes);
app.use(`${API_VERSION}/guardians`, guardiansRoutes);
app.use(`${API_VERSION}/phasesessions`, phasesessionsRoutes);
app.use(`${API_VERSION}/payments`, paymentsRoutes);
app.use(`${API_VERSION}/reservations`, reservationsRoutes);
app.use(`${API_VERSION}/dashboard`, dashboardRoutes);
app.use(`${API_VERSION}/calendar`, calendarRoutes);
app.use(`${API_VERSION}/promos`, promosRoutes);
app.use(`${API_VERSION}/referrals`, referralsRoutes);
app.use(`${API_VERSION}/attendance`, attendanceRoutes);
app.use(`${API_VERSION}/announcements`, announcementsRoutes);
app.use(`${API_VERSION}/suspensions`, suspensionsRoutes);
app.use(`${API_VERSION}/upload`, uploadRoutes);
app.use(`${API_VERSION}/holidays`, holidaysRoutes);
app.use(`${API_VERSION}/settings`, settingsRoutes);

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Start server - Bind to 0.0.0.0 for Replit compatibility
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server is running on ${HOST}:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Health check: http://${HOST}:${PORT}/health`);
  console.log(`🔗 API base URL: http://${HOST}:${PORT}${API_VERSION}`);
  
  // Start scheduled jobs
  startInstallmentInvoiceScheduler();
  console.log(`⏰ Installment invoice scheduler started`);

  startInstallmentDelinquencyScheduler();
  console.log(`⏰ Installment delinquency scheduler started`);

  startOverdueInvoiceEmailScheduler();
  console.log(`⏰ Overdue invoice auto-email scheduler started`);
});

export default app;

