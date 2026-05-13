import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

// Route imports
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/user.routes.js';
import leadRoutes from './modules/leads/lead.routes.js';
import customerRoutes from './modules/customers/customer.routes.js';
import followupRoutes from './modules/followups/followup.routes.js';
import itineraryRoutes from './modules/itineraries/itinerary.routes.js';
import bookingRoutes from './modules/bookings/booking.routes.js';
import paymentRoutes from './modules/payments/payment.routes.js';
import vendorRoutes from './modules/vendors/vendor.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import reportRoutes from './modules/reports/report.routes.js';
import leadStageRoutes from './modules/lead-stages/leadStage.routes.js';
import chatRoutes from './modules/chats/chat.routes.js';
import taskRoutes from './modules/tasks/task.routes.js';
// Middleware imports
import { errorHandler } from './middleware/error.middleware.js';
import { notFound } from './middleware/notFound.middleware.js';
import invoiceRoutes from './modules/invoice/invoice.routes.js';
import ticketRoutes from './modules/tickets/ticket.routes.js';
import unifiedPaymentRoutes from './modules/payments/unified_payment.routes.js';


const app = express();

// ─── Core Middleware ───────────────────────────────────────────
app.use(helmet());

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Handle preflight for ALL routes
app.options('*', cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ─── Health Check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Travel CRM API is running',
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ────────────────────────────────────────────────
const API = '/api/v1';
app.use(`${API}/auth`, authRoutes);
app.use(`${API}/users`, userRoutes);
app.use(`${API}/leads`, leadRoutes);
app.use(`${API}/customers`, customerRoutes);
app.use(`${API}/follow-ups`, followupRoutes);
app.use(`${API}/itineraries`, itineraryRoutes);
app.use(`${API}/bookings`, bookingRoutes);
app.use(`${API}/payments`, paymentRoutes);
app.use(`${API}/chats`, chatRoutes);
app.use(`${API}/vendors`, vendorRoutes);
app.use(`${API}/notifications`, notificationRoutes);
app.use(`${API}/dashboard`, dashboardRoutes);
app.use(`${API}/reports`, reportRoutes);
app.use(`${API}/lead-stages`, leadStageRoutes);
app.use(`${API}/tasks`, taskRoutes);
app.use(`${API}/invoices`, invoiceRoutes);
app.use(`${API}/tickets`, ticketRoutes);
app.use(`${API}/unified-payments`, unifiedPaymentRoutes);

// ─── Error Handlers ────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;