import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/superadmin/Dashboard';
import Branch from './pages/superadmin/Branch';
import Personnel from './pages/superadmin/Personnel';
import Student from './pages/superadmin/Student';
import Curriculum from './pages/superadmin/Curriculum';
import Program from './pages/superadmin/Program';
import Classes from './pages/superadmin/Classes';
import Guardians from './pages/superadmin/Guardians';
import Package from './pages/superadmin/Package';
import PricingList from './pages/superadmin/PricingList';
import Merchandise from './pages/superadmin/Merchandise';
import Promo from './pages/superadmin/Promo';
import Room from './pages/superadmin/Room';
import Invoice from './pages/superadmin/Invoice';
import InstallmentInvoice from './pages/superadmin/InstallmentInvoice';
import PaymentLogs from './pages/superadmin/PaymentLogs';
import CalendarSchedule from './pages/superadmin/CalendarSchedule';
import Announcements from './pages/superadmin/Announcements';
import AdminDashboard from './pages/admin/adminDashboard';
import AdminCalendar from './pages/admin/adminCalendar';
import AdminPersonnel from './pages/admin/adminPersonnel';
import AdminStudent from './pages/admin/adminStudent';
import AdminGuardians from './pages/admin/adminGuardians';
import AdminCurriculum from './pages/admin/adminCurriculum';
import AdminProgram from './pages/admin/adminProgram';
import AdminClasses from './pages/admin/adminClasses';
import AdminAnnouncements from './pages/admin/adminAnnouncements';
import AdminPackage from './pages/admin/adminPackage';
import AdminPricingList from './pages/admin/adminPricingList';
import AdminMerchandise from './pages/admin/adminMerchandise';
import AdminPromo from './pages/admin/adminPromo';
import AdminRoom from './pages/admin/adminRoom';
import AdminInvoice from './pages/admin/adminInvoice';
import AdminInstallmentInvoice from './pages/admin/adminInstallmentInvoice';
import AdminPaymentLogs from './pages/admin/adminPaymentLogs';
import TeacherDashboard from './pages/teacher/teacherDashboard';
import TeacherCalendar from './pages/teacher/teacherCalendar';
import TeacherClasses from './pages/teacher/teacherClasses';
import TeacherAnnouncements from './pages/teacher/teacherAnnouncements';
import TeacherStudentList from './pages/teacher/teacherStudentList';
import TeacherProgram from './pages/teacher/teacherProgram';
import TeacherCurriculum from './pages/teacher/teacherCurriculum';
import StudentDashboard from './pages/student/studentDashboard';
import StudentCalendar from './pages/student/studentCalendar';
import StudentClasses from './pages/student/studentClasses';
import StudentAnnouncements from './pages/student/studentAnnouncements';
import StudentPackages from './pages/student/studentPackages';
import StudentInvoice from './pages/student/studentInvoice';
import StudentPaymentLogs from './pages/student/studentPaymentLogs';
import FinanceDashboard from './pages/finance/financeDashboard';
import FinanceInvoice from './pages/finance/financeInvoice';
import FinanceInstallmentInvoice from './pages/finance/financeInstallmentInvoice';
import FinancePaymentLogs from './pages/finance/financePaymentLogs';
import SuperfinanceDashboard from './pages/superfinance/superfinanceDashboard';
import SuperfinanceInvoice from './pages/superfinance/superfinanceInvoice';
import SuperfinanceInstallmentInvoice from './pages/superfinance/superfinanceInstallmentInvoice';
import SuperfinancePaymentLogs from './pages/superfinance/superfinancePaymentLogs';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          
          {/* Protected Routes with Layout */}
          <Route
            path="/superadmin/*"
            element={
              <ProtectedRoute allowedRoles={['Superadmin']}>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="branch" element={<Branch />} />
            <Route path="personnel" element={<Personnel />} />
            <Route path="student" element={<Student />} />
            <Route path="guardians" element={<Guardians />} />
            <Route path="curriculum" element={<Curriculum />} />
            <Route path="program" element={<Program />} />
            <Route path="classes" element={<Classes />} />
            <Route path="package" element={<Package />} />
            <Route path="pricinglist" element={<PricingList />} />
            <Route path="merchandise" element={<Merchandise />} />
            <Route path="promo" element={<Promo />} />
            <Route path="room" element={<Room />} />
            <Route path="invoice" element={<Invoice />} />
            <Route path="installment-invoice" element={<InstallmentInvoice />} />
            <Route path="payment-logs" element={<PaymentLogs />} />
            <Route path="calendar-schedule" element={<CalendarSchedule />} />
            <Route path="announcements" element={<Announcements />} />
          </Route>
          
          {/* Admin Routes */}
          <Route
            path="/admin/*"
            element={
              <ProtectedRoute allowedRoles={['Admin']}>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="calendar" element={<AdminCalendar />} />
            <Route path="personnel" element={<AdminPersonnel />} />
            <Route path="student" element={<AdminStudent />} />
            <Route path="guardians" element={<AdminGuardians />} />
            <Route path="curriculum" element={<AdminCurriculum />} />
            <Route path="program" element={<AdminProgram />} />
            <Route path="classes" element={<AdminClasses />} />
            <Route path="announcements" element={<AdminAnnouncements />} />
            <Route path="package" element={<AdminPackage />} />
            <Route path="pricinglist" element={<AdminPricingList />} />
            <Route path="merchandise" element={<AdminMerchandise />} />
            <Route path="promo" element={<AdminPromo />} />
            <Route path="room" element={<AdminRoom />} />
            <Route path="invoice" element={<AdminInvoice />} />
            <Route path="installment-invoice" element={<AdminInstallmentInvoice />} />
            <Route path="payment-logs" element={<AdminPaymentLogs />} />
          </Route>
          
          {/* Teacher Routes */}
          <Route
            path="/teacher/*"
            element={
              <ProtectedRoute allowedRoles={['Teacher']}>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<TeacherDashboard />} />
            <Route path="calendar" element={<TeacherCalendar />} />
            <Route path="announcements" element={<TeacherAnnouncements />} />
            <Route path="classes" element={<TeacherClasses />} />
            <Route path="student-list" element={<TeacherStudentList />} />
            <Route path="program" element={<TeacherProgram />} />
            <Route path="curriculum" element={<TeacherCurriculum />} />
          </Route>
          
          {/* Student Routes */}
          <Route
            path="/student/*"
            element={
              <ProtectedRoute allowedRoles={['Student']}>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<StudentDashboard />} />
            <Route path="calendar" element={<StudentCalendar />} />
            <Route path="announcements" element={<StudentAnnouncements />} />
            <Route path="classes" element={<StudentClasses />} />
            <Route path="packages" element={<StudentPackages />} />
            <Route path="invoice" element={<StudentInvoice />} />
            <Route path="payment-logs" element={<StudentPaymentLogs />} />
          </Route>
          
          {/* Finance Routes */}
          <Route
            path="/finance/*"
            element={
              <ProtectedRoute allowedRoles={['Finance']} checkBranch={true}>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<FinanceDashboard />} />
            <Route path="invoice" element={<FinanceInvoice />} />
            <Route path="installment-invoice" element={<FinanceInstallmentInvoice />} />
            <Route path="payment-logs" element={<FinancePaymentLogs />} />
          </Route>
          
          {/* Superfinance Routes - Finance role with no branch (manages all branches) */}
          <Route
            path="/superfinance/*"
            element={
              <ProtectedRoute allowedRoles={['Finance']} checkBranch={false} requireNoBranch={true}>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<SuperfinanceDashboard />} />
            <Route path="invoice" element={<SuperfinanceInvoice />} />
            <Route path="installment-invoice" element={<SuperfinanceInstallmentInvoice />} />
            <Route path="payment-logs" element={<SuperfinancePaymentLogs />} />
          </Route>
          
          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          
          {/* Catch all - redirect to login */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
