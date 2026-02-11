import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateManila } from '../../utils/dateUtils';

const AdminClasses = () => {
  const { userInfo } = useAuth();
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  // Removed filterBranch - admin only sees their branch
  const [filterProgram, setFilterProgram] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: undefined, bottom: undefined, right: undefined, left: undefined });
  const [openBranchDropdown, setOpenBranchDropdown] = useState(false);
  const [openProgramDropdown, setOpenProgramDropdown] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState('branch-selection'); // 'branch-selection', 'step1', 'step2', or 'form' (form is for editing)
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [editingClass, setEditingClass] = useState(null);
  const [branches, setBranches] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [holidayCacheKey, setHolidayCacheKey] = useState('');
  const [holidayDateSet, setHolidayDateSet] = useState(new Set());
  const [loadingHolidays, setLoadingHolidays] = useState(false);
  const [formData, setFormData] = useState({
    branch_id: '',
    room_id: '',
    program_id: '',
    teacher_ids: [], // Changed to array for multiple teachers
    level_tag: '',
    class_name: '',
    max_students: '',
    start_date: '',
    end_date: '',
    days_of_week: {
      Monday: { enabled: false, start_time: '', end_time: '' },
      Tuesday: { enabled: false, start_time: '', end_time: '' },
      Wednesday: { enabled: false, start_time: '', end_time: '' },
      Thursday: { enabled: false, start_time: '', end_time: '' },
      Friday: { enabled: false, start_time: '', end_time: '' },
      Saturday: { enabled: false, start_time: '', end_time: '' },
      Sunday: { enabled: false, start_time: '', end_time: '' },
    },
  });
  const [manualEndDateAdjustment, setManualEndDateAdjustment] = useState({
    enabled: false,
    adjustedDate: '',
    notes: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'detail'
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const [phaseSessions, setPhaseSessions] = useState([]);
  const [loadingPhaseSessions, setLoadingPhaseSessions] = useState(false);
  const [classSessions, setClassSessions] = useState([]);
  const [loadingClassSessions, setLoadingClassSessions] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState(new Set([1])); // Phase 1 open by default
  const [openSessionMenuId, setOpenSessionMenuId] = useState(null);
  const [sessionMenuPosition, setSessionMenuPosition] = useState({ top: 0, right: 0 });
  const [selectedSessionForSubstitute, setSelectedSessionForSubstitute] = useState(null);
  const [isSubstituteModalOpen, setIsSubstituteModalOpen] = useState(false);
  const [substitutingSession, setSubstitutingSession] = useState(false);
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const [selectedSessionForAttendance, setSelectedSessionForAttendance] = useState(null);
  const [attendanceData, setAttendanceData] = useState(null);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [attendanceNotes, setAttendanceNotes] = useState('');
  const [attendanceAgenda, setAttendanceAgenda] = useState('');
  const [attendanceJustSaved, setAttendanceJustSaved] = useState(false);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [isAgendaModalOpen, setIsAgendaModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [agendaDraft, setAgendaDraft] = useState('');
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
  const [enrollStep, setEnrollStep] = useState('enrollment-option'); // 'enrollment-option', 'package-selection', 'student-selection', 'review'
  const [selectedClassForEnrollment, setSelectedClassForEnrollment] = useState(null);
  const [selectedEnrollmentOption, setSelectedEnrollmentOption] = useState(null); // 'package', 'per-phase'
  const [isViewStudentsModalOpen, setIsViewStudentsModalOpen] = useState(false);
  const [viewStudentsStep, setViewStudentsStep] = useState('phase-selection'); // 'phase-selection' or 'students-list'
  const [selectedClassForView, setSelectedClassForView] = useState(null);
  const [selectedPhaseForView, setSelectedPhaseForView] = useState(null);
  const [viewEnrolledStudents, setViewEnrolledStudents] = useState([]);
  const [loadingViewStudents, setLoadingViewStudents] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [packages, setPackages] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [availablePromos, setAvailablePromos] = useState([]);
  const [selectedPromo, setSelectedPromo] = useState(null);
  const [loadingPromos, setLoadingPromos] = useState(false);
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [validatedPromoFromCode, setValidatedPromoFromCode] = useState(null);
  const [validatingPromoCode, setValidatingPromoCode] = useState(false);
  const [promoCodeError, setPromoCodeError] = useState('');
  const [promoCodeValidationTimeout, setPromoCodeValidationTimeout] = useState(null);
  // Suspension states
  const [isSuspensionModalOpen, setIsSuspensionModalOpen] = useState(false);
  const [selectedClassForSuspension, setSelectedClassForSuspension] = useState(null);
  const [suspensionStep, setSuspensionStep] = useState('select-sessions'); // 'select-sessions', 'choose-strategy', 'schedule-makeup', 'preview-auto'
  const [makeupStrategy, setMakeupStrategy] = useState('add-last-phase'); // 'add-last-phase' | 'manual'
  const [suspensionFormData, setSuspensionFormData] = useState({
    suspension_name: '',
    reason: 'Typhoon',
    description: '',
  });
  const [availableClassSessions, setAvailableClassSessions] = useState([]);
  const [selectedSessionsToSuspend, setSelectedSessionsToSuspend] = useState([]);
  const [makeupSchedules, setMakeupSchedules] = useState([]);
  const [creatingSuspension, setCreatingSuspension] = useState(false);
  const [suspensionRoomSchedules, setSuspensionRoomSchedules] = useState([]); // Room schedules for suspension modal
  const [loadingSuspensionRoomSchedules, setLoadingSuspensionRoomSchedules] = useState(false);
  const [selectedPricingLists, setSelectedPricingLists] = useState([]);
  const [selectedMerchandise, setSelectedMerchandise] = useState([]); // Array of {merchandise_id, size}
  const [packageMerchSelections, setPackageMerchSelections] = useState({});
  const [uniformCategoryFilters, setUniformCategoryFilters] = useState({});
  // Per-student merchandise selections: { [student_id]: [{merchandise_id, size, merchandise_name}] }
  const [studentMerchandiseSelections, setStudentMerchandiseSelections] = useState({});
  const [pricingLists, setPricingLists] = useState([]);
  const [merchandise, setMerchandise] = useState([]);
  const [enrollSubmitting, setEnrollSubmitting] = useState(false);
  const [generatedInvoices, setGeneratedInvoices] = useState([]);
  const [enrolledStudents, setEnrolledStudents] = useState([]);
  const [loadingEnrolledStudents, setLoadingEnrolledStudents] = useState(false);
  const [enrollReservedStudents, setEnrollReservedStudents] = useState([]);
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [showStudentDropdown, setShowStudentDropdown] = useState(false);
  const [showTeacherDropdown, setShowTeacherDropdown] = useState(false);
  const [teacherSearchTerm, setTeacherSearchTerm] = useState('');
  const [teacherConflicts, setTeacherConflicts] = useState([]); // Array of {teacher_id, teacher_name, conflicts: [...]}
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [teacherConflictError, setTeacherConflictError] = useState(''); // Error message for conflict checking
  const [roomSchedules, setRoomSchedules] = useState([]); // Array of schedules for selected room
  const [loadingRoomSchedules, setLoadingRoomSchedules] = useState(false);
  const [expandedCalendarDays, setExpandedCalendarDays] = useState(new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])); // Track expanded days in calendar
  const [expandedSchedulesPerDay, setExpandedSchedulesPerDay] = useState({}); // Track how many schedules to show per day
  // Merge history state
  const [mergeHistory, setMergeHistory] = useState([]);
  const [loadingMergeHistory, setLoadingMergeHistory] = useState(false);
  const [isMergeHistoryModalOpen, setIsMergeHistoryModalOpen] = useState(false);
  const [selectedClassForHistory, setSelectedClassForHistory] = useState(null);
  const [undoingMerge, setUndoingMerge] = useState(false);
  const [conflictData, setConflictData] = useState(null); // Store conflict details from undo error
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [pendingConflictData, setPendingConflictData] = useState(null); // Store conflict data while switching to detail view
  const [showInstallmentSettings, setShowInstallmentSettings] = useState(false);
  const [showPackageDetails, setShowPackageDetails] = useState(true); // Default to open/expanded
  const [installmentSettings, setInstallmentSettings] = useState({
    invoice_issue_date: '',
    billing_month: '',
    invoice_due_date: '',
    invoice_generation_date: '',
    frequency_months: 1,
  });
  const [selectedPhaseNumber, setSelectedPhaseNumber] = useState(null); // null means auto-determine
  const [perPhaseAmount, setPerPhaseAmount] = useState(''); // Amount for per-phase enrollment
  const [reservationPhaseNumber, setReservationPhaseNumber] = useState(null); // Always null - reservations are for entire class; package type is selected during upgrade
  const [reservationInvoiceSettings, setReservationInvoiceSettings] = useState({
    issue_date: '',
    due_date: '',
  });
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [mergeStep, setMergeStep] = useState('select-class'); // 'select-class', 'choose-schedule', 'review'
  const [selectedClassForMerge, setSelectedClassForMerge] = useState(null);
  const [selectedMergeTargetClasses, setSelectedMergeTargetClasses] = useState([]); // Changed to array for multiple selection
  const [mergeTargetClasses, setMergeTargetClasses] = useState([]);
  const [classesWithInactivatedSchedules, setClassesWithInactivatedSchedules] = useState(new Set()); // Track classes with temporarily inactivated schedules
  const [sourceClassSchedule, setSourceClassSchedule] = useState([]);
  const [manualSchedule, setManualSchedule] = useState([]); // For manual schedule editing
  const [useSourceSchedule, setUseSourceSchedule] = useState(true); // Toggle between source schedule and manual schedule
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [mergeScheduleConflicts, setMergeScheduleConflicts] = useState([]); // Array of conflict objects
  const [checkingMergeConflicts, setCheckingMergeConflicts] = useState(false);
  const [mergeFormData, setMergeFormData] = useState({
    class_name: '',
    teacher_ids: [], // Changed to array for multiple teachers
    room_id: '',
  });
  const [isReservedStudentsModalOpen, setIsReservedStudentsModalOpen] = useState(false);
  const [reservedStudents, setReservedStudents] = useState([]);
  const [loadingReservedStudents, setLoadingReservedStudents] = useState(false);
  const [selectedClassForReservations, setSelectedClassForReservations] = useState(null);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [selectedReservationForUpgrade, setSelectedReservationForUpgrade] = useState(null);
  const [reservationFeePaid, setReservationFeePaid] = useState(0);
  const [alternativeClasses, setAlternativeClasses] = useState([]);
  const [isAlternativeClassesModalOpen, setIsAlternativeClassesModalOpen] = useState(false);
  const [upgradeStep, setUpgradeStep] = useState('enrollment-option'); // 'enrollment-option', 'package-selection', 'package-config', 'per-phase-selection', 'review'
  const [upgradeEnrollmentOption, setUpgradeEnrollmentOption] = useState(''); // 'package', 'per-phase'
  const [upgradeSelectedPackage, setUpgradeSelectedPackage] = useState(null);
  const [upgradeAvailablePromos, setUpgradeAvailablePromos] = useState([]);
  const [upgradeSelectedPromo, setUpgradeSelectedPromo] = useState(null);
  const [loadingUpgradePromos, setLoadingUpgradePromos] = useState(false);
  const [upgradeSelectedPricingLists, setUpgradeSelectedPricingLists] = useState([]);
  const [upgradeSelectedMerchandise, setUpgradeSelectedMerchandise] = useState([]);
  const [upgradePerPhaseAmount, setUpgradePerPhaseAmount] = useState('');
  const [upgradePhaseNumber, setUpgradePhaseNumber] = useState(null);
  const [upgradeInstallmentSettings, setUpgradeInstallmentSettings] = useState({
    invoice_issue_date: '',
    billing_month: '',
    invoice_due_date: '',
    invoice_generation_date: '',
    frequency_months: 1,
  });
  const [upgradeShowInstallmentSettings, setUpgradeShowInstallmentSettings] = useState(false);
  const [upgradeShowPackageDetails, setUpgradeShowPackageDetails] = useState(true); // Default to open/expanded
  const [upgradePackageMerchSelections, setUpgradePackageMerchSelections] = useState({});
  const [upgradeStudentMerchandiseSelections, setUpgradeStudentMerchandiseSelections] = useState({});
  const [upgradeUniformCategoryFilters, setUpgradeUniformCategoryFilters] = useState({});

const initializePackageMerchSelections = useCallback(
  (pkg) => {
    if (!pkg || !pkg.details) {
      setPackageMerchSelections({});
      return;
    }

    const { merchandiseTypes } = groupPackageDetails(pkg.details || []);
    setPackageMerchSelections((prev) => {
      const updatedSelections = { ...prev };
      merchandiseTypes.forEach((typeName) => {
        const items = getMerchandiseItemsByType(typeName);
        if (items.length === 0) {
          updatedSelections[typeName] = [];
          return;
        }

        // Check if this merchandise type requires sizing
        const requiresSizing = requiresSizingForMerchandise(typeName);
        
        // For items that don't require sizing, automatically include them without showing in configure section
        if (!requiresSizing) {
          // Auto-select the first available item for non-uniform merchandise
          updatedSelections[typeName] = [
            {
              merchandise_id: items[0].merchandise_id,
              size: items[0].size || null,
            },
          ];
          return;
        }

        // For items that require sizing (uniforms), check existing selections or initialize
        const existingSelections = (prev[typeName] || []).filter((selection) =>
          items.some((item) => item.merchandise_id === selection.merchandise_id)
        );

        if (existingSelections.length > 0) {
          updatedSelections[typeName] = existingSelections;
        } else {
          updatedSelections[typeName] = [];
        }
      });
      return updatedSelections;
    });
  },
  [merchandise]
);

  const location = useLocation();
  const autoOpenClassIdRef = useRef(null);

  // Fetch branch name if not in userInfo
  useEffect(() => {
    const fetchBranchName = async () => {
      if (!userInfo?.branch_name && adminBranchId) {
        try {
          const response = await apiRequest(`/branches/${adminBranchId}`);
          if (response && response.data && response.data.branch_name) {
            setSelectedBranchName(response.data.branch_name);
          }
        } catch (err) {
          console.error('Error fetching branch name:', err);
        }
      } else if (userInfo?.branch_name) {
        setSelectedBranchName(userInfo.branch_name);
      }
    };

    fetchBranchName();
  }, [userInfo, adminBranchId]);

  useEffect(() => {
    fetchClasses();
    // Don't fetch branches for admin - they only see their branch
    fetchPrograms();
    fetchRooms();
    fetchTeachers();
  }, []);

  // Auto-set branch_id from adminBranchId when available
  useEffect(() => {
    if (adminBranchId && isModalOpen && !editingClass) {
      setFormData(prev => ({
        ...prev,
        branch_id: adminBranchId.toString(),
      }));
    }
  }, [adminBranchId, isModalOpen, editingClass]);

  // Capture classId from query param to auto-open
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const classId = params.get('classId');
    if (classId) {
      autoOpenClassIdRef.current = classId;
    }
  }, [location.search]);

  // Auto-open class when classes are loaded and target id exists
  useEffect(() => {
    if (autoOpenClassIdRef.current && classes.length > 0) {
      const targetId = parseInt(autoOpenClassIdRef.current, 10);
      const targetClass = classes.find((c) => c.class_id === targetId);
      if (targetClass) {
        handleViewClass(targetClass);
        autoOpenClassIdRef.current = null;
      }
    }
  }, [classes]);

  // Open conflict modal only after detail view is confirmed active
  useEffect(() => {
    if (pendingConflictData && viewMode === 'detail' && selectedClassForDetails) {
      // Detail view is now active, safe to open conflict modal
      setConflictData(pendingConflictData);
      setIsConflictModalOpen(true);
      setPendingConflictData(null);
    }
  }, [pendingConflictData, viewMode, selectedClassForDetails]);

  useEffect(() => {
    if (selectedPackage) {
      initializePackageMerchSelections(selectedPackage);
    } else {
      setPackageMerchSelections({});
    }
  }, [selectedPackage, initializePackageMerchSelections]);

  // Refetch student-specific promos when students are selected
  useEffect(() => {
    if (selectedPackage?.package_id && selectedStudents.length > 0) {
      // Fetch promos for the first selected student (for now, we'll use the first student's eligibility)
      const firstStudent = selectedStudents[0];
      fetchAvailablePromos(selectedPackage.package_id, firstStudent.user_id);
    } else if (selectedPackage?.package_id && selectedStudents.length === 0) {
      // Fetch general promos when no students selected
      fetchAvailablePromos(selectedPackage.package_id);
    }
  }, [selectedPackage?.package_id, selectedStudents]);

  // Clear validated promo when package changes
  useEffect(() => {
    setValidatedPromoFromCode(null);
    setPromoCodeInput('');
    setPromoCodeError('');
    // Clear any pending validation timeout
    if (promoCodeValidationTimeout) {
      clearTimeout(promoCodeValidationTimeout);
      setPromoCodeValidationTimeout(null);
    }
  }, [selectedPackage?.package_id]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (promoCodeValidationTimeout) {
        clearTimeout(promoCodeValidationTimeout);
      }
    };
  }, [promoCodeValidationTimeout]);

  const fetchPackages = async (branchId) => {
    try {
      const response = await apiRequest(`/packages?branch_id=${branchId}&limit=100`);
      setPackages(response.data || []);
    } catch (err) {
      console.error('Error fetching packages:', err);
    }
  };

  const fetchStudents = async (branchId) => {
    try {
      const response = await apiRequest(`/users?user_type=Student&branch_id=${branchId}&limit=100`);
      setStudents(response.data || []);
    } catch (err) {
      console.error('Error fetching students:', err);
    }
  };

  const fetchPricingLists = async (branchId) => {
    try {
      const response = await apiRequest(`/pricinglists?branch_id=${branchId}&limit=100`);
      setPricingLists(response.data || []);
    } catch (err) {
      console.error('Error fetching pricing lists:', err);
    }
  };

  const fetchMerchandise = async (branchId) => {
    try {
      const response = await apiRequest('/merchandise?limit=100');
      // Filter merchandise by branch_id
      const filteredMerchandise = (response.data || []).filter(
        (item) => item.branch_id === branchId
      );
      setMerchandise(filteredMerchandise);
    } catch (err) {
      console.error('Error fetching merchandise:', err);
    }
  };

  const fetchAvailablePromos = async (packageId, studentId = null) => {
    try {
      setLoadingPromos(true);
      let url = `/promos/package/${packageId}`;
      if (studentId) {
        url = `/promos/package/${packageId}/student/${studentId}`;
      }
      const response = await apiRequest(url);
      const promos = response.data || [];
      // Filter to only show auto-apply promos (those without promo_code)
      // Code-based promos (with promo_code) should ONLY appear when user enters the code
      const autoApplyPromos = promos.filter(promo => {
        // Show promos that do NOT have a promo_code (auto-apply promos)
        // Hide promos that DO have a promo_code (code-based promos)
        const promoCode = promo.promo_code;
        // Return true if promo_code is null, undefined, empty string, or whitespace-only
        return !promoCode || (typeof promoCode === 'string' && promoCode.trim() === '');
      });
      console.log(`Fetched ${promos.length} total promos, showing ${autoApplyPromos.length} auto-apply promos (excluding ${promos.length - autoApplyPromos.length} code-based promos) for package ${packageId}${studentId ? ` and student ${studentId}` : ''}:`, {
        total: promos.length,
        autoApply: autoApplyPromos.length,
        codeBased: promos.length - autoApplyPromos.length,
        autoApplyPromos: autoApplyPromos.map(p => ({ id: p.promo_id, name: p.promo_name, code: p.promo_code || 'null' })),
        codeBasedPromos: promos.filter(p => {
          const code = p.promo_code;
          return code && typeof code === 'string' && code.trim() !== '';
        }).map(p => ({ id: p.promo_id, name: p.promo_name, code: p.promo_code }))
      });
      setAvailablePromos(autoApplyPromos);
    } catch (err) {
      console.error('Error fetching available promos:', err);
      console.error('Error details:', err.response?.data || err.message);
      setAvailablePromos([]);
    } finally {
      setLoadingPromos(false);
    }
  };

  const validatePromoCode = async (code, packageId, studentId = null) => {
    if (!code || !code.trim()) {
      setValidatedPromoFromCode(null);
      setPromoCodeError('');
      return;
    }

    try {
      setValidatingPromoCode(true);
      setPromoCodeError('');
      
      const payload = {
        promo_code: code.trim().toUpperCase(),
        package_id: packageId,
      };
      
      if (studentId) {
        payload.student_id = studentId;
      }

      const response = await apiRequest('/promos/validate-code', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (response.success && response.data) {
        const promo = response.data;
        // For Installment packages, apply promo to downpayment; otherwise use package_price
        const baseAmount = selectedPackage?.package_type === 'Installment' && selectedPackage?.downpayment_amount != null && parseFloat(selectedPackage.downpayment_amount) > 0
          ? parseFloat(selectedPackage.downpayment_amount)
          : parseFloat(selectedPackage?.package_price || 0);
        let discountAmount = 0;
        
        if (promo.promo_type === 'percentage_discount' && promo.discount_percentage) {
          discountAmount = (baseAmount * promo.discount_percentage) / 100;
        } else if (promo.promo_type === 'fixed_discount' && promo.discount_amount) {
          discountAmount = Math.min(parseFloat(promo.discount_amount), baseAmount);
        } else if (promo.promo_type === 'combined') {
          if (promo.discount_percentage && parseFloat(promo.discount_percentage) > 0) {
            discountAmount = (baseAmount * promo.discount_percentage) / 100;
          } else if (promo.discount_amount && parseFloat(promo.discount_amount) > 0) {
            discountAmount = Math.min(parseFloat(promo.discount_amount), baseAmount);
          }
        }
        
        const finalPrice = Math.max(0, baseAmount - discountAmount);
        
        const validatedPromo = {
          ...promo,
          calculated_discount: discountAmount,
          final_price: finalPrice,
        };
        setValidatedPromoFromCode(validatedPromo);
        // Automatically select the validated promo
        setSelectedPromo(validatedPromo);
        setPromoCodeError('');
      } else {
        setValidatedPromoFromCode(null);
        setPromoCodeError(response.message || 'Invalid promo code');
      }
    } catch (err) {
      console.error('Error validating promo code:', err);
      setValidatedPromoFromCode(null);
      setPromoCodeError(err.message || 'Failed to validate promo code');
    } finally {
      setValidatingPromoCode(false);
    }
  };

  const fetchUpgradeAvailablePromos = async (packageId, studentId = null) => {
    try {
      setLoadingUpgradePromos(true);
      let url = `/promos/package/${packageId}`;
      if (studentId) {
        url = `/promos/package/${packageId}/student/${studentId}`;
      }
      const response = await apiRequest(url);
      const promos = response.data || [];
      console.log(`Fetched ${promos.length} promos for upgrade package ${packageId}${studentId ? ` and student ${studentId}` : ''}:`, promos);
      setUpgradeAvailablePromos(promos);
    } catch (err) {
      console.error('Error fetching available promos for upgrade:', err);
      console.error('Error details:', err.response?.data || err.message);
      setUpgradeAvailablePromos([]);
    } finally {
      setLoadingUpgradePromos(false);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      if (openSessionMenuId && !event.target.closest('.session-action-menu-container') && !event.target.closest('.session-action-menu-overlay')) {
        setOpenSessionMenuId(null);
      }
      // Removed branch dropdown - admin only sees their branch
      if (openProgramDropdown && !event.target.closest('.program-filter-dropdown')) {
        setOpenProgramDropdown(false);
      }
      if (showStudentDropdown && !event.target.closest('#student_search') && !event.target.closest('.student-dropdown-container')) {
        setShowStudentDropdown(false);
      }
      if (showTeacherDropdown && !event.target.closest('#teacher_search') && !event.target.closest('#merge_teacher_search') && !event.target.closest('.teacher-dropdown-container')) {
        setShowTeacherDropdown(false);
      }
    };

    // Always add the event listener, but only handle clicks when needed
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
  }, [openMenuId, openSessionMenuId, openProgramDropdown, showStudentDropdown, showTeacherDropdown]);

  const handleMenuClick = (classId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === classId) {
      setOpenMenuId(null);
      setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
    } else {
      // Calculate available space
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // Estimate dropdown height (approximately 7 menu items * 40px each = ~280px)
      const estimatedDropdownHeight = 280;
      
      // Determine vertical position (above or below)
      let top, bottom;
      if (spaceBelow >= estimatedDropdownHeight) {
        top = rect.bottom + 4;
        bottom = 'auto';
      } else if (spaceAbove >= estimatedDropdownHeight) {
        bottom = viewportHeight - rect.top + 4;
        top = 'auto';
      } else {
        if (spaceBelow > spaceAbove) {
          top = rect.bottom + 4;
          bottom = 'auto';
        } else {
          bottom = viewportHeight - rect.top + 4;
          top = 'auto';
        }
      }
      
      // Align right edge of dropdown with right edge of button (same as Program and Curriculum)
      let right, left;
      right = viewportWidth - rect.right;
      left = 'auto';
      
      setMenuPosition({
        top: top !== 'auto' ? top : undefined,
        bottom: bottom !== 'auto' ? bottom : undefined,
        right: right !== 'auto' ? right : undefined,
        left: left !== 'auto' ? left : undefined,
      });
      setOpenMenuId(classId);
    }
  };

  const handleSessionMenuClick = (sessionKey, event) => {
    event.stopPropagation();
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openSessionMenuId === sessionKey) {
      setOpenSessionMenuId(null);
      setSessionMenuPosition({ top: 0, right: 0 });
    } else {
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedDropdownHeight = 100;
      
      let top, bottom;
      if (spaceBelow >= estimatedDropdownHeight) {
        top = rect.bottom + 4;
        bottom = 'auto';
      } else if (spaceAbove >= estimatedDropdownHeight) {
        bottom = viewportHeight - rect.top + 4;
        top = 'auto';
      } else {
        if (spaceBelow > spaceAbove) {
          top = rect.bottom + 4;
          bottom = 'auto';
        } else {
          bottom = viewportHeight - rect.top + 4;
          top = 'auto';
        }
      }
      
      let right, left;
      right = viewportWidth - rect.right;
      left = 'auto';
      
      setSessionMenuPosition({
        top: top !== 'auto' ? top : undefined,
        bottom: bottom !== 'auto' ? bottom : undefined,
        right: right !== 'auto' ? right : undefined,
        left: left !== 'auto' ? left : undefined,
      });
      setOpenSessionMenuId(sessionKey);
    }
  };

  const openAttendanceModal = async (classSession, phaseNumber, phaseSessionNumber, sessionDate) => {
    if (!selectedClassForDetails) {
      console.error('Cannot open attendance modal: selectedClassForDetails is null');
      return;
    }

    const sessionData = classSession || {
      classsession_id: null,
      class_id: selectedClassForDetails.class_id,
      phase_number: phaseNumber,
      phase_session_number: phaseSessionNumber,
      scheduled_date: sessionDate,
    };

    setSelectedSessionForAttendance(sessionData);
    setIsAttendanceModalOpen(true);
    setAttendanceData(null);
    setAttendanceNotes('');
    setAttendanceAgenda('');
    
    if (sessionData.classsession_id) {
      fetchAttendanceData(sessionData.classsession_id).catch(err => {
        console.error('Error fetching attendance data:', err);
        if (selectedClassForDetails) {
          fetchEnrolledStudentsForAttendance(selectedClassForDetails.class_id).catch(console.error);
        }
      });
    } else {
      if (selectedClassForDetails) {
        fetchEnrolledStudentsForAttendance(selectedClassForDetails.class_id).catch(err => {
          console.error('Error fetching enrolled students:', err);
        });
      }
    }
  };

  const fetchAttendanceData = async (classsessionId) => {
    try {
      setLoadingAttendance(true);
      const response = await apiRequest(`/attendance/session/${classsessionId}`);
      const attendanceData = response.data || response;
      setAttendanceData(attendanceData);
      
      if (attendanceData?.session) {
        setAttendanceNotes(attendanceData.session.notes || '');
        setAttendanceAgenda(attendanceData.session.agenda || '');
      }
    } catch (err) {
      console.error('Error fetching attendance:', err);
      setError(err.message || 'Failed to fetch attendance data');
      if (selectedClassForDetails) {
        await fetchEnrolledStudentsForAttendance(selectedClassForDetails.class_id);
      }
    } finally {
      setLoadingAttendance(false);
    }
  };

  const fetchEnrolledStudentsForAttendance = async (classId) => {
    try {
      setLoadingAttendance(true);
      const response = await apiRequest(`/students/class/${classId}`);
      const students = response.data || [];
      
      const sessionDate = selectedSessionForAttendance?.scheduled_date || null;
      const sessionStartTime = selectedSessionForAttendance?.scheduled_start_time || null;
      const sessionEndTime = selectedSessionForAttendance?.scheduled_end_time || null;
      const sessionPhaseNumber = selectedSessionForAttendance?.phase_number || null;
      
      // Filter students by phase_number if session has a phase
      // Only show students enrolled in the same phase as the session
      const filteredStudents = sessionPhaseNumber
        ? students.filter(student => {
            // Handle students enrolled in multiple phases (e.g., "Phase 1-10")
            if (student.phase_number && typeof student.phase_number === 'string' && student.phase_number.includes('-')) {
              const [startPhase, endPhase] = student.phase_number.split('-').map(Number);
              return sessionPhaseNumber >= startPhase && sessionPhaseNumber <= endPhase;
            }
            // Handle single phase enrollment
            return Number(student.phase_number) === Number(sessionPhaseNumber);
          })
        : students; // If no phase specified, show all (fallback)
      
      setAttendanceData({
        session: {
          classsession_id: null,
          class_id: classId,
          scheduled_date: sessionDate,
          scheduled_start_time: sessionStartTime,
          scheduled_end_time: sessionEndTime,
          status: 'Scheduled',
          topic: selectedSessionForAttendance?.topic || null,
          goal: selectedSessionForAttendance?.goal || null,
          agenda: selectedSessionForAttendance?.agenda || null,
          class_name: selectedClassForDetails?.class_name || null,
          level_tag: selectedClassForDetails?.level_tag || null,
          program_name: selectedClassForDetails?.program_name || null,
        },
        students: filteredStudents.map(student => ({
          student_id: student.student_id,
          full_name: student.full_name,
          profile_picture_url: student.profile_picture_url,
          phase_number: student.phase_number,
          enrolled_at: student.enrolled_at,
          attendance: null,
        })),
      });
    } catch (err) {
      console.error('Error fetching students:', err);
      setError(err.message || 'Failed to fetch students');
    } finally {
      setLoadingAttendance(false);
    }
  };

  const closeAttendanceModal = () => {
    setIsAttendanceModalOpen(false);
    setSelectedSessionForAttendance(null);
    setAttendanceData(null);
    setAttendanceNotes('');
    setAttendanceAgenda('');
    setAttendanceJustSaved(false);
  };

  const handleAttendanceStatusChange = (studentId, status) => {
    if (!attendanceData) return;

    setAttendanceData(prev => ({
      ...prev,
      students: prev.students.map(student => {
        if (student.student_id === studentId) {
          return {
            ...student,
            attendance: {
              ...student.attendance,
              student_id: studentId,
              status: status,
              notes: student.attendance?.notes || '',
            },
          };
        }
        return student;
      }),
    }));
  };

  const handleSaveAttendance = async () => {
    if (!attendanceData || !selectedSessionForAttendance) return;

    try {
      setSavingAttendance(true);

      if (!attendanceData || !attendanceData.students) {
        alert('No attendance data available');
        return;
      }

      const attendanceRecords = attendanceData.students
        .filter(student => student.attendance && student.attendance.status)
        .map(student => ({
          student_id: student.student_id,
          status: student.attendance?.status || 'Present',
          notes: student.attendance?.notes || '',
        }));

      if (selectedSessionForAttendance.classsession_id) {
        await apiRequest(`/attendance/session/${selectedSessionForAttendance.classsession_id}`, {
          method: 'POST',
          body: JSON.stringify({ attendance: attendanceRecords }),
        });

        await fetchAttendanceData(selectedSessionForAttendance.classsession_id);
        setAttendanceJustSaved(true);

        // Refresh class sessions to update status in the table
        if (selectedClassForDetails) {
          try {
            const sessionsResponse = await apiRequest(`/classes/${selectedClassForDetails.class_id}/sessions`);
            if (sessionsResponse.success && sessionsResponse.data) {
              // Sort sessions by scheduled_date, then phase_number, then phase_session_number
              const sortedSessions = sessionsResponse.data.sort((a, b) => {
                if (a.scheduled_date !== b.scheduled_date) {
                  return new Date(a.scheduled_date) - new Date(b.scheduled_date);
                }
                if (a.phase_number !== b.phase_number) {
                  return a.phase_number - b.phase_number;
                }
                return a.phase_session_number - b.phase_session_number;
              });
              setClassSessions(sortedSessions);
            }
          } catch (sessionsErr) {
            console.error('Error refreshing class sessions:', sessionsErr);
          }
        }
      } else {
        alert('Please generate class sessions first before marking attendance.');
        return;
      }
    } catch (err) {
      console.error('Error saving attendance:', err);
      alert(err.message || 'Failed to save attendance');
    } finally {
      setSavingAttendance(false);
    }
  };

  const fetchClasses = async () => {
    // Filter by admin's branch
    try {
      setLoading(true);
      // Request a higher limit to get all classes filtered by admin's branch
      const response = await apiRequest(`/classes?branch_id=${adminBranchId}&limit=100`);
      setClasses(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch classes');
      console.error('Error fetching classes:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      // Request a higher limit to get all branches (backend default is 20)
      const response = await apiRequest('/branches?limit=100');
      setBranches(response.data || []);
    } catch (err) {
      console.error('Error fetching branches:', err);
    }
  };

  const fetchPrograms = async () => {
    try {
      // Request a higher limit to get all programs (backend default is 20)
      const response = await apiRequest('/programs?limit=100');
      setPrograms(response.data || []);
    } catch (err) {
      console.error('Error fetching programs:', err);
    }
  };

  const fetchRooms = async () => {
    try {
      const response = await apiRequest('/rooms');
      setRooms(response.data || []);
    } catch (err) {
      console.error('Error fetching rooms:', err);
    }
  };

  const fetchTeachers = async () => {
    try {
      const response = await apiRequest('/users?user_type=Teacher&limit=100');
      setTeachers(response.data || []);
    } catch (err) {
      console.error('Error fetching teachers:', err);
    }
  };

  const handleDelete = async (classId) => {
    setOpenMenuId(null);
    
    // Verify class belongs to admin's branch
    const classItem = classes.find(c => c.class_id === classId);
    if (classItem && classItem.branch_id !== adminBranchId) {
      alert('You can only delete classes from your branch.');
      return;
    }
    
    if (!window.confirm('Are you sure you want to delete this class?')) {
      return;
    }

    try {
      await apiRequest(`/classes/${classId}`, {
        method: 'DELETE',
      });
      fetchClasses();
    } catch (err) {
      alert(err.message || 'Failed to delete class');
    }
  };

  // Helper function to calculate session date
  const calculateSessionDate = (startDate, daysOfWeek, phaseNumber, sessionNumber, sessionsPerPhase) => {
    if (!startDate || !daysOfWeek || daysOfWeek.length === 0 || !phaseNumber || !sessionNumber) {
      return null;
    }

    const dayMap = {
      'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
      'Thursday': 4, 'Friday': 5, 'Saturday': 6
    };

    const sortedDays = [...daysOfWeek].sort((a, b) => {
      const dayA = typeof a === 'string' ? dayMap[a] : dayMap[a.day_of_week];
      const dayB = typeof b === 'string' ? dayMap[b] : dayMap[b.day_of_week];
      return dayA - dayB;
    });

    const dayNames = sortedDays.map(day => typeof day === 'string' ? day : day.day_of_week);
    const dayNumbers = dayNames.map(day => dayMap[day]);

    // Parse start date as local date (YYYY-MM-DD format from database)
    // Treat as Asia/Manila UTC+8 - parse as local date components
    const [year, month, day] = startDate.split('-').map(Number);
    
    // Create date object in local timezone (UTC+8) - use noon to avoid DST/timezone edge cases
    const start = new Date(year, month - 1, day, 12, 0, 0);
    const startDayOfWeek = start.getDay(); // 0 = Sunday, 1 = Monday, etc.

    // Calculate which session number this is (1-indexed across all phases)
    const overallSessionNumber = sessionsPerPhase 
      ? (phaseNumber - 1) * sessionsPerPhase + sessionNumber
      : sessionNumber;

    // Session index (0-indexed)
    const sessionIndex = overallSessionNumber - 1;
    
    // Which day in the cycle (0 = first enabled day, 1 = second enabled day, etc.)
    const dayIndexInCycle = sessionIndex % dayNames.length;
    
    // Which week (0 = first week, 1 = second week, etc.)
    const weekOffset = Math.floor(sessionIndex / dayNames.length);

    // Get the target day name and number for this session
    const targetDayName = dayNames[dayIndexInCycle];
    const targetDayNumber = dayMap[targetDayName];

    // Find the first enabled day in the cycle
    const firstDayNumber = dayNumbers[0];
    
    // Check if start date is already on an enabled day
    let baseDate;
    let baseDayOfWeek;
    
    if (dayNumbers.includes(startDayOfWeek)) {
      // Start date is on an enabled day, use it as the base
      baseDate = new Date(year, month - 1, day, 12, 0, 0);
      baseDayOfWeek = startDayOfWeek;
    } else {
      // Start date is not on an enabled day, find the next enabled day
      let daysUntilFirstDay = firstDayNumber - startDayOfWeek;
      if (daysUntilFirstDay < 0) {
        daysUntilFirstDay += 7; // Next week
      }
      baseDate = new Date(year, month - 1, day + daysUntilFirstDay, 12, 0, 0);
      baseDayOfWeek = firstDayNumber;
    }
    
    // Find which position the base day is in the enabled days cycle
    const baseDayIndex = dayNumbers.indexOf(baseDayOfWeek);
    
    // Calculate which day in the cycle this session should be on
    const targetDayIndex = dayIndexInCycle;
    
    // Calculate how many days to add from base date
    let daysToAdd = 0;
    
    if (targetDayIndex >= baseDayIndex) {
      // Target day is same week or later in the cycle
      daysToAdd = (targetDayIndex - baseDayIndex) + (weekOffset * 7);
    } else {
      // Target day is earlier in the cycle, need to go to next week
      daysToAdd = (dayNames.length - baseDayIndex) + targetDayIndex + (weekOffset * 7);
    }
    
    // Calculate the final session date
    const sessionDate = new Date(baseDate);
    sessionDate.setDate(baseDate.getDate() + daysToAdd);

    // Format as YYYY-MM-DD (using local date components to avoid timezone conversion)
    // This ensures we get the correct date in UTC+8 timezone
    const resultYear = sessionDate.getFullYear();
    const resultMonth = String(sessionDate.getMonth() + 1).padStart(2, '0');
    const resultDay = String(sessionDate.getDate()).padStart(2, '0');
    return `${resultYear}-${resultMonth}-${resultDay}`;
  };

  // Calculate which phase is currently active based on today's date
  const calculateActivePhase = (phaseSessions, classSessions, classDetails, daysOfWeek, sessionsPerPhase) => {
    if (!phaseSessions || phaseSessions.length === 0 || !classDetails.start_date) {
      return 1; // Default to Phase 1 if no data
    }

    const today = new Date();
    today.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues
    const todayStr = today.toISOString().split('T')[0]; // Format as YYYY-MM-DD

    // Group sessions by phase
    const sessionsByPhase = phaseSessions.reduce((acc, session) => {
      const phaseNum = session.phase_number;
      if (!acc[phaseNum]) {
        acc[phaseNum] = [];
      }
      acc[phaseNum].push(session);
      return acc;
    }, {});

    // Find the active phase by checking which phase contains today's date
    const sortedPhases = Object.keys(sessionsByPhase)
      .map(Number)
      .sort((a, b) => a - b);

    for (const phaseNum of sortedPhases) {
      const phaseSessions = sessionsByPhase[phaseNum].sort((a, b) => a.phase_session_number - b.phase_session_number);
      
      // Get first and last session dates for this phase
      const firstSession = phaseSessions[0];
      const lastSession = phaseSessions[phaseSessions.length - 1];

      // Try to get dates from database sessions first
      let firstSessionDate = classSessions.find(cs => 
        cs.phase_number === firstSession.phase_number && 
        cs.phase_session_number === firstSession.phase_session_number
      )?.scheduled_date;

      let lastSessionDate = classSessions.find(cs => 
        cs.phase_number === lastSession.phase_number && 
        cs.phase_session_number === lastSession.phase_session_number
      )?.scheduled_date;

      // If not in database, calculate dates
      if (!firstSessionDate && classDetails.start_date && sessionsPerPhase) {
        firstSessionDate = calculateSessionDate(
          classDetails.start_date,
          daysOfWeek,
          firstSession.phase_number,
          firstSession.phase_session_number,
          sessionsPerPhase
        );
      }

      if (!lastSessionDate && classDetails.start_date && sessionsPerPhase) {
        lastSessionDate = calculateSessionDate(
          classDetails.start_date,
          daysOfWeek,
          lastSession.phase_number,
          lastSession.phase_session_number,
          sessionsPerPhase
        );
      }

      // Check if today falls within this phase's date range
      if (firstSessionDate && lastSessionDate) {
        if (todayStr >= firstSessionDate && todayStr <= lastSessionDate) {
          return phaseNum;
        }
      } else if (firstSessionDate && todayStr >= firstSessionDate) {
        // If we have first date but not last, check if today is after first
        // This handles cases where we're in the middle of a phase
        return phaseNum;
      }
    }

    // If no active phase found, check if class hasn't started yet
    const firstPhaseSessions = sessionsByPhase[sortedPhases[0]];
    if (firstPhaseSessions && firstPhaseSessions.length > 0) {
      const firstSession = firstPhaseSessions[0];
      const firstSessionDate = classSessions.find(cs => 
        cs.phase_number === firstSession.phase_number && 
        cs.phase_session_number === firstSession.phase_session_number
      )?.scheduled_date || (classDetails.start_date && sessionsPerPhase
        ? calculateSessionDate(
            classDetails.start_date,
            daysOfWeek,
            firstSession.phase_number,
            firstSession.phase_session_number,
            sessionsPerPhase
          )
        : null);

      if (firstSessionDate && todayStr < firstSessionDate) {
        return sortedPhases[0]; // Class hasn't started, show first phase
      }
    }

    // If today is past all phases' date ranges, find the first completed phase
    // and return the next phase if it exists, otherwise return the last phase
    // Loop forward through phases to find the first one that's completed
    for (let i = 0; i < sortedPhases.length; i++) {
      const phaseNum = sortedPhases[i];
      const phaseSessions = sessionsByPhase[phaseNum].sort((a, b) => a.phase_session_number - b.phase_session_number);
      const lastSession = phaseSessions[phaseSessions.length - 1];
      
      // Get last session date
      let lastSessionDate = classSessions.find(cs => 
        cs.phase_number === lastSession.phase_number && 
        cs.phase_session_number === lastSession.phase_session_number
      )?.scheduled_date;

      // If not in database, calculate date
      if (!lastSessionDate && classDetails.start_date && sessionsPerPhase) {
        lastSessionDate = calculateSessionDate(
          classDetails.start_date,
          daysOfWeek,
          lastSession.phase_number,
          lastSession.phase_session_number,
          sessionsPerPhase
        );
      }

      // If this phase is completed (today > last session date), check for next phase
      if (lastSessionDate && todayStr > lastSessionDate) {
        // Check if there's a next phase
        if (i < sortedPhases.length - 1) {
          // This phase is completed, return the next phase
          return sortedPhases[i + 1];
        } else {
          // This is the last phase and it's completed, return it
          return phaseNum;
        }
      }
    }

    // Default to last phase if class has ended, or Phase 1 if no match
    return sortedPhases[sortedPhases.length - 1] || 1;
  };

  const handleViewClass = async (classItem) => {
    setOpenMenuId(null);
    setViewMode('detail');
    setLoadingPhaseSessions(true);
    setLoadingClassSessions(true);
    setPhaseSessions([]);
    setClassSessions([]);
    setMergeHistory([]); // Clear previous merge history

    try {
      // Fetch phase sessions (curriculum template)
      const phaseResponse = await apiRequest(`/classes/${classItem.class_id}/phasesessions`);
      // Fetch class details to check if it's a merged class
      const classDetailsResponse = await apiRequest(`/classes/${classItem.class_id}`);
      const isMergedClass = classDetailsResponse.data?.is_merged_class || false;
      
      // Update selectedClassForDetails with fresh data including schedules
      let classDetails;
      if (phaseResponse.data?.class) {
        classDetails = {
          ...classItem,
          ...phaseResponse.data.class,
          // Preserve days_of_week from response or fallback to classItem
          days_of_week: phaseResponse.data.class.days_of_week || classItem.days_of_week || [],
          is_merged_class: isMergedClass,
          merge_history_id: classDetailsResponse.data?.merge_history_id || null,
        };
        setSelectedClassForDetails(classDetails);
      } else {
        classDetails = {
          ...classItem,
          is_merged_class: isMergedClass,
          merge_history_id: classDetailsResponse.data?.merge_history_id || null,
        };
        setSelectedClassForDetails(classDetails);
      }

      // Don't auto-fetch merge history - only fetch when user clicks "View History"
      const fetchedPhaseSessions = phaseResponse.data?.phasesessions || [];
      setPhaseSessions(fetchedPhaseSessions);

      // Fetch actual class sessions (from database)
      let fetchedClassSessions = [];
      try {
        const sessionsResponse = await apiRequest(`/classes/${classItem.class_id}/sessions`);
        if (sessionsResponse.success && sessionsResponse.data) {
          // Sort sessions by scheduled_date, then phase_number, then phase_session_number
          const sortedSessions = sessionsResponse.data.sort((a, b) => {
            if (a.scheduled_date !== b.scheduled_date) {
              return new Date(a.scheduled_date) - new Date(b.scheduled_date);
            }
            if (a.phase_number !== b.phase_number) {
              return a.phase_number - b.phase_number;
            }
            return a.phase_session_number - b.phase_session_number;
          });
          fetchedClassSessions = sortedSessions;
          setClassSessions(sortedSessions);
        } else {
          setClassSessions([]);
        }
      } catch (sessionsErr) {
        console.error('Error fetching class sessions:', sessionsErr);
        // If sessions don't exist yet, that's okay - we'll use calculated dates as fallback
        setClassSessions([]);
      }

      // Calculate active phase based on today's date
      const daysOfWeek = classDetails.days_of_week || [];
      const sessionsPerPhase = classDetails.number_of_session_per_phase;
      const activePhase = calculateActivePhase(
        fetchedPhaseSessions,
        fetchedClassSessions,
        classDetails,
        daysOfWeek,
        sessionsPerPhase
      );
      setExpandedPhases(new Set([activePhase])); // Set active phase as expanded
    } catch (err) {
      console.error('Error fetching phase sessions:', err);
      setSelectedClassForDetails(classItem);
      setPhaseSessions([]);
      setClassSessions([]);
      setExpandedPhases(new Set([1])); // Fallback to Phase 1 on error
    } finally {
      setLoadingPhaseSessions(false);
      setLoadingClassSessions(false);
    }
  };

  const handleBackToList = () => {
    setViewMode('list');
    setSelectedClassForDetails(null);
    setPhaseSessions([]);
    setClassSessions([]);
  };

  const handleUnenrollStudent = async (student) => {
    if (!selectedClassForEnrollment) return;
    
    const studentName = student.full_name || `Student ID: ${student.user_id}`;
    const reason = window.prompt(
      `Are you sure you want to unenroll ${studentName} from this class?\n\n` +
      `Please provide a reason (e.g., "Client informed student will not continue"):`
    );
    
    if (!reason || reason.trim() === '') {
      alert('Unenrollment cancelled. Reason is required.');
      return;
    }
    
    if (!window.confirm(`Confirm unenrollment of ${studentName}?\n\nReason: ${reason.trim()}`)) {
      return;
    }

    try {
      setLoadingEnrolledStudents(true);
      
      // Fetch all enrollment records for this student in this class
      const enrollmentResponse = await apiRequest(`/students/class/${selectedClassForEnrollment.class_id}`);
      const allStudents = enrollmentResponse.data || [];
      
      // Find all enrollment IDs for this student (can have multiple phases)
      const enrollmentIds = allStudents
        .filter(s => s.user_id === student.user_id && s.classstudent_id)
        .map(s => s.classstudent_id);
      
      if (enrollmentIds.length === 0) {
        alert('No active enrollment found for this student.');
        return;
      }
      
      // Unenroll all enrollments for this student
      const unenrollPromises = enrollmentIds.map(enrollmentId =>
        apiRequest(`/students/unenroll/${enrollmentId}`, {
          method: 'DELETE',
        }).then(response => {
          // API returns { success: true, message: ... }
          return { success: true, enrollmentId, response };
        }).catch(err => {
          console.error(`Error unenrolling enrollment ${enrollmentId}:`, err);
          return { success: false, enrollmentId, error: err.message || err.response?.data?.message || 'Unknown error' };
        })
      );
      
      const results = await Promise.all(unenrollPromises);
      const successCount = results.filter(r => r.success === true).length;
      const failCount = results.filter(r => r.success === false).length;
      
      if (successCount > 0) {
        alert(`Student ${studentName} has been unenrolled successfully.${failCount > 0 ? `\n\nNote: ${failCount} enrollment(s) could not be removed.` : ''}`);
        // Refresh enrolled students list
        await fetchEnrolledStudents(selectedClassForEnrollment.class_id);
      } else {
        alert(`Failed to unenroll student. Please try again.`);
      }
    } catch (err) {
      console.error('Error unenrolling student:', err);
      alert(err.message || 'Failed to unenroll student. Please try again.');
    } finally {
      setLoadingEnrolledStudents(false);
    }
  };

  const fetchEnrolledStudents = async (classId, phaseNumber = null) => {
    try {
      setLoadingEnrolledStudents(true);
      
      // Fetch both enrolled students and reserved students
      const [enrolledResponse, reservedResponse] = await Promise.all([
        apiRequest(`/students/class/${classId}`).catch(() => ({ data: [] })),
        apiRequest(`/reservations?class_id=${classId}`).catch(() => ({ data: [] }))
      ]);
      
      let enrolledStudents = enrolledResponse.data || [];
      let reservedStudents = reservedResponse.data || [];
      
      // Filter enrolled students by phase if specified
      if (phaseNumber !== null) {
        enrolledStudents = enrolledStudents.filter(s => s.phase_number === phaseNumber);
      }
      
      // Group enrolled students by student_id to show only unique students
      // Collect all phases for each student and keep the earliest enrollment info
      const uniqueEnrolledStudents = enrolledStudents.reduce((acc, student) => {
        const existing = acc.find(s => s.user_id === student.user_id);
        if (!existing) {
          // First time seeing this student - initialize with phases array
          acc.push({
            ...student,
            student_type: student.student_type || 'enrolled', // Preserve student_type from API (enrolled or pending)
            phases: [student.phase_number],
            highestPhase: student.phase_number,
            earliestEnrollment: student.enrolled_at,
            enrolledBy: student.enrolled_by
          });
        } else {
          // Student already exists - add phase if not already included
          if (!existing.phases.includes(student.phase_number)) {
            existing.phases.push(student.phase_number);
            existing.phases.sort((a, b) => a - b); // Sort phases ascending
          }
          // Update highest phase
          if (student.phase_number > existing.highestPhase) {
            existing.highestPhase = student.phase_number;
          }
          // Keep earliest enrollment date and original enrolled_by
          if (student.enrolled_at && existing.earliestEnrollment &&
              new Date(student.enrolled_at) < new Date(existing.earliestEnrollment)) {
            existing.earliestEnrollment = student.enrolled_at;
            existing.enrolledBy = student.enrolled_by;
          }
        }
        return acc;
      }, []);
      
      // Format phases display for each enrolled student
      uniqueEnrolledStudents.forEach(student => {
        student.phasesDisplay = student.phases.length > 1 
          ? `Phases ${student.phases.join(', ')}`
          : `Phase ${student.phases[0]}`;
      });
      
      // Helper function to check if a reserved student should be counted towards class capacity
      const shouldCountReservedStudent = (reservation) => {
        // Don't count if status is Expired, Cancelled, or Upgraded
        if (['Expired', 'Cancelled', 'Upgraded'].includes(reservation.status)) {
          return false;
        }
        
        // Check if due date has passed and payment is unpaid
        const dueDateToCheck = reservation.due_date || reservation.reservation_invoice_due_date;
        if (dueDateToCheck) {
          const today = new Date();
          today.setHours(0, 0, 0, 0); // Reset time to start of day
          const dueDate = new Date(dueDateToCheck);
          dueDate.setHours(0, 0, 0, 0);
          
          // If due date has passed (including today if it's past due date)
          if (dueDate < today) {
            // Check if invoice is unpaid
            // The backend returns invoice_id as reservation_invoice_id
            const hasInvoice = reservation.invoice_id || reservation.reservation_invoice_id;
            const invoiceStatus = reservation.invoice_status;
            
            // If no invoice exists, it's unpaid
            // If invoice exists, check if status is not Paid or Partially Paid
            const isUnpaid = !hasInvoice || 
                             (invoiceStatus && 
                              !['Paid', 'Partially Paid'].includes(invoiceStatus));
            
            // If past due and unpaid, don't count
            if (isUnpaid) {
              return false;
            }
          }
        }
        
        // Count if status is 'Reserved' or 'Fee Paid' and not past due/unpaid
        return ['Reserved', 'Fee Paid'].includes(reservation.status);
      };
      
      // Convert reserved students to match enrolled students format
      // Only include reserved students who are NOT already enrolled
      // But include ALL reserved students (even expired/unpaid) - we'll filter for count separately
      const enrolledStudentIds = new Set(uniqueEnrolledStudents.map(s => s.user_id));
      
      const formattedReservedStudents = reservedStudents
        .filter(reservation => {
          // Exclude if already enrolled
          if (enrolledStudentIds.has(reservation.student_id)) return false;
          return true; // Include all reservations for display, even expired/unpaid
        })
        .map(reservation => {
          const shouldCount = shouldCountReservedStudent(reservation);
          
          return {
            user_id: reservation.student_id,
            full_name: reservation.student_name,
            email: reservation.student_email,
            level_tag: reservation.level_tag || null,
            phase_number: null, // Reservations are for entire class, not specific phase
            enrolled_at: reservation.reserved_at,
            enrolled_by: null,
            student_type: 'reserved',
            reservation_id: reservation.reserved_id,
            reservation_status: reservation.status,
            package_name: reservation.package_name,
            reservation_fee: reservation.reservation_fee,
            reservation_invoice_due_date: reservation.reservation_invoice_due_date,
            due_date: reservation.due_date || reservation.reservation_invoice_due_date,
            expired_at: reservation.expired_at,
            invoice_id: reservation.invoice_id || reservation.reservation_invoice_id,
            invoice_status: reservation.invoice_status,
            phases: [],
            phasesDisplay: 'Reserved',
            highestPhase: null,
            earliestEnrollment: reservation.reserved_at,
            shouldCount: shouldCount, // Flag to indicate if this student should be counted
          };
        });
      
      // Combine enrolled and reserved students
      const allStudents = [...uniqueEnrolledStudents, ...formattedReservedStudents];
      
      // Sort: enrolled students first, then reserved students
      allStudents.sort((a, b) => {
        if (a.student_type === 'enrolled' && b.student_type === 'reserved') return -1;
        if (a.student_type === 'reserved' && b.student_type === 'enrolled') return 1;
        // Within same type, sort by name
        return (a.full_name || '').localeCompare(b.full_name || '');
      });
      
      setEnrolledStudents(allStudents);
      return allStudents;
    } catch (err) {
      console.error('Error fetching enrolled students:', err);
      setEnrolledStudents([]);
      return [];
    } finally {
      setLoadingEnrolledStudents(false);
    }
  };

  // Helper function to check if a reserved student should be counted towards class capacity
  const shouldCountReservation = (reservation) => {
    // Don't count if status is Expired, Cancelled, or Upgraded
    if (['Expired', 'Cancelled', 'Upgraded'].includes(reservation.status)) {
      return false;
    }
    
    // Check if due date has passed and payment is unpaid
    const dueDateToCheck = reservation.due_date || reservation.reservation_invoice_due_date;
    if (dueDateToCheck) {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset time to start of day
      const dueDate = new Date(dueDateToCheck);
      dueDate.setHours(0, 0, 0, 0);
      
      // If due date has passed (including today if it's past due date)
      if (dueDate < today) {
        // Check if invoice is unpaid
        // The backend returns invoice_id as reservation_invoice_id
        const hasInvoice = reservation.invoice_id || reservation.reservation_invoice_id;
        const invoiceStatus = reservation.invoice_status;
        
        // If no invoice exists, it's unpaid
        // If invoice exists, check if status is not Paid or Partially Paid
        const isUnpaid = !hasInvoice || 
                         (invoiceStatus && 
                          !['Paid', 'Partially Paid'].includes(invoiceStatus));
        
        // If past due and unpaid, don't count
        if (isUnpaid) {
          return false;
        }
      }
    }
    
    // Count if status is 'Reserved' or 'Fee Paid' and not past due/unpaid
    return ['Reserved', 'Fee Paid'].includes(reservation.status);
  };

  const fetchEnrollReservedStudents = async (classId) => {
    try {
      const response = await apiRequest(`/reservations?class_id=${classId}`);
      // Get all reservations (we'll filter for counting separately)
      setEnrollReservedStudents(response.data || []);
    } catch (err) {
      console.error('Error fetching reserved students:', err);
      setEnrollReservedStudents([]);
    }
  };

  // Helper function to get count of reserved students that should be counted
  const getCountableReservedStudents = () => {
    return enrollReservedStudents.filter(shouldCountReservation).length;
  };

  // Helper function to get count of students that should be counted (from enrolledStudents array)
  const getCountableStudents = (students) => {
    return students.filter(student => {
      if (student.student_type === 'enrolled') {
        // Exclude delinquent/removed students from capacity counts
        // Backend provides either `shouldCount` (boolean) or `enrollment_status`
        if (student.shouldCount === false) return false;
        if (student.enrollment_status && student.enrollment_status !== 'Active') return false;
        return true;
      }
      if (student.student_type === 'reserved') {
        // Only count reserved students that should be counted (not expired/unpaid past due)
        return student.shouldCount !== false; // Default to true if not set
      }
      return false;
    }).length;
  };

  const fetchEnrolledStudentsForView = async (classId, phaseNumber = null) => {
    try {
      setLoadingViewStudents(true);
      
      // Fetch both enrolled students and reserved students
      const [enrolledResponse, reservedResponse] = await Promise.all([
        apiRequest(`/students/class/${classId}`).catch(() => ({ data: [] })),
        apiRequest(`/reservations?class_id=${classId}`).catch(() => ({ data: [] }))
      ]);
      
      let enrolledStudents = enrolledResponse.data || [];
      let reservedStudents = reservedResponse.data || [];
      
      // Filter enrolled students by phase if specified
      if (phaseNumber !== null) {
        enrolledStudents = enrolledStudents.filter(s => s.phase_number === phaseNumber);
      }
      
      // Group enrolled students by student_id to show only unique students
      // Collect all phases for each student and keep the earliest enrollment info
      const uniqueEnrolledStudents = enrolledStudents.reduce((acc, student) => {
        const existing = acc.find(s => s.user_id === student.user_id);
        if (!existing) {
          // First time seeing this student - initialize with phases array
          acc.push({
            ...student,
            student_type: student.student_type || 'enrolled', // Preserve student_type from API (enrolled or pending)
            phases: [student.phase_number],
            highestPhase: student.phase_number,
            earliestEnrollment: student.enrolled_at,
            enrolledBy: student.enrolled_by
          });
        } else {
          // Student already exists - add phase if not already included
          if (!existing.phases.includes(student.phase_number)) {
            existing.phases.push(student.phase_number);
            existing.phases.sort((a, b) => a - b); // Sort phases ascending
          }
          // Update highest phase
          if (student.phase_number > existing.highestPhase) {
            existing.highestPhase = student.phase_number;
          }
          // Keep earliest enrollment date and original enrolled_by
          if (student.enrolled_at && existing.earliestEnrollment &&
              new Date(student.enrolled_at) < new Date(existing.earliestEnrollment)) {
            existing.earliestEnrollment = student.enrolled_at;
            existing.enrolledBy = student.enrolled_by;
          }
        }
        return acc;
      }, []);
      
      // Format phases display for each enrolled student
      uniqueEnrolledStudents.forEach(student => {
        student.phasesDisplay = student.phases.length > 1 
          ? `Phases ${student.phases.join(', ')}`
          : `Phase ${student.phases[0]}`;
      });
      
      // Helper function to check if a reserved student should be counted towards class capacity
      const shouldCountReservedStudent = (reservation) => {
        // Don't count if status is Expired, Cancelled, or Upgraded
        if (['Expired', 'Cancelled', 'Upgraded'].includes(reservation.status)) {
          return false;
        }
        
        // Check if due date has passed and payment is unpaid
        if (reservation.due_date) {
          const today = new Date();
          today.setHours(0, 0, 0, 0); // Reset time to start of day
          const dueDate = new Date(reservation.due_date);
          dueDate.setHours(0, 0, 0, 0);
          
          // If due date has passed
          if (dueDate < today) {
            // Check if invoice is unpaid
            // If no invoice_id, it's unpaid
            // If invoice exists, check if status is not Paid or Partially Paid
            const isUnpaid = !reservation.invoice_id || 
                             (reservation.invoice_status && 
                              !['Paid', 'Partially Paid'].includes(reservation.invoice_status));
            
            // If past due and unpaid, don't count
            if (isUnpaid) {
              return false;
            }
          }
        }
        
        // Count if status is 'Reserved' or 'Fee Paid' and not past due/unpaid
        return ['Reserved', 'Fee Paid'].includes(reservation.status);
      };
      
      // Convert reserved students to match enrolled students format
      // Include ALL reserved students for display, but mark which ones should be counted
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const formattedReservedStudents = reservedStudents.map(reservation => {
        const shouldCount = shouldCountReservedStudent(reservation);
        
        return {
          user_id: reservation.student_id,
          full_name: reservation.student_name,
          email: reservation.student_email,
          level_tag: null, // Reserved students may not have level_tag
          phase_number: null, // Reservations are for entire class, not specific phase
          enrolled_at: reservation.reserved_at,
          enrolled_by: null,
          student_type: 'reserved',
          reservation_id: reservation.reserved_id,
          reservation_status: reservation.status,
          package_name: reservation.package_name,
          reservation_fee: reservation.reservation_fee,
          due_date: reservation.due_date,
          expired_at: reservation.expired_at,
          invoice_status: reservation.invoice_status,
          phases: [],
          phasesDisplay: 'Reserved',
          highestPhase: null,
          earliestEnrollment: reservation.reserved_at,
          shouldCount: shouldCount, // Flag to indicate if this student should be counted
        };
      });
      
      // Combine enrolled and reserved students
      // All students are included for display
      const allStudents = [...uniqueEnrolledStudents, ...formattedReservedStudents];
      
      // Sort: enrolled students first, then reserved students
      allStudents.sort((a, b) => {
        if (a.student_type === 'enrolled' && b.student_type === 'reserved') return -1;
        if (a.student_type === 'reserved' && b.student_type === 'enrolled') return 1;
        // Within same type, sort by name
        return (a.full_name || '').localeCompare(b.full_name || '');
      });
      
      setViewEnrolledStudents(allStudents);
      return allStudents;
    } catch (err) {
      console.error('Error fetching students:', err);
      setViewEnrolledStudents([]);
      return [];
    } finally {
      setLoadingViewStudents(false);
    }
  };

  const openMergeModal = async (classItem) => {
    setOpenMenuId(null);
    setSelectedClassForMerge(classItem);
    setSelectedMergeTargetClasses([]);
    setClassesWithInactivatedSchedules(new Set());
    setMergeStep('select-class');
    setSourceClassSchedule([]);
    setManualSchedule([]);
    setMergeFormData({
      class_name: '',
      teacher_ids: [],
      room_id: classItem.room_id ? classItem.room_id.toString() : '', // Default to source class room
    });
    setIsMergeModalOpen(true);

    // Filter classes that can be merged with (same phase_number and level_tag, exclude current class)
    const eligibleClasses = classes.filter(c => 
      c.class_id !== classItem.class_id &&
      (c.class_phase_number === classItem.class_phase_number || (c.class_phase_number === null && classItem.class_phase_number === null)) &&
      c.level_tag === classItem.level_tag &&
      c.status === 'Active'
    );
    setMergeTargetClasses(eligibleClasses);

    // Fetch schedule for source class
    if (classItem.days_of_week && classItem.days_of_week.length > 0) {
      setSourceClassSchedule(classItem.days_of_week);
      // Initialize manual schedule with source schedule
      setManualSchedule(classItem.days_of_week.map(day => ({ ...day })));
    } else {
      try {
        const scheduleResponse = await apiRequest(`/classes/${classItem.class_id}`);
        if (scheduleResponse.data && scheduleResponse.data.days_of_week) {
          setSourceClassSchedule(scheduleResponse.data.days_of_week);
          setManualSchedule(scheduleResponse.data.days_of_week.map(day => ({ ...day })));
        }
      } catch (err) {
        console.error('Error fetching source class schedule:', err);
      }
    }
  };

  const closeMergeModal = () => {
    // Restore schedules for all classes that were selected
    setClassesWithInactivatedSchedules(new Set());
    setIsMergeModalOpen(false);
    setSelectedClassForMerge(null);
    setSelectedMergeTargetClasses([]);
    setMergeStep('select-class');
    setMergeTargetClasses([]);
    setUseSourceSchedule(true); // Reset to default
    setSourceClassSchedule([]);
    setManualSchedule([]);
    setMergeFormData({
      class_name: '',
      teacher_ids: [],
      room_id: '',
    });
    setExpandedCalendarDays(new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']));
    setExpandedSchedulesPerDay({});
    fetchClasses(); // Refresh to show normal state
  };

  const handleMergeTargetToggle = (targetClass) => {
    const isSelected = selectedMergeTargetClasses.some(c => c.class_id === targetClass.class_id);
    
    if (isSelected) {
      // Deselect: Remove from selection and restore schedule
      setSelectedMergeTargetClasses(prev => prev.filter(c => c.class_id !== targetClass.class_id));
      setClassesWithInactivatedSchedules(prev => {
        const newSet = new Set(prev);
        newSet.delete(targetClass.class_id);
        return newSet;
      });
    } else {
      // Select: Add to selection and inactivate schedule
      setSelectedMergeTargetClasses(prev => [...prev, targetClass]);
      setClassesWithInactivatedSchedules(prev => new Set(prev).add(targetClass.class_id));
      
      // Combine teacher IDs from all selected classes
      const allTeacherIds = new Set();
      if (selectedClassForMerge.teacher_id) {
        allTeacherIds.add(selectedClassForMerge.teacher_id.toString());
        }
      selectedMergeTargetClasses.forEach(c => {
        if (c.teacher_id) {
          allTeacherIds.add(c.teacher_id.toString());
        }
      });
      if (targetClass.teacher_id) {
        allTeacherIds.add(targetClass.teacher_id.toString());
    }

      // Combine class names
      const classNames = [
        selectedClassForMerge.class_name || selectedClassForMerge.level_tag,
        ...selectedMergeTargetClasses.map(c => c.class_name || c.level_tag),
        targetClass.class_name || targetClass.level_tag
      ].filter(Boolean);
      const combinedClassName = classNames.join(' & ').substring(0, 100);
      
      setMergeFormData(prev => ({
        ...prev,
        class_name: combinedClassName,
        teacher_ids: Array.from(allTeacherIds),
      }));
    }
  };

  const handleContinueToSchedule = () => {
    if (selectedMergeTargetClasses.length === 0) {
      alert('Please select at least one class to merge with');
      return;
    }
    setMergeStep('choose-schedule');
    
    // Fetch room schedules when entering the choose-schedule step
    // Exclude classes involved in the merge (source + targets)
    if (mergeFormData.room_id) {
      const mergeClassIds = [
        selectedClassForMerge.class_id,
        ...selectedMergeTargetClasses.map(c => c.class_id)
      ];
      fetchRoomSchedules(mergeFormData.room_id, mergeClassIds);
    }
  };

  // Check for schedule conflicts when manual schedule or room changes
  const checkMergeScheduleConflicts = useCallback(() => {
    if (!mergeFormData.room_id || useSourceSchedule || !manualSchedule || manualSchedule.length === 0) {
      setMergeScheduleConflicts([]);
      return;
    }

    // Get all class IDs being merged (to exclude from conflict check)
    const mergeClassIds = [
      selectedClassForMerge?.class_id,
      ...selectedMergeTargetClasses.map(c => c.class_id)
    ].filter(Boolean);

    // Filter room schedules to exclude classes being merged
    const relevantSchedules = roomSchedules.filter(
      schedule => schedule.class_id && !mergeClassIds.includes(schedule.class_id)
    );

    const conflicts = [];
    const enabledDays = manualSchedule.filter(
      day => day.day_of_week && day.start_time && day.end_time
    );

    for (const daySchedule of enabledDays) {
      // Find existing schedules for the same day and room
      const existingSchedules = relevantSchedules.filter(
        s => s.day_of_week === daySchedule.day_of_week
      );

      for (const existing of existingSchedules) {
        if (!existing.start_time || !existing.end_time) continue;

        // Convert times to minutes for comparison
        const timeToMinutes = (timeStr) => {
          if (!timeStr) return 0;
          const parts = timeStr.split(':');
          return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
        };

        const newStartMin = timeToMinutes(daySchedule.start_time);
        const newEndMin = timeToMinutes(daySchedule.end_time);
        const existingStartMin = timeToMinutes(existing.start_time);
        const existingEndMin = timeToMinutes(existing.end_time);

        // Check for overlap: newStart < existingEnd AND existingStart < newEnd
        if (newStartMin < existingEndMin && existingStartMin < newEndMin) {
          const className = existing.class_name 
            ? `${existing.program_name || ''} - ${existing.class_name}`.trim()
            : existing.level_tag 
              ? `${existing.program_name || ''} - ${existing.level_tag}`.trim()
              : existing.program_name || `Class ${existing.class_id}`;

          conflicts.push({
            day: daySchedule.day_of_week,
            start_time: daySchedule.start_time.substring(0, 5),
            end_time: daySchedule.end_time.substring(0, 5),
            conflicting_class: {
              class_id: existing.class_id,
              class_name: existing.class_name,
              level_tag: existing.level_tag,
              program_name: existing.program_name,
            },
            conflicting_time: `${existing.start_time.substring(0, 5)} - ${existing.end_time.substring(0, 5)}`,
            message: `Schedule conflicts with "${className}" (${existing.start_time.substring(0, 5)} - ${existing.end_time.substring(0, 5)})`,
          });
        }
      }
    }

    setMergeScheduleConflicts(conflicts);
  }, [mergeFormData.room_id, useSourceSchedule, manualSchedule, roomSchedules, selectedClassForMerge, selectedMergeTargetClasses]);

  // Check conflicts when manual schedule or room changes
  useEffect(() => {
    if (mergeStep === 'choose-schedule' && !useSourceSchedule) {
      checkMergeScheduleConflicts();
    } else {
      setMergeScheduleConflicts([]);
    }
  }, [mergeStep, useSourceSchedule, manualSchedule, mergeFormData.room_id, roomSchedules, checkMergeScheduleConflicts]);

  const handleMergeReview = () => {
    if (!selectedClassForMerge || selectedMergeTargetClasses.length === 0) {
      alert('Please select at least one class to merge with');
      return;
    }
    if (!mergeFormData.room_id || mergeFormData.room_id === '') {
      alert('Please select a room for the merged class');
      return;
    }
    // Validate schedule based on selected mode
    if (useSourceSchedule) {
      if (!sourceClassSchedule || sourceClassSchedule.length === 0 || sourceClassSchedule.filter(s => s.start_time && s.end_time).length === 0) {
        alert('Source class does not have a schedule configured. Please use manual schedule setup.');
        return;
      }
    } else {
      if (!manualSchedule || manualSchedule.length === 0 || manualSchedule.filter(s => s.start_time && s.end_time).length === 0) {
        alert('Please configure the schedule for the merged class');
        return;
      }
      // Check for conflicts before proceeding
      if (mergeScheduleConflicts.length > 0) {
        const conflictMessages = mergeScheduleConflicts.map(c => 
          `${c.day} ${c.start_time}-${c.end_time}: ${c.message}`
        ).join('\n');
        alert(`Cannot proceed: Schedule conflicts detected.\n\n${conflictMessages}\n\nPlease resolve these conflicts before continuing.`);
        return;
      }
    }
    setMergeStep('review');
  };

  const handleMergeSubmit = async () => {
    if (!selectedClassForMerge || selectedMergeTargetClasses.length === 0) {
      alert('Please select at least one class to merge with');
      return;
    }

    const allClassNames = [
      `${selectedClassForMerge.program_name} - ${selectedClassForMerge.class_name || selectedClassForMerge.level_tag}`,
      ...selectedMergeTargetClasses.map(c => `${c.program_name} - ${c.class_name || c.level_tag}`)
    ].join('\n');

    if (!window.confirm(
      `Are you sure you want to merge these ${selectedMergeTargetClasses.length + 1} classes?\n\n` +
      `Classes to merge:\n${allClassNames}\n\n` +
      `This action cannot be undone. All original classes will be deleted and all students will be moved to a new merged class with the configured schedule.`
    )) {
      return;
    }

    setMergeSubmitting(true);
    try {
      // Prepare schedule data based on selected mode
      const scheduleToUse = useSourceSchedule ? sourceClassSchedule : manualSchedule;
      const scheduleData = scheduleToUse
        .filter(day => day.day_of_week && day.start_time && day.end_time)
        .map(day => ({
          day_of_week: day.day_of_week,
          start_time: day.start_time,
          end_time: day.end_time,
        }));

      const response = await apiRequest(`/classes/${selectedClassForMerge.class_id}/merge`, {
        method: 'POST',
        body: JSON.stringify({
          merge_with_class_ids: selectedMergeTargetClasses.map(c => c.class_id), // Array of class IDs
          days_of_week: scheduleData, // Manual schedule configuration
          room_id: mergeFormData.room_id && mergeFormData.room_id !== '' ? parseInt(mergeFormData.room_id) : null,
          class_name: mergeFormData.class_name?.trim() || null,
          teacher_ids: mergeFormData.teacher_ids && mergeFormData.teacher_ids.length > 0
            ? mergeFormData.teacher_ids.map(id => parseInt(id)).filter(id => !isNaN(id))
            : [],
        }),
      });

      alert(`Classes merged successfully! ${response.data.enrollment_stats?.unique_students || response.data.students_moved || 0} students moved to the new merged class.`);
      closeMergeModal();
      fetchClasses(); // Refresh classes list
    } catch (err) {
      // Handle conflict errors specifically
      if (err.response?.data?.conflicts && Array.isArray(err.response.data.conflicts)) {
        const conflictMessages = err.response.data.conflicts.map(c => 
          `${c.day} ${c.start_time}-${c.end_time}: ${c.message || 'Schedule conflict'}`
        ).join('\n');
        alert(`Cannot merge classes: Schedule conflicts detected.\n\n${conflictMessages}\n\nPlease resolve these conflicts and try again.`);
      } else {
        alert(err.response?.data?.message || err.message || 'Failed to merge classes');
      }
      console.error('Error merging classes:', err);
    } finally {
      setMergeSubmitting(false);
    }
  };

  const formatTime = (timeString) => {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const openViewStudentsModal = (classItem) => {
    setOpenMenuId(null);
    setSelectedClassForView(classItem);
    setViewStudentsStep('phase-selection');
    setSelectedPhaseForView(null);
    setViewEnrolledStudents([]);
    setIsViewStudentsModalOpen(true);
  };

  const fetchMergeHistory = async (classId) => {
    setLoadingMergeHistory(true);
    try {
      const response = await apiRequest(`/classes/${classId}/merge-history`);
      setMergeHistory(response.data || []);
    } catch (err) {
      console.error('Error fetching merge history:', err);
      alert(err.message || 'Failed to fetch merge history');
      setMergeHistory([]);
    } finally {
      setLoadingMergeHistory(false);
    }
  };

  const openMergeHistoryModal = async (classItem) => {
    setOpenMenuId(null);
    setSelectedClassForHistory(classItem);
    setIsMergeHistoryModalOpen(true);
    await fetchMergeHistory(classItem.class_id);
  };


  const closeMergeHistoryModal = () => {
    setIsMergeHistoryModalOpen(false);
    setSelectedClassForHistory(null);
    setMergeHistory([]);
  };

  const handleUndoMerge = async (mergeHistoryId, mergedClassId) => {
    const latestHistory = mergeHistory.find(h => h.merge_history_id === mergeHistoryId);
    if (!latestHistory) {
      alert('Merge history not found');
      return;
    }

    if (latestHistory.is_undone) {
      alert('This merge has already been undone');
      return;
    }

    const originalClassesList = latestHistory.original_classes
      .map(c => `${c.class_name || c.level_tag} (ID: ${c.class_id})`)
      .join('\n');

    const confirmMessage = `Are you sure you want to undo this merge?\n\n` +
      `This will restore the following ${latestHistory.original_classes.length} original class(es):\n${originalClassesList}\n\n` +
      `The merged class will be deleted and all original classes will be restored with their original students, schedules, and reservations.\n\n` +
      (latestHistory.summary.original_enrollment_count > 0 
        ? `Warning: ${latestHistory.summary.original_enrollment_count} enrollment(s) will be restored to original classes.\n\n`
        : '') +
      `This action cannot be undone.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setUndoingMerge(true);
    try {
      const response = await apiRequest(`/classes/${mergedClassId}/undo-merge`, {
        method: 'POST',
      });

      alert(`Merge undone successfully! ${response.data.restored_classes.length} class(es) restored.`);
      closeMergeHistoryModal();
      // If we're in detail view, go back to list view since the merged class is now deleted
      if (viewMode === 'detail' && selectedClassForDetails?.class_id === mergedClassId) {
        setViewMode('list');
        setSelectedClassForDetails(null);
      }
      fetchClasses(); // Refresh classes list
    } catch (err) {
      // Check if this is a schedule conflict error
      const errorData = err.response?.data;
      if (errorData?.conflicts && Array.isArray(errorData.conflicts) && errorData.conflicts.length > 0) {
        // This is a schedule conflict error - show detailed conflict modal
        // IMPORTANT: Preserve the class for detail view BEFORE closing merge history modal
        // because closeMergeHistoryModal() will clear selectedClassForHistory
        const classToShow = selectedClassForDetails || selectedClassForHistory;
        
        // Determine which class to show in detail view
        let classForDetailView = classToShow;
        if (!classForDetailView) {
          // Fallback: if no class found, try to get it from the merged class ID
          classForDetailView = classes.find(c => c.class_id === mergedClassId);
        }
        
        // Close merge history modal
        closeMergeHistoryModal();
        
        // IMPORTANT: Force detail view to show conflict modal in class details context
        // This ensures the conflict modal appears on top of the class details page, not the classes list
        if (classForDetailView) {
          // Store conflict data temporarily - useEffect will open modal once detail view is confirmed active
          setPendingConflictData({
            conflicts: errorData.conflicts,
            details: errorData.details,
            message: errorData.message,
          });
          
          // Force detail view - useEffect will open conflict modal once detail view is confirmed active
          setViewMode('detail');
          setSelectedClassForDetails(classForDetailView);
        } else {
          // Fallback: if we can't find the class, show conflict modal anyway (but user might be in list view)
          console.warn('Could not find class for detail view, showing conflict modal anyway');
          setConflictData({
            conflicts: errorData.conflicts,
            details: errorData.details,
            message: errorData.message,
          });
          setIsConflictModalOpen(true);
        }
      } else {
        // Regular error - show alert
        alert(err.message || 'Failed to undo merge');
      }
      console.error('Error undoing merge:', err);
    } finally {
      setUndoingMerge(false);
    }
  };

  const openReservedStudentsModal = async (classItem) => {
    setOpenMenuId(null);
    setSelectedClassForReservations(classItem);
    setIsReservedStudentsModalOpen(true);
    await fetchReservedStudents(classItem.class_id);
  };

  const closeReservedStudentsModal = () => {
    setIsReservedStudentsModalOpen(false);
    setSelectedClassForReservations(null);
    setReservedStudents([]);
  };

  const fetchReservedStudents = async (classId) => {
    try {
      setLoadingReservedStudents(true);
      const response = await apiRequest(`/reservations?class_id=${classId}`);
      setReservedStudents(response.data || []);
    } catch (err) {
      console.error('Error fetching reserved students:', err);
      setError(err.message || 'Failed to fetch reserved students');
    } finally {
      setLoadingReservedStudents(false);
    }
  };

  const handleUpgradeReservation = async (reservation) => {
    // Allow upgrade for Fee Paid and Expired reservations
    if (reservation.status !== 'Fee Paid' && reservation.status !== 'Expired') {
      if (reservation.status === 'Reserved') {
        alert(`Cannot upgrade reservation. The reservation fee must be paid first. Current status: ${reservation.status}`);
      } else {
        alert(`Cannot upgrade reservation. Current status: ${reservation.status}`);
      }
      return;
    }
    
    setSelectedReservationForUpgrade(reservation);
    
    // Fetch reservation fee paid amount
    let feePaid = 0;
    if (reservation.invoice_id || reservation.reservation_invoice_id) {
      try {
        const invoiceId = reservation.invoice_id || reservation.reservation_invoice_id;
        const paymentsResponse = await apiRequest(`/payments/invoice/${invoiceId}`);
        const payments = paymentsResponse.data || [];
        feePaid = payments
          .filter(p => p.status === 'Completed')
          .reduce((sum, p) => sum + (parseFloat(p.payable_amount) || 0), 0);
      } catch (err) {
        console.error('Error fetching reservation fee payments:', err);
        // Fallback to reservation_fee if available
        feePaid = reservation.reservation_fee ? parseFloat(reservation.reservation_fee) : 0;
      }
    } else if (reservation.reservation_fee) {
      // Fallback: use reservation_fee if invoice_id is not available
      feePaid = parseFloat(reservation.reservation_fee) || 0;
    }
    setReservationFeePaid(feePaid);
    
    // All reservations are for entire class - show enrollment option selection first
    // User can choose between package enrollment or per-phase enrollment
    setUpgradeStep('enrollment-option');
    setUpgradeEnrollmentOption('');
    setUpgradeSelectedPackage(null);
    setUpgradeSelectedPricingLists([]);
    setUpgradeSelectedMerchandise([]);
    setUpgradePerPhaseAmount('');
    setUpgradePhaseNumber(null);
    
    // Reset installment settings
    setUpgradeInstallmentSettings({
      invoice_issue_date: '',
      billing_month: '',
      invoice_due_date: '',
      invoice_generation_date: '',
      frequency_months: 1,
    });
    setUpgradeShowInstallmentSettings(false);
    
    // Fetch packages, pricing lists, and merchandise for the class's branch
    const branchId = reservation.branch_id || selectedClassForEnrollment?.branch_id;
    if (branchId) {
      await fetchPackages(branchId);
      await fetchPricingLists(branchId);
      await fetchMerchandise(branchId);
    }
    
    setIsUpgradeModalOpen(true);
  };

  const handleUpgradeSubmit = async () => {
    if (!selectedReservationForUpgrade) return;

    try {
      setEnrollSubmitting(true);
      
      let payload = {};

      // For upgrades we now always base enrollment on a package.
      // - When upgradeEnrollmentOption === 'package': use package for entire class
      // - When upgradeEnrollmentOption === 'per-phase': use Phase-type package for per-phase enrollment
      if (upgradeStep === 'review') {
        if (!upgradeSelectedPackage) {
          alert('Please select a package');
          return;
        }

        const isPhasePerPhase =
          upgradeEnrollmentOption === 'per-phase' &&
          upgradeSelectedPackage.package_type === 'Phase';

        // Collect merchandise selections for the reserved student (e.g., uniforms)
        const studentId = selectedReservationForUpgrade?.student_id;
        const selectedMerchandise = [];
        if (studentId && upgradeStudentMerchandiseSelections[studentId]) {
          upgradeStudentMerchandiseSelections[studentId].forEach(selection => {
            selectedMerchandise.push({
              merchandise_id: selection.merchandise_id,
              size: selection.size || null,
            });
          });
        }

        const enrollmentType = isPhasePerPhase
          ? 'Per-Phase'
          : (upgradeSelectedPackage.package_type === 'Installment' ? 'Installment' : 'Fullpayment');

        payload = {
          enrollment_type: enrollmentType,
          package_id: upgradeSelectedPackage.package_id,
          ...(selectedMerchandise.length > 0 ? { selected_merchandise: selectedMerchandise } : {}),
          ...(upgradeSelectedPromo ? { promo_id: upgradeSelectedPromo.promo_id } : {}),
          // Installment settings apply only to standard Installment packages (not Phase per-phase)
          ...(!isPhasePerPhase &&
          upgradeSelectedPackage.package_type === 'Installment' &&
          upgradeShowInstallmentSettings &&
          upgradeInstallmentSettings.invoice_issue_date
            ? {
                installment_settings: {
                  invoice_issue_date: upgradeInstallmentSettings.invoice_issue_date,
                  billing_month: upgradeInstallmentSettings.billing_month,
                  invoice_due_date: upgradeInstallmentSettings.invoice_due_date,
                  invoice_generation_date: upgradeInstallmentSettings.invoice_generation_date,
                  frequency_months: upgradeInstallmentSettings.frequency_months,
                },
              }
            : {}),
        };
      }

      await apiRequest(`/reservations/${selectedReservationForUpgrade.reserved_id}/upgrade`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      alert('Reservation upgraded to enrollment successfully!');
      setIsUpgradeModalOpen(false);
      setSelectedReservationForUpgrade(null);
      setReservationFeePaid(0);
      // Reset upgrade state
      setUpgradeStep('enrollment-option');
      setUpgradeEnrollmentOption('');
      setUpgradeSelectedPackage(null);
      setUpgradeSelectedPricingLists([]);
      setUpgradeSelectedMerchandise([]);
      setUpgradePerPhaseAmount('');
      setUpgradePhaseNumber(null);
      setUpgradePackageMerchSelections({});
      setUpgradeStudentMerchandiseSelections({});
      setUpgradeShowPackageDetails(false);
      setUpgradeUniformCategoryFilters({});
      setUpgradeAvailablePromos([]);
      setUpgradeSelectedPromo(null);
      setUpgradeInstallmentSettings({
        invoice_issue_date: '',
        billing_month: '',
        invoice_due_date: '',
        invoice_generation_date: '',
        frequency_months: 1,
      });
      setUpgradeShowInstallmentSettings(false);
      
      if (selectedClassForReservations) {
        await fetchReservedStudents(selectedClassForReservations.class_id);
      }
      // Refresh enrolled students if enrollment modal is open
      if (selectedClassForEnrollment) {
        await fetchEnrolledStudents(selectedClassForEnrollment.class_id);
      }
    } catch (err) {
      console.error('Error upgrading reservation:', err);
      
      // Check if error contains alternative classes (class is full)
      if (err.response?.data?.class_full && err.response?.data?.alternative_classes) {
        setAlternativeClasses(err.response.data.alternative_classes);
        setIsAlternativeClassesModalOpen(true);
      } else if (err.response?.data?.class_inactive) {
        alert('Cannot re-upgrade expired reservation. The class is no longer active.');
      } else {
        alert(err.response?.data?.message || err.message || 'Failed to upgrade reservation');
      }
    } finally {
      setEnrollSubmitting(false);
    }
  };

  const closeViewStudentsModal = () => {
    setIsViewStudentsModalOpen(false);
    setSelectedClassForView(null);
    setViewStudentsStep('phase-selection');
    setSelectedPhaseForView(null);
    setViewEnrolledStudents([]);
  };

  const handlePhaseSelectForView = (phaseNumber) => {
    setSelectedPhaseForView(phaseNumber);
    setViewStudentsStep('students-list');
    if (selectedClassForView) {
      fetchEnrolledStudentsForView(selectedClassForView.class_id, phaseNumber);
    }
  };

  const openEnrollModal = (classItem) => {
    setOpenMenuId(null);
    setSelectedClassForEnrollment(classItem);
    setEnrollStep('view'); // Start with view mode
    setSelectedPackage(null);
    setSelectedStudents([]);
    setSelectedPricingLists([]);
    setSelectedMerchandise([]);
    setGeneratedInvoices([]);
    setShowPackageDetails(false); // Reset package details visibility
    setSelectedEnrollmentOption(null);
    setIsEnrollModalOpen(true);
    
    // Fetch enrolled students and related reservations
    fetchEnrolledStudents(classItem.class_id);
    fetchEnrollReservedStudents(classItem.class_id);
    
    // Fetch packages, students, pricing lists, and merchandise for this branch
    if (classItem.branch_id) {
      fetchPackages(classItem.branch_id);
      fetchStudents(classItem.branch_id);
      fetchPricingLists(classItem.branch_id);
      fetchMerchandise(classItem.branch_id);
    }
  };

  const handleStartEnrollment = () => {
    setEnrollStep('enrollment-option');
    setStudentSearchTerm('');
    setShowStudentDropdown(false);
    setSelectedStudents([]);
    setPackageMerchSelections({});
    setSelectedEnrollmentOption(null);
  };

  const handleEnrollmentOptionContinue = () => {
    if (!selectedEnrollmentOption) return;
    
    // Clear package-related state when switching away from package option
    if (selectedEnrollmentOption !== 'package' && selectedEnrollmentOption !== 'reservation') {
      setSelectedPackage(null);
      setPackageMerchSelections({});
      setShowPackageDetails(false);
      setShowInstallmentSettings(false);
      updateInstallmentSettings({
        invoice_issue_date: '',
        billing_month: '',
        invoice_due_date: '',
        invoice_generation_date: '',
      });
    }
    
    // For per-phase enrollment, base selection on Phase packages
    if (selectedEnrollmentOption === 'per-phase') {
      // Clear any manual per-phase config when starting fresh
      setPerPhaseAmount('');
      setSelectedPhaseNumber(null);
      // Go to package selection, filtered to Phase packages
      setEnrollStep('package-selection');
    } else if (selectedEnrollmentOption === 'package') {
      setEnrollStep('package-selection');
    } else if (selectedEnrollmentOption === 'reservation') {
      // For reservation, go to package selection (will be filtered to Reserved packages only)
      setEnrollStep('package-selection');
    }
  };

  const closeEnrollModal = () => {
    setIsEnrollModalOpen(false);
    setSelectedClassForEnrollment(null);
    setEnrollStep('view');
    setSelectedPackage(null);
    setSelectedStudents([]);
    setSelectedPricingLists([]);
    setSelectedMerchandise([]);
    setPackageMerchSelections({});
    setStudentMerchandiseSelections({});
    setGeneratedInvoices([]);
    setEnrolledStudents([]);
    setEnrollReservedStudents([]);
    setStudentSearchTerm('');
    setShowStudentDropdown(false);
    setShowInstallmentSettings(false);
    setShowPackageDetails(false); // Reset package details visibility
    setSelectedPhaseNumber(null); // Reset phase selection
    setSelectedEnrollmentOption(null);
    setPerPhaseAmount(''); // Reset per-phase amount
    updateInstallmentSettings({
      invoice_issue_date: '',
      billing_month: '',
      invoice_due_date: '',
      invoice_generation_date: '',
    });
  };

  const handlePackageSelect = (packageItem) => {

    // For per-phase enrollment with Phase packages, treat it as package-based per-phase:
    // - Use the Phase package as the selectedPackage (so manual per-phase fields stay hidden)
    // - Pre-fill phase and amount from the package
    if (selectedEnrollmentOption === 'per-phase' && packageItem.package_type === 'Phase') {
      if (packageItem.package_price) {
        setPerPhaseAmount(packageItem.package_price.toString());
      }
      if (packageItem.phase_start) {
        setSelectedPhaseNumber(packageItem.phase_start);
      }
    } else if (selectedEnrollmentOption !== 'per-phase') {
      // Clear any per-phase config when switching away from per-phase option
      setPerPhaseAmount('');
      setSelectedPhaseNumber(null);
    }

    setPackageMerchSelections({});
    setSelectedPackage(packageItem);
    setSelectedPromo(null); // Clear selected promo when package changes
    setAvailablePromos([]); // Clear available promos
    setShowPackageDetails(true); // Show package details by default when package is selected
    setEnrollStep('student-selection');
    setStudentSearchTerm('');
    setShowStudentDropdown(false);
    setSelectedStudents([]);
    
    // Fetch available promos for this package (will fetch student-specific when student is selected)
    if (packageItem.package_id) {
      fetchAvailablePromos(packageItem.package_id);
    }
    
    // Check if package has fullpayment pricing list
    const hasFullpaymentPricing = packageItem.details?.some(detail => {
      const pricing = pricingLists.find(p => p.pricinglist_id === detail.pricinglist_id);
      return pricing && isNewEnrolleeFullpayment(pricing);
    });
    
    // Auto-show installment settings if package type is "Installment" and NOT fullpayment
    // Hide installment settings for Reserved packages (settings will be configured during upgrade)
    if (packageItem.package_type === 'Installment' && !hasFullpaymentPricing) {
      setShowInstallmentSettings(true);
      const defaultSettings = getDefaultInstallmentSettings();
      setInstallmentSettings(defaultSettings);
    } else {
      // Reset installment settings when package changes to non-installment, fullpayment, or Reserved
      setShowInstallmentSettings(false);
      updateInstallmentSettings({
        invoice_issue_date: '',
        billing_month: '',
        invoice_due_date: '',
        invoice_generation_date: '',
      });
    }
    
    // Initialize reservation invoice settings for Reserved packages
    if (packageItem.package_type === 'Reserved') {
      const today = new Date();
      const defaultDueDate = new Date(today);
      defaultDueDate.setDate(defaultDueDate.getDate() + 7); // 1 week (7 days) from today
      
      setReservationInvoiceSettings({
        issue_date: today.toISOString().split('T')[0],
        due_date: defaultDueDate.toISOString().split('T')[0],
      });
    } else {
      // Reset reservation invoice settings for non-Reserved packages
      setReservationInvoiceSettings({
        issue_date: '',
        due_date: '',
      });
    }
    
    initializePackageMerchSelections(packageItem);
  };


  const handleStudentToggle = (student) => {
    setSelectedStudents(prev => {
      const isSelected = prev.some(s => s.user_id === student.user_id);
      if (isSelected) {
        // Remove student and their merchandise selections
        setStudentMerchandiseSelections(prevSelections => {
          const newSelections = { ...prevSelections };
          delete newSelections[student.user_id];
          return newSelections;
        });
        return prev.filter(s => s.user_id !== student.user_id);
      } else {
        // Only allow 1 student to be selected for enrollment
        if (prev.length >= 1) {
          // Remove previous student's merchandise selections
          const previousStudent = prev[0];
          setStudentMerchandiseSelections(prevSelections => {
            const newSelections = { ...prevSelections };
            delete newSelections[previousStudent.user_id];
            return newSelections;
          });
          // Replace with new student
          prev = [];
        }
        
        // Check if adding this student would exceed max_students
        // Count both enrolled students AND reserved students that should be counted
        if (selectedClassForEnrollment?.max_students) {
          const currentEnrolled = getCountableStudents(enrolledStudents);
          const currentReserved = getCountableReservedStudents(); // Only count valid reservations
          const totalAfterAdd = currentEnrolled + currentReserved + 1;
          if (totalAfterAdd > selectedClassForEnrollment.max_students) {
            alert(`Cannot add student. Class has a maximum of ${selectedClassForEnrollment.max_students} students. Currently enrolled: ${currentEnrolled}, Reserved: ${currentReserved}`);
            return prev;
          }
        }
        // Initialize merchandise selections for this student based on package selections
        if (selectedPackage) {
          // Get all merchandise from package (including non-uniform items that are auto-included)
          const initialMerchSelections = Object.values(packageMerchSelections || {})
            .flat()
            .filter(selection => selection && selection.merchandise_id)
            .map(selection => {
              const merchMeta = merchandise.find(m => m.merchandise_id === selection.merchandise_id);
              return {
                merchandise_id: selection.merchandise_id,
                size: selection.size || null,
                merchandise_name: merchMeta?.merchandise_name || null,
                category: merchMeta ? getUniformCategory(merchMeta) : null
              };
            });
          setStudentMerchandiseSelections(prevSelections => ({
            ...prevSelections,
            [student.user_id]: initialMerchSelections
          }));
        } else if (selectedMerchandise.length > 0) {
          // Initialize with manual merchandise selections
          // For per-phase enrollment with uniforms, don't pre-initialize - let users select sizes
          if (selectedEnrollmentOption === 'per-phase') {
            // For per-phase, only initialize non-uniform items or items without sizes
            const initialMerchSelections = selectedMerchandise
              .filter(m => {
                // Don't pre-initialize items that require sizing - users will select sizes
                if (requiresSizingForMerchandise(m.merchandise_name)) return false;
                // Only initialize items without sizes
                const itemsForType = getMerchandiseItemsByType(m.merchandise_name);
                return !itemsForType.some(item => item.size);
              })
              .map(m => {
                const merchMeta = merchandise.find(item => item.merchandise_id === m.merchandise_id);
                return {
                  merchandise_id: m.merchandise_id,
                  size: m.size || null,
                  merchandise_name: m.merchandise_name || merchMeta?.merchandise_name || null,
                  category: merchMeta ? getUniformCategory(merchMeta) : null
                };
              });
            if (initialMerchSelections.length > 0) {
              setStudentMerchandiseSelections(prevSelections => ({
                ...prevSelections,
                [student.user_id]: initialMerchSelections
              }));
            }
          } else {
            // For other enrollment types, initialize all selected merchandise
          const initialMerchSelections = selectedMerchandise.map(m => {
            const merchMeta = merchandise.find(item => item.merchandise_id === m.merchandise_id);
            return {
              merchandise_id: m.merchandise_id,
              size: m.size || null,
              merchandise_name: m.merchandise_name || merchMeta?.merchandise_name || null,
              category: merchMeta ? getUniformCategory(merchMeta) : null
            };
          });
          setStudentMerchandiseSelections(prevSelections => ({
            ...prevSelections,
            [student.user_id]: initialMerchSelections
          }));
          }
        }
        return [...prev, student];
      }
    });
  };
  
  // Handle per-student merchandise size change
  const handleStudentMerchandiseSizeChange = (studentId, merchandiseName, selectedItem, category = null) => {
    setStudentMerchandiseSelections(prev => {
      const studentSelections = prev[studentId] || [];
      // Remove existing selection for this merchandise/category
      const filteredSelections = studentSelections.filter(selection => {
        if (selection.merchandise_name !== merchandiseName) return true;
        if (category) {
          return selection.category && selection.category !== category;
        }
        return false;
      });

      if (selectedItem && selectedItem.merchandise_id && selectedItem.size) {
        filteredSelections.push({
          merchandise_id: selectedItem.merchandise_id,
          merchandise_name: merchandiseName,
          size: selectedItem.size,
          category: category || null
        });
      }

      return {
        ...prev,
        [studentId]: filteredSelections
      };
    });
  };
  
  // Handle per-student merchandise toggle (for non-size items)
  const handleStudentMerchandiseToggle = (studentId, merchandiseId, merchandiseName) => {
    setStudentMerchandiseSelections(prev => {
      const studentSelections = prev[studentId] || [];
      const existingIndex = studentSelections.findIndex(m => m.merchandise_id === merchandiseId);
      const merchMeta = merchandise.find(m => m.merchandise_id === merchandiseId);
      
      if (existingIndex >= 0) {
        // Remove
        return {
          ...prev,
          [studentId]: studentSelections.filter(m => m.merchandise_id !== merchandiseId)
        };
      } else {
        // Add
        return {
          ...prev,
          [studentId]: [...studentSelections, {
            merchandise_id: merchandiseId,
            size: null,
            merchandise_name: merchandiseName,
            category: merchMeta ? getUniformCategory(merchMeta) : null
          }]
        };
      }
    });
  };

  const filteredStudents = students.filter((student) => {
    // Exclude already enrolled students
    const isEnrolled = enrolledStudents.some(s => s.user_id === student.user_id);
    if (isEnrolled) return false;
    
    // Exclude already selected students (they're shown as pills)
    const isSelected = selectedStudents.some(s => s.user_id === student.user_id);
    if (isSelected) return false;
    
    // Filter by search term
    if (studentSearchTerm) {
      const searchLower = studentSearchTerm.toLowerCase();
      const matchesSearch = (
        student.full_name?.toLowerCase().includes(searchLower) ||
        student.email?.toLowerCase().includes(searchLower) ||
        student.level_tag?.toLowerCase().includes(searchLower)
      );
      if (!matchesSearch) return false;
    }
    return true;
  });

  const getAvailableSlots = () => {
    if (!selectedClassForEnrollment?.max_students) return null;
    const currentEnrolled = getCountableStudents(enrolledStudents);
    const currentReserved = getCountableReservedStudents();
    const currentlySelected = selectedStudents.length;
    return selectedClassForEnrollment.max_students - currentEnrolled - currentReserved - currentlySelected;
  };

  // Calculate total amount for per-phase enrollment
  const calculatePerPhaseTotal = () => {
    if (selectedEnrollmentOption !== 'per-phase') return 0;
    
    let total = 0;
    
    // Add per-phase amount
    if (perPhaseAmount && parseFloat(perPhaseAmount) > 0) {
      total += parseFloat(perPhaseAmount);
    }
    
    // Add selected pricing lists
    selectedPricingLists.forEach(pricingId => {
      const pricing = pricingLists.find(p => p.pricinglist_id === pricingId);
      if (pricing && pricing.price) {
        total += parseFloat(pricing.price) || 0;
      }
    });
    
    // Add selected merchandise
    // Strategy: Count per-student selections first, then count any remaining items from global selections
    const countedMerchandiseNames = new Set(); // Track which merchandise names we've already counted
    
    // First, count per-student merchandise selections (for uniforms with sizes and other items)
    if (selectedStudents.length > 0 && Object.keys(studentMerchandiseSelections).length > 0) {
      selectedStudents.forEach(student => {
        const studentMerchSelections = studentMerchandiseSelections[student.user_id] || [];
        studentMerchSelections.forEach(merchSelection => {
          if (merchSelection.merchandise_id) {
            const merchItem = merchandise.find(m => m.merchandise_id === merchSelection.merchandise_id);
            if (merchItem && merchItem.price) {
              total += parseFloat(merchItem.price) || 0;
            }
          }
        });
        // Mark all merchandise in this student's selections as counted
        studentMerchSelections.forEach(merchSelection => {
          if (merchSelection.merchandise_name) {
            countedMerchandiseNames.add(merchSelection.merchandise_name);
          }
        });
      });
    }
    
    // Then, count any merchandise from global selections that wasn't counted yet
    // This handles cases where merchandise was selected but not yet initialized to students
    selectedMerchandise.forEach(merch => {
      // Skip if this merchandise was already counted in per-student selections
      if (countedMerchandiseNames.has(merch.merchandise_name)) {
        return;
      }
      
      // Find the actual merchandise item to get the price
      let merchItem = null;
      const itemsForType = getMerchandiseItemsByType(merch.merchandise_name);
      const hasSizes = itemsForType.some(item => item.size);
      
      if (merch.merchandise_name === 'LCA Uniform' && merch.size) {
        // For uniforms with size in global selection (shouldn't happen, but handle it)
        merchItem = merchandise.find(
          item => item.merchandise_name === merch.merchandise_name && item.size === merch.size
        );
      } else {
        // For other merchandise, find the first item with this name
        merchItem = merchandise.find(
          item => item.merchandise_name === merch.merchandise_name
        );
      }
      
      if (merchItem && merchItem.price) {
        // For merchandise without sizes or uniforms, multiply by number of students
        // For uniforms, they should be in per-student selections, but if not, count once per student
        const studentCount = selectedStudents.length > 0 ? selectedStudents.length : 1;
        total += parseFloat(merchItem.price) * studentCount;
      }
    });
    
    return total;
  };


  const groupPackageDetails = (details = []) => {
    const pricingDetails = [];
    const includedMerchandiseTypes = []; // Freebies (is_included = true)
    const paidMerchandiseTypes = []; // Paid merchandise (is_included = false)
    const seenIncludedTypes = new Set();
    const seenPaidTypes = new Set();

    details.forEach((detail) => {
      if (detail.pricinglist_id || detail.pricing_name) {
        pricingDetails.push(detail);
      }
      if (detail.merchandise_id || detail.merchandise_name) {
        const typeName = detail.merchandise_name || detail.merchandise_type;
        const isIncluded = detail.is_included !== false; // Default to true if not set
        
        if (typeName) {
          if (isIncluded && !seenIncludedTypes.has(typeName)) {
            seenIncludedTypes.add(typeName);
            includedMerchandiseTypes.push(typeName);
          } else if (!isIncluded && !seenPaidTypes.has(typeName)) {
            seenPaidTypes.add(typeName);
            paidMerchandiseTypes.push(typeName);
          }
        }
      }
    });

    return { pricingDetails, includedMerchandiseTypes, paidMerchandiseTypes, merchandiseTypes: [...includedMerchandiseTypes, ...paidMerchandiseTypes] };
  };

  const getPackageDetailDisplayCount = (details = []) => {
    const { pricingDetails, merchandiseTypes } = groupPackageDetails(details);
    return pricingDetails.length + merchandiseTypes.length;
  };

  const getMerchandiseItemsByType = (typeName) => {
    if (!typeName) return [];
    return merchandise.filter(
      (item) => item.merchandise_name === typeName
    );
  };

  // Check if a merchandise type requires sizing
  const requiresSizingForMerchandise = (typeName) => {
    if (!typeName) return false;
    
    // Check if name contains "uniform" (case-insensitive)
    if (typeName.toLowerCase().includes('uniform')) {
      return true;
    }
    
    // Check if any item of this type has a size (not null/empty)
    const itemsForType = getMerchandiseItemsByType(typeName);
    return itemsForType.some(item => item.size && item.size.trim() !== '' && item.size !== 'N/A');
  };
  
  const selectedPackageDetails = selectedPackage
    ? groupPackageDetails(selectedPackage.details || [])
    : { pricingDetails: [], includedMerchandiseTypes: [], paidMerchandiseTypes: [], merchandiseTypes: [] };
  
  // Filter to only show merchandise types that require sizing in configure section - other items are auto-included
  const selectedPackageMerchTypes = selectedPackageDetails.merchandiseTypes.filter(
    typeName => requiresSizingForMerchandise(typeName)
  );
  
  // Calculate total quantity needed for all selected students
  const getTotalQuantityNeeded = () => {
    return selectedStudents.length;
  };
  
  // Check inventory availability for merchandise
  const checkInventoryAvailability = (merchandiseId) => {
    const item = merchandise.find(m => m.merchandise_id === merchandiseId);
    if (!item || item.quantity === null || item.quantity === undefined) {
      return { available: null, hasStock: true, isLowStock: false }; // No quantity tracking
    }
    const available = parseInt(item.quantity) || 0;
    const needed = getTotalQuantityNeeded();
    return {
      available,
      needed,
      hasStock: available >= needed,
      isLowStock: available > 0 && available < needed,
      isOutOfStock: available === 0
    };
  };

  const getMerchandiseOptionLabel = (item) => {
    if (!item) return '';
    const parts = [];
    // Build label from gender and type
    if (item.gender) parts.push(item.gender);
    if (item.type) parts.push(item.type);
    if (item.size) parts.push(`(${item.size})`);
    return parts.length > 0 ? parts.join(' - ') : `Stock #${item.merchandise_id}`;
  };

  const getUniformCategory = (item) => {
    if (!item) return 'General';
    // Use the type field directly
    const typeValue = typeof item === 'string' ? item : (item.type || '');
    const typeLower = typeValue.toLowerCase();
    if (typeLower === 'top' || typeLower.includes('blouse')) return 'Top';
    if (
      typeLower === 'bottom' ||
      typeLower.includes('skirt') ||
      typeLower.includes('pants') ||
      typeLower.includes('short')
    ) {
      return 'Bottom';
    }
    return 'General';
  };

  // Default installment invoice settings for enrollment (downpayment: issue today, due in a week)
  const getDefaultInstallmentSettings = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-11 (0 = January)
    const currentDay = today.getDate();

    // Helper function to format date as YYYY-MM-DD without timezone conversion
    const formatDateLocal = (year, month, day) => {
      const monthStr = String(month + 1).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      return `${year}-${monthStr}-${dayStr}`;
    };

    // Invoice Issue Date: today (downpayment issued on enrollment)
    const invoiceIssueDateStr = formatDateLocal(currentYear, currentMonth, currentDay);

    // Invoice Due Date: a week after issue date (admin can change)
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 7);
    const invoiceDueDateStr = formatDateLocal(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

    // Billing Month: current month YYYY-MM
    const billingMonth = formatDateLocal(currentYear, currentMonth, 1).substring(0, 7);

    // Invoice Generation Date: 25th of current month (when next recurring invoice is generated)
    const invoiceGenerationDateStr = formatDateLocal(currentYear, currentMonth, 25);

    return {
      invoice_issue_date: invoiceIssueDateStr,
      billing_month: billingMonth,
      invoice_due_date: invoiceDueDateStr,
      invoice_generation_date: invoiceGenerationDateStr,
      frequency_months: 1, // Fixed at 1 month
    };
  };

  // Wrapper function to ensure frequency_months is always 1
  const updateInstallmentSettings = (updates) => {
    setInstallmentSettings(prev => ({
      ...prev,
      ...updates,
      frequency_months: 1, // Always enforce frequency_months to be 1
    }));
  };

  const validatePackageMerchSelections = () => {
    if (!selectedPackage) return true;
    const { merchandiseTypes } = groupPackageDetails(selectedPackage.details || []);
    const missingTypes = merchandiseTypes.filter((typeName) => {
      const selection = packageMerchSelections[typeName];
      return !selection || selection.length === 0;
    });

    if (missingTypes.length > 0) {
      alert(`Please select merchandise for: ${missingTypes.join(', ')}`);
      return false;
    }

    return true;
  };

  // Helper function to check if pricing list is "New Enrollee Installment" or "New Enrollee Fullpayment"
  // Normalized to specifically match these mutually exclusive pricing lists
  const isNewEnrolleeInstallment = (pricing) => {
    const nameLower = (pricing.name || '').toLowerCase().trim();
    const typeLower = (pricing.type || '').toLowerCase().trim();
    
    // Check if name or type contains "new enrollee" AND "installment" (with variations)
    const hasNewEnrollee = nameLower.includes('new enrollee') || typeLower.includes('new enrollee');
    const hasInstallment = nameLower.includes('installment') || 
                          nameLower.includes('instalment') || 
                          nameLower.includes('install') ||
                          typeLower.includes('installment') || 
                          typeLower.includes('instalment') || 
                          typeLower.includes('install');
    
    return hasNewEnrollee && hasInstallment;
  };

  const isNewEnrolleeFullpayment = (pricing) => {
    const nameLower = (pricing.name || '').toLowerCase().trim();
    const typeLower = (pricing.type || '').toLowerCase().trim();
    
    // Check if name or type contains "new enrollee" AND "fullpayment" (with variations)
    const hasNewEnrollee = nameLower.includes('new enrollee') || typeLower.includes('new enrollee');
    const hasFullpayment = nameLower.includes('fullpayment') || 
                          nameLower.includes('full payment') || 
                          nameLower.includes('full-payment') ||
                          nameLower.includes('fullpay') ||
                          typeLower.includes('fullpayment') || 
                          typeLower.includes('full payment') || 
                          typeLower.includes('full-payment') ||
                          typeLower.includes('fullpay');
    
    return hasNewEnrollee && hasFullpayment;
  };

  const handlePricingListToggle = (pricinglistId) => {
    setSelectedPricingLists(prev => {
      const id = parseInt(pricinglistId);
      const pricing = pricingLists.find(p => p.pricinglist_id === id);
      
      if (!pricing) return prev;
      
      // Check if this pricing list is "New Enrollee Installment" or "New Enrollee Fullpayment"
      const isInstallment = isNewEnrolleeInstallment(pricing);
      const isFullpayment = isNewEnrolleeFullpayment(pricing);
      
      // If currently selected, deselect it
      if (prev.includes(id)) {
        return prev.filter(pid => pid !== id);
      }
      
      // If selecting "New Enrollee Installment", deselect all "New Enrollee Fullpayment" pricing lists
      if (isInstallment) {
        const fullpaymentIds = pricingLists
          .filter(p => isNewEnrolleeFullpayment(p))
          .map(p => p.pricinglist_id);
        return [...prev.filter(pid => !fullpaymentIds.includes(pid)), id];
      }
      
      // If selecting "New Enrollee Fullpayment", deselect all "New Enrollee Installment" pricing lists
      if (isFullpayment) {
        const installmentIds = pricingLists
          .filter(p => isNewEnrolleeInstallment(p))
          .map(p => p.pricinglist_id);
        return [...prev.filter(pid => !installmentIds.includes(pid)), id];
      }
      
      // For other pricing lists, allow multiple selection
      return [...prev, id];
    });
  };

  const handleMerchandiseToggle = (merchandiseId, merchandiseName) => {
    setSelectedMerchandise(prev => {
      const id = parseInt(merchandiseId);
      const existingIndex = prev.findIndex(m => m.merchandise_id === id);
      const merchMeta = merchandise.find(m => m.merchandise_id === id);
      const category = merchMeta ? getUniformCategory(merchMeta) : null;
      
      if (existingIndex >= 0) {
        // Remove if already selected
        // Also remove from all students' selections if it's a non-uniform item without sizes
        if (selectedEnrollmentOption === 'per-phase' && selectedStudents.length > 0) {
          const itemsForType = getMerchandiseItemsByType(merchandiseName);
          const hasSizes = itemsForType.some(item => item.size);
          if (merchandiseName !== 'LCA Uniform' && !hasSizes) {
            // Remove from all students' selections
            setStudentMerchandiseSelections(prevSelections => {
              const updated = { ...prevSelections };
              selectedStudents.forEach(student => {
                if (updated[student.user_id]) {
                  updated[student.user_id] = updated[student.user_id].filter(
                    m => m.merchandise_name !== merchandiseName
                  );
                }
              });
              return updated;
            });
          }
        }
        return prev.filter(m => m.merchandise_id !== id);
      } else {
        // Add new merchandise item
        // If it's LCA Uniform, we'll need to select size later, so add with empty size for now
        const newMerch = { merchandise_id: id, size: null, merchandise_name: merchandiseName, category };
        
        // For per-phase enrollment, if students are already selected and this is a non-uniform item without sizes,
        // add it to all existing students' selections
        if (selectedEnrollmentOption === 'per-phase' && selectedStudents.length > 0) {
          const itemsForType = getMerchandiseItemsByType(merchandiseName);
          const hasSizes = itemsForType.some(item => item.size);
          if (merchandiseName !== 'LCA Uniform' && !hasSizes) {
            // Add to all existing students' selections
            setStudentMerchandiseSelections(prevSelections => {
              const updated = { ...prevSelections };
              selectedStudents.forEach(student => {
                const studentSelections = updated[student.user_id] || [];
                // Check if already exists
                const exists = studentSelections.some(m => m.merchandise_id === id);
                if (!exists) {
                  updated[student.user_id] = [...studentSelections, newMerch];
                }
              });
              return updated;
            });
          }
        }
        
        return [...prev, newMerch];
      }
    });
  };

  const handleMerchandiseSizeChange = (merchandiseId, size) => {
    setSelectedMerchandise(prev => {
      return prev.map(m => 
        m.merchandise_id === merchandiseId 
          ? { ...m, size: size || null }
          : m
      );
    });
  };

  const handlePackageMerchSelectionChange = (typeName, item) => {
    setPackageMerchSelections(prev => {
      const currentSelections = prev[typeName] || [];
      const exists = currentSelections.some(selection => selection.merchandise_id === item.merchandise_id);
      const updatedList = exists
        ? currentSelections.filter(selection => selection.merchandise_id !== item.merchandise_id)
        : [...currentSelections, { merchandise_id: item.merchandise_id, size: item.size || null }];
      return {
        ...prev,
        [typeName]: updatedList,
      };
    });
  };

  const handleEnrollSubmit = async () => {
    if (selectedStudents.length === 0) {
      alert('Please select a student');
      return;
    }

    // Validate per-phase enrollment
    if (selectedEnrollmentOption === 'per-phase') {
      const isPhasePackage = selectedPackage && selectedPackage.package_type === 'Phase';
      
      // When using Phase packages, phase and amount come from the package,
      // and included pricing/merchandise are defined by the package — no extra selections needed.
      if (!isPhasePackage) {
        if (selectedPhaseNumber === null || selectedPhaseNumber === undefined) {
          alert('Please select a phase for per-phase enrollment');
          return;
        }
        if (!perPhaseAmount || parseFloat(perPhaseAmount) <= 0) {
          alert('Please enter a valid amount for per-phase enrollment');
          return;
        }
        if (selectedPricingLists.length === 0 && selectedMerchandise.length === 0) {
          alert('Please select at least one pricing list or merchandise for per-phase enrollment');
          return;
        }
      }
    }

    // Validate reservation invoice settings for Reserved packages
    if (selectedPackage && selectedPackage.package_type === 'Reserved') {
      if (!reservationInvoiceSettings.issue_date) {
        alert('Please enter an issue date for the reservation invoice');
        return;
      }
      if (!reservationInvoiceSettings.due_date) {
        alert('Please enter a due date for the reservation invoice');
        return;
      }
      // Validate that due date is after issue date
      const issueDate = new Date(reservationInvoiceSettings.issue_date);
      const dueDate = new Date(reservationInvoiceSettings.due_date);
      if (dueDate <= issueDate) {
        alert('Due date must be after the issue date');
        return;
      }
    }

    if (selectedPackage && !validatePackageMerchSelections()) {
      return;
    }

    // Validate per-student merchandise size selections
    if (selectedStudents.length > 0) {
      for (const student of selectedStudents) {
        const studentMerchSelections = studentMerchandiseSelections[student.user_id] || [];
        const availableMerchandise = selectedPackage
          ? Object.values(packageMerchSelections || {}).flat().filter(m => m && m.merchandise_id)
          : selectedMerchandise;
        
        for (const merchItem of availableMerchandise) {
          const merchName = typeof merchItem === 'object' 
            ? (merchandise.find(m => m.merchandise_id === merchItem.merchandise_id)?.merchandise_name || merchItem.merchandise_name)
            : merchandise.find(m => m.merchandise_id === merchItem)?.merchandise_name;
          
          // Check if this merchandise type has sizes available
          const itemsForType = getMerchandiseItemsByType(merchName);
          const hasSizes = itemsForType.some(m => m.size);
          
          if (hasSizes && merchName === 'LCA Uniform') {
            // For LCA Uniform, check if both Top and Bottom categories have sizes selected (if categories exist)
            const uniformCategories = Array.from(
              new Set(
                itemsForType
                  .map(item => getUniformCategory(item))
                  .filter(category => category && category !== 'General')
              )
            );
            
            if (uniformCategories.length > 0) {
              // Check that each category has a size selected
              for (const category of uniformCategories) {
                const categorySelection = studentMerchSelections.find(m => 
                  m.merchandise_name === merchName && m.category === category
                );
          
                if (!categorySelection || !categorySelection.size || categorySelection.size.trim() === '') {
                  alert(`Please select a size for ${merchName} - ${category} for student: ${student.full_name}`);
                  return;
                }
              }
            } else {
              // No categories, just check for any size selection
              const studentSelection = studentMerchSelections.find(m => 
                m.merchandise_name === merchName
              );
              
              if (!studentSelection || !studentSelection.size || studentSelection.size.trim() === '') {
                alert(`Please select a size for ${merchName} for student: ${student.full_name}`);
                return;
              }
            }
          } else if (hasSizes) {
            // For other merchandise with sizes, check for size selection
            const studentSelection = studentMerchSelections.find(m => 
              m.merchandise_id === (typeof merchItem === 'object' ? merchItem.merchandise_id : merchItem) ||
              m.merchandise_name === merchName
            );
            
            if (!studentSelection || !studentSelection.size || studentSelection.size.trim() === '') {
              alert(`Please select a size for ${merchName} for student: ${student.full_name}`);
              return;
            }
          }
        }
      }
    }

    // Fallback validation for non-per-student selections (skip for per-phase enrollment as it uses per-student selections)
    if (!selectedPackage && selectedMerchandise.length > 0 && Object.keys(studentMerchandiseSelections).length === 0 && selectedEnrollmentOption !== 'per-phase') {
      // Check all merchandise items that require sizing
      const itemsRequiringSizing = selectedMerchandise.filter(m => requiresSizingForMerchandise(m.merchandise_name));
      for (const item of itemsRequiringSizing) {
        if (!item.size || item.size.trim() === '') {
          alert(`Please select a size for ${item.merchandise_name}`);
          return;
        }
      }
    }

    // Check max students limit
    // Count both enrolled students AND reserved students (reservations reserve spots but don't enroll)
    if (selectedClassForEnrollment?.max_students) {
      const currentEnrolled = enrolledStudents.length;
      const currentReserved = enrollReservedStudents.length; // Reserved students also count toward max
      const totalAfterEnroll = currentEnrolled + currentReserved + selectedStudents.length;
      if (totalAfterEnroll > selectedClassForEnrollment.max_students) {
        const availableSlots = selectedClassForEnrollment.max_students - currentEnrolled - currentReserved;
        alert(`Cannot ${selectedPackage?.package_type === 'Reserved' ? 'reserve' : 'enroll'} student. Class has a maximum of ${selectedClassForEnrollment.max_students} students. Currently enrolled: ${currentEnrolled}, Reserved: ${currentReserved}. You can only ${selectedPackage?.package_type === 'Reserved' ? 'reserve' : 'enroll'} ${availableSlots} more student${availableSlots !== 1 ? 's' : ''}.`);
        return;
      }
    }

    setEnrollSubmitting(true);
    const invoices = [];
    const errors = [];

    try {
      // Enroll each student
      for (const student of selectedStudents) {
        try {
          // For package enrollment, use per-student merchandise selections if available
          // This ensures the correct Top/Bottom sizes selected by the user are sent
          // Also include auto-included non-uniform items from package
          const packageMerchPayload = selectedPackage
            ? (() => {
                // Get per-student selections (which have the correct sizes for uniforms)
                const studentMerchSelections = studentMerchandiseSelections[student.user_id] || [];
                
                // Get all package merchandise (including auto-included non-uniform items)
                const allPackageMerch = Object.values(packageMerchSelections || {})
                  .flat()
                  .filter(selection => selection && selection.merchandise_id);
                
                // Build a map of merchandise by type to ensure we include all items
                const merchByType = new Map();
                
                // First, add all per-student selections (these have correct sizes)
                studentMerchSelections.forEach(m => {
                  if (m.merchandise_id && m.merchandise_name) {
                    merchByType.set(`${m.merchandise_name}-${m.size || 'no_size'}-${m.category || 'no_category'}`, m);
                  }
                });
                
                // Then, add auto-included items from package that aren't already in per-student selections
                // This ensures non-uniform items (LCA Learning Kit, LCA Bag, etc.) are included
                allPackageMerch.forEach(selection => {
                  const merchMeta = merchandise.find(m => m.merchandise_id === selection.merchandise_id);
                  if (merchMeta) {
                    const typeName = merchMeta.merchandise_name;
                    const category = getUniformCategory(merchMeta);
                    const key = `${typeName}-${selection.size || 'no_size'}-${category || 'no_category'}`;
                    
                    // Only add if not already in per-student selections (to avoid duplicates)
                    if (!merchByType.has(key)) {
                      merchByType.set(key, {
                        merchandise_id: selection.merchandise_id,
                        size: selection.size || null,
                        merchandise_name: typeName,
                        category: category || null
                      });
                    }
                  }
                });
                
                // Convert map to array and validate merchandise_id
                // Ensure all merchandise_ids exist in the current branch's merchandise list
                return Array.from(merchByType.values())
                  .filter(m => m.merchandise_id && m.merchandise_name)
                  .map(m => {
                    let finalMerchId = null;
                    let finalSize = m.size || null;
                    let finalCategory = m.category || null;
                    
                    // For uniforms with category, find the exact merchandise_id by name, size, and category
                    if (m.merchandise_name === 'LCA Uniform' && m.size && m.category) {
                      const uniformItem = merchandise.find(
                        item => item.merchandise_name === m.merchandise_name && 
                                item.size === m.size &&
                                getUniformCategory(item) === m.category
                      );
                      if (uniformItem) {
                        finalMerchId = uniformItem.merchandise_id;
                        finalSize = uniformItem.size || m.size;
                        finalCategory = getUniformCategory(uniformItem);
                      }
                    } else if (m.merchandise_name === 'LCA Uniform' && m.size) {
                      // For uniforms without category, find by name and size
                      const uniformItem = merchandise.find(
                        item => item.merchandise_name === m.merchandise_name && 
                                item.size === m.size
                      );
                      if (uniformItem) {
                        finalMerchId = uniformItem.merchandise_id;
                        finalSize = uniformItem.size || m.size;
                        finalCategory = getUniformCategory(uniformItem);
                      }
                    } else {
                      // For non-uniforms, verify merchandise_id exists in current branch
                      const matchingItem = merchandise.find(
                        item => item.merchandise_id === m.merchandise_id
                      );
                      
                      if (matchingItem) {
                        finalMerchId = matchingItem.merchandise_id;
                        finalSize = matchingItem.size || m.size || null;
                      } else {
                        // Fallback: find by name (and size if specified) in current branch
                        const fallbackItem = merchandise.find(
                          item => item.merchandise_name === m.merchandise_name &&
                                  (!m.size || !item.size || item.size === m.size)
                        );
                        if (fallbackItem) {
                          finalMerchId = fallbackItem.merchandise_id;
                          finalSize = fallbackItem.size || m.size || null;
                        }
                      }
                    }
                    
                    // Only return if we found a valid merchandise_id
                    if (finalMerchId) {
                      return {
                        merchandise_id: finalMerchId,
                        size: finalSize,
                        merchandise_name: m.merchandise_name,
                        category: finalCategory
                      };
                    }
                    
                    // Log warning if merchandise not found
                    console.warn(`Merchandise not found for ${m.merchandise_name}${m.size ? ` (${m.size})` : ''}${m.category ? ` - ${m.category}` : ''}`);
                    return null;
                  })
                  .filter(m => m !== null && m.merchandise_id); // Remove any null or invalid entries
              })()
            : [];

          // For per-phase enrollment, use per-student merchandise selections
          // For other enrollments, use selectedMerchandise
          let manualMerchPayload = [];
          
          if (selectedEnrollmentOption === 'per-phase') {
            // Use per-student merchandise selections for per-phase enrollment
            const studentMerchSelections = studentMerchandiseSelections[student.user_id] || [];
            manualMerchPayload = studentMerchSelections
              .filter(m => m.merchandise_id)
              .map(m => {
                // Find the actual merchandise item to get the correct merchandise_id
                let actualMerchId = m.merchandise_id;
                if (m.merchandise_name === 'LCA Uniform' && m.size && m.category) {
                  // For uniforms with category (Top/Bottom), find by name, size, and category
                  const matchingItem = merchandise.find(
                    item => item.merchandise_name === m.merchandise_name && 
                            item.size === m.size &&
                            getUniformCategory(item) === m.category
                  );
                  if (matchingItem) {
                    actualMerchId = matchingItem.merchandise_id;
                  }
                } else if (m.merchandise_name === 'LCA Uniform' && m.size) {
                  // For uniforms without category, find by name and size
                  const matchingItem = merchandise.find(
                    item => item.merchandise_name === m.merchandise_name && item.size === m.size
                  );
                  if (matchingItem) {
                    actualMerchId = matchingItem.merchandise_id;
                  }
                } else {
                  // For non-uniforms, find by merchandise_id or name
                  const matchingItem = merchandise.find(
                    item => item.merchandise_id === m.merchandise_id || 
                            item.merchandise_name === m.merchandise_name
                  );
                  if (matchingItem) {
                    actualMerchId = matchingItem.merchandise_id;
                  }
                }
                return {
                  merchandise_id: actualMerchId,
                  size: m.size || null,
                  merchandise_name: m.merchandise_name || null
                };
              });
          } else {
            // For other enrollment types, use selectedMerchandise
            manualMerchPayload = selectedMerchandise.map(m => {
            let merchandiseId = m.merchandise_id;
            if (m.merchandise_name === 'LCA Uniform' && m.size) {
              const matchingItem = merchandise.find(
                item => item.merchandise_name === m.merchandise_name && item.size === m.size
              );
              if (matchingItem) {
                merchandiseId = matchingItem.merchandise_id;
              }
            } else {
              const matchingItem = merchandise.find(
                item => item.merchandise_name === m.merchandise_name
              );
              if (matchingItem) {
                merchandiseId = matchingItem.merchandise_id;
              }
            }
            return {
              merchandise_id: merchandiseId,
                size: m.size || null,
                merchandise_name: m.merchandise_name || null
            };
          });
          }

          const merchandisePayload = selectedPackage ? packageMerchPayload : manualMerchPayload;

          // Final validation: Ensure all merchandise IDs exist in current branch's merchandise list
          const validatedMerchandisePayload = merchandisePayload.filter(item => {
            if (!item.merchandise_id) {
              console.warn(`Skipping item without merchandise_id:`, item);
              return false;
            }
            
            const exists = merchandise.some(m => m.merchandise_id === item.merchandise_id);
            if (!exists) {
              console.error(`Merchandise ID ${item.merchandise_id} (${item.merchandise_name || 'Unknown'}) not found in current branch's merchandise list`);
              return false;
            }
            
            return true;
          });

          // Debug: Log merchandise payload to help diagnose issues
          if (validatedMerchandisePayload.length !== merchandisePayload.length) {
            console.warn(`Filtered out ${merchandisePayload.length - validatedMerchandisePayload.length} invalid merchandise items`);
          }
          
          if (validatedMerchandisePayload.length > 0) {
            console.log(`Validated merchandise payload for ${student.full_name}:`, JSON.stringify(validatedMerchandisePayload, null, 2));
            console.log(`Merchandise count: ${validatedMerchandisePayload.length}`);
            validatedMerchandisePayload.forEach((item, index) => {
              const merchItem = merchandise.find(m => m.merchandise_id === item.merchandise_id);
              console.log(`  Item ${index + 1}:`, {
                merchandise_id: item.merchandise_id,
                merchandise_name: item.merchandise_name,
                size: item.size,
                category: item.category,
                exists: !!merchItem,
                branch_id: merchItem?.branch_id
              });
            });
          } else {
            console.warn(`No valid merchandise payload for ${student.full_name}`);
          }

          const payload = {
            student_id: student.user_id,
            ...(selectedPackage ? { package_id: selectedPackage.package_id } : {}),
            ...(!selectedPackage && selectedPricingLists.length > 0 ? { selected_pricing_lists: selectedPricingLists } : {}),
            ...(validatedMerchandisePayload.length > 0 ? { selected_merchandise: validatedMerchandisePayload } : {}),
            ...(selectedPhaseNumber !== null ? { phase_number: selectedPhaseNumber } : {}),
            ...(selectedEnrollmentOption === 'per-phase' && perPhaseAmount ? { per_phase_amount: parseFloat(perPhaseAmount) } : {}),
            ...(selectedPromo ? { 
              promo_id: selectedPromo.promo_id,
              ...(selectedPromo.promo_code ? { promo_code: selectedPromo.promo_code } : {})
            } : {}),
            // For Reserved packages, always set phase_number to null (entire class reservation)
            // Package type will be selected when upgrading the reservation
            ...(selectedPackage && selectedPackage.package_type === 'Reserved' ? { phase_number: null } : {}),
            // For Reserved packages, include reservation invoice settings
            ...(selectedPackage && selectedPackage.package_type === 'Reserved' && reservationInvoiceSettings.issue_date ? {
              reservation_invoice_settings: {
                issue_date: reservationInvoiceSettings.issue_date,
                due_date: reservationInvoiceSettings.due_date,
              }
            } : {}),
            ...(showInstallmentSettings && installmentSettings.invoice_issue_date ? { 
              installment_settings: {
                invoice_issue_date: installmentSettings.invoice_issue_date,
                billing_month: installmentSettings.billing_month,
                invoice_due_date: installmentSettings.invoice_due_date,
                invoice_generation_date: installmentSettings.invoice_generation_date,
                frequency_months: installmentSettings.frequency_months,
              }
            } : {}),
          };

          const response = await apiRequest(`/classes/${selectedClassForEnrollment.class_id}/enroll`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });

          invoices.push({
            student: student,
            invoice: response.data.invoice,
          });
        } catch (err) {
          console.error(`Error enrolling student ${student.full_name}:`, err);
          console.error('Full error object:', err);
          console.error('Error response:', err.response);
          console.error('Error response data:', err.response?.data);
          console.error('Error response data errors:', err.response?.data?.errors);
          
          // Extract detailed error messages if available (e.g., inventory validation errors)
          let errorMessage = err.message || 'Failed to enroll student';
          
          // Check for errors array in response
          const responseData = err.response?.data;
          if (responseData) {
            if (responseData.errors) {
              if (Array.isArray(responseData.errors) && responseData.errors.length > 0) {
                // Combine all error messages into a readable format
                errorMessage = `Validation Errors:\n  • ${responseData.errors.join('\n  • ')}`;
              } else if (typeof responseData.errors === 'string') {
                errorMessage = responseData.errors;
              }
            } else if (responseData.message) {
              errorMessage = responseData.message;
              // If there's a message but no errors array, still show the message
            }
          }
          
          errors.push({
            student: student,
            error: errorMessage,
          });
        }
      }

      setGeneratedInvoices(invoices);
      fetchClasses(); // Refresh classes list
      // Refresh enrolled students list
      if (selectedClassForEnrollment) {
        fetchEnrolledStudents(selectedClassForEnrollment.class_id);
      }

      if (errors.length > 0) {
        let errorMessage = '';
        if (invoices.length > 0) {
          errorMessage = `Successfully enrolled ${invoices.length} student(s).\n\n`;
        }
        errorMessage += `Failed to enroll ${errors.length} student(s):\n\n`;
        errors.forEach((e, index) => {
          errorMessage += `${index + 1}. ${e.student.full_name}:\n`;
          // Replace newlines with spaces for alert, but keep structure
          const formattedError = e.error.replace(/\n/g, '\n   ');
          errorMessage += `   ${formattedError}\n\n`;
        });
        // Use a more detailed alert
        console.error('Enrollment Errors:', errors);
        alert(errorMessage);
      } else if (invoices.length > 0) {
        alert(`Successfully enrolled ${invoices.length} student(s)!`);
      }
    } catch (err) {
      console.error('Error enrolling students:', err);
      alert(err.message || 'Failed to enroll students');
    } finally {
      setEnrollSubmitting(false);
    }
  };

  const openCreateModal = () => {
    setEditingClass(null);
    setError('');
    // Skip branch selection - go directly to step1 with admin's branch
    setModalStep('step1');
    setSelectedBranch(null);
    setSelectedProgram(null);
    setFormData({
      branch_id: adminBranchId ? adminBranchId.toString() : '',
      room_id: '',
      program_id: '',
      teacher_ids: [],
      level_tag: '',
      class_name: '',
      max_students: '',
      start_date: '',
      end_date: '',
      days_of_week: {
        Monday: { enabled: false, start_time: '', end_time: '' },
        Tuesday: { enabled: false, start_time: '', end_time: '' },
        Wednesday: { enabled: false, start_time: '', end_time: '' },
        Thursday: { enabled: false, start_time: '', end_time: '' },
        Friday: { enabled: false, start_time: '', end_time: '' },
        Saturday: { enabled: false, start_time: '', end_time: '' },
        Sunday: { enabled: false, start_time: '', end_time: '' },
      },
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = async (classItem) => {
    setOpenMenuId(null);
    
    // Verify class belongs to admin's branch
    if (classItem.branch_id !== adminBranchId) {
      alert('You can only edit classes from your branch.');
      return;
    }
    
    setEditingClass(classItem);
    setError('');
    setModalStep('form');
    setSelectedBranch(branches.find(b => b.branch_id === classItem.branch_id) || null);
    // Set selected program if available
    const program = programs.find(p => p.program_id === classItem.program_id);
    setSelectedProgram(program || null);
    // Reset manual end date adjustment
    setManualEndDateAdjustment({
      enabled: false,
      adjustedDate: '',
      notes: '',
    });
    // Fetch class sessions for end date calculation
    try {
      const sessionsResponse = await apiRequest(`/classes/${classItem.class_id}/sessions`);
      if (sessionsResponse.success && sessionsResponse.data) {
        const sortedSessions = sessionsResponse.data.sort((a, b) => {
          if (a.scheduled_date !== b.scheduled_date) {
            return new Date(a.scheduled_date) - new Date(b.scheduled_date);
          }
          if (a.phase_number !== b.phase_number) {
            return a.phase_number - b.phase_number;
          }
          return a.phase_session_number - b.phase_session_number;
        });
        setClassSessions(sortedSessions);
      } else {
        setClassSessions([]);
      }
    } catch (sessionsErr) {
      console.error('Error fetching class sessions for edit modal:', sessionsErr);
      setClassSessions([]);
    }
    // Format dates for date input (YYYY-MM-DD format)
    const formatDateForInput = (dateString) => {
      if (!dateString) return '';
      try {
        const date = new Date(dateString);
        return date.toISOString().split('T')[0];
      } catch {
        return '';
      }
    };
    
    // Fetch full class data including days_of_week if not already present or empty
    let classDataWithSchedule = classItem;
    if (!classItem.days_of_week || !Array.isArray(classItem.days_of_week) || classItem.days_of_week.length === 0) {
      try {
        const response = await apiRequest(`/classes/${classItem.class_id}`);
        if (response.data && response.data.class) {
          classDataWithSchedule = response.data.class;
        }
      } catch (err) {
        console.error('Error fetching class schedule:', err);
        // Continue with original classItem if fetch fails
      }
    }
    
    // Initialize days_of_week from classDataWithSchedule if available, otherwise use default
    const initializeDaysOfWeek = () => {
      const defaultDays = {
        Monday: { enabled: false, start_time: '', end_time: '' },
        Tuesday: { enabled: false, start_time: '', end_time: '' },
        Wednesday: { enabled: false, start_time: '', end_time: '' },
        Thursday: { enabled: false, start_time: '', end_time: '' },
        Friday: { enabled: false, start_time: '', end_time: '' },
        Saturday: { enabled: false, start_time: '', end_time: '' },
        Sunday: { enabled: false, start_time: '', end_time: '' },
      };
      
      // If classDataWithSchedule has days_of_week data, populate it
      if (classDataWithSchedule.days_of_week && Array.isArray(classDataWithSchedule.days_of_week) && classDataWithSchedule.days_of_week.length > 0) {
        classDataWithSchedule.days_of_week.forEach(dayData => {
          // Backend returns 'day_of_week' field from roomschedtbl
          const dayName = dayData.day_of_week || dayData.day;
          if (dayName && defaultDays[dayName]) {
            // Format time from HH:MM:SS to HH:MM for input fields
            const formatTimeForInput = (timeString) => {
              if (!timeString) return '';
              // Extract HH:MM from HH:MM:SS format
              return timeString.substring(0, 5);
            };
            
            defaultDays[dayName] = {
              enabled: true,
              start_time: formatTimeForInput(dayData.start_time) || '',
              end_time: formatTimeForInput(dayData.end_time) || '',
            };
          }
        });
      }
      
      return defaultDays;
    };
    
    // Convert teacher_id/teacher_ids to teacher_ids array (for backward compatibility)
    let teacherIds = [];
    if (classDataWithSchedule.teacher_ids && Array.isArray(classDataWithSchedule.teacher_ids) && classDataWithSchedule.teacher_ids.length > 0) {
      // Use teacher_ids array if available
      teacherIds = classDataWithSchedule.teacher_ids.map(id => id.toString());
    } else if (classDataWithSchedule.teachers && Array.isArray(classDataWithSchedule.teachers) && classDataWithSchedule.teachers.length > 0) {
      // Use teachers array if available
      teacherIds = classDataWithSchedule.teachers.map(t => t.teacher_id.toString());
    } else if (classDataWithSchedule.teacher_id) {
      // Fall back to single teacher_id
      teacherIds = [classDataWithSchedule.teacher_id.toString()];
    }
    
    setFormData({
      branch_id: classDataWithSchedule.branch_id?.toString() || '',
      room_id: classDataWithSchedule.room_id?.toString() || '',
      program_id: classDataWithSchedule.program_id?.toString() || '',
      teacher_ids: teacherIds,
      level_tag: classDataWithSchedule.level_tag || '',
      class_name: classDataWithSchedule.class_name || '',
      max_students: classDataWithSchedule.max_students?.toString() || '',
      start_date: formatDateForInput(classDataWithSchedule.start_date),
      end_date: formatDateForInput(classDataWithSchedule.end_date),
      days_of_week: initializeDaysOfWeek(),
    });
    setFormErrors({});
    
    // Fetch room schedules if room is already selected
    if (classDataWithSchedule.room_id) {
      fetchRoomSchedules(classDataWithSchedule.room_id.toString());
    }
    
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingClass(null);
    setModalStep('branch-selection');
    setSelectedBranch(null);
    setSelectedProgram(null);
    setFormErrors({});
    setTeacherSearchTerm('');
    setShowTeacherDropdown(false);
    setRoomSchedules([]);
    setTeacherConflicts([]);
    setTeacherConflictError('');
    setExpandedCalendarDays(new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']));
    setExpandedSchedulesPerDay({});
  };

  // Toggle day expansion in calendar
  const toggleCalendarDay = (day) => {
    setExpandedCalendarDays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(day)) {
        newSet.delete(day);
      } else {
        newSet.add(day);
      }
      return newSet;
    });
  };

  // Show more schedules for a specific day
  const showMoreSchedules = (day, totalCount) => {
    setExpandedSchedulesPerDay(prev => ({
      ...prev,
      [day]: totalCount
    }));
  };

  const handleBranchSelect = (branch) => {
    setSelectedBranch(branch);
    setFormData(prev => ({
      ...prev,
      branch_id: branch.branch_id.toString(),
    }));
    // For new class creation, go to step1. For editing, go to form.
    setModalStep(editingClass ? 'form' : 'step1');
  };

  // Removed handleBackToBranchSelection - admin doesn't select branch

  // Handle Next button from Step 1 to Step 2
  const handleNextToStep2 = (e) => {
    e.preventDefault();
    if (validateStep1()) {
      setModalStep('step2');
      setFormErrors({}); // Clear errors when moving to next step
    }
  };

  // Handle Back button from Step 2 to Step 1
  const handleBackToStep1 = () => {
    setModalStep('step1');
    setFormErrors({}); // Clear errors when going back
  };

  // Calculate end date from actual class sessions (excluding cancelled, accounting for rescheduled)
  const calculateEndDateFromSessions = (classSessions, numberOfPhases, numberOfSessionsPerPhase) => {
    if (!classSessions || classSessions.length === 0) {
      return null;
    }

    // Filter out cancelled sessions
    const activeSessions = classSessions.filter(session => session.status !== 'Cancelled');
    
    if (activeSessions.length === 0) {
      return null;
    }

    // Calculate expected total sessions
    const expectedTotalSessions = numberOfPhases * numberOfSessionsPerPhase;
    
    // Get the last scheduled session date (accounting for rescheduled sessions)
    // For rescheduled sessions, use actual_date if available, otherwise scheduled_date
    const sessionDates = activeSessions
      .map(session => {
        // If session is rescheduled and has actual_date, use that
        if (session.status === 'Rescheduled' && session.actual_date) {
          return session.actual_date;
        }
        return session.scheduled_date;
      })
      .filter(date => date) // Remove null/undefined dates
      .sort((a, b) => new Date(b) - new Date(a)); // Sort descending

    if (sessionDates.length === 0) {
      return null;
    }

    // If we have fewer active sessions than expected, the end date might be later
    // Use the latest session date as the end date
    return sessionDates[0];
  };

  const calculateEndDate = (startDate, daysOfWeek, numberOfPhases, numberOfSessionsPerPhase, classSessions = null) => {
    // If we have actual class sessions, use them for more accurate calculation
    if (classSessions && classSessions.length > 0) {
      const calculatedFromSessions = calculateEndDateFromSessions(classSessions, numberOfPhases, numberOfSessionsPerPhase);
      if (calculatedFromSessions) {
        return calculatedFromSessions;
      }
    }

    // Otherwise, use the theoretical calculation (for new classes or when sessions aren't available)
    if (!startDate || !daysOfWeek || !numberOfPhases || !numberOfSessionsPerPhase) {
      return '';
    }

    const holidaySet = holidayDateSet instanceof Set ? holidayDateSet : new Set();

    // Get enabled days
    const enabledDays = Object.entries(daysOfWeek)
      .filter(([_, data]) => data.enabled)
      .map(([day, _]) => day);

    if (enabledDays.length === 0) {
      return '';
    }

    // Map day names to day numbers (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const dayMap = {
      'Sunday': 0,
      'Monday': 1,
      'Tuesday': 2,
      'Wednesday': 3,
      'Thursday': 4,
      'Friday': 5,
      'Saturday': 6,
    };

    const enabledDayNumbers = enabledDays.map(day => dayMap[day]);

    // Calculate total sessions needed
    const totalSessions = numberOfPhases * numberOfSessionsPerPhase;

    const parseYmdLocalNoon = (ymd) => {
      if (!ymd) return null;
      const [y, m, d] = String(ymd).split('-').map(Number);
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d, 12, 0, 0, 0);
    };

    const formatYmdLocal = (dateObj) => {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    // Start from the start date (local-noon to avoid timezone shifting)
    const start = parseYmdLocalNoon(startDate) || new Date(startDate);
    // Create a new date object to avoid mutating the original
    let currentDate = new Date(start);
    let sessionsCompleted = 0;

    // Iterate day by day until we've completed all sessions
    while (sessionsCompleted < totalSessions) {
      const currentDayOfWeek = currentDate.getDay();
      const currentYmd = formatYmdLocal(currentDate);
      
      // Check if today is one of the enabled days
      if (enabledDayNumbers.includes(currentDayOfWeek)) {
        // Skip national holidays
        if (!holidaySet.has(currentYmd)) {
          sessionsCompleted++;
        }
        
        // If we've completed all sessions, this is the end date
        if (sessionsCompleted >= totalSessions) {
          break;
        }
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Format as YYYY-MM-DD for date input
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const loadNationalHolidaysForStartDate = useCallback(async (startDateStr) => {
    if (!startDateStr || typeof startDateStr !== 'string' || startDateStr.length < 4) {
      setHolidayCacheKey('');
      setHolidayDateSet(new Set());
      return;
    }

    const startYear = Number(startDateStr.slice(0, 4));
    if (!Number.isInteger(startYear)) {
      setHolidayCacheKey('');
      setHolidayDateSet(new Set());
      return;
    }

    const endYear = startYear + 3;
    const rangeStart = `${startYear}-01-01`;
    const rangeEnd = `${endYear}-12-31`;
    const key = `${rangeStart}:${rangeEnd}`;

    if (holidayCacheKey === key) return;

    setHolidayCacheKey(key);
    setLoadingHolidays(true);
    try {
      const response = await apiRequest(`/holidays/national?start_date=${rangeStart}&end_date=${rangeEnd}`);
      const dates = (response?.data || []).map((h) => h?.date).filter(Boolean);
      setHolidayDateSet(new Set(dates));
    } catch (e) {
      console.error('Error loading national holidays:', e);
      setHolidayDateSet(new Set());
    } finally {
      setLoadingHolidays(false);
    }
  }, [holidayCacheKey]);

  useEffect(() => {
    if (!formData.start_date) {
      setHolidayCacheKey('');
      setHolidayDateSet(new Set());
      return;
    }
    loadNationalHolidaysForStartDate(formData.start_date);
  }, [formData.start_date, loadNationalHolidaysForStartDate]);

  useEffect(() => {
    if (manualEndDateAdjustment.enabled) return;
    if (!formData.start_date) return;
    if (!selectedProgram?.number_of_phase || !selectedProgram?.number_of_session_per_phase) return;
    if (!formData.days_of_week) return;

    const calculated = calculateEndDate(
      formData.start_date,
      formData.days_of_week,
      selectedProgram.number_of_phase,
      selectedProgram.number_of_session_per_phase
    );

    if (calculated && calculated !== formData.end_date) {
      setFormData((prev) => ({ ...prev, end_date: calculated }));
    }
  }, [
    manualEndDateAdjustment.enabled,
    formData.start_date,
    formData.days_of_week,
    formData.end_date,
    selectedProgram,
    holidayCacheKey,
    holidayDateSet,
  ]);

  // Calculate end time from start time and duration
  const calculateEndTimeFromDuration = (startTime, durationHours) => {
    if (!startTime || !durationHours) return null;
    
    try {
      // Parse start time (HH:MM format)
      const [hours, minutes] = startTime.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return null;
      
      // Create date object for calculation
      const startDate = new Date();
      startDate.setHours(hours, minutes, 0, 0);
      
      // Add duration in hours
      const endDate = new Date(startDate.getTime() + (durationHours * 60 * 60 * 1000));
      
      // Format as HH:MM
      const endHours = String(endDate.getHours()).padStart(2, '0');
      const endMinutes = String(endDate.getMinutes()).padStart(2, '0');
      return `${endHours}:${endMinutes}`;
    } catch (error) {
      console.error('Error calculating end time:', error);
      return null;
    }
  };

  // Fetch room schedules when room is selected
  const fetchRoomSchedules = async (roomId, excludeClassIds = []) => {
    if (!roomId) {
      setRoomSchedules([]);
      return;
    }

    try {
      setLoadingRoomSchedules(true);
      const response = await apiRequest(`/rooms/${roomId}/schedules`);
      if (response.success && response.data) {
        // Filter to only show active classes
        const activeSchedules = response.data.filter(schedule => {
          // Only show schedules that have a class_id (assigned to a class)
          if (!schedule.class_id) return false;
          
          // Exclude the current class if editing
          if (editingClass && schedule.class_id === editingClass.class_id) return false;
          
          // Exclude classes involved in the merge (if any)
          if (excludeClassIds.length > 0 && excludeClassIds.includes(schedule.class_id)) return false;
          
          return true;
        });
        setRoomSchedules(activeSchedules);
      } else {
        setRoomSchedules([]);
      }
    } catch (err) {
      console.error('Error fetching room schedules:', err);
      setRoomSchedules([]);
    } finally {
      setLoadingRoomSchedules(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const updated = {
        ...prev,
        [name]: value,
      };

      // Fetch room schedules and clear teacher conflicts when room changes
      if (name === 'room_id') {
        setTeacherConflicts([]);
        fetchRoomSchedules(value);
      }

      // Auto-calculate end_date when start_date, days_of_week, or program changes
      if (name === 'program_id' || name === 'start_date') {
        if (name === 'program_id') {
          // Fetch program details to get curriculum info
          const program = programs.find(p => p.program_id === parseInt(value));
          if (program && program.number_of_phase && program.number_of_session_per_phase) {
            setSelectedProgram(program);
            // Auto-calculate end times for existing start times if program has session duration
            if (program.session_duration_hours && prev.days_of_week) {
              const updatedDaysOfWeek = { ...prev.days_of_week };
              Object.keys(updatedDaysOfWeek).forEach(day => {
                const dayData = updatedDaysOfWeek[day];
                if (dayData.enabled && dayData.start_time && !dayData.end_time) {
                  // Only auto-calculate if end_time is empty
                  const calculatedEndTime = calculateEndTimeFromDuration(dayData.start_time, program.session_duration_hours);
                  if (calculatedEndTime) {
                    updatedDaysOfWeek[day] = {
                      ...dayData,
                      end_time: calculatedEndTime
                    };
                  }
                } else if (dayData.enabled && dayData.start_time && dayData.end_time) {
                  // Recalculate end time if start time exists (user might want to update)
                  const calculatedEndTime = calculateEndTimeFromDuration(dayData.start_time, program.session_duration_hours);
                  if (calculatedEndTime) {
                    updatedDaysOfWeek[day] = {
                      ...dayData,
                      end_time: calculatedEndTime
                    };
                  }
                }
              });
              updated.days_of_week = updatedDaysOfWeek;
            }
            // Calculate end date if start_date and days_of_week are available
            if (prev.start_date && prev.days_of_week) {
              const calculatedEndDate = calculateEndDate(
                prev.start_date,
                updated.days_of_week || prev.days_of_week,
                program.number_of_phase,
                program.number_of_session_per_phase
              );
              if (calculatedEndDate) {
                updated.end_date = calculatedEndDate;
              }
            }
          } else {
            setSelectedProgram(null);
          }
        } else if (name === 'start_date') {
          // Calculate end date when start_date changes
          if (selectedProgram && selectedProgram.number_of_phase && selectedProgram.number_of_session_per_phase && prev.days_of_week) {
            const calculatedEndDate = calculateEndDate(
              value,
              prev.days_of_week,
              selectedProgram.number_of_phase,
              selectedProgram.number_of_session_per_phase
            );
            if (calculatedEndDate) {
              updated.end_date = calculatedEndDate;
            }
          }
        }
      }

      return updated;
    });
    
    if (formErrors[name]) {
      setFormErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  // Handle days of week checkbox toggle
  const handleDaysOfWeekToggle = (day) => {
    setFormData(prev => {
      const updated = {
        ...prev,
        days_of_week: {
          ...prev.days_of_week,
          [day]: {
            ...prev.days_of_week[day],
            enabled: !prev.days_of_week[day].enabled,
          }
        }
      };

      // Check conflicts when schedule changes
      if (prev.teacher_ids && prev.teacher_ids.length > 0) {
        checkTeacherConflicts(prev.teacher_ids, updated.days_of_week, editingClass?.class_id || null);
      }

      // Recalculate end_date when days_of_week changes
      if (selectedProgram && selectedProgram.number_of_phase && selectedProgram.number_of_session_per_phase && prev.start_date) {
        const calculatedEndDate = calculateEndDate(
          prev.start_date,
          updated.days_of_week,
          selectedProgram.number_of_phase,
          selectedProgram.number_of_session_per_phase
        );
        if (calculatedEndDate) {
          updated.end_date = calculatedEndDate;
        }
      }

      return updated;
    });
  };

  // Check teacher schedule conflicts
  const checkTeacherConflicts = async (teacherIds, daysOfWeek, excludeClassId = null) => {
    if (!teacherIds || teacherIds.length === 0 || !daysOfWeek) {
      setTeacherConflicts([]);
      setTeacherConflictError('');
      return;
    }

    // Format days_of_week for API - only include enabled days with valid times
    const formattedDays = Object.entries(daysOfWeek)
      .map(([day, data]) => {
        // Ensure day name is properly capitalized (Monday, Tuesday, etc.)
        const capitalizedDay = day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
        // Map common variations to standard names
        const dayMap = {
          'Monday': 'Monday',
          'Tuesday': 'Tuesday',
          'Wednesday': 'Wednesday',
          'Thursday': 'Thursday',
          'Friday': 'Friday',
          'Saturday': 'Saturday',
          'Sunday': 'Sunday',
        };
        const standardDay = dayMap[capitalizedDay] || capitalizedDay;
        
        return {
          day: standardDay,
          start_time: (data.start_time || '').trim(),
          end_time: (data.end_time || '').trim(),
          enabled: Boolean(data.enabled),
        };
      })
      .filter(d => {
        // Only include days that are enabled AND have both start_time and end_time
        return d.enabled === true && d.start_time && d.end_time;
      });

    if (formattedDays.length === 0) {
      setTeacherConflicts([]);
      setTeacherConflictError('');
      return;
    }

    // Validate teacher_ids are valid integers
    const validTeacherIds = teacherIds
      .map(id => {
        const parsed = parseInt(id, 10);
        return isNaN(parsed) ? null : parsed;
      })
      .filter(id => id !== null);

    if (validTeacherIds.length === 0) {
      setTeacherConflicts([]);
      setTeacherConflictError('');
      return;
    }

    try {
      setCheckingConflicts(true);
      setTeacherConflictError('');
      // Build request body - only include exclude_class_id if it has a value
      const requestBody = {
        teacher_ids: validTeacherIds,
        days_of_week: formattedDays,
      };
      
      // Only include exclude_class_id if it's provided and valid
      if (excludeClassId) {
        const parsedExcludeId = parseInt(excludeClassId, 10);
        if (!isNaN(parsedExcludeId)) {
          requestBody.exclude_class_id = parsedExcludeId;
        }
      }

      const response = await apiRequest('/classes/check-teacher-conflicts', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      if (response.success && response.has_conflicts) {
        setTeacherConflicts(response.conflicts || []);
      } else {
        setTeacherConflicts([]);
      }
    } catch (err) {
      console.error('Error checking teacher conflicts:', err);
      // Display error message to user
      const errorMessage = err.response?.data?.message || 
                          err.response?.data?.errors?.join(', ') || 
                          err.message || 
                          'Failed to check teacher schedule conflicts. Please try again.';
      setTeacherConflictError(errorMessage);
      setTeacherConflicts([]);
    } finally {
      setCheckingConflicts(false);
    }
  };

  // Handle days of week time change
  const handleDaysOfWeekTimeChange = (day, field, value) => {
    setFormData(prev => {
      const updated = {
      ...prev,
      days_of_week: {
        ...prev.days_of_week,
        [day]: {
          ...prev.days_of_week[day],
          [field]: value,
        }
      }
      };

      // Auto-calculate end_time when start_time changes and program has session duration
      if (field === 'start_time' && value && selectedProgram && selectedProgram.session_duration_hours) {
        const calculatedEndTime = calculateEndTimeFromDuration(value, selectedProgram.session_duration_hours);
        if (calculatedEndTime) {
          updated.days_of_week[day].end_time = calculatedEndTime;
        }
      }

      // Check conflicts when schedule changes
      if (prev.teacher_ids && prev.teacher_ids.length > 0) {
        checkTeacherConflicts(prev.teacher_ids, updated.days_of_week, editingClass?.class_id || null);
      }

      return updated;
    });
  };

  // Validate Step 1: Branch, Program, Level Tag, Max Students
  const validateStep1 = () => {
    const errors = {};
    
    if (!formData.branch_id) {
      errors.branch_id = 'Branch is required';
    }
    
    if (!formData.program_id) {
      errors.program_id = 'Program is required';
    }

    if (!formData.level_tag || !formData.level_tag.trim()) {
      errors.level_tag = 'Level tag is required';
    }

    if (!formData.max_students || formData.max_students.trim() === '') {
      errors.max_students = 'Max students is required';
    } else if (isNaN(formData.max_students) || parseInt(formData.max_students) < 1) {
      errors.max_students = 'Max students must be a positive integer';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Validate Step 2: Class Name, Room, Days of Week (at least 1), Teachers, Start Date, End Date
  const validateStep2 = () => {
    const errors = {};
    
    if (!formData.class_name || !formData.class_name.trim()) {
      errors.class_name = 'Class name is required';
    }

    if (!formData.room_id || formData.room_id === '') {
      errors.room_id = 'Room is required';
    }

    // Validate at least 1 day of week is enabled
    const enabledDays = Object.entries(formData.days_of_week || {})
      .filter(([_, data]) => data && data.enabled === true);
    
    if (enabledDays.length === 0) {
      errors.days_of_week = 'At least one day of week must be selected';
    } else {
      // Validate that enabled days have start_time and end_time
      const daysWithErrors = [];
      for (const [day, data] of enabledDays) {
        const dayErrors = [];
        if (!data.start_time || data.start_time.trim() === '') {
          dayErrors.push('start time');
        }
        if (!data.end_time || data.end_time.trim() === '' && !selectedProgram?.session_duration_hours) {
          // End time is auto-calculated if session_duration_hours is set, so only require if not set
          dayErrors.push('end time');
        }
        if (dayErrors.length > 0) {
          daysWithErrors.push(`${day} ${dayErrors.join(' and ')}`);
          errors[`days_of_week_${day}`] = `${day}: ${dayErrors.join(' and ')} ${dayErrors.length > 1 ? 'are' : 'is'} required`;
        }
      }
      // If multiple days have errors, show a summary
      if (daysWithErrors.length > 1) {
        errors.days_of_week = `Please fill in times for all enabled days: ${daysWithErrors.join(', ')}`;
      }
    }

    // Teachers are required
    if (!formData.teacher_ids || formData.teacher_ids.length === 0) {
      errors.teacher_ids = 'At least one teacher is required';
    }

    // Start date is REQUIRED - needed for session generation and end date calculation
    if (!formData.start_date || formData.start_date.trim() === '') {
      errors.start_date = 'Start date is required';
    }

    // End date validation
    // If program has phases/sessions and start_date exists, end_date should be auto-calculated
    // Otherwise, it's required to be filled manually
    if (selectedProgram && selectedProgram.number_of_phase && selectedProgram.number_of_session_per_phase && formData.start_date) {
      // End date should be auto-calculated, but validate it exists
      if (!formData.end_date || formData.end_date.trim() === '') {
        errors.end_date = 'End date is required. Please ensure start date and schedule are properly configured.';
      }
    } else {
      // Manual end date entry required
      if (!formData.end_date || formData.end_date.trim() === '') {
        errors.end_date = 'End date is required';
      }
    }

    // Validate end date is after start date (if both exist)
    if (formData.start_date && formData.end_date) {
      const startDate = new Date(formData.start_date);
      const endDate = new Date(formData.end_date);
      if (startDate > endDate) {
        errors.end_date = 'End date must be after start date';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Full form validation (for editing mode)
  const validateForm = () => {
    const errors = {};
    
    if (!formData.branch_id) {
      errors.branch_id = 'Branch is required';
    }
    
    if (!formData.program_id) {
      errors.program_id = 'Program is required';
    }

    if (!formData.level_tag || !formData.level_tag.trim()) {
      errors.level_tag = 'Level tag is required';
    }

    if (!formData.room_id || formData.room_id === '') {
      errors.room_id = 'Room is required';
    }

    // Start date is REQUIRED - needed for session generation and end date calculation
    if (!formData.start_date || formData.start_date.trim() === '') {
      errors.start_date = 'Start date is required';
    }

    if (formData.max_students && (isNaN(formData.max_students) || parseInt(formData.max_students) < 1)) {
      errors.max_students = 'Max students must be a positive integer';
    }

    // Validate end date only if both dates are provided
    if (formData.start_date && formData.end_date) {
      const startDate = new Date(formData.start_date);
      const endDate = new Date(formData.end_date);
      if (startDate > endDate) {
        errors.end_date = 'End date must be after start date';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // For new class creation (step2), use validateStep2. For editing, use validateForm.
    const isValid = editingClass ? validateForm() : validateStep2();
    if (!isValid) {
      // Navigate to the first error field
      setTimeout(() => {
        // Priority 1: Check if room is not selected - navigate to room field first
        // (Days of week section won't be visible if room is not selected)
        if (formErrors.room_id) {
          const roomField = document.getElementById('room_id');
          if (roomField) {
            roomField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            roomField.focus();
          }
          return; // Don't check other errors if room is missing
        }
        
        // Priority 2: Check if days_of_week validation failed - navigate to days_of_week section
        // (Only check if room is selected, otherwise days_of_week section won't exist)
        if (formData.room_id && (formErrors.days_of_week || Object.keys(formErrors).some(key => key.startsWith('days_of_week_')))) {
          // Ensure we're on step2 (days_of_week section is only visible in step2)
          if (modalStep === 'step2') {
            const daysOfWeekSection = document.getElementById('days-of-week-section');
            if (daysOfWeekSection) {
              daysOfWeekSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Focus on the first enabled day's start time input, or first checkbox if no days enabled
              const enabledDays = Object.entries(formData.days_of_week || {})
                .filter(([_, data]) => data && data.enabled === true);
              
              if (enabledDays.length > 0) {
                // Focus on first enabled day's start time input that has an error
                const dayWithError = enabledDays.find(([day]) => formErrors[`days_of_week_${day}`]);
                const targetDay = dayWithError ? dayWithError[0] : enabledDays[0][0];
                const startTimeInput = document.querySelector(`input[data-day="${targetDay}"][data-time-type="start_time"]`);
                if (startTimeInput) {
                  setTimeout(() => startTimeInput.focus(), 300);
                }
              } else {
                // No days enabled, focus on first day's checkbox
                const firstCheckbox = document.querySelector('input[type="checkbox"][data-day="Monday"]');
                if (firstCheckbox) {
                  setTimeout(() => firstCheckbox.focus(), 300);
                }
              }
            }
          } else {
            // If not on step2, navigate to step2 first
            setModalStep('step2');
            // Then scroll to days_of_week section after a short delay
            setTimeout(() => {
              const daysOfWeekSection = document.getElementById('days-of-week-section');
              if (daysOfWeekSection) {
                daysOfWeekSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Focus on first checkbox
                const firstCheckbox = document.querySelector('input[type="checkbox"][data-day="Monday"]');
                if (firstCheckbox) {
                  setTimeout(() => firstCheckbox.focus(), 300);
                }
              }
            }, 100);
          }
          return; // Don't check other errors if days_of_week has issues
        }
        
        // Priority 3: Check if start_date validation failed
        if (formErrors.start_date) {
          const startDateField = document.getElementById('start_date');
          if (startDateField) {
            startDateField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            startDateField.focus();
          }
          return;
        }
        
        // Priority 4: Check if teacher_ids validation failed
        if (formErrors.teacher_ids) {
          const teacherField = document.getElementById('teacher_search_input');
          if (teacherField) {
            teacherField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            teacherField.focus();
          }
          return;
        }
        
        // Priority 5: Check if class_name validation failed
        if (formErrors.class_name) {
          const classNameField = document.getElementById('class_name');
          if (classNameField) {
            classNameField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            classNameField.focus();
          }
          return;
        }
      }, 100);
      return;
    }

    setSubmitting(true);
    setError(''); // Clear previous errors
    try {
      // Build payload - ensure empty strings become null for optional fields
      // Note: start_date is required and validated above, so it should always be present here
      const payload = {
        branch_id: adminBranchId || parseInt(formData.branch_id),
        program_id: parseInt(formData.program_id),
        room_id: formData.room_id && formData.room_id !== '' ? parseInt(formData.room_id) : null,
        teacher_ids: formData.teacher_ids && formData.teacher_ids.length > 0 
          ? formData.teacher_ids.map(id => parseInt(id)).filter(id => !isNaN(id))
          : [],
        level_tag: formData.level_tag?.trim() || null,
        class_name: formData.class_name?.trim() || null,
        max_students: formData.max_students && formData.max_students !== '' ? parseInt(formData.max_students) : null,
        // Start date is REQUIRED - validation ensures it exists before reaching here
        start_date: formData.start_date && formData.start_date.trim() !== '' ? formData.start_date.trim() : null,
        end_date: manualEndDateAdjustment.enabled && manualEndDateAdjustment.adjustedDate
          ? manualEndDateAdjustment.adjustedDate
          : (formData.end_date && formData.end_date !== '' ? formData.end_date : null),
        days_of_week: formData.days_of_week ? Object.entries(formData.days_of_week)
          .filter(([_, data]) => data.enabled)
          .map(([day, data]) => ({
            day,
            start_time: data.start_time || null,
            end_time: data.end_time || null,
          })) : null,
      };

      // Additional safety check: Ensure start_date is present (should never happen due to validation, but defensive programming)
      if (!payload.start_date) {
        setError('Start date is required. Please fill in the start date before submitting.');
        setSubmitting(false);
        return;
      }
      
      if (editingClass) {
        await apiRequest(`/classes/${editingClass.class_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/classes', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      fetchClasses();
    } catch (err) {
      const errorMessage = err.message || `Failed to ${editingClass ? 'update' : 'create'} class`;
      setError(errorMessage);
      console.error('Error saving class:', err);
      
      // If it's a schedule conflict error, clear the days_of_week to prevent confusion
      if (errorMessage.toLowerCase().includes('conflict') || errorMessage.toLowerCase().includes('schedule')) {
        setFormData(prev => ({
          ...prev,
          days_of_week: {
            Monday: { enabled: false, start_time: '', end_time: '' },
            Tuesday: { enabled: false, start_time: '', end_time: '' },
            Wednesday: { enabled: false, start_time: '', end_time: '' },
            Thursday: { enabled: false, start_time: '', end_time: '' },
            Friday: { enabled: false, start_time: '', end_time: '' },
            Saturday: { enabled: false, start_time: '', end_time: '' },
            Sunday: { enabled: false, start_time: '', end_time: '' },
          },
        }));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Suspension handlers
  const handleSuspensionFormChange = (field, value) => {
    setSuspensionFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const fetchClassSessionsForSuspension = async (classId, phaseNumber = null) => {
    setLoadingClassSessions(true);
    try {
      // Fetch sessions directly from API for the specific class
      const sessionsResponse = await apiRequest(`/classes/${classId}/sessions`);
      
      if (sessionsResponse.success && sessionsResponse.data) {
        // Filter only scheduled sessions that belong to this specific class
        let sessions = sessionsResponse.data.filter(
          session => session.status === 'Scheduled' && 
                     session.classsession_id && 
                     session.class_id === classId
        );
        
        // If phaseNumber is provided, filter to only that phase
        if (phaseNumber !== null) {
          sessions = sessions.filter(session => session.phase_number === parseInt(phaseNumber));
        }
        
        // Group sessions by phase for easier selection
        const sessionsByPhase = sessions.reduce((acc, session) => {
          const phase = session.phase_number || 1;
          if (!acc[phase]) acc[phase] = [];
          acc[phase].push(session);
          return acc;
        }, {});

        setAvailableClassSessions(sessionsByPhase);
      } else {
        setAvailableClassSessions({});
      }
    } catch (error) {
      console.error('Error fetching class sessions:', error);
      alert('Failed to load class sessions');
      setAvailableClassSessions({});
    } finally {
      setLoadingClassSessions(false);
    }
  };

  const handleSessionToggle = (session) => {
    setSelectedSessionsToSuspend(prev => {
      const isSelected = prev.some(s => s.classsession_id === session.classsession_id);
      if (isSelected) return prev.filter(s => s.classsession_id !== session.classsession_id);
      return [...prev, session];
    });
  };

  const validateSamePhase = () => {
    if (selectedSessionsToSuspend.length === 0) return true;
    const firstPhase = selectedSessionsToSuspend[0].phase_number;
    return selectedSessionsToSuspend.every(s => s.phase_number === firstPhase);
  };

  // Fetch room schedules for suspension modal
  const fetchSuspensionRoomSchedules = async (roomId, excludeClassId = null) => {
    if (!roomId) {
      setSuspensionRoomSchedules([]);
      return;
    }

    try {
      setLoadingSuspensionRoomSchedules(true);
      const response = await apiRequest(`/rooms/${roomId}/schedules`);
      if (response.success && response.data) {
        // Filter to only show schedules that have a class_id (assigned to a class)
        // IMPORTANT: Do NOT exclude the current class. The UI should show ALL schedules for this room
        // so users can choose makeup times without confusion.
        const activeSchedules = response.data.filter(schedule => {
          // Only show schedules that have a class_id (assigned to a class)
          if (!schedule.class_id) return false;
          return true;
        });
        setSuspensionRoomSchedules(activeSchedules);
      } else {
        setSuspensionRoomSchedules([]);
      }
    } catch (err) {
      console.error('Error fetching room schedules for suspension:', err);
      setSuspensionRoomSchedules([]);
    } finally {
      setLoadingSuspensionRoomSchedules(false);
    }
  };

  const handleNextToMakeupScheduling = () => {
    if (selectedSessionsToSuspend.length === 0) {
      alert('Please select at least one session to suspend');
      return;
    }
    if (!suspensionFormData.suspension_name || !suspensionFormData.reason) {
      alert('Please fill in suspension name and reason');
      return;
    }
    if (!validateSamePhase()) {
      alert('All selected sessions must be from the same phase');
      return;
    }
    setSuspensionStep('choose-strategy');
  };

  const handleContinueFromChooseStrategy = async () => {
    if (makeupStrategy === 'manual') {
      const initialMakeupSchedules = selectedSessionsToSuspend.map(session => ({
        suspended_session_id: session.classsession_id,
        suspended_session: session,
        makeup_date: '',
        makeup_start_time: session.scheduled_start_time || '',
        makeup_end_time: session.scheduled_end_time || '',
      }));
      setMakeupSchedules(initialMakeupSchedules);
      if (selectedClassForSuspension && selectedClassForSuspension.room_id) {
        await fetchSuspensionRoomSchedules(selectedClassForSuspension.room_id.toString());
      } else {
        setSuspensionRoomSchedules([]);
      }
      setSuspensionStep('schedule-makeup');
    } else {
      setSuspensionStep('preview-auto');
    }
  };

  // Calculate end time based on start time and original session duration
  const calculateEndTime = (startTime, originalStartTime, originalEndTime) => {
    if (!startTime || !originalStartTime || !originalEndTime) return '';
    
    // Parse times
    const [startH, startM] = startTime.split(':').map(Number);
    const [origStartH, origStartM] = originalStartTime.split(':').map(Number);
    const [origEndH, origEndM] = originalEndTime.split(':').map(Number);
    
    // Calculate duration in minutes
    const origStartMinutes = origStartH * 60 + origStartM;
    const origEndMinutes = origEndH * 60 + origEndM;
    const durationMinutes = origEndMinutes - origStartMinutes;
    
    // Calculate new end time
    const newStartMinutes = startH * 60 + startM;
    const newEndMinutes = newStartMinutes + durationMinutes;
    
    // Handle day overflow (if end time goes past midnight)
    const endH = Math.floor(newEndMinutes / 60) % 24;
    const endM = newEndMinutes % 60;
    
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  };

  const handleMakeupScheduleChange = (suspendedSessionId, field, value) => {
    setMakeupSchedules(prev =>
      prev.map(schedule => {
        if (schedule.suspended_session_id === suspendedSessionId) {
          const updated = { ...schedule, [field]: value };
          
          // Auto-calculate end time when start time changes
          if (field === 'makeup_start_time' && value) {
            updated.makeup_end_time = calculateEndTime(
              value,
              schedule.suspended_session.scheduled_start_time,
              schedule.suspended_session.scheduled_end_time
            );
          }
          
          return updated;
        }
        return schedule;
      })
    );
  };

  const validateMakeupSchedules = () => {
    if (makeupSchedules.length === 0) return false;
    const allFilled = makeupSchedules.every(
      s => s.makeup_date && s.makeup_start_time && s.makeup_end_time
    );
    if (!allFilled) {
      alert('Please fill in all makeup schedules');
      return false;
    }
    const phaseNumber = selectedSessionsToSuspend[0].phase_number;
    const phaseSessions = classSessions.filter(s => s.phase_number === phaseNumber);
    if (phaseSessions.length === 0) return true;
    const phaseDates = phaseSessions.map(s => new Date(s.scheduled_date));
    const phaseStartDate = new Date(Math.min(...phaseDates));
    const phaseEndDate = new Date(Math.max(...phaseDates));
    for (const schedule of makeupSchedules) {
      const makeupDate = new Date(schedule.makeup_date);
      if (makeupDate < phaseStartDate || makeupDate > phaseEndDate) {
        alert(`Makeup dates must be within the phase date range (${formatDateManila(phaseStartDate)} - ${formatDateManila(phaseEndDate)})`);
        return false;
      }
    }
    return true;
  };

  const handleCreateSuspension = async () => {
    if (!selectedClassForSuspension) {
      alert('No class selected');
      return;
    }
    if (makeupStrategy === 'manual' && !validateMakeupSchedules()) return;
    const strategyDescriptions = {
      'add-last-phase': 'Makeup sessions will be auto-generated and added to the last phase; the class end date will be extended.',
      'manual': 'Makeup sessions will be created at your specified dates and times.',
    };
    const confirmed = window.confirm(
      `Are you sure you want to suspend ${selectedSessionsToSuspend.length} session(s) using ${
        makeupStrategy === 'add-last-phase' ? 'Add New Sessions to Last Phase' : 'Manual Scheduling'
      } strategy?\n\n` +
      `${strategyDescriptions[makeupStrategy]}\n\n` +
      `Suspended sessions will be cancelled and marked with reason: ${suspensionFormData.reason}`
    );
    if (!confirmed) return;
    setCreatingSuspension(true);
    try {
      const payload = {
        suspension_name: suspensionFormData.suspension_name,
        reason: suspensionFormData.reason,
        description: suspensionFormData.description || '',
        branch_id: selectedClassForSuspension.branch_id,
        affected_class_ids: [selectedClassForSuspension.class_id],
        selected_session_ids: selectedSessionsToSuspend.map(s => s.classsession_id),
        makeup_strategy: makeupStrategy,
        ...(makeupStrategy === 'manual' ? {
          makeup_schedules: makeupSchedules.map(schedule => ({
            suspended_session_id: schedule.suspended_session_id,
            makeup_date: schedule.makeup_date,
            makeup_start_time: schedule.makeup_start_time,
            makeup_end_time: schedule.makeup_end_time,
          })),
        } : {}),
      };
      await apiRequest('/suspensions', { method: 'POST', body: payload });
      alert('Suspension created successfully with makeup schedules!');
      setIsSuspensionModalOpen(false);
      setSelectedClassForSuspension(null);
      setSuspensionStep('select-sessions');
      setMakeupStrategy('add-last-phase');
      setSuspensionFormData({ suspension_name: '', reason: 'Typhoon', description: '' });
      setAvailableClassSessions([]);
      setSelectedSessionsToSuspend([]);
      setMakeupSchedules([]);
      setSuspensionRoomSchedules([]);
      fetchClasses();
      if (viewMode === 'detail' && selectedClassForDetails) {
        await handleViewClass(selectedClassForDetails);
      }
    } catch (error) {
      console.error('Error creating suspension:', error);
      alert(error.message || 'Failed to create suspension. Please try again.');
    } finally {
      setCreatingSuspension(false);
    }
  };

  // Helper functions
  // Removed getBranchName - admin only sees their branch, use selectedBranchName instead

  const getProgramName = (programId) => {
    if (!programId) return null;
    const program = programs.find(p => p.program_id === programId);
    return program ? program.program_name : null;
  };

  const getRoomName = (roomId) => {
    if (!roomId) return null;
    const room = rooms.find(r => r.room_id === roomId);
    return room ? room.room_name : null;
  };

  // Removed getUniqueBranches - admin only sees their branch
  const getUniquePrograms = [...new Set(classes.map(c => c.program_id).filter(Boolean))];

  const filteredClasses = classes.filter((classItem) => {
    const matchesSearch = !nameSearchTerm || 
      classItem.level_tag?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      classItem.class_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      classItem.teacher_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      selectedBranchName?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      getProgramName(classItem.program_id)?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    // Removed branch filter - admin only sees their branch
    const matchesProgram = !filterProgram || classItem.program_id?.toString() === filterProgram;
    
    return matchesSearch && matchesProgram;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Detail View Component
  if (viewMode === 'detail' && selectedClassForDetails) {
    const formatTime = (timeString) => {
      if (!timeString) return '';
      const timeParts = timeString.split(':');
      const hours = timeParts[0];
      const minutes = timeParts[1] || '00';
      const hour = parseInt(hours);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      const minutesFormatted = minutes.padStart(2, '0');
      return `${hour12}:${minutesFormatted} ${ampm}`;
    };

    const formatDate = (dateValue) => {
      if (!dateValue) return '-';
      try {
        let date;
        // Handle both string (YYYY-MM-DD) and Date object
        if (typeof dateValue === 'string') {
          // Parse date string as local date (YYYY-MM-DD format from database)
          const [year, month, day] = dateValue.split('-').map(Number);
          // Create date in local timezone (treat as Asia/Manila UTC+8)
          date = new Date(year, month - 1, day);
        } else if (dateValue instanceof Date) {
          date = dateValue;
        } else {
          return '-';
        }
        
        // Validate date
        if (isNaN(date.getTime())) {
          return '-';
        }
        
        // Format as "Month Day, Year" (e.g., "November 20, 2025")
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return formatDateManila(date);
      } catch {
        return '-';
      }
    };

    const daysOfWeek = selectedClassForDetails.days_of_week || [];
    const sessionsPerPhase = selectedClassForDetails.number_of_session_per_phase;

    // Resolve primary teacher (for header avatar/name) from either class details or teachers list
    let primaryTeacher = null;
    if (selectedClassForDetails.teacher_ids && Array.isArray(selectedClassForDetails.teacher_ids) && selectedClassForDetails.teacher_ids.length > 0) {
      const firstId = selectedClassForDetails.teacher_ids[0]?.toString();
      primaryTeacher = teachers.find(t => t.user_id?.toString() === firstId) || null;
    } else if (selectedClassForDetails.teacher_id) {
      const idStr = selectedClassForDetails.teacher_id.toString();
      primaryTeacher = teachers.find(t => t.user_id?.toString() === idStr) || null;
    }

    // Determine if there are any students without an explicit attendance status
    const hasPendingStudents = attendanceData?.students?.some(
      (student) => !student.attendance || !student.attendance.status
    );

    // Check if attendance window is open (allow past sessions, block future sessions)
    const checkAttendanceWindow = () => {
      if (!attendanceData?.session?.scheduled_date) return { isOpen: false, reason: 'No session date available' };
      
      const sessionDate = new Date(attendanceData.session.scheduled_date);
      const today = new Date();
      
      sessionDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      
      const isFuture = today < sessionDate;
      
      // Block only future sessions - allow past and current sessions
      if (isFuture) {
        return { isOpen: false, reason: 'future', message: 'Cannot mark attendance for a future session. Please wait until the session date.' };
      }
      return { isOpen: true, reason: 'current' };
    };

    const attendanceWindow = checkAttendanceWindow();
    const isAttendanceWindowClosed = !attendanceWindow.isOpen;

    // Session is locked if:
    // 1. Already saved/completed, OR
    // 2. Attendance window is closed (future date only - past sessions are allowed)
    const isAttendanceLocked =
      attendanceJustSaved || 
      attendanceData?.session?.status === 'Completed' ||
      isAttendanceWindowClosed;
    
    // Determine lock reason for user messaging
    const lockReason = 
      attendanceData?.session?.status === 'Completed' 
        ? 'Attendance for this session has been saved and can no longer be edited.'
        : isAttendanceWindowClosed
        ? attendanceWindow.message
        : '';

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBackToList}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Class Details</h1>
              <p className="text-sm text-gray-500 mt-1">
                {selectedClassForDetails.program_name} - {selectedClassForDetails.class_name || selectedClassForDetails.level_tag}
              </p>
            </div>
          </div>
          {selectedClassForDetails.is_merged_class && (
            <div className="flex items-center gap-2 bg-white rounded-lg shadow px-3 py-2 border border-gray-200">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Merge History</span>
              <button
                onClick={() => openMergeHistoryModal(selectedClassForDetails)}
                className="ml-2 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs font-medium"
              >
                View History
              </button>
            </div>
          )}
        </div>

        {/* Phase & Sessions Table - Collapsible by Phase */}
        {loadingPhaseSessions ? (
          <div className="bg-white rounded-lg shadow p-12">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
          </div>
        ) : phaseSessions.length > 0 ? (
          <div className="space-y-4">
            {(() => {
              // Group sessions by phase_number
              const sessionsByPhase = phaseSessions.reduce((acc, session) => {
                const phaseNum = session.phase_number;
                if (!acc[phaseNum]) {
                  acc[phaseNum] = [];
                }
                acc[phaseNum].push(session);
                return acc;
              }, {});

              // Sort phases and sessions within each phase
              const sortedPhases = Object.keys(sessionsByPhase)
                .map(Number)
                .sort((a, b) => a - b)
                .map(phaseNum => ({
                  phaseNumber: phaseNum,
                  sessions: sessionsByPhase[phaseNum].sort((a, b) => a.phase_session_number - b.phase_session_number)
                }));

              // Calculate active phase for highlighting
              const activePhase = calculateActivePhase(
                phaseSessions,
                classSessions,
                selectedClassForDetails,
                daysOfWeek,
                sessionsPerPhase
              );

              return sortedPhases.map(({ phaseNumber, sessions }) => {
                const isExpanded = expandedPhases.has(phaseNumber);
                const isActivePhase = phaseNumber === activePhase;
                
                // Merge curriculum sessions with any extra class sessions (make-up) not in curriculum
                const phaseClassSessions = (classSessions || [])
                  .filter(cs => cs.phase_number === phaseNumber)
                  .sort((a, b) => {
                    if (a.scheduled_date && b.scheduled_date && a.scheduled_date !== b.scheduled_date) {
                      return new Date(a.scheduled_date) - new Date(b.scheduled_date);
                    }
                    return a.phase_session_number - b.phase_session_number;
                  });

                const curriculumNumbers = new Set(sessions.map(s => s.phase_session_number));
                
                // Create a map of phase sessions by phase_number and phase_session_number for lookup
                const phaseSessionsMap = new Map();
                phaseSessions.forEach(ps => {
                  const key = `${ps.phase_number}-${ps.phase_session_number}`;
                  phaseSessionsMap.set(key, ps);
                });
                
                const extraSessions = phaseClassSessions
                  .filter(cs => !curriculumNumbers.has(cs.phase_session_number))
                  .map(cs => {
                    // Look up enrolled_students from phasesessions (includes rescheduled sessions from backend)
                    const sessionKey = `${cs.phase_number}-${cs.phase_session_number}`;
                    const phaseSessionData = phaseSessionsMap.get(sessionKey);
                    
                    return {
                      phasesessiondetail_id: `makeup-${cs.classsession_id}`,
                      phase_number: cs.phase_number,
                      phase_session_number: cs.phase_session_number,
                      topic: phaseSessionData?.topic || '',
                      goal: phaseSessionData?.goal || '',
                      agenda: phaseSessionData?.agenda || '',
                      enrolled_students: phaseSessionData?.enrolled_students ?? (cs.enrolled_students ?? 0),
                    };
                  });

                // IMPORTANT:
                // Sort by actual scheduled date/time so make-up (Rescheduled) sessions appear
                // in chronological order (e.g., a Jan 29 make-up appears before a Jan 30 session),
                // regardless of phase_session_number.
                const classSessionsByKey = new Map();
                phaseClassSessions.forEach(cs => {
                  classSessionsByKey.set(`${cs.phase_number}-${cs.phase_session_number}`, cs);
                });

                const getSessionSortMeta = (session) => {
                  const key = `${session.phase_number}-${session.phase_session_number}`;
                  const cs = classSessionsByKey.get(key);

                  const date =
                    cs?.scheduled_date ||
                    (selectedClassForDetails.start_date && sessionsPerPhase
                      ? calculateSessionDate(
                          selectedClassForDetails.start_date,
                          daysOfWeek,
                          session.phase_number,
                          session.phase_session_number,
                          sessionsPerPhase
                        )
                      : null);

                  const startTime = cs?.scheduled_start_time || '';
                  return { date, startTime };
                };

                const mergedSessions = [...sessions, ...extraSessions].sort((a, b) => {
                  const aMeta = getSessionSortMeta(a);
                  const bMeta = getSessionSortMeta(b);

                  if (aMeta.date && bMeta.date && aMeta.date !== bMeta.date) {
                    return aMeta.date.localeCompare(bMeta.date);
                  }
                  if (aMeta.date && !bMeta.date) return -1;
                  if (!aMeta.date && bMeta.date) return 1;

                  if (aMeta.startTime && bMeta.startTime && aMeta.startTime !== bMeta.startTime) {
                    return aMeta.startTime.localeCompare(bMeta.startTime);
                  }

                  return a.phase_session_number - b.phase_session_number;
                });
                const activeSessionsOrdered = [...phaseClassSessions].sort((a, b) => {
                  if (a.scheduled_date && b.scheduled_date && a.scheduled_date !== b.scheduled_date) {
                    return new Date(a.scheduled_date) - new Date(b.scheduled_date);
                  }
                  return a.phase_session_number - b.phase_session_number;
                });
                
                return (
                  <div key={phaseNumber} className={`bg-white rounded-lg shadow border-2 transition-colors ${
                    isActivePhase ? 'border-primary-500 shadow-md' : 'border-gray-200'
                  }`}>
                    {/* Phase Header - Collapsible */}
                    <button
                      onClick={() => {
                        const newExpanded = new Set(expandedPhases);
                        if (isExpanded) {
                          newExpanded.delete(phaseNumber);
                        } else {
                          newExpanded.add(phaseNumber);
                        }
                        setExpandedPhases(newExpanded);
                      }}
                      className={`w-full px-6 py-4 flex items-center justify-between transition-colors ${
                        isActivePhase 
                          ? 'bg-primary-50 hover:bg-primary-100' 
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <svg
                          className={`w-5 h-5 transition-transform ${
                            isExpanded 
                              ? 'transform rotate-90' 
                              : ''
                          } ${
                            isActivePhase 
                              ? 'text-primary-600' 
                              : 'text-gray-500'
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <h3 className={`text-lg font-semibold ${
                          isActivePhase 
                            ? 'text-primary-700' 
                            : 'text-gray-900'
                        }`}>
                          Phase {phaseNumber}
                          {isActivePhase && (
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                              Current
                            </span>
                          )}
                        </h3>
                        <span className={`text-sm ${
                          isActivePhase 
                            ? 'text-primary-600' 
                            : 'text-gray-500'
                        }`}>
                          ({sessions.length} session{sessions.length !== 1 ? 's' : ''})
                        </span>
                      </div>
                    </button>

                    {/* Phase Sessions Table - Collapsible Content */}
                    {isExpanded && (
                      <div className="border-t border-gray-200">
            <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
              <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '900px' }}>
                            <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      CLASS CODE
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      PHASE AND SESSION
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      TOPIC
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      GOAL
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      AGENDA
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      SCHEDULE
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      TEACHER
                    </th>
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ENROLLED STUDENTS
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ACTIONS
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                              {mergedSessions.map((session) => {
                      // Find corresponding class session from database
                      const classSession = classSessions.find(cs => 
                        cs.phase_number === session.phase_number && 
                        cs.phase_session_number === session.phase_session_number
                      );

                      // Compute display session number: cancelled shows original; active compresses numbering
                      const displaySessionNumber = (() => {
                        // If session is cancelled, always show original number
                        if (classSession?.status === 'Cancelled') {
                          return session.phase_session_number;
                        }
                        
                        // For active sessions or sessions not yet in database, count non-cancelled sessions before this one
                        let count = 0;
                        for (const s of mergedSessions) {
                          // Only count sessions that come before the current session
                          if (s.phase_session_number < session.phase_session_number) {
                            const cs = classSessions.find(c => 
                              c.phase_number === s.phase_number && 
                              c.phase_session_number === s.phase_session_number
                            );
                            // Count only if not cancelled
                            if (!cs || cs.status !== 'Cancelled') {
                              count++;
                            }
                          } else if (s.phase_session_number === session.phase_session_number) {
                            // Found current session - return count + 1
                            return count + 1;
                          }
                        }
                        
                        // Fallback: if session not found in mergedSessions, return original
                        return session.phase_session_number;
                      })();

                      const isCancelled = classSession?.status === 'Cancelled';
                      const rowTextClass = isCancelled ? 'text-gray-400 line-through' : 'text-gray-900';
                      const rowSubTextClass = isCancelled ? 'text-gray-400 line-through' : 'text-gray-900';

                      // Use database session date if available, otherwise calculate as fallback
                      const sessionDate = classSession?.scheduled_date 
                        ? classSession.scheduled_date
                        : (selectedClassForDetails.start_date && sessionsPerPhase
                          ? calculateSessionDate(
                              selectedClassForDetails.start_date,
                              daysOfWeek,
                              session.phase_number,
                              session.phase_session_number,
                              sessionsPerPhase
                            )
                          : null);

                      // Use database session time if available, otherwise use schedule
                      const sessionStartTime = classSession?.scheduled_start_time || null;
                      const sessionEndTime = classSession?.scheduled_end_time || null;

                      // Get teacher info
                      const originalTeacherName = classSession?.original_teacher_name || selectedClassForDetails.teacher_name || null;
                      const assignedTeacherName = classSession?.assigned_teacher_name || originalTeacherName;
                      const substituteTeacherName = classSession?.substitute_teacher_name || null;
                      const hasSubstitute = classSession?.substitute_teacher_id !== null && classSession?.substitute_teacher_id !== undefined;

                      return (
                        <tr key={session.phasesessiondetail_id} className={isCancelled ? 'bg-gray-100 opacity-60' : ''}>
                          <td className="px-6 py-4 max-w-[200px]">
                            <div className={`text-sm font-medium truncate ${rowTextClass}`} title={classSession?.class_code || ''}>
                              {classSession?.class_code || '-'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className={`text-sm font-medium ${rowTextClass}`}>
                              Phase {session.phase_number} - Session {displaySessionNumber}
                            </div>
                          </td>
                          <td className="px-6 py-4 max-w-[120px]">
                            <div className={`text-sm truncate ${rowSubTextClass}`} title={session.topic || ''}>
                              {session.topic || '-'}
                            </div>
                          </td>
                          <td className="px-6 py-4 max-w-[120px]">
                            <div className={`text-sm truncate ${rowSubTextClass}`} title={session.goal || ''}>
                              {session.goal || '-'}
                            </div>
                          </td>
                          <td className="px-6 py-4 max-w-[120px]">
                            <div className={`text-sm truncate ${rowSubTextClass}`} title={session.agenda || ''}>
                              {session.agenda || '-'}
                            </div>
                          </td>
                          <td className="px-6 py-4 max-w-[140px]">
                            <div className="space-y-1 min-w-0">
                              {sessionDate && (() => {
                                // Get times from database session or fallback to schedule
                                let displayStartTime = sessionStartTime;
                                let displayEndTime = sessionEndTime;
                                
                                // If no times from database, find from schedule based on day of week
                                if (!displayStartTime || !displayEndTime) {
                                  const dateObj = new Date(sessionDate + 'T12:00:00');
                                  const dayOfWeekIndex = dateObj.getDay();
                                  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                                  const dayOfWeekName = dayNames[dayOfWeekIndex];
                                  const daySchedule = daysOfWeek.find(day => day && day.day_of_week === dayOfWeekName);
                                  if (daySchedule && daySchedule.start_time && daySchedule.end_time) {
                                    displayStartTime = daySchedule.start_time;
                                    displayEndTime = daySchedule.end_time;
                                  }
                                }
                                
                                return (
                                  <div>
                                  <div className="text-sm font-medium text-gray-900">
                                    {formatDate(sessionDate)}
                                    </div>
                                    {displayStartTime && displayEndTime && (
                                      <div className="text-sm text-gray-600 font-normal">
                                        {formatTime(displayStartTime)} - {formatTime(displayEndTime)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {!sessionDate && daysOfWeek.length > 0 && (
                                <div className="space-y-0.5">
                                  {daysOfWeek
                                    .filter(day => day && day.day_of_week)
                                    .map((day, index) => {
                                      const timeStr = day.start_time && day.end_time 
                                        ? ` (${formatTime(day.start_time)} - ${formatTime(day.end_time)})`
                                        : '';
                                      return (
                                        <div key={index} className="text-sm text-gray-500">
                                          {day.day_of_week}{timeStr}
                                        </div>
                                      );
                                    })}
                                </div>
                              )}
                              {classSession?.status && classSession.status !== 'Scheduled' && (
                                <div className="inline-flex items-center gap-1 mt-1">
                                  <div className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                                  style={{
                                    backgroundColor: classSession.status === 'Completed' ? '#d1fae5' : 
                                                    classSession.status === 'Cancelled' ? '#fee2e2' :
                                                    classSession.status === 'Rescheduled' ? '#fef3c7' :
                                                    classSession.status === 'In Progress' ? '#dbeafe' : '#f3f4f6',
                                    color: classSession.status === 'Completed' ? '#065f46' : 
                                           classSession.status === 'Cancelled' ? '#991b1b' :
                                           classSession.status === 'Rescheduled' ? '#92400e' :
                                           classSession.status === 'In Progress' ? '#1e40af' : '#374151'
                                  }}
                                >
                                  {classSession.status}
                                  </div>
                                  {(classSession.status === 'Cancelled' || classSession.status === 'Rescheduled') && (
                                    <div 
                                      className="inline-flex items-center text-xs text-amber-600 cursor-help"
                                      title={classSession.status === 'Cancelled' 
                                        ? 'This cancelled session is excluded from end date calculation' 
                                        : 'This rescheduled session may affect end date calculation'}
                                    >
                                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                      </svg>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 max-w-[160px]">
                            <div className="space-y-1 min-w-0">
                              {assignedTeacherName && (
                                <div className="text-sm text-gray-900 truncate" title={assignedTeacherName}>
                                  {assignedTeacherName}
                                  {hasSubstitute && (
                                    <span className="text-xs text-orange-600 ml-1" title="Substitute Teacher">
                                      (Sub)
                                    </span>
                                  )}
                                </div>
                              )}
                              {originalTeacherName && hasSubstitute && originalTeacherName !== assignedTeacherName && (
                                <div className="text-xs text-gray-500 truncate" title={originalTeacherName}>
                                  Original: {originalTeacherName}
                                </div>
                              )}
                              {!assignedTeacherName && (
                                <div className="text-sm text-gray-400 italic">No teacher assigned</div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-center">
                            <div className="text-sm text-gray-900">
                              {session.enrolled_students !== undefined && session.enrolled_students !== null
                                ? session.enrolled_students
                                : '0'}
                              {selectedClassForDetails.max_students && (
                                <span className="text-gray-500"> / {selectedClassForDetails.max_students}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-right">
                            <div className="relative session-action-menu-container">
                            <button
                                onClick={(e) => {
                                  // Prevent action if session is cancelled
                                  if (classSession?.status === 'Cancelled') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    return;
                                  }
                                  const sessionKey = `${session.phase_number}-${session.phase_session_number}`;
                                  handleSessionMenuClick(sessionKey, e);
                              }}
                                disabled={classSession?.status === 'Cancelled'}
                                className={`p-2 rounded-full transition-colors ${
                                  classSession?.status === 'Cancelled'
                                    ? 'opacity-50 cursor-not-allowed'
                                    : 'hover:bg-gray-100 cursor-pointer'
                                }`}
                                title={classSession?.status === 'Cancelled' ? 'Actions unavailable for cancelled sessions' : ''}
                            >
                                <svg className={`w-5 h-5 ${classSession?.status === 'Cancelled' ? 'text-gray-400' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                              </svg>
                            </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-500">No phase sessions found for this class.</p>
            <p className="text-sm text-gray-400 mt-2">
              This program may not have a curriculum with phases and sessions defined.
            </p>
          </div>
        )}

        {/* Session Action Menu Overlay */}
        {openSessionMenuId && viewMode === 'detail' && selectedClassForDetails && (() => {
          const [phaseNum, sessionNum] = openSessionMenuId.split('-');
          
          const session = phaseSessions.find(s => 
            s.phase_number === parseInt(phaseNum) && 
            s.phase_session_number === parseInt(sessionNum)
          );
          
          const classSession = classSessions.find(cs => 
            cs.phase_number === parseInt(phaseNum) && 
            cs.phase_session_number === parseInt(sessionNum)
          );
          
          let sessionDate = null;
          if (classSession?.scheduled_date) {
            sessionDate = classSession.scheduled_date;
          } else if (selectedClassForDetails.start_date && daysOfWeek && daysOfWeek.length > 0) {
            const sessionsInPhase = phaseSessions.filter(s => s.phase_number === parseInt(phaseNum));
            const sessionsPerPhase = sessionsInPhase.length;
            
            if (sessionsPerPhase > 0) {
              sessionDate = calculateSessionDate(
                selectedClassForDetails.start_date,
                daysOfWeek,
                parseInt(phaseNum),
                parseInt(sessionNum),
                sessionsPerPhase
              );
            }
          }
          
          const originalTeacherName = classSession?.original_teacher_name || selectedClassForDetails.teacher_name || null;
          
          return (
            <>
              <div 
                className="fixed inset-0 z-40 bg-transparent" 
                onClick={() => setOpenSessionMenuId(null)}
              />
              <div
                className="fixed session-action-menu-overlay bg-white rounded-md shadow-lg z-50 border border-gray-200 w-48 max-h-[calc(100vh-2rem)] overflow-y-auto"
                style={{
                  ...(sessionMenuPosition.top !== undefined && { top: `${sessionMenuPosition.top}px` }),
                  ...(sessionMenuPosition.bottom !== undefined && { bottom: `${sessionMenuPosition.bottom}px` }),
                  ...(sessionMenuPosition.right !== undefined && { right: `${sessionMenuPosition.right}px` }),
                  ...(sessionMenuPosition.left !== undefined && { left: `${sessionMenuPosition.left}px` }),
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e0 #f7fafc',
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="py-1">
                  <button
                    onClick={() => {
                      setOpenSessionMenuId(null);
                      openAttendanceModal(classSession, parseInt(phaseNum), parseInt(sessionNum), sessionDate);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    Attendance
                  </button>
                  <button
                    onClick={() => {
                      setOpenSessionMenuId(null);
                      setSelectedSessionForSubstitute(classSession || {
                        class_id: selectedClassForDetails.class_id,
                        phase_number: parseInt(phaseNum),
                        phase_session_number: parseInt(sessionNum),
                        scheduled_date: sessionDate,
                        original_teacher_id: selectedClassForDetails.teacher_id,
                        original_teacher_name: originalTeacherName
                      });
                      setIsSubstituteModalOpen(true);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    Sub-teacher
                  </button>
                  <button
                    onClick={() => {
                      setOpenSessionMenuId(null);
                      if (selectedClassForDetails && classSession) {
                        setSelectedClassForSuspension(selectedClassForDetails);
                        setSuspensionStep('select-sessions');
                        setSuspensionFormData({ suspension_name: '', reason: 'Typhoon', description: '' });
                        // Pre-select only the clicked session
                        setSelectedSessionsToSuspend([classSession]);
                        // Limit available sessions to this one session in its phase
                        setAvailableClassSessions({
                          [parseInt(phaseNum)]: [classSession],
                        });
                        setMakeupSchedules([]);
                        setIsSuspensionModalOpen(true);
                      }
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-amber-600 hover:bg-gray-100 transition-colors"
                  >
                    Suspension
                  </button>
                </div>
              </div>
            </>
          );
        })()}

        {/* Merge History Modal - Accessible from detail view */}
        {isMergeHistoryModalOpen && selectedClassForHistory && createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Merge History</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {selectedClassForHistory.program_name} - {selectedClassForHistory.class_name || selectedClassForHistory.level_tag}
                  </p>
                </div>
                <button
                  onClick={closeMergeHistoryModal}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {loadingMergeHistory ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
                  </div>
                ) : mergeHistory.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500">No merge history found for this class.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {mergeHistory.map((history) => (
                      <div key={history.merge_history_id} className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                              Merge Operation
                              {history.is_undone && (
                                <span className="ml-2 inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-200 text-gray-700">
                                  Undone
                                </span>
                              )}
                            </h3>
                            <div className="text-sm text-gray-600 space-y-1">
                              <p>Merged on: {new Date(history.merged_at).toLocaleString()}</p>
                              {history.merged_by_name && <p>Merged by: {history.merged_by_name}</p>}
                              {history.is_undone && history.undone_at && (
                                <>
                                  <p>Undone on: {new Date(history.undone_at).toLocaleString()}</p>
                                  {history.undone_by_name && <p>Undone by: {history.undone_by_name}</p>}
                                </>
                              )}
                            </div>
                          </div>
                          {!history.is_undone && (
                            <button
                              onClick={() => handleUndoMerge(history.merge_history_id, history.merged_class_id)}
                              disabled={undoingMerge}
                              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {undoingMerge ? 'Undoing...' : 'Undo Merge'}
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                          <div className="bg-white rounded p-3">
                            <div className="text-xs text-gray-500 mb-1">Original Classes</div>
                            <div className="text-lg font-semibold text-gray-900">{history.summary.original_class_count}</div>
                          </div>
                          <div className="bg-white rounded p-3">
                            <div className="text-xs text-gray-500 mb-1">Enrollments</div>
                            <div className="text-lg font-semibold text-gray-900">{history.summary.original_enrollment_count}</div>
                          </div>
                          <div className="bg-white rounded p-3">
                            <div className="text-xs text-gray-500 mb-1">Unique Students</div>
                            <div className="text-lg font-semibold text-gray-900">{history.summary.unique_students}</div>
                          </div>
                          <div className="bg-white rounded p-3">
                            <div className="text-xs text-gray-500 mb-1">Schedules</div>
                            <div className="text-lg font-semibold text-gray-900">{history.summary.original_schedule_count}</div>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">Original Classes</h4>
                          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                            <table style={{ width: '100%', minWidth: '600px' }} className="divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Class Name</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Level Tag</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Students</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {history.original_classes.map((origClass) => (
                                  <tr key={origClass.class_id}>
                                    <td className="px-4 py-3 text-sm text-gray-900">{origClass.class_name || '-'}</td>
                                    <td className="px-4 py-3 text-sm text-gray-900">{origClass.level_tag || '-'}</td>
                                    <td className="px-4 py-3 text-sm text-gray-900">{origClass.max_students || '-'}</td>
                                    <td className="px-4 py-3 text-sm">
                                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                                        origClass.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                      }`}>
                                        {origClass.status || 'Active'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0">
                <button
                  onClick={closeMergeHistoryModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Schedule Conflicts Modal - Only shown in detail view */}
        {isConflictModalOpen && conflictData && viewMode === 'detail' && createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Schedule Conflicts Detected</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Cannot undo merge due to schedule conflicts with existing classes
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsConflictModalOpen(false);
                    setConflictData(null);
                  }}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {/* Summary */}
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                  <div className="flex items-start">
                    <svg className="w-6 h-6 text-red-600 mr-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-red-900 mb-2">
                        {conflictData.details?.total_conflicts || conflictData.conflicts.length} Conflict(s) Found
                      </h3>
                      <p className="text-sm text-red-800 mb-2">
                        {conflictData.details?.action_required || 'Please resolve these conflicts before undoing the merge.'}
                      </p>
                      {conflictData.details && (
                        <div className="text-xs text-red-700 space-y-1">
                          <p>• Room conflicts: {conflictData.details.room_conflicts || 0}</p>
                          <p>• Missing rooms: {conflictData.details.missing_room_conflicts || 0}</p>
                          {conflictData.details.conflicting_class_ids && conflictData.details.conflicting_class_ids.length > 0 && (
                            <p>• Conflicting class IDs: {conflictData.details.conflicting_class_ids.join(', ')}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Conflicts Table */}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Conflict Details</h3>
                  <div className="overflow-x-auto rounded-lg border border-gray-200" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                    <table style={{ width: '100%', minWidth: '800px' }} className="divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Original Class</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conflicting Class</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Room</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Day & Time</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Message</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {conflictData.conflicts.map((conflict, index) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm">
                              <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                                conflict.type === 'room_conflict' 
                                  ? 'bg-red-100 text-red-800' 
                                  : 'bg-yellow-100 text-yellow-800'
                              }`}>
                                {conflict.type === 'room_conflict' ? 'Room Conflict' : 'Missing Room'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {conflict.original_class ? (
                                <div>
                                  <div className="font-medium">{conflict.original_class.class_name || conflict.original_class.level_tag || `Class ${conflict.original_class.class_id}`}</div>
                                  {conflict.original_class.program_name && (
                                    <div className="text-xs text-gray-500">{conflict.original_class.program_name}</div>
                                  )}
                                  <div className="text-xs text-gray-400">ID: {conflict.original_class.class_id}</div>
                                </div>
                              ) : (
                                <span className="text-gray-400">Unknown</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {conflict.conflicting_class ? (
                                <div>
                                  <div className="font-medium text-red-700">
                                    {conflict.conflicting_class.class_name || conflict.conflicting_class.level_tag || `Class ${conflict.conflicting_class.class_id}`}
                                  </div>
                                  {conflict.conflicting_class.program_name && (
                                    <div className="text-xs text-gray-500">{conflict.conflicting_class.program_name}</div>
                                  )}
                                  <div className="text-xs text-gray-400">ID: {conflict.conflicting_class.class_id}</div>
                                </div>
                              ) : conflict.type === 'missing_room' ? (
                                <span className="text-gray-400">N/A</span>
                              ) : (
                                <span className="text-gray-400">Unknown</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {conflict.room_id ? (
                                <span className="font-medium">Room {conflict.room_id}</span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {conflict.day_of_week && conflict.start_time && conflict.end_time ? (
                                <div>
                                  <div className="font-medium">{conflict.day_of_week}</div>
                                  <div className="text-xs text-gray-500">
                                    {formatTime(conflict.start_time)} - {formatTime(conflict.end_time)}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {conflict.message || 'No message available'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Instructions */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-blue-900 mb-2">How to Resolve Conflicts:</h4>
                  <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                    <li>Review the conflicting classes listed above</li>
                    <li>Edit the schedule of the conflicting class(es) to use a different room or time</li>
                    <li>Alternatively, delete the conflicting class(es) if they are no longer needed</li>
                    <li>Once conflicts are resolved, try undoing the merge again</li>
                  </ol>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0">
                <button
                  onClick={() => {
                    setIsConflictModalOpen(false);
                    setConflictData(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Suspension Modal - Two-Step Process */}
        {isSuspensionModalOpen && selectedClassForSuspension && createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">
                    {suspensionStep === 'select-sessions' && 'Select Sessions to Suspend'}
                    {suspensionStep === 'choose-strategy' && 'Choose Makeup Strategy'}
                    {suspensionStep === 'schedule-makeup' && 'Schedule Makeup Sessions'}
                    {suspensionStep === 'preview-auto' && 'Review Automatic Makeup Schedule'}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Class: {selectedClassForSuspension.class_name} ({selectedClassForSuspension.level_tag})
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsSuspensionModalOpen(false);
                    setSelectedClassForSuspension(null);
                    setSuspensionStep('select-sessions');
                    setMakeupStrategy('add-last-phase');
                    setAvailableClassSessions([]);
                    setSelectedSessionsToSuspend([]);
                    setMakeupSchedules([]);
                    setSuspensionRoomSchedules([]);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div
                className={`flex-1 min-h-0 p-6 ${
                  suspensionStep === 'schedule-makeup'
                    ? 'overflow-hidden flex'
                    : 'overflow-hidden flex flex-col space-y-4'
                }`}
              >
                {suspensionStep === 'select-sessions' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Suspension Description <span className="text-red-500">*</span></label>
                        <input type="text" value={suspensionFormData.suspension_name} onChange={(e) => handleSuspensionFormChange('suspension_name', e.target.value)} placeholder="e.g., Typhoon Odette" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
                        <select value={suspensionFormData.reason} onChange={(e) => handleSuspensionFormChange('reason', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent">
                          <option value="Typhoon">Typhoon</option>
                          <option value="Earthquake">Earthquake</option>
                          <option value="Flood">Flood</option>
                          <option value="Holiday">Holiday</option>
                          <option value="Government Mandate">Government Mandate</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-6 flex-1 min-h-0 flex flex-col">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Select Sessions to Suspend ({selectedSessionsToSuspend.length} selected)</h4>
                      <p className="text-xs text-amber-600 mb-3">⚠️ All selected sessions must be from the same phase</p>
                      {loadingClassSessions ? (
                        <div className="text-center py-8">
                          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                          <p className="text-sm text-gray-600 mt-2">Loading sessions...</p>
                        </div>
                      ) : Object.keys(availableClassSessions).length === 0 ? (
                        <p className="text-sm text-gray-500 text-center py-8">No scheduled sessions available</p>
                      ) : (
                        <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
                          {Object.keys(availableClassSessions).sort((a, b) => parseInt(a) - parseInt(b)).map(phaseNumber => (
                            <div key={phaseNumber} className="border border-gray-200 rounded-lg p-4">
                              <h5 className="font-semibold text-gray-900 mb-3">Phase {phaseNumber}</h5>
                              <div className="space-y-2">
                                {availableClassSessions[phaseNumber].map(session => (
                                  <label key={session.classsession_id} className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                                    <input type="checkbox" checked={selectedSessionsToSuspend.some(s => s.classsession_id === session.classsession_id)} onChange={() => handleSessionToggle(session)} className="h-4 w-4 text-amber-600 focus:ring-amber-500 border-gray-300 rounded" />
                                    <div className="ml-3 flex-1">
                                      <div className="text-sm font-medium text-gray-900">Session {session.phase_session_number}</div>
                                      <div className="text-xs text-gray-600">
                                        {formatDateManila(session.scheduled_date)} • {session.scheduled_start_time} - {session.scheduled_end_time}
                                      </div>
                                    </div>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {suspensionStep === 'choose-strategy' && (
                  <div className="flex-1 overflow-y-auto space-y-6">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-blue-900 mb-2">How would you like to handle makeup sessions?</h4>
                      <p className="text-xs text-blue-700">Choose the best approach for rescheduling the {selectedSessionsToSuspend.length} suspended session(s).</p>
                    </div>
                    <div className="space-y-4">
                      <label className={`block p-6 border-2 rounded-lg cursor-pointer transition-all ${makeupStrategy === 'add-last-phase' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                        <div className="flex items-start">
                          <input type="radio" name="makeupStrategy" value="add-last-phase" checked={makeupStrategy === 'add-last-phase'} onChange={(e) => setMakeupStrategy(e.target.value)} className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300" />
                          <div className="ml-4 flex-1">
                            <div className="flex items-center justify-between">
                              <h5 className="text-base font-semibold text-gray-900">Add New Sessions to Last Phase</h5>
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Recommended</span>
                            </div>
                            <p className="mt-2 text-sm text-gray-600">Automatically generates makeup sessions and adds them to the last phase of the class. The class end date will be extended to accommodate the new sessions.</p>
                            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                              <div className="flex items-start"><svg className="w-4 h-4 text-green-500 mt-0.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-gray-600">Automatic scheduling</span></div>
                              <div className="flex items-start"><svg className="w-4 h-4 text-green-500 mt-0.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-gray-600">Sessions added to last phase</span></div>
                              <div className="flex items-start"><svg className="w-4 h-4 text-green-500 mt-0.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-gray-600">Class end date extended</span></div>
                              <div className="flex items-start"><svg className="w-4 h-4 text-green-500 mt-0.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-gray-600">No new phase created</span></div>
                            </div>
                          </div>
                        </div>
                      </label>
                      <label className={`block p-6 border-2 rounded-lg cursor-pointer transition-all ${makeupStrategy === 'manual' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                        <div className="flex items-start">
                          <input type="radio" name="makeupStrategy" value="manual" checked={makeupStrategy === 'manual'} onChange={(e) => setMakeupStrategy(e.target.value)} className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300" />
                          <div className="ml-4 flex-1">
                            <h5 className="text-base font-semibold text-gray-900">Manual Scheduling</h5>
                            <p className="mt-2 text-sm text-gray-600">Manually pick the date and time for each makeup session. Gives you full control over when and how makeup sessions are scheduled.</p>
                            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                              <div className="flex items-start"><svg className="w-4 h-4 text-green-500 mt-0.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-gray-600">Full control over schedule</span></div>
                              <div className="flex items-start"><svg className="w-4 h-4 text-green-500 mt-0.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-gray-600">Flexible date/time selection</span></div>
                              <div className="flex items-start"><svg className="w-4 h-4 text-amber-500 mt-0.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg><span className="text-gray-600">Requires manual input for each session</span></div>
                              <div className="flex items-start"><svg className="w-4 h-4 text-blue-500 mt-0.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span className="text-gray-600">Best for custom arrangements</span></div>
                            </div>
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {suspensionStep === 'preview-auto' && (
                  <div className="flex-1 overflow-y-auto space-y-6">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-green-900 mb-2">✓ Sessions Added to Last Phase · Class End Date Extended</h4>
                      <p className="text-xs text-green-700">{selectedSessionsToSuspend.length} makeup session(s) will be auto-generated and added to the last phase. The class end date will be extended to accommodate them.</p>
                    </div>
                    <div className="space-y-4">
                      <h4 className="text-sm font-semibold text-gray-900">Sessions to be Suspended:</h4>
                      {selectedSessionsToSuspend.map((session, index) => (
                        <div key={session.classsession_id} className="border border-gray-200 rounded-lg p-4 bg-white">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h5 className="text-sm font-semibold text-gray-900">Session {index + 1}: Phase {session.phase_number}, Session {session.phase_session_number}</h5>
                              <p className="text-xs text-gray-600 mt-1">Original Date: {formatDateManila(session.scheduled_date)}</p>
                              <p className="text-xs text-gray-600">Time: {session.scheduled_start_time} - {session.scheduled_end_time}</p>
                            </div>
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Will be suspended</span>
                          </div>
                          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                            <p className="text-xs font-medium text-blue-900 mb-1">→ Will be rescheduled in the last phase</p>
                            <p className="text-xs text-blue-700">Makeup session will be automatically scheduled at the end of the class; the class end date will be extended.</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">What will happen:</h4>
                      <ul className="space-y-2 text-sm text-gray-700">
                        <li className="flex items-start"><svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span>Selected session(s) will be marked as &quot;Cancelled&quot; with reason: {suspensionFormData.reason}</span></li>
                        <li className="flex items-start"><svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span>Makeup sessions will be added to the last phase and the class end date will be extended</span></li>
                        <li className="flex items-start"><svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span>Makeup sessions will follow the same day(s) of week and time as the original class schedule</span></li>
                        <li className="flex items-start"><svg className="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span>Students will be notified about the suspension and rescheduled sessions</span></li>
                      </ul>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <p className="text-xs text-amber-800"><strong>Note:</strong> Click &quot;Create Suspension&quot; to proceed with this automatic makeup scheduling.</p>
                    </div>
                  </div>
                )}

                {suspensionStep === 'schedule-makeup' && (
                  <>
                    {/* Left Column: Makeup Scheduling */}
                    <div className="flex-1 pr-4 overflow-y-auto">
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                        <h4 className="text-sm font-semibold text-amber-900 mb-2">Suspended Sessions: {selectedSessionsToSuspend.length}</h4>
                        <p className="text-xs text-amber-700">Please schedule makeup sessions for each suspended session. Makeup dates must be within the same phase.</p>
                      </div>

                      <div className="space-y-4">
                        {makeupSchedules.map((schedule) => {
                          const phaseNumber = schedule.suspended_session.phase_number;
                          return (
                            <div key={schedule.suspended_session_id} className="border border-gray-200 rounded-lg p-4">
                              <div className="flex items-start justify-between mb-3">
                                <div>
                                  <h5 className="font-semibold text-gray-900">Phase {schedule.suspended_session.phase_number}, Session {schedule.suspended_session.phase_session_number}</h5>
                                  <p className="text-xs text-gray-600 mt-1">Original: {formatDateManila(schedule.suspended_session.scheduled_date)} • {schedule.suspended_session.scheduled_start_time} - {schedule.suspended_session.scheduled_end_time}</p>
                                </div>
                                <span className="text-xs font-medium text-amber-600 bg-amber-100 px-2 py-1 rounded">Suspended</span>
                              </div>
                              <div className="grid grid-cols-1 gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Makeup Date <span className="text-red-500">*</span></label>
                                  <input type="date" value={schedule.makeup_date} onChange={(e) => handleMakeupScheduleChange(schedule.suspended_session_id, 'makeup_date', e.target.value)} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Start Time <span className="text-red-500">*</span></label>
                                    <input type="time" value={schedule.makeup_start_time} onChange={(e) => handleMakeupScheduleChange(schedule.suspended_session_id, 'makeup_start_time', e.target.value)} className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">End Time <span className="text-red-500">*</span></label>
                                    <input type="time" value={schedule.makeup_end_time} disabled readOnly className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed" />
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Right Column: Existing Schedule */}
                    <div className="w-80 border-l border-gray-200 pl-4 overflow-y-auto">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-sm font-semibold text-blue-900">
                            📅 Existing Schedules
                          </h4>
                          <p className="text-xs text-blue-700 mt-0.5">
                            {selectedClassForSuspension?.room_id ? 
                              (rooms.find(r => r.room_id === selectedClassForSuspension.room_id)?.room_name || 'Selected Room') :
                              'No room assigned'
                            }
                          </p>
                        </div>
                      </div>
                      
                      {loadingSuspensionRoomSchedules ? (
                        <div className="flex items-center justify-center py-8">
                          <div className="flex items-center space-x-2 text-blue-600">
                            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="text-sm">Loading...</span>
                          </div>
                        </div>
                      ) : suspensionRoomSchedules.length > 0 ? (
                        <div className="space-y-2">
                          {/* Group schedules by day of week */}
                          {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => {
                            const daySchedules = suspensionRoomSchedules.filter(s => s.day_of_week === day);
                            
                            if (daySchedules.length === 0) {
                              return (
                                <div key={day} className="border border-gray-200 rounded-lg p-2 bg-gray-50">
                                  <div className="text-xs font-semibold text-gray-500 uppercase">
                                    {day.substring(0, 3)}
                                  </div>
                                  <div className="text-xs text-gray-400 italic mt-1">No schedule</div>
                                </div>
                              );
                            }
                            
                            return (
                              <div key={day} className="border border-blue-200 rounded-lg bg-blue-50">
                                <div className="w-full flex items-center justify-between p-2">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-xs font-semibold text-blue-900 uppercase">
                                      {day.substring(0, 3)}
                                    </span>
                                    <span className="text-[10px] text-blue-600 bg-blue-200 px-1.5 py-0.5 rounded-full">
                                      {daySchedules.length}
                                    </span>
                                  </div>
                                </div>
                                
                                <div className="p-2 space-y-1.5">
                                  {daySchedules.map((schedule, idx) => {
                                    const startTime = schedule.start_time ? schedule.start_time.substring(0, 5) : '--:--';
                                    const endTime = schedule.end_time ? schedule.end_time.substring(0, 5) : '--:--';
                                    const className = schedule.class_name 
                                      ? `${schedule.program_name || ''} - ${schedule.class_name}`.trim()
                                      : schedule.level_tag 
                                        ? `${schedule.program_name || ''} - ${schedule.level_tag}`.trim()
                                        : schedule.program_name || `Class ${schedule.class_id}`;
                                    
                                    return (
                                      <div key={idx} className="bg-white rounded border border-blue-100 p-1.5 hover:bg-blue-50 transition-colors">
                                        <div className="flex items-center justify-between mb-0.5">
                                          <span className="text-[10px] font-medium text-blue-700">
                                            {startTime} - {endTime}
                                          </span>
                                          {selectedClassForSuspension?.class_id &&
                                            schedule.class_id === selectedClassForSuspension.class_id && (
                                              <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                                                This class
                                              </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-blue-900 truncate font-medium" title={className}>
                                          {className}
                                        </p>
                                        {schedule.teacher_names && (
                                          <p className="text-[10px] text-blue-600 truncate mt-0.5" title={schedule.teacher_names}>
                                            {schedule.teacher_names}
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center py-8">
                          <p className="text-sm text-gray-500 italic text-center">
                            {selectedClassForSuspension?.room_id 
                              ? 'No existing schedules found for this room.'
                              : 'No room assigned to this class.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0">
                {(suspensionStep === 'choose-strategy' || suspensionStep === 'schedule-makeup' || suspensionStep === 'preview-auto') && (
                  <button
                    onClick={() => {
                      if (suspensionStep === 'choose-strategy') setSuspensionStep('select-sessions');
                      else setSuspensionStep('choose-strategy');
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={() => {
                    setIsSuspensionModalOpen(false);
                    setSelectedClassForSuspension(null);
                    setSuspensionStep('select-sessions');
                    setMakeupStrategy('add-last-phase');
                    setAvailableClassSessions([]);
                    setSelectedSessionsToSuspend([]);
                    setMakeupSchedules([]);
                    setSuspensionRoomSchedules([]);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                {suspensionStep === 'select-sessions' && (
                  <button onClick={handleNextToMakeupScheduling} disabled={selectedSessionsToSuspend.length === 0} className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Next</button>
                )}
                {suspensionStep === 'choose-strategy' && (
                  <button onClick={handleContinueFromChooseStrategy} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors">Continue</button>
                )}
                {(suspensionStep === 'schedule-makeup' || suspensionStep === 'preview-auto') && (
                  <button onClick={handleCreateSuspension} disabled={creatingSuspension} className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{creatingSuspension ? 'Creating...' : 'Create Suspension'}</button>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Attendance Modal */}
        {isAttendanceModalOpen && createPortal(
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
            onClick={closeAttendanceModal}
            style={{ zIndex: 9999, position: 'fixed' }}
          >
            {loadingAttendance || !attendanceData ? (
              <div className="bg-white rounded-lg shadow-xl p-8 text-center max-w-md">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading attendance data...</p>
              </div>
            ) : (
            <div 
              className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-gradient-to-r from-[#F7C844] to-[#F5B82E]">
                <div className="flex-1">
                  {/* Schedule line */}
                  <div className="flex items-center text-sm text-gray-900 font-medium mb-2">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>
                      {attendanceData?.session?.scheduled_date 
                        ? formatDate(attendanceData.session.scheduled_date)
                        : selectedSessionForAttendance?.scheduled_date
                        ? formatDate(selectedSessionForAttendance.scheduled_date)
                        : '-'}
                    </span>
                    {attendanceData?.session?.scheduled_start_time && attendanceData?.session?.scheduled_end_time && (
                      <>
                        <span className="mx-2">•</span>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>
                          {formatTime(attendanceData.session.scheduled_start_time)} - {formatTime(attendanceData.session.scheduled_end_time)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Class name */}
                  <h2 className="text-3xl font-bold text-gray-900 mb-1">
                    {attendanceData?.session?.class_name || attendanceData?.session?.level_tag || selectedClassForDetails?.class_name || selectedClassForDetails?.level_tag || 'Class'}
                  </h2>

                  {/* Program + phase/session */}
                  <div className="flex items-center text-sm text-gray-800">
                    <span className="font-medium">{attendanceData?.session?.program_name || selectedClassForDetails?.program_name || ''}</span>
                    {selectedSessionForAttendance?.phase_number && selectedSessionForAttendance?.phase_session_number && (
                      <>
                        <span className="mx-2">•</span>
                        <span className="px-2 py-0.5 bg-white bg-opacity-30 rounded text-gray-900 font-semibold">
                          Phase {selectedSessionForAttendance.phase_number} Session {selectedSessionForAttendance.phase_session_number}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Right: Teacher avatar + name + close */}
                <div className="flex items-center gap-4 ml-4">
                  {(primaryTeacher || selectedClassForDetails?.teacher_name) && (
                    <div className="flex items-center gap-3 bg-white bg-opacity-20 rounded-lg px-3 py-2">
                      <div className="w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center overflow-hidden ring-2 ring-white ring-opacity-50">
                        {primaryTeacher?.profile_picture_url ? (
                          <img 
                            src={primaryTeacher.profile_picture_url} 
                            alt={primaryTeacher.full_name}
                            className="w-full h-full object-cover"
                          />
                        ) : selectedClassForDetails?.teacher_profile_picture ? (
                          <img 
                            src={selectedClassForDetails.teacher_profile_picture} 
                            alt={selectedClassForDetails.teacher_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-lg font-bold text-gray-700">
                            {(primaryTeacher?.full_name || selectedClassForDetails?.teacher_name || '?')
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-gray-800 opacity-90">Teacher</div>
                        <div className="text-sm text-gray-900 font-semibold">
                          {primaryTeacher?.full_name || selectedClassForDetails?.teacher_name}
                        </div>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={closeAttendanceModal}
                    className="text-gray-900 hover:text-gray-700 transition-colors p-2 hover:bg-white hover:bg-opacity-20 rounded-lg"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="space-y-6">
                    {/* Quick Actions Bar */}
                    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                          <span className="text-sm font-semibold text-gray-900">Quick Actions</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              if (isAttendanceLocked || !attendanceData) return;
                              if (attendanceData) {
                                setAttendanceData(prev => ({
                                  ...prev,
                                  students: prev.students.map(student => ({
                                    ...student,
                                    attendance: {
                                      ...student.attendance,
                                      student_id: student.student_id,
                                      status: 'Present',
                                      notes: student.attendance?.notes || '',
                                    },
                                  })),
                                }));
                              }
                            }}
                            disabled={isAttendanceLocked}
                            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                            title="Mark all students as present"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>All Present</span>
                          </button>
                          <button 
                            onClick={() => {
                              if (isAttendanceLocked || !attendanceData) return;
                              if (attendanceData) {
                                setAttendanceData(prev => ({
                                  ...prev,
                                  students: prev.students.map(student => ({
                                    ...student,
                                    attendance: {
                                      ...student.attendance,
                                      student_id: student.student_id,
                                      status: 'Absent',
                                      notes: student.attendance?.notes || '',
                                    },
                                  })),
                                }));
                              }
                            }}
                            disabled={isAttendanceLocked}
                            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                            title="Mark all students as absent"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            <span>All Absent</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Attendance Window Status Banner */}
                    {isAttendanceWindowClosed && (
                      <div className="p-4 rounded-lg border bg-blue-50 border-blue-200">
                        <div className="flex items-start gap-3">
                          <svg 
                            className="w-5 h-5 flex-shrink-0 mt-0.5 text-blue-600" 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path 
                              strokeLinecap="round" 
                              strokeLinejoin="round" 
                              strokeWidth={2} 
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
                            />
                          </svg>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-blue-900">
                              Attendance Not Yet Available
                            </p>
                            <p className="text-xs mt-1 text-blue-700">
                              {attendanceWindow.message}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Students Grid */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">Students</h3>
                        <span className="text-sm text-gray-600">
                          {attendanceData?.students?.filter(s => s.attendance?.status === 'Present').length || 0} / {attendanceData?.students?.length || 0} Present
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {attendanceData?.students?.map((student) => {
                          const rawStatus = student.attendance?.status || null;
                          const attendanceStatus = rawStatus || 'Pending';
                          const displayLabel = rawStatus ? attendanceStatus : 'Mark Attendance';
                          
                          const statusConfig = {
                            'Present': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: 'bg-green-500', hover: 'hover:bg-green-100' },
                            'Absent': { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: 'bg-red-500', hover: 'hover:bg-red-100' },
                            'Late': { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', icon: 'bg-yellow-500', hover: 'hover:bg-yellow-100' },
                            'Excused': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', icon: 'bg-blue-500', hover: 'hover:bg-blue-100' },
                            'Leave Early': { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', icon: 'bg-purple-500', hover: 'hover:bg-purple-100' },
                            'Pending': { bg: 'bg-white', border: 'border-gray-200', text: 'text-gray-600', icon: 'bg-gray-400', hover: 'hover:bg-gray-50' }
                          };
                          
                          const config = statusConfig[attendanceStatus];
                          
                          return (
                            <button
                              key={student.student_id}
                              onClick={() => {
                                if (isAttendanceLocked) return;
                                const statuses = ['Present', 'Absent', 'Late', 'Excused', 'Leave Early'];
                                const currentIndex = statuses.indexOf(attendanceStatus);
                                const nextIndex = (currentIndex + 1) % statuses.length;
                                handleAttendanceStatusChange(student.student_id, statuses[nextIndex]);
                              }}
                              disabled={isAttendanceLocked}
                              className={`${config.bg} ${config.border} border-2 rounded-xl p-4 flex flex-col items-center transition-all ${config.hover} disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md relative group`}
                            >
                              {/* Status Indicator Badge */}
                              {attendanceStatus !== 'Pending' && (
                                <div className={`absolute top-2 right-2 ${config.icon} w-3 h-3 rounded-full ring-2 ring-white`}></div>
                              )}
                              
                              {/* Student Avatar */}
                              <div className="w-16 h-16 rounded-full bg-white shadow-md flex items-center justify-center overflow-hidden mb-3 ring-2 ring-gray-100">
                                {student.profile_picture_url ? (
                                  <img 
                                    src={student.profile_picture_url} 
                                    alt={student.full_name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span className="text-2xl font-bold text-gray-600">
                                    {student.full_name.charAt(0).toUpperCase()}
                                  </span>
                                )}
                              </div>
                              
                              {/* Student Name */}
                              <div className="text-sm font-semibold text-gray-900 text-center mb-2 line-clamp-2">
                                {student.full_name}
                              </div>
                              
                              {/* Attendance Status */}
                              <div className={`text-xs font-bold ${config.text} uppercase tracking-wide`}>
                                {displayLabel}
                              </div>
                              
                              {/* Click hint */}
                              {!isAttendanceLocked && (
                                <div className="mt-2 text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                  Click to change
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Session Details Section */}
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 border border-gray-200 shadow-sm">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Session Details
                      </h3>
                      <div className="space-y-4">
                        {/* Topic */}
                        <div>
                          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                            Topic
                          </label>
                          <div className="text-sm text-gray-900 bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                            {attendanceData?.session?.topic || <span className="text-gray-400 italic">No topic specified</span>}
                          </div>
                        </div>

                        {/* Notes */}
                        <div>
                          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Notes
                          </label>
                          <div className="text-sm text-gray-700 min-h-[60px] rounded-lg bg-white px-4 py-3 border border-gray-200 shadow-sm">
                            {attendanceNotes?.trim()
                              ? <div className="whitespace-pre-wrap">{attendanceNotes}</div>
                              : <span className="text-gray-400 italic">No notes added yet. Click "Add Note" to add session notes.</span>}
                          </div>
                        </div>

                        {/* Agenda */}
                        <div>
                          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                            Agenda
                          </label>
                          <div className="text-sm text-gray-700 min-h-[60px] rounded-lg bg-white px-4 py-3 border border-gray-200 shadow-sm">
                            {attendanceAgenda?.trim()
                              ? <div className="whitespace-pre-wrap">{attendanceAgenda}</div>
                              : <span className="text-gray-400 italic">No agenda added yet. Click "Add Agenda" to add session agenda.</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Sidebar - Actions */}
                <div className="w-80 border-l border-gray-200 bg-gradient-to-br from-gray-50 to-white p-6 flex flex-col">
                  {/* Header with Status */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Actions
                      </h3>
                    </div>
                    
                    {/* Status Badge */}
                    {isAttendanceLocked && attendanceData?.session?.status === 'Completed' && (
                      <div className="bg-green-100 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                        <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <div className="text-sm font-semibold text-green-900">Completed</div>
                          <div className="text-xs text-green-700">Attendance saved successfully</div>
                        </div>
                      </div>
                    )}
                    {isAttendanceLocked && isAttendanceWindowClosed && attendanceWindow.reason === 'future' && (
                      <div className="bg-blue-100 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <div className="text-sm font-semibold text-blue-900">Not Yet Available</div>
                          <div className="text-xs text-blue-700">Session hasn't started</div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="space-y-3 flex-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (isAttendanceLocked) return;
                        setNoteDraft(attendanceNotes || '');
                        setIsNoteModalOpen(true);
                      }}
                      disabled={isAttendanceLocked}
                      className="w-full px-5 py-4 bg-white text-gray-800 rounded-xl font-semibold hover:bg-gray-50 transition-all border-2 border-gray-200 hover:border-gray-300 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md group"
                    >
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-bold">Add Note</div>
                        <div className="text-xs text-gray-600">Session notes</div>
                      </div>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        if (isAttendanceLocked) return;
                        setAgendaDraft(attendanceAgenda || '');
                        setIsAgendaModalOpen(true);
                      }}
                      disabled={isAttendanceLocked}
                      className="w-full px-5 py-4 bg-white text-gray-800 rounded-xl font-semibold hover:bg-gray-50 transition-all border-2 border-gray-200 hover:border-gray-300 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md group"
                    >
                      <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                        </svg>
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-bold">Add Agenda</div>
                        <div className="text-xs text-gray-600">Session agenda</div>
                      </div>
                    </button>
                  </div>
                  
                  {/* Save Button */}
                  <button
                    onClick={handleSaveAttendance}
                    disabled={
                      savingAttendance ||
                      !selectedSessionForAttendance?.classsession_id ||
                      !attendanceData ||
                      hasPendingStudents ||
                      isAttendanceLocked
                    }
                    className="w-full px-6 py-4 bg-gradient-to-r from-[#F7C844] to-[#F5B82E] text-gray-900 rounded-xl font-bold text-lg hover:from-[#F5B82E] hover:to-[#E5A818] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center justify-center gap-3 mt-6"
                    title={
                      isAttendanceLocked
                        ? lockReason
                        : hasPendingStudents
                        ? 'Please take attendance for all students before saving.'
                        : ''
                    }
                  >
                    {savingAttendance ? (
                      <>
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>
                          {isAttendanceLocked && attendanceData?.session?.status === 'Completed'
                            ? 'Attendance Saved'
                            : isAttendanceLocked && isAttendanceWindowClosed
                            ? 'Locked'
                            : 'Save Attendance'}
                        </span>
                      </>
                    )}
                  </button>
                  
                  {hasPendingStudents && !isAttendanceLocked && (
                    <div className="mt-3 text-xs text-center text-amber-600 bg-amber-50 py-2 px-3 rounded-lg border border-amber-200">
                      <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Mark all students before saving
                    </div>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>,
          document.body
        )}

        {/* Attendance Note Modal */}
        {isAttendanceModalOpen && isNoteModalOpen && !isAttendanceLocked && createPortal(
          <div
            className="fixed inset-0 z-[10000] bg-black bg-opacity-40 flex items-center justify-center p-4"
            onClick={() => setIsNoteModalOpen(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Add Note</h3>
                <button
                  onClick={() => setIsNoteModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-4">
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent resize-none text-sm"
                  placeholder="Add notes for this session..."
                />
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsNoteModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAttendanceNotes(noteDraft || '');
                      setIsNoteModalOpen(false);
                    }}
                    className="px-4 py-2 text-sm font-semibold text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  >
                    Save Note
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Attendance Agenda Modal */}
        {isAttendanceModalOpen && isAgendaModalOpen && !isAttendanceLocked && createPortal(
          <div
            className="fixed inset-0 z-[10000] bg-black bg-opacity-40 flex items-center justify-center p-4"
            onClick={() => setIsAgendaModalOpen(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Add Agenda</h3>
                <button
                  onClick={() => setIsAgendaModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-4">
                <textarea
                  value={agendaDraft}
                  onChange={(e) => setAgendaDraft(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent resize-none text-sm"
                  placeholder="Add agenda items for this session..."
                />
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsAgendaModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAttendanceAgenda(agendaDraft || '');
                      setIsAgendaModalOpen(false);
                    }}
                    className="px-4 py-2 text-sm font-semibold text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  >
                    Save Agenda
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  // List View
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Classes</h1>
        <button 
          onClick={openCreateModal}
          className="btn-primary flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Add Class</span>
        </button>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              value={nameSearchTerm}
              onChange={(e) => setNameSearchTerm(e.target.value)}
              placeholder="Search class..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div className="flex gap-4">
            {/* Removed branch filter - admin only sees their branch */}
            <div className="relative program-filter-dropdown">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenProgramDropdown(!openProgramDropdown);
                }}
                className="flex items-center space-x-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <span>Program</span>
                {filterProgram && (
                  <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                )}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {openProgramDropdown && (
                <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                  <div className="py-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterProgram('');
                        setOpenProgramDropdown(false);
                      }}
                      className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                        !filterProgram ? 'bg-gray-100 font-medium' : 'text-gray-700'
                      }`}
                    >
                      All Programs
                    </button>
                    {getUniquePrograms.map((programId) => {
                      const programName = getProgramName(programId);
                      return (
                        <button
                          key={programId}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFilterProgram(programId.toString());
                            setOpenProgramDropdown(false);
                          }}
                          className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                            filterProgram === programId.toString() ? 'bg-gray-100 font-medium' : 'text-gray-700'
                          }`}
                        >
                          {programName || `Program ${programId}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Classes List */}
      {filteredClasses.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterProgram
              ? 'No classes found matching your criteria.'
              : 'No classes found. Add your first class to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Table View - Horizontal Scroll on All Screens */}
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <div className="max-h-[600px] overflow-y-auto relative">
              <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1100px' }}>
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    PROGRAM CODE
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    CLASS NAME
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ROOM
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    LEVEL TAG
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    TEACHER
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    MAX STUDENTS
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    START DATE & END DATE
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ACTIONS
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredClasses.map((classItem) => {
                  const formatDate = (dateValue) => {
                    if (!dateValue) return '-';
                    try {
                      let date;
                      // Handle both string (YYYY-MM-DD) and Date object
                      if (typeof dateValue === 'string') {
                        // Parse date string as local date (YYYY-MM-DD format from database)
                        const [year, month, day] = dateValue.split('-').map(Number);
                        // Create date in local timezone (treat as Asia/Manila UTC+8)
                        date = new Date(year, month - 1, day);
                      } else if (dateValue instanceof Date) {
                        date = dateValue;
                      } else {
                        return '-';
                      }
                      
                      // Validate date
                      if (isNaN(date.getTime())) {
                        return '-';
                      }
                      
                      // Format as "Month Day, Year" (e.g., "November 20, 2025")
                      const options = { year: 'numeric', month: 'long', day: 'numeric' };
                      return formatDateManila(date);
                    } catch {
                      return '-';
                    }
                  };

                  const hasInactivatedSchedule = classesWithInactivatedSchedules.has(classItem.class_id);

                  return (
                    <tr key={classItem.class_id} className={hasInactivatedSchedule ? 'bg-yellow-50' : ''}>
                      <td className="px-6 py-4 max-w-[100px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate" title={classItem.program_code || classItem.program_name || ''}>
                            {classItem.program_code || classItem.program_name || '-'}
                          </div>
                          {hasInactivatedSchedule && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800" title="Schedule temporarily inactivated for merge">
                              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              Merge
                            </span>
                          )}
                          {classItem.is_merged_class && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800" title="This class was created by merging multiple classes">
                              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                              </svg>
                              Merged
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-[220px]">
                        <div className="text-sm text-gray-900 truncate" title={classItem.class_name || ''}>
                          {classItem.class_name || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-[140px]">
                        <div className="text-sm text-gray-900 truncate" title={classItem.room_name || ''}>
                          {classItem.room_name || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-[100px]">
                        <div className="text-sm text-gray-900 truncate" title={classItem.level_tag || ''}>
                          {classItem.level_tag || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 max-w-[180px]">
                        <div className="text-sm text-gray-900 min-w-0">
                          {(() => {
                            // Check if we have teachers array first
                            if (classItem.teachers && Array.isArray(classItem.teachers) && classItem.teachers.length > 0) {
                              return classItem.teachers.map((teacher, idx) => {
                                const name = typeof teacher === 'object' ? (teacher.teacher_name || teacher.full_name) : teacher;
                                return (
                                  <div key={teacher.teacher_id || idx} className={`truncate ${idx > 0 ? 'mt-1' : ''}`} title={name || ''}>
                                    {name || '-'}
                                  </div>
                                );
                              });
                            }
                            
                            // Check for teacher_names (comma-separated string)
                            const teachers = classItem.teacher_names || classItem.teacher_name || '';
                            if (!teachers) return '-';
                            
                            // If it's already an array, display on separate lines
                            if (Array.isArray(teachers)) {
                              return teachers.map((teacher, idx) => {
                                const name = typeof teacher === 'object' ? (teacher.teacher_name || teacher.full_name) : teacher;
                                return (
                                  <div key={idx} className={`truncate ${idx > 0 ? 'mt-1' : ''}`} title={name || ''}>
                                    {name || '-'}
                                  </div>
                                );
                              });
                            }
                            
                            // If it's a string with commas, split and display on separate lines
                            if (typeof teachers === 'string' && teachers.includes(',')) {
                              return teachers.split(',').map((teacher, idx) => {
                                const t = teacher.trim();
                                return (
                                  <div key={idx} className={`truncate ${idx > 0 ? 'mt-1' : ''}`} title={t}>
                                    {t}
                                  </div>
                                );
                              });
                            }
                            
                            // Single teacher
                            return <div className="truncate" title={teachers}>{teachers}</div>;
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {classItem.max_students !== null && classItem.max_students !== undefined
                            ? classItem.max_students
                            : '-'}
                                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {classItem.start_date || classItem.end_date ? (
                            <div className="space-y-1">
                              {classItem.start_date && (
                                <div>Start: {formatDate(classItem.start_date)}</div>
                              )}
                              {classItem.end_date && (
                                <div>End: {formatDate(classItem.end_date)}</div>
                              )}
                            </div>
                          ) : (
                            '-'
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="relative action-menu-container">
                          <button
                            onClick={(e) => handleMenuClick(classItem.class_id, e)}
                            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                          >
                            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* Results Count */}
      {filteredClasses.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredClasses.length} of {classes.length} classes
        </div>
      )}

      {/* Action Menu Overlay Modal */}
      {openMenuId && createPortal(
        <>
          <div 
            className="fixed inset-0 z-40 bg-transparent" 
            onClick={() => {
              setOpenMenuId(null);
              setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
            }}
          />
          <div
            className="fixed action-menu-overlay bg-white rounded-md shadow-lg z-50 border border-gray-200 w-48 max-h-[calc(100vh-2rem)] overflow-y-auto"
            style={{
              ...(menuPosition.top !== undefined && { top: `${menuPosition.top}px` }),
              ...(menuPosition.bottom !== undefined && { bottom: `${menuPosition.bottom}px` }),
              ...(menuPosition.right !== undefined && { right: `${menuPosition.right}px` }),
              ...(menuPosition.left !== undefined && { left: `${menuPosition.left}px` }),
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedClass = filteredClasses.find(c => c.class_id === openMenuId);
                  if (selectedClass) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openViewStudentsModal(selectedClass);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                View Students
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedClass = filteredClasses.find(c => c.class_id === openMenuId);
                  if (selectedClass) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openEnrollModal(selectedClass);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Enroll Student
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedClass = filteredClasses.find(c => c.class_id === openMenuId);
                  if (selectedClass) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    handleViewClass(selectedClass);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                View Class Details
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedClass = filteredClasses.find(c => c.class_id === openMenuId);
                  if (selectedClass) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openEditModal(selectedClass);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedClass = filteredClasses.find(c => c.class_id === openMenuId);
                  if (selectedClass) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openMergeModal(selectedClass);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Merge Class
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(null);
                  setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                  handleDelete(openMenuId);
                }}
                className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Create/Edit Class Modal */}
      {isModalOpen && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeModal}
        >
          <div className="flex items-center justify-center gap-4 w-full max-w-7xl">
            {/* Main Modal */}
            <div 
              className="bg-white rounded-lg shadow-xl relative z-[101] max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingClass 
                    ? 'Edit Class' 
                    : modalStep === 'step1'
                      ? 'Create New Class - Step 1 of 2'
                      : modalStep === 'step2'
                        ? 'Create New Class - Step 2 of 2'
                        : 'Create New Class'}
                </h2>
                {!editingClass && (
                  <p className="text-sm text-gray-500 mt-1">
                    {modalStep === 'step1'
                      ? 'Fill in the program, level tag, and max students'
                      : modalStep === 'step2'
                        ? 'Fill in the class details, schedule, and dates'
                        : 'Fill in the details to create a new class'}
                  </p>
                )}
              </div>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            {/* Removed branch selection - admin uses their branch automatically */}
            {(
            <form onSubmit={modalStep === 'step2' || editingClass ? handleSubmit : handleNextToStep2} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto flex-1">
                <div className="space-y-6">
                  {/* STEP 1: Branch (read-only), Program, Level Tag, Max Students */}
                  {(!editingClass && modalStep === 'step1') ? (
                    <>
                      {/* Branch (Read-only) */}
                      <div>
                        <label htmlFor="branch_id" className="label-field">
                          Branch <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={selectedBranchName}
                          readOnly
                          className="input-field bg-gray-50 cursor-not-allowed"
                        />
                        <p className="mt-1 text-xs text-gray-500">Branch is automatically set to your branch</p>
                      </div>

                      {/* Row: Program | Level Tag */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="program_id" className="label-field">
                            Program <span className="text-red-500">*</span>
                          </label>
                          <select
                            id="program_id"
                            name="program_id"
                            value={formData.program_id}
                            onChange={(e) => {
                              const programId = e.target.value;
                              const program = programs.find(p => p.program_id === parseInt(programId));
                              setSelectedProgram(program || null);
                              handleInputChange(e);
                            }}
                            className={`input-field ${formErrors.program_id ? 'border-red-500' : ''}`}
                            required
                          >
                            <option value="">Select Program</option>
                            {programs.map((program) => (
                              <option key={program.program_id} value={program.program_id}>
                                {program.program_name}
                                {program.number_of_phase && program.number_of_session_per_phase 
                                  ? ` (${program.number_of_phase} phases, ${program.number_of_session_per_phase} sessions/phase)`
                                  : ''}
                              </option>
                            ))}
                          </select>
                          {selectedProgram && selectedProgram.number_of_phase && selectedProgram.number_of_session_per_phase && (
                            <p className="mt-1 text-xs text-gray-500">
                              Curriculum: {selectedProgram.curriculum_name || 'N/A'} - 
                              {selectedProgram.number_of_phase} phase(s) × {selectedProgram.number_of_session_per_phase} session(s) = 
                              {selectedProgram.number_of_phase * selectedProgram.number_of_session_per_phase} total sessions
                            </p>
                          )}
                          {formErrors.program_id && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.program_id}</p>
                          )}
                        </div>

                        <div>
                          <label htmlFor="level_tag" className="label-field">
                            Level Tag <span className="text-red-500">*</span>
                          </label>
                          <select
                            id="level_tag"
                            name="level_tag"
                            value={formData.level_tag}
                            onChange={handleInputChange}
                            className={`input-field ${formErrors.level_tag ? 'border-red-500' : ''}`}
                            required
                          >
                            <option value="">Select Level</option>
                            <option value="Playgroup">Playgroup</option>
                            <option value="Nursery">Nursery</option>
                            <option value="Pre-Kindergarten">Pre-Kindergarten</option>
                            <option value="Kindergarten">Kindergarten</option>
                            <option value="Grade School">Grade School</option>
                          </select>
                          {formErrors.level_tag && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.level_tag}</p>
                          )}
                        </div>
                      </div>

                      {/* Max Students */}
                      <div>
                        <label htmlFor="max_students" className="label-field">
                          Max Students <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          id="max_students"
                          name="max_students"
                          value={formData.max_students}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.max_students ? 'border-red-500' : ''}`}
                          min="1"
                          required
                          placeholder="e.g., 30"
                        />
                        {formErrors.max_students && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.max_students}</p>
                        )}
                      </div>
                    </>
                  ) : (
                  /* STEP 2 or EDIT MODE: Class Name, Room, Days of Week, Teachers, Start Date, End Date */
                  <>
                    {/* For new class creation, show branch as read-only in step 2 */}
                    {!editingClass && modalStep === 'step2' && selectedBranch && (
                      <div>
                        <label htmlFor="branch_id" className="label-field">
                          Branch <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={selectedBranchName}
                          readOnly
                          className="input-field bg-gray-50 cursor-not-allowed"
                        />
                        <p className="mt-1 text-xs text-gray-500">Branch is automatically set to your branch</p>
                      </div>
                    )}

                    {/* For editing mode, show branch selector */}
                    {editingClass && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="branch_id" className="label-field">
                            Branch <span className="text-red-500">*</span>
                          </label>
                          <select
                            id="branch_id"
                            name="branch_id"
                            value={formData.branch_id}
                            onChange={handleInputChange}
                            className={`input-field ${formErrors.branch_id ? 'border-red-500' : ''}`}
                            required
                          >
                            <option value="">Select Branch</option>
                            {branches.map((branch) => (
                              <option key={branch.branch_id} value={branch.branch_id}>
                                {branch.branch_name}
                              </option>
                            ))}
                          </select>
                          {formErrors.branch_id && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.branch_id}</p>
                          )}
                        </div>

                        <div>
                          <label htmlFor="program_id" className="label-field">
                            Program <span className="text-red-500">*</span>
                          </label>
                          <select
                            id="program_id"
                            name="program_id"
                            value={formData.program_id}
                            onChange={(e) => {
                              const programId = e.target.value;
                              const program = programs.find(p => p.program_id === parseInt(programId));
                              setSelectedProgram(program || null);
                              handleInputChange(e);
                            }}
                            className={`input-field ${formErrors.program_id ? 'border-red-500' : ''}`}
                            required
                          >
                            <option value="">Select Program</option>
                            {programs.map((program) => (
                              <option key={program.program_id} value={program.program_id}>
                                {program.program_name}
                                {program.number_of_phase && program.number_of_session_per_phase 
                                  ? ` (${program.number_of_phase} phases, ${program.number_of_session_per_phase} sessions/phase)`
                                  : ''}
                              </option>
                            ))}
                          </select>
                          {selectedProgram && selectedProgram.number_of_phase && selectedProgram.number_of_session_per_phase && (
                            <p className="mt-1 text-xs text-gray-500">
                              Curriculum: {selectedProgram.curriculum_name || 'N/A'} - 
                              {selectedProgram.number_of_phase} phase(s) × {selectedProgram.number_of_session_per_phase} session(s) = 
                              {selectedProgram.number_of_phase * selectedProgram.number_of_session_per_phase} total sessions
                            </p>
                          )}
                          {formErrors.program_id && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.program_id}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* For editing mode, show level tag and max students */}
                    {editingClass && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="level_tag" className="label-field">
                            Level Tag <span className="text-red-500">*</span>
                          </label>
                          <select
                            id="level_tag"
                            name="level_tag"
                            value={formData.level_tag}
                            onChange={handleInputChange}
                            className={`input-field ${formErrors.level_tag ? 'border-red-500' : ''}`}
                            required
                          >
                            <option value="">Select Level</option>
                            <option value="Playgroup">Playgroup</option>
                            <option value="Nursery">Nursery</option>
                            <option value="Pre-Kindergarten">Pre-Kindergarten</option>
                            <option value="Kindergarten">Kindergarten</option>
                            <option value="Grade School">Grade School</option>
                          </select>
                          {formErrors.level_tag && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.level_tag}</p>
                          )}
                        </div>

                        <div>
                          <label htmlFor="max_students" className="label-field">
                            Max Students
                          </label>
                          <input
                            type="number"
                            id="max_students"
                            name="max_students"
                            value={formData.max_students}
                            onChange={handleInputChange}
                            className={`input-field ${formErrors.max_students ? 'border-red-500' : ''}`}
                            min="1"
                            placeholder="e.g., 30"
                          />
                          {formErrors.max_students && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.max_students}</p>
                          )}
                        </div>
                      </div>
                    )}

                  {/* Row 3: Class Name | Room - Required in Step 2 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="class_name" className="label-field">
                        Class Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="class_name"
                        name="class_name"
                        value={formData.class_name}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.class_name ? 'border-red-500' : ''}`}
                        required
                        placeholder="e.g., Section A, Morning"
                      />
                      {formErrors.class_name && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.class_name}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="room_id" className="label-field">
                        Room <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="room_id"
                        name="room_id"
                        value={formData.room_id}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.room_id ? 'border-red-500' : ''}`}
                        required
                      >
                        <option value="">Select Room</option>
                        {rooms.map((room) => (
                          <option key={room.room_id} value={room.room_id}>
                            {room.room_name}
                          </option>
                        ))}
                      </select>
                      {formErrors.room_id && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.room_id}</p>
                      )}
                    </div>
                  </div>

                  {/* Row 4: Days of Week (Full Width) - Required in Step 2, at least 1 day must be enabled - Only show when room is selected */}
                  {formData.room_id && (
                    <div id="days-of-week-section">
                      <label className="label-field">
                        Days of Week <span className="text-red-500">*</span> <span className="text-gray-500 font-normal text-xs">(At least 1 day required)</span>
                      </label>
                      {formErrors.days_of_week && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.days_of_week}</p>
                      )}
                      {Object.keys(formData.days_of_week || {}).map(day => {
                        const dayError = formErrors[`days_of_week_${day}`];
                        if (dayError) {
                          return (
                            <p key={`error_${day}`} className="mt-1 text-sm text-red-600">{dayError}</p>
                          );
                        }
                        return null;
                      })}
                      <div className="mt-2 overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                        <table className="divide-y divide-gray-200 border border-gray-200 rounded-lg" style={{ width: '100%', minWidth: '600px' }}>
                          <thead className="bg-white">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12"></th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">DAY</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">START TIME</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">END TIME</th>
                            </tr>
                          </thead>
                          <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => (
                              <tr key={day}>
                                <td className="px-4 py-3 whitespace-nowrap">
                                <input
                                  type="checkbox"
                                  checked={formData.days_of_week[day]?.enabled || false}
                                  onChange={() => handleDaysOfWeekToggle(day)}
                                  className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                                  data-day={day}
                                />
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className="text-sm font-medium text-gray-900">{day}</span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <input
                                    type="time"
                                    value={formData.days_of_week[day]?.start_time || ''}
                                    onChange={(e) => handleDaysOfWeekTimeChange(day, 'start_time', e.target.value)}
                                    disabled={!formData.days_of_week[day]?.enabled}
                                    required={formData.days_of_week[day]?.enabled}
                                    className={`input-field text-sm ${!formData.days_of_week[day]?.enabled ? 'bg-gray-100 cursor-not-allowed' : ''} ${formErrors[`days_of_week_${day}`] ? 'border-red-500' : ''}`}
                                    placeholder="--:--"
                                    data-day={day}
                                    data-time-type="start_time"
                                  />
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div>
                                  <input
                                    type="time"
                                    value={formData.days_of_week[day]?.end_time || ''}
                                    onChange={(e) => handleDaysOfWeekTimeChange(day, 'end_time', e.target.value)}
                                      disabled={!formData.days_of_week[day]?.enabled || (selectedProgram?.session_duration_hours ? true : false)}
                                      readOnly={selectedProgram?.session_duration_hours ? true : false}
                                      required={formData.days_of_week[day]?.enabled && !selectedProgram?.session_duration_hours}
                                      className={`input-field text-sm ${!formData.days_of_week[day]?.enabled || selectedProgram?.session_duration_hours ? 'bg-gray-100 cursor-not-allowed' : ''} ${formErrors[`days_of_week_${day}`] ? 'border-red-500' : ''}`}
                                    placeholder="--:--"
                                      title={selectedProgram?.session_duration_hours ? 'End time is auto-calculated from start time and session duration' : ''}
                                    data-day={day}
                                    data-time-type="end_time"
                                  />
                                    {selectedProgram?.session_duration_hours && formData.days_of_week[day]?.enabled && (
                                      <p className="mt-1 text-xs text-gray-500">Auto-calculated</p>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Show message when room is not selected */}
                  {!formData.room_id && (
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                      <p className="text-sm text-gray-600">
                        Please select a room first to configure the class schedule.
                      </p>
                    </div>
                  )}

                  {/* Row 2.5: Teachers (Multiple Selection with Dropdown) - Required in Step 2 - Moved below Days of Week */}
                  {formData.room_id && (
                    <div>
                      <label htmlFor="teacher_search" className="label-field">
                        Teachers <span className="text-red-500">*</span> <span className="text-gray-500 font-normal text-xs">(Can select multiple)</span>
                      </label>
                      {formErrors.teacher_ids && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.teacher_ids}</p>
                      )}
                      {checkingConflicts && (
                        <p className="mt-1 text-sm text-blue-600">Checking for schedule conflicts...</p>
                      )}
                      {teacherConflictError && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                          <div className="flex items-start space-x-2">
                            <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-red-800">Error checking conflicts</p>
                              <p className="text-xs text-red-700 mt-1">{teacherConflictError}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setTeacherConflictError('')}
                              className="text-red-600 hover:text-red-800"
                              title="Dismiss error"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )}
                      {teacherConflicts.length > 0 && (
                        <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <p className="text-sm font-medium text-yellow-800 mb-2">⚠️ Schedule Conflicts Detected:</p>
                          {teacherConflicts.map((conflict) => (
                            <div key={conflict.teacher_id} className="mb-2 last:mb-0">
                              <p className="text-sm font-medium text-yellow-900">{conflict.teacher_name}:</p>
                              <ul className="ml-4 mt-1 space-y-1">
                                {conflict.conflicts.map((c, idx) => (
                                  <li key={idx} className="text-xs text-yellow-800">
                                    • {c.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="relative">
                        {/* Multi-select input container with chips */}
                        <div 
                          className="min-h-[42px] w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus-within:border-[#F7C844] focus-within:ring-2 focus-within:ring-[#F7C844] focus-within:ring-opacity-20 transition-all flex flex-wrap items-center gap-2 cursor-text"
                          onClick={() => {
                            // Focus the input when clicking on the container
                            const input = document.getElementById('teacher_search');
                            if (input) input.focus();
                          }}
                        >
                          {/* Selected Teachers as Pills */}
                          {formData.teacher_ids.map((teacherIdStr) => {
                            const teacher = teachers.find(t => t.user_id.toString() === teacherIdStr);
                            if (!teacher) return null;
                            const hasConflict = teacherConflicts.some(c => c.teacher_id === parseInt(teacherIdStr));
                            return (
                              <span
                                key={teacher.user_id}
                                className={`inline-flex items-center gap-1.5 px-3 py-1 text-gray-900 text-sm font-medium rounded-full ${hasConflict ? 'bg-yellow-400' : 'bg-[#F7C844]'}`}
                              >
                            {teacher.full_name}
                                {hasConflict && (
                                  <svg className="w-4 h-4 text-yellow-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                  </svg>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const updatedTeacherIds = formData.teacher_ids.filter(id => id !== teacherIdStr);
                                    setFormData(prev => ({
                                      ...prev,
                                      teacher_ids: updatedTeacherIds
                                    }));
                                    // Recheck conflicts after removing teacher
                                    if (updatedTeacherIds.length > 0) {
                                      checkTeacherConflicts(updatedTeacherIds, formData.days_of_week, editingClass?.class_id || null);
                                    } else {
                                      setTeacherConflicts([]);
                                    }
                                  }}
                                  className="hover:bg-[#F5B82E] rounded-full p-0.5 transition-colors flex items-center justify-center"
                                  title="Remove teacher"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </span>
                            );
                          })}
                          
                          {/* Search Input */}
                          <div className="flex-1 min-w-[120px] relative">
                            <div className="absolute inset-y-0 left-0 pl-0 flex items-center pointer-events-none">
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                            </div>
                            <input
                              type="text"
                              id="teacher_search"
                              value={teacherSearchTerm}
                              onChange={(e) => {
                                setTeacherSearchTerm(e.target.value);
                                setShowTeacherDropdown(true);
                              }}
                              onFocus={() => setShowTeacherDropdown(true)}
                              placeholder={formData.teacher_ids.length === 0 ? "Search by name or branch..." : ""}
                              className="w-full pl-6 pr-2 py-1 text-sm border-none outline-none bg-transparent"
                            />
                          </div>
                        </div>
                        
                        {showTeacherDropdown && (
                          <>
                            {(() => {
                              // Filter teachers: exclude already selected and filter by search term
                              const filteredTeachers = teachers.filter((teacher) => {
                                // Exclude already selected teachers
                                const isSelected = formData.teacher_ids.includes(teacher.user_id.toString());
                                if (isSelected) return false;
                                
                                // Filter by search term
                                if (teacherSearchTerm) {
                                  const searchLower = teacherSearchTerm.toLowerCase();
                                  const teacherName = teacher.full_name?.toLowerCase() || '';
                                  const branchName = selectedBranchName?.toLowerCase() || '';
                                  if (!teacherName.includes(searchLower) && !branchName.includes(searchLower)) {
                                    return false;
                                  }
                                }
                                return true;
                              });

                              return filteredTeachers.length > 0 ? (
                                <div className="teacher-dropdown-container absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                                  <div className="py-1">
                                    {filteredTeachers.map((teacher) => {
                                      return (
                                        <button
                                          key={teacher.user_id}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const teacherIdStr = teacher.user_id.toString();
                                            const updatedTeacherIds = [...formData.teacher_ids, teacherIdStr];
                                            setFormData(prev => ({
                                              ...prev,
                                              teacher_ids: updatedTeacherIds
                                            }));
                                            setTeacherSearchTerm('');
                                            setShowTeacherDropdown(false);
                                            // Check conflicts when teacher is added
                                            checkTeacherConflicts(updatedTeacherIds, formData.days_of_week, editingClass?.class_id || null);
                                          }}
                                          className="w-full flex items-center space-x-2 px-3 py-2 mx-1 my-0.5 rounded-lg transition-all hover:bg-gray-50 text-left"
                                        >
                                          <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-gray-900 truncate">{teacher.full_name}</div>
                                            {teacher.branch_id && (
                                              <div className="text-xs text-gray-500 truncate">
                                                {selectedBranchName}
                                              </div>
                                            )}
                                          </div>
                                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                          </svg>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <div className="teacher-dropdown-container absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                                  <div className="px-4 py-3 text-sm text-gray-500 text-center">
                                    {teacherSearchTerm 
                                      ? `No teachers found matching "${teacherSearchTerm}"`
                                      : 'No more teachers available'}
                                  </div>
                                </div>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Row 5: Start Date | End Date */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="start_date" className="label-field">
                        Start Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        id="start_date"
                        name="start_date"
                        value={formData.start_date}
                        onChange={handleInputChange}
                        required
                        className={`input-field ${formErrors.start_date ? 'border-red-500' : ''}`}
                        aria-required="true"
                      />
                      {formErrors.start_date && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.start_date}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="end_date" className="label-field">
                        End Date <span className="text-red-500">*</span> {selectedProgram && selectedProgram.number_of_phase && selectedProgram.number_of_session_per_phase && formData.start_date && !editingClass && (
                          <span className="text-xs text-gray-500 font-normal">(Auto-calculated)</span>
                        )}
                      </label>
                      {selectedProgram && selectedProgram.number_of_phase && selectedProgram.number_of_session_per_phase && formData.start_date && !editingClass ? (
                        <input
                          type="text"
                          id="end_date"
                          name="end_date"
                          value={formData.end_date ? (() => {
                            const [year, month, day] = formData.end_date.split('-').map(Number);
                            const date = new Date(year, month - 1, day);
                            return formatDateManila(formData.end_date);
                          })() : ''}
                          readOnly
                          className={`input-field bg-gray-50 cursor-not-allowed ${formErrors.end_date ? 'border-red-500' : ''}`}
                          placeholder="dd/mm/yyyy"
                        />
                      ) : (
                        <input
                          type="date"
                          id="end_date"
                          name="end_date"
                          value={manualEndDateAdjustment.enabled ? manualEndDateAdjustment.adjustedDate : formData.end_date}
                          onChange={(e) => {
                            if (manualEndDateAdjustment.enabled) {
                              setManualEndDateAdjustment(prev => ({
                                ...prev,
                                adjustedDate: e.target.value,
                              }));
                            } else {
                              handleInputChange(e);
                            }
                          }}
                          className={`input-field ${formErrors.end_date ? 'border-red-500' : ''}`}
                        />
                      )}
                      {selectedProgram && selectedProgram.number_of_phase && selectedProgram.number_of_session_per_phase && formData.start_date && !editingClass && (
                        <p className="mt-1 text-xs text-gray-500">
                          End date is automatically calculated based on curriculum ({selectedProgram.number_of_phase} phases × {selectedProgram.number_of_session_per_phase} sessions) and selected days
                        </p>
                      )}
                      {formErrors.end_date && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.end_date}</p>
                      )}
                    </div>
                  </div>

                  {/* Manual End Date Adjustment Section - Only for editing existing classes */}
                  {editingClass && classSessions && classSessions.length > 0 && (
                    <div className="border-t border-gray-200 pt-6 mt-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Manual End Date Adjustment</h3>
                      <div className="space-y-4">
                        {/* Calculated End Date (Read-only) */}
                        <div>
                          <label className="label-field">Calculated End Date (from sessions)</label>
                          <input
                            type="text"
                            value={(() => {
                              const calculatedDate = calculateEndDateFromSessions(
                                classSessions,
                                selectedProgram?.number_of_phase || editingClass.number_of_phase,
                                selectedProgram?.number_of_session_per_phase || editingClass.number_of_session_per_phase
                              );
                              if (!calculatedDate) return 'N/A';
                              const [year, month, day] = calculatedDate.split('-').map(Number);
                              const date = new Date(year, month - 1, day);
                              return formatDateManila(calculatedDate);
                            })()}
                            readOnly
                            className="input-field bg-gray-50 cursor-not-allowed"
                          />
                          <div className="mt-2 text-sm text-gray-600">
                            {(() => {
                              const cancelledCount = classSessions.filter(s => s.status === 'Cancelled').length;
                              const rescheduledCount = classSessions.filter(s => s.status === 'Rescheduled').length;
                              const parts = [];
                              if (cancelledCount > 0) {
                                parts.push(`${cancelledCount} cancelled session${cancelledCount !== 1 ? 's' : ''}`);
                              }
                              if (rescheduledCount > 0) {
                                parts.push(`${rescheduledCount} rescheduled session${rescheduledCount !== 1 ? 's' : ''}`);
                              }
                              return parts.length > 0 ? `Note: ${parts.join(', ')} ${parts.length > 1 ? 'are' : 'is'} excluded from calculation.` : 'All sessions are active.';
                            })()}
                          </div>
                        </div>

                        {/* Manual Override Toggle */}
                        <div className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            id="manual_end_date_override"
                            checked={manualEndDateAdjustment.enabled}
                            onChange={(e) => {
                              setManualEndDateAdjustment(prev => ({
                                ...prev,
                                enabled: e.target.checked,
                                adjustedDate: e.target.checked ? formData.end_date : '',
                              }));
                            }}
                            className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                          />
                          <label htmlFor="manual_end_date_override" className="text-sm font-medium text-gray-700">
                            Override calculated end date
                          </label>
                        </div>

                        {/* Manual Date Input */}
                        {manualEndDateAdjustment.enabled && (
                          <div>
                            <label htmlFor="adjusted_end_date" className="label-field">
                              Adjusted End Date
                            </label>
                            <input
                              type="date"
                              id="adjusted_end_date"
                              value={manualEndDateAdjustment.adjustedDate}
                              onChange={(e) => {
                                setManualEndDateAdjustment(prev => ({
                                  ...prev,
                                  adjustedDate: e.target.value,
                                }));
                              }}
                              className="input-field"
                            />
                          </div>
                        )}

                        {/* Notes Field */}
                        {manualEndDateAdjustment.enabled && (
                          <div>
                            <label htmlFor="end_date_adjustment_notes" className="label-field">
                              Adjustment Reason/Notes
                            </label>
                            <textarea
                              id="end_date_adjustment_notes"
                              value={manualEndDateAdjustment.notes}
                              onChange={(e) => {
                                setManualEndDateAdjustment(prev => ({
                                  ...prev,
                                  notes: e.target.value,
                                }));
                              }}
                              rows={3}
                              className="input-field"
                              placeholder="e.g., Extended due to holiday disruptions, Additional make-up sessions scheduled..."
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  </>
                  )}
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="px-6 pb-4">
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    {error}
                  </div>
                </div>
              )}

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                {/* Step 1: Show Next button (removed Back button - no branch selection) */}
                {!editingClass && modalStep === 'step1' && (
                  <>
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                      disabled={submitting}
                    >
                      Next
                    </button>
                  </>
                )}
                
                {/* Step 2: Show Back to Step 1, Cancel, and Submit button */}
                {!editingClass && modalStep === 'step2' && (
                  <>
                    <button
                      type="button"
                      onClick={handleBackToStep1}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      disabled={submitting}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                      disabled={submitting}
                    >
                      {submitting ? (
                        <span className="flex items-center space-x-2">
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>Creating...</span>
                        </span>
                      ) : (
                        'Create Class'
                      )}
                    </button>
                  </>
                )}

                {/* Edit Mode: Show Cancel and Update button */}
                {editingClass && (
                  <>
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      disabled={submitting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                      disabled={submitting}
                    >
                      {submitting ? (
                        <span className="flex items-center space-x-2">
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>Updating...</span>
                        </span>
                      ) : (
                        'Update Class'
                      )}
                    </button>
                  </>
                )}
              </div>
            </form>
            )}
          </div>
          
          {/* Existing Schedules Sidebar - Only show when room is selected and in step2 or editing mode */}
          {formData.room_id && (modalStep === 'step2' || editingClass) && (
            <div 
              className="bg-white rounded-lg shadow-xl relative z-[101] w-80 max-h-[90vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Sidebar Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0 bg-blue-50">
                <div>
                  <h3 className="text-sm font-semibold text-blue-900">
                    📅 Existing Schedules
                  </h3>
                  <p className="text-xs text-blue-700 mt-0.5">
                    {rooms.find(r => r.room_id === parseInt(formData.room_id))?.room_name || 'Selected Room'}
                  </p>
                </div>
              </div>
              
              {/* Sidebar Content - Minimal Calendar View */}
              <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}>
                {loadingRoomSchedules ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="flex items-center space-x-2 text-blue-600">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="text-sm">Loading...</span>
                    </div>
                  </div>
                ) : roomSchedules.length > 0 ? (
                  <div className="space-y-2">
                    {/* Expand/Collapse All Controls */}
                    {roomSchedules.length > 10 && (
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200">
                        <button
                          type="button"
                          onClick={() => {
                            const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                            const hasSchedules = allDays.filter(day => 
                              roomSchedules.some(s => s.day_of_week === day)
                            );
                            if (expandedCalendarDays.size === hasSchedules.length) {
                              setExpandedCalendarDays(new Set());
                            } else {
                              setExpandedCalendarDays(new Set(hasSchedules));
                            }
                          }}
                          className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                        >
                          {expandedCalendarDays.size > 0 ? 'Collapse All' : 'Expand All'}
                        </button>
                        <span className="text-[10px] text-gray-500">
                          {roomSchedules.length} schedule{roomSchedules.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    )}
                    
                    {/* Group schedules by day of week */}
                    {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => {
                      const daySchedules = roomSchedules.filter(s => s.day_of_week === day);
                      const isExpanded = expandedCalendarDays.has(day);
                      const INITIAL_SHOW_COUNT = 3;
                      const showCount = expandedSchedulesPerDay[day] || INITIAL_SHOW_COUNT;
                      const displayedSchedules = isExpanded ? daySchedules.slice(0, showCount) : [];
                      const hasMore = daySchedules.length > showCount;
                      
                      if (daySchedules.length === 0) {
                        return (
                          <div key={day} className="border border-gray-200 rounded-lg p-2 bg-gray-50">
                            <div className="text-xs font-semibold text-gray-500 uppercase">
                              {day.substring(0, 3)}
                            </div>
                            <div className="text-xs text-gray-400 italic mt-1">No schedule</div>
                          </div>
                        );
                      }
                      
                      return (
                        <div key={day} className="border border-blue-200 rounded-lg bg-blue-50">
                          {/* Day Header - Clickable to expand/collapse */}
                          <button
                            type="button"
                            onClick={() => toggleCalendarDay(day)}
                            className="w-full flex items-center justify-between p-2 hover:bg-blue-100 transition-colors rounded-t-lg"
                          >
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-semibold text-blue-900 uppercase">
                                {day.substring(0, 3)}
                              </span>
                              <span className="text-[10px] text-blue-600 bg-blue-200 px-1.5 py-0.5 rounded-full">
                                {daySchedules.length}
                              </span>
                            </div>
                            <svg
                              className={`w-3 h-3 text-blue-700 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          
                          {/* Schedules List - Only show when expanded */}
                          {isExpanded && (
                            <div className="p-2 space-y-1.5">
                              {displayedSchedules.map((schedule, idx) => {
                                const startTime = schedule.start_time ? schedule.start_time.substring(0, 5) : '--:--';
                                const endTime = schedule.end_time ? schedule.end_time.substring(0, 5) : '--:--';
                                const className = schedule.class_name 
                                  ? `${schedule.program_name || ''} - ${schedule.class_name}`.trim()
                                  : schedule.level_tag 
                                    ? `${schedule.program_name || ''} - ${schedule.level_tag}`.trim()
                                    : schedule.program_name || `Class ${schedule.class_id}`;
                                
                                return (
                                  <div key={idx} className="bg-white rounded border border-blue-100 p-1.5 hover:bg-blue-50 transition-colors">
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[10px] font-medium text-blue-700">
                                        {startTime} - {endTime}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-blue-900 truncate font-medium" title={className}>
                                      {className}
                                    </p>
                                    {schedule.teacher_names && (
                                      <p className="text-[10px] text-blue-600 truncate mt-0.5" title={schedule.teacher_names}>
                                        {schedule.teacher_names}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                              
                              {/* Show More Button */}
                              {hasMore && (
                                <button
                                  type="button"
                                  onClick={() => showMoreSchedules(day, daySchedules.length)}
                                  className="w-full text-[10px] text-blue-600 hover:text-blue-800 font-medium py-1 hover:bg-blue-100 rounded transition-colors"
                                >
                                  Show {daySchedules.length - showCount} more...
                                </button>
                              )}
                              
                              {/* Show Less Button (when all are shown) */}
                              {!hasMore && showCount > INITIAL_SHOW_COUNT && (
                                <button
                                  type="button"
                                  onClick={() => showMoreSchedules(day, INITIAL_SHOW_COUNT)}
                                  className="w-full text-[10px] text-blue-600 hover:text-blue-800 font-medium py-1 hover:bg-blue-100 rounded transition-colors"
                                >
                                  Show less
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-sm text-gray-500 italic text-center">
                      No existing schedules found for this room.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        </div>,
        document.body
      )}

      {/* Enroll Student Modal */}
      {isEnrollModalOpen && selectedClassForEnrollment && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeEnrollModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl relative z-[101] max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {enrollStep === 'view' && 'Enrolled Students'}
                  {enrollStep === 'enrollment-option' && 'Select Enrollment Option'}
                  {enrollStep === 'package-selection' && 'Select Package'}
                  {enrollStep === 'student-selection' && 'Select Student'}
                  {enrollStep === 'review' && 'Review & Enroll'}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selectedClassForEnrollment.program_name} - {selectedClassForEnrollment.class_name || selectedClassForEnrollment.level_tag}
                </p>
              </div>
              <button
                onClick={closeEnrollModal}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-3 sm:p-4 overflow-y-auto flex-1">
              {/* Step 0: View Enrolled Students */}
              {enrollStep === 'view' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Enrolled Students ({getCountableStudents(enrolledStudents)})
                      {selectedClassForEnrollment.max_students && (
                        <span className="text-sm font-normal text-gray-500 ml-2">
                          / {selectedClassForEnrollment.max_students} max
                        </span>
                      )}
                    </h3>
                    <button
                      onClick={handleStartEnrollment}
                      className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors flex items-center space-x-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span>Enroll New Student</span>
                    </button>
                  </div>

                  {loadingEnrolledStudents ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                    </div>
                  ) : enrolledStudents.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                      <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <h3 className="mt-2 text-sm font-medium text-gray-900">No enrolled students</h3>
                      <p className="mt-1 text-sm text-gray-500">Get started by enrolling a new student.</p>
                      <div className="mt-6">
                        <button
                          onClick={handleStartEnrollment}
                          className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                        >
                          Enroll New Student
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-lg border border-gray-200">
                      <div
                        className="overflow-x-auto rounded-lg"
                        style={{
                          scrollbarWidth: 'thin',
                          scrollbarColor: '#cbd5e0 #f7fafc',
                          WebkitOverflowScrolling: 'touch',
                        }}
                      >
                        <table
                          className="divide-y divide-gray-200"
                          style={{ width: '100%', minWidth: '1000px' }}
                        >
                        <thead className="bg-white">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Student Name
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Email
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Level Tag
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Phase
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Enrolled Date
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Enrolled By
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Reservation Fee
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Status
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Due Date
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                          {enrolledStudents.map((student) => {
                            const isReserved = student.student_type === 'reserved';
                            const isPending = student.student_type === 'pending';
                            const isRemovedEnrollment =
                              !isReserved &&
                              !isPending &&
                              (student.shouldCount === false ||
                                (student.enrollment_status && student.enrollment_status !== 'Active'));
                            const uniqueKey = isReserved 
                              ? `reserved-${student.reservation_id}` 
                              : `enrolled-${student.classstudent_id || student.user_id}`;

                            // For enrolled students, try to find their reservation
                            // For reserved students, use their own data
                            const reservationForStudent = isReserved 
                              ? enrollReservedStudents.find(
                                  (reservation) => reservation.reserved_id === student.reservation_id
                                )
                              : enrollReservedStudents.find(
                                  (reservation) =>
                                    reservation.student_id === student.user_id &&
                                    reservation.class_id === selectedClassForEnrollment.class_id
                                );

                            const reservationFee = isReserved
                              ? (student.reservation_fee !== null && student.reservation_fee !== undefined
                                  ? `₱${parseFloat(student.reservation_fee).toFixed(2)}`
                                  : '-')
                              : (reservationForStudent && reservationForStudent.reservation_fee !== null &&
                                  reservationForStudent.reservation_fee !== undefined
                                  ? `₱${parseFloat(reservationForStudent.reservation_fee).toFixed(2)}`
                                  : '-');

                            const reservationStatus = isReserved 
                              ? student.reservation_status || null
                              : reservationForStudent?.status || null;
                            
                            const dueDate = isReserved
                              ? (student.reservation_invoice_due_date
                                  ? formatDateManila(student.reservation_invoice_due_date)
                                  : '-')
                              : (reservationForStudent?.reservation_invoice_due_date
                                  ? formatDateManila(reservationForStudent.reservation_invoice_due_date)
                                  : '-');

                            return (
                              <tr
                                key={uniqueKey}
                                className={`${isReserved ? 'bg-yellow-50' : ''} ${isRemovedEnrollment ? 'bg-red-50' : ''}`}
                              >
                                <td className="px-4 py-4">
                                  <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                    <span>{student.full_name}</span>
                                    {isRemovedEnrollment && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-800">
                                        Removed (Delinquent)
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="text-sm text-gray-500">{student.email}</div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="text-sm text-gray-500">{student.level_tag || '-'}</div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="text-sm text-gray-500">
                                    {isReserved 
                                      ? <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                          Reserved
                                        </span>
                                      : (student.phasesDisplay || (student.phase_number ? `Phase ${student.phase_number}` : '-'))
                                    }
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="text-sm text-gray-500">
                                    {isReserved
                                      ? (student.earliestEnrollment || student.enrolled_at
                                          ? formatDateManila(student.earliestEnrollment || student.enrolled_at)
                                          : '-')
                                      : (student.earliestEnrollment || student.enrolled_at
                                          ? formatDateManila(student.earliestEnrollment || student.enrolled_at)
                                          : '-')
                                    }
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="text-sm text-gray-500">
                                    {isReserved ? '-' : (student.enrolledBy || student.enrolled_by || '-')}
                                  </div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap">
                                  <div className="text-sm text-gray-900">{reservationFee}</div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap">
                                  {isRemovedEnrollment ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                      Removed
                                    </span>
                                  ) : reservationStatus ? (
                                    <span
                                      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                        reservationStatus === 'Fee Paid'
                                          ? 'bg-green-100 text-green-800'
                                          : reservationStatus === 'Upgraded'
                                          ? 'bg-blue-100 text-blue-800'
                                          : reservationStatus === 'Cancelled'
                                          ? 'bg-red-100 text-red-800'
                                          : 'bg-yellow-100 text-yellow-800'
                                      }`}
                                    >
                                      {reservationStatus}
                                    </span>
                                  ) : (
                                    <span className="text-sm text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap">
                                  <div className="text-sm text-gray-500">{dueDate}</div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                                  {isRemovedEnrollment ? (
                                    <span className="text-sm text-gray-400">-</span>
                                  ) : isReserved && reservationStatus === 'Fee Paid' ? (
                                    <button
                                      onClick={() => {
                                        const reservation = enrollReservedStudents.find(
                                          r => r.reserved_id === student.reservation_id
                                        );
                                        if (reservation) {
                                          handleUpgradeReservation(reservation);
                                        }
                                      }}
                                      className="text-blue-600 hover:text-blue-900"
                                    >
                                      Upgrade
                                    </button>
                                  ) : isReserved && reservationStatus === 'Reserved' ? (
                                    <span className="text-xs text-gray-500">Pay fee first</span>
                                  ) : reservationForStudent && reservationStatus === 'Fee Paid' ? (
                                    <button
                                      onClick={() => handleUpgradeReservation(reservationForStudent)}
                                      className="text-blue-600 hover:text-blue-900"
                                    >
                                      Upgrade
                                    </button>
                                  ) : !isReserved && !isPending ? (
                                    <button
                                      onClick={() => handleUnenrollStudent(student)}
                                      className="text-red-600 hover:text-red-900 flex items-center space-x-1"
                                      title="Unenroll student from class"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                      <span>Unenroll</span>
                                    </button>
                                  ) : (
                                    <span className="text-sm text-gray-400">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 1: Enrollment Option Selection */}
              {enrollStep === 'enrollment-option' && (
                <div className="flex flex-col overflow-hidden">
                  <div className="p-6">
                    <div className="mb-4">
                      <label htmlFor="enrollment_option_select" className="label-field">
                        Select Enrollment Option <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="enrollment_option_select"
                        value={selectedEnrollmentOption || ''}
                        onChange={(e) => {
                          const option = e.target.value;
                          setSelectedEnrollmentOption(option || null);
                          
                          // Clear package-related state when switching away from package and reservation options
                          if (option !== 'package' && option !== 'reservation') {
                            setSelectedPackage(null);
                            setPackageMerchSelections({});
                            setShowPackageDetails(false);
                            setShowInstallmentSettings(false);
                            updateInstallmentSettings({
                              invoice_issue_date: '',
                              billing_month: '',
                              invoice_due_date: '',
                              invoice_generation_date: '',
                            });
                          }
                          
                          // Clear per-phase amount and phase selection when switching away from per-phase option
                          if (option !== 'per-phase') {
                            setPerPhaseAmount('');
                            setSelectedPhaseNumber(null);
                          } else {
                            // When switching to per-phase, remove "New Enrollee Installment" and "New Enrollee Fullpayment" from selected pricing lists
                            setSelectedPricingLists(prev => {
                              const filtered = prev.filter(pricingId => {
                                const pricing = pricingLists.find(p => p.pricinglist_id === pricingId);
                                if (!pricing) return true;
                                const isInstallment = isNewEnrolleeInstallment(pricing);
                                const isFullpayment = isNewEnrolleeFullpayment(pricing);
                                // Remove if it's installment or fullpayment
                                return !(isInstallment || isFullpayment);
                              });
                              return filtered;
                            });
                          }
                        }}
                        className="input-field"
                        required
                      >
                        <option value="">Choose an option...</option>
                        <option value="package">Select Package</option>
                        {selectedClassForEnrollment?.number_of_phase && selectedClassForEnrollment.number_of_phase > 0 && (
                          <option value="per-phase">Enroll per Phase</option>
                        )}
                        <option value="reservation">Student Class Reservation</option>
                      </select>
                      <p className="mt-2 text-sm text-gray-500">
                        Choose how you want to enroll students. You can select a package or enroll students per phase.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end space-x-3 px-6 pb-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                    <button
                      type="button"
                      onClick={closeEnrollModal}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleEnrollmentOptionContinue}
                      disabled={!selectedEnrollmentOption}
                      className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Package Selection */}
              {enrollStep === 'package-selection' && (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                      {selectedEnrollmentOption === 'reservation'
                        ? 'Select a Reservation Package'
                        : selectedEnrollmentOption === 'per-phase'
                        ? 'Select a Phase Package'
                        : 'Select a Package'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {selectedEnrollmentOption === 'reservation'
                        ? 'Choose a reserved package to reserve students for this class'
                        : selectedEnrollmentOption === 'per-phase'
                        ? 'Choose a phase-based package to enroll students per phase'
                        : 'Choose a package to enroll students with'}
                    </p>
                  </div>
                  
                  {(() => {
                    // Filter packages based on enrollment option
                    let filteredPackages =
                      selectedEnrollmentOption === 'reservation'
                        ? packages.filter(pkg => pkg.package_type === 'Reserved')
                        : selectedEnrollmentOption === 'per-phase'
                        ? packages.filter(pkg => pkg.package_type === 'Phase')
                        : packages.filter(pkg =>
                            pkg.package_type === 'Fullpayment' ||
                            pkg.package_type === 'Installment' ||
                            pkg.package_type === 'Promo'
                          );
                    
                    // Filter packages by level_tag to match the class's level_tag
                    if (selectedClassForEnrollment?.level_tag) {
                      filteredPackages = filteredPackages.filter(pkg => 
                        pkg.level_tag === selectedClassForEnrollment.level_tag
                      );
                    }
                    
                    // For per-phase enrollment with Phase packages, filter by phase range
                    if (selectedEnrollmentOption === 'per-phase') {
                      const targetPhase = selectedPhaseNumber;
                      const classMaxPhase = selectedClassForEnrollment?.number_of_phase;
                      
                      // Filter Phase packages based on phase range
                      filteredPackages = filteredPackages.filter(pkg => {
                        if (pkg.package_type !== 'Phase') return true; // Keep non-Phase packages (shouldn't happen, but safe)
                        
                        const phaseStart = pkg.phase_start;
                        const phaseEnd = pkg.phase_end;
                        
                        // If targetPhase is selected, filter packages where targetPhase falls within the package's range
                        if (targetPhase !== null && targetPhase !== undefined) {
                          // If phase_end is null, it's a single phase package (only phase_start)
                          if (phaseEnd === null || phaseEnd === undefined) {
                            return phaseStart === targetPhase;
                          }
                          // If phase_end exists, it's a range from phase_start to phase_end (inclusive)
                          return targetPhase >= phaseStart && targetPhase <= phaseEnd;
                        }
                        
                        // If targetPhase is not set yet, filter based on class's maximum phase
                        // Only show packages where phase_start is within the class's available phases
                        // This prevents showing Phase 3 packages if class only has 2 phases
                        if (classMaxPhase) {
                          // If phase_end is null, it's a single phase package
                          if (phaseEnd === null || phaseEnd === undefined) {
                            return phaseStart <= classMaxPhase;
                          }
                          // If phase_end exists, only show if the range starts within class's phases
                          return phaseStart <= classMaxPhase;
                        }
                        
                        // If no class phase info, show all Phase packages
                        return true;
                      });
                    }
                    
                    // Filter out unavailable promo packages (but show them as disabled)
                    // We'll show them disabled instead of hiding them completely
                    
                    return filteredPackages.length > 0 ? (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}>
                        {filteredPackages.map((pkg) => {
                          return (
                        <button
                          key={pkg.package_id}
                          onClick={() => handlePackageSelect(pkg)}
                          className="group w-full p-5 bg-white border-2 rounded-xl transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2 border-gray-200 hover:border-[#F7C844] hover:shadow-lg"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-2 mb-2">
                                  <div className="w-2 h-2 bg-[#F7C844] rounded-full transition-opacity opacity-0 group-hover:opacity-100"></div>
                                  <h5 className="font-bold text-gray-900 text-base transition-colors truncate group-hover:text-[#F7C844]">
                                    {pkg.package_name}
                                  </h5>
                                  {pkg.package_type === 'Installment' && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                                      Installment
                                    </span>
                                  )}
                                </div>
                              {pkg.package_price && (
                                <div className="flex flex-col space-y-1 mb-2">
                                  {pkg.package_type === 'Installment' ? (
                                    <>
                                      {pkg.downpayment_amount != null && parseFloat(pkg.downpayment_amount) > 0 && (
                                        <div className="flex items-baseline space-x-2">
                                          <span className="text-sm text-gray-600">Down payment:</span>
                                          <span className="text-lg font-bold text-gray-900">
                                            ₱{parseFloat(pkg.downpayment_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </span>
                                        </div>
                                      )}
                                      <div className="flex items-baseline space-x-2">
                                        <span className="text-sm text-gray-600">Monthly:</span>
                                        <span className="text-lg font-bold text-gray-900">
                                          ₱{parseFloat(pkg.package_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="flex items-baseline space-x-2">
                                      <span className="text-xl font-bold text-gray-900">
                                        ₱{parseFloat(pkg.package_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                              {pkg.details && pkg.details.length > 0 && (
                                <div className="flex items-center space-x-2 mt-3">
                                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                  </svg>
                                  <span className="text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">
                                    {getPackageDetailDisplayCount(pkg.details)} item{getPackageDetailDisplayCount(pkg.details) !== 1 ? 's' : ''} included
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="flex-shrink-0 ml-4">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center transition-colors bg-gray-100 group-hover:bg-[#F7C844]">
                                <svg className="w-5 h-5 transition-colors text-gray-600 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </div>
                            </div>
                          </div>
                        </button>
                        );
                        })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center p-12 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl">
                      <div className="text-center">
                        <svg className="w-12 h-12 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                          <p className="text-sm font-medium text-gray-500">
                            {selectedEnrollmentOption === 'reservation' 
                              ? 'No reserved packages available' 
                              : 'No packages available'}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {selectedEnrollmentOption === 'reservation' 
                              ? 'No reserved packages found for this branch' 
                              : 'No packages found for this branch'}
                          </p>
                      </div>
                    </div>
                    );
                  })()}
                </div>
              )}

              {/* Step 3: Student Selection */}
              {enrollStep === 'student-selection' && (
                <div className="space-y-3">
                  {/* Student Selection - Moved to Top */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label htmlFor="student_search" className="text-sm font-bold text-gray-900 mb-0">
                        Student Selected <span className="text-red-500">*</span>
                      </label>
                      {selectedClassForEnrollment?.max_students && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-[#F7C844] bg-opacity-20 text-gray-700">
                          <svg className="w-3.5 h-3.5 mr-1 text-[#F7C844]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          {(() => {
                            const available = getAvailableSlots();
                            return available !== null ? `${available} slot${available !== 1 ? 's' : ''} available` : '';
                          })()}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      {/* Multi-select input container with chips */}
                      <div 
                        className="min-h-[42px] w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus-within:border-[#F7C844] focus-within:ring-2 focus-within:ring-[#F7C844] focus-within:ring-opacity-20 transition-all flex flex-wrap items-center gap-2 cursor-text"
                        onClick={() => {
                          // Focus the input when clicking on the container
                          const input = document.getElementById('student_search');
                          if (input) input.focus();
                        }}
                      >
                        {/* Selected Students as Pills */}
                        {selectedStudents.map((student) => (
                          <span
                            key={student.user_id}
                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#F7C844] text-gray-900 text-sm font-medium rounded-full"
                          >
                            {student.full_name}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStudentToggle(student);
                              }}
                              className="hover:bg-[#F5B82E] rounded-full p-0.5 transition-colors flex items-center justify-center"
                              title="Remove student"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        ))}
                        
                        {/* Search Input */}
                        <div className="flex-1 min-w-[120px] relative">
                          <div className="absolute inset-y-0 left-0 pl-0 flex items-center pointer-events-none">
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        id="student_search"
                        value={studentSearchTerm}
                        onChange={(e) => {
                          setStudentSearchTerm(e.target.value);
                          setShowStudentDropdown(true);
                        }}
                        onFocus={() => setShowStudentDropdown(true)}
                            placeholder={selectedStudents.length === 0 ? "Search by name, email, or level tag..." : ""}
                            className="w-full pl-6 pr-2 py-1 text-sm border-none outline-none bg-transparent"
                      />
                        </div>
                      </div>
                      
                      {showStudentDropdown && (
                        <>
                          {filteredStudents.length > 0 ? (
                            <div className="student-dropdown-container absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}>
                              <div className="py-1">
                                {filteredStudents.map((student) => {
                                  const isSelected = selectedStudents.some(s => s.user_id === student.user_id);
                                  const isEnrolled = enrolledStudents.some(s => s.user_id === student.user_id);
                                  const availableSlots = getAvailableSlots();
                                  const canSelect = !isEnrolled && (availableSlots === null || availableSlots > 0);
                                  
                                  return (
                                    <label
                                      key={student.user_id}
                                      className={`flex items-center space-x-2 px-3 py-2 mx-1 my-0.5 rounded-lg transition-all cursor-pointer ${
                                        isSelected 
                                          ? 'bg-primary-50 border border-[#F7C844]' 
                                          : 'hover:bg-gray-50 border border-transparent'
                                      } ${!canSelect ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                      <div className="flex-shrink-0">
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => canSelect && handleStudentToggle(student)}
                                          disabled={!canSelect}
                                          className="h-4 w-4 text-[#F7C844] focus:ring-[#F7C844] border-gray-300 rounded transition-all"
                                        />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                          <div className="flex-1 min-w-0">
                                            <h5 className="text-sm font-bold text-gray-900 truncate">{student.full_name}</h5>
                                            <p className="text-xs text-gray-600 truncate">{student.email}</p>
                                            {student.level_tag && (
                                              <div className="flex items-center mt-0.5">
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-800">
                                                  {student.level_tag}
                                                </span>
                                              </div>
                                            )}
                                          </div>
                                          <div className="flex-shrink-0 ml-2 flex items-center space-x-1">
                                            {isSelected && (
                                              <div className="w-5 h-5 rounded-full bg-[#F7C844] flex items-center justify-center">
                                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                              </div>
                                            )}
                                            {isEnrolled && (
                                              <span className="text-xs text-gray-500 font-medium bg-gray-100 px-1.5 py-0.5 rounded">Enrolled</span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="student-dropdown-container absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                              <div className="px-4 py-3 text-sm text-gray-500 text-center">
                                {studentSearchTerm 
                                  ? `No students found matching "${studentSearchTerm}"`
                                  : 'Start typing to search for students'}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    
                    {students.length === 0 && (
                      <p className="mt-2 text-sm text-gray-500 italic">No students available for this branch.</p>
                    )}
                  </div>

                  {/* Selected Package - shown for all enrollment options when a package is chosen */}
                  {selectedPackage && (
                    <div className="space-y-3">
                      {/* Collapsible Package Header */}
                      <div className="p-4 bg-white border border-gray-200 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setShowPackageDetails(!showPackageDetails)}
                          className="w-full flex items-center justify-between"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-[#F7C844] rounded-lg flex items-center justify-center">
                              <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                </svg>
                              </div>
                            <div className="text-left">
                              <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                                  Selected Package
                                </p>
                              <p className="text-base font-semibold text-gray-900 mt-0.5">
                                  {selectedPackage.package_name}
                                </p>
                            {selectedPackage.package_type === 'Installment' ? (
                              <div className="flex flex-col gap-1 mt-1">
                                {selectedPackage.downpayment_amount != null && parseFloat(selectedPackage.downpayment_amount) > 0 && (
                                  <div className="flex items-baseline space-x-2">
                                    <span className="text-base font-bold text-gray-900">
                                      ₱{parseFloat(selectedPackage.downpayment_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-xs text-gray-600 font-medium">Down payment</span>
                                  </div>
                                )}
                                {selectedPackage.package_price && (
                                  <div className="flex items-baseline space-x-2">
                                    <span className="text-base font-bold text-gray-900">
                                      ₱{parseFloat(selectedPackage.package_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-xs text-gray-600 font-medium">Monthly</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              selectedPackage.package_price && (
                                <div className="flex items-baseline space-x-2 mt-1">
                                  <span className="text-xl font-bold text-gray-900">
                                    ₱{parseFloat(selectedPackage.package_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                  <span className="text-xs text-gray-600 font-medium">Package Price</span>
                                </div>
                              )
                            )}
                          </div>
                          </div>
                          <svg
                            className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${showPackageDetails ? 'transform rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        </div>

                      {/* Promo Selection - Always Visible Section */}
                      {selectedPackage && (
                        <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 rounded-lg">
                          <div className="flex items-center space-x-2 mb-3">
                            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                            </svg>
                            <h4 className="text-base font-bold text-gray-900">Available Promos</h4>
                            {selectedPromo && (
                              <span className="ml-auto px-2 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">
                                Promo Selected
                              </span>
                            )}
                          </div>

                          {/* Promo Code Input Field */}
                          <div className="mb-4">
                            <label htmlFor="promo_code_input" className="block text-sm font-medium text-gray-700 mb-2">
                              Enter Promo Code (Optional)
                            </label>
                            <div className="flex space-x-2">
                              <input
                                type="text"
                                id="promo_code_input"
                                value={promoCodeInput}
                                onChange={(e) => {
                                  const value = e.target.value.toUpperCase().replace(/\s/g, '').replace(/[^A-Z0-9-]/g, '');
                                  setPromoCodeInput(value);
                                  
                                  // Clear previous timeout
                                  if (promoCodeValidationTimeout) {
                                    clearTimeout(promoCodeValidationTimeout);
                                  }
                                  
                                  // Clear error and validated promo when input changes
                                  if (value.length === 0) {
                                    setValidatedPromoFromCode(null);
                                    setPromoCodeError('');
                                    setPromoCodeValidationTimeout(null);
                                    // Clear selected promo if it was the validated one
                                    if (selectedPromo?.promo_code) {
                                      setSelectedPromo(null);
                                    }
                                  } else {
                                    // Debounce validation - wait 800ms after user stops typing
                                    const timeout = setTimeout(() => {
                                      if (value.length >= 4) {
                                        const studentId = selectedStudents.length > 0 ? selectedStudents[0].user_id : null;
                                        validatePromoCode(value, selectedPackage?.package_id, studentId);
                                      }
                                    }, 800);
                                    setPromoCodeValidationTimeout(timeout);
                                  }
                                }}
                                onBlur={(e) => {
                                  // Validate immediately on blur if code is 4+ characters
                                  const value = e.target.value.trim();
                                  if (value.length >= 4) {
                                    // Clear any pending timeout
                                    if (promoCodeValidationTimeout) {
                                      clearTimeout(promoCodeValidationTimeout);
                                      setPromoCodeValidationTimeout(null);
                                    }
                                    const studentId = selectedStudents.length > 0 ? selectedStudents[0].user_id : null;
                                    validatePromoCode(value, selectedPackage?.package_id, studentId);
                                  }
                                }}
                                placeholder="e.g., SUMMER2024"
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                                maxLength={20}
                                disabled={!selectedPackage || validatingPromoCode}
                              />
                              {validatingPromoCode && (
                                <div className="flex items-center px-3">
                                  <svg className="animate-spin h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                </div>
                              )}
                            </div>
                            {promoCodeError && (
                              <p className="mt-1 text-sm text-red-600">{promoCodeError}</p>
                            )}
                            {validatedPromoFromCode && !promoCodeError && (
                              <p className="mt-1 text-sm text-green-600">✓ Valid promo code found!</p>
                            )}
                          </div>

                          {loadingPromos ? (
                            <div className="text-sm text-gray-500 text-center py-2">Loading promos...</div>
                          ) : (
                            <div className="space-y-2">
                              <button
                                type="button"
                                onClick={() => setSelectedPromo(null)}
                                className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                                  !selectedPromo
                                    ? 'bg-[#F7C844] border-[#F7C844] text-gray-900 shadow-md'
                                    : 'bg-white border-gray-300 hover:border-[#F7C844] hover:shadow'
                                }`}
                              >
                                <span className="text-sm font-semibold">No Promo</span>
                                <span className="ml-2 text-xs text-gray-600">(Use regular package price)</span>
                              </button>
                              
                              {/* Show validated promo from code */}
                              {validatedPromoFromCode && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedPromo(validatedPromoFromCode)}
                                  className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                                    selectedPromo?.promo_id === validatedPromoFromCode.promo_id
                                      ? 'bg-[#F7C844] border-[#F7C844] text-gray-900 shadow-md'
                                      : 'bg-white border-green-400 hover:border-green-500 hover:shadow'
                                  }`}
                                >
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center space-x-2 mb-1">
                                        <div className="font-bold text-base text-gray-900">{validatedPromoFromCode.promo_name}</div>
                                        <span className="text-xs font-mono bg-green-100 text-green-800 px-2 py-0.5 rounded">
                                          {validatedPromoFromCode.promo_code}
                                        </span>
                                        {selectedPromo?.promo_id === validatedPromoFromCode.promo_id && (
                                          <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                          </svg>
                                        )}
                                      </div>
                                      {validatedPromoFromCode.description && (
                                        <div className="text-xs text-gray-600 mb-2">{validatedPromoFromCode.description}</div>
                                      )}
                                      <div className="flex flex-wrap gap-2 mb-2">
                                        {validatedPromoFromCode.promo_type === 'percentage_discount' && validatedPromoFromCode.discount_percentage && (
                                          <span className="text-xs font-bold bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full">
                                            {validatedPromoFromCode.discount_percentage}% OFF
                                          </span>
                                        )}
                                        {validatedPromoFromCode.promo_type === 'fixed_discount' && validatedPromoFromCode.discount_amount && (
                                          <span className="text-xs font-bold bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full">
                                            ₱{parseFloat(validatedPromoFromCode.discount_amount).toFixed(2)} OFF
                                          </span>
                                        )}
                                        {validatedPromoFromCode.merchandise && validatedPromoFromCode.merchandise.length > 0 && (
                                          <span className="text-xs font-bold bg-purple-100 text-purple-800 px-2.5 py-1 rounded-full">
                                            🎁 Free Items ({validatedPromoFromCode.merchandise.length})
                                          </span>
                                        )}
                                      </div>
                                      {validatedPromoFromCode.calculated_discount > 0 && (
                                        <div className="mt-2 pt-2 border-t border-gray-200">
                                          <div className="flex items-baseline space-x-2">
                                            <span className="text-xs text-gray-500 line-through">
                                              ₱{(selectedPackage?.package_type === 'Installment' && selectedPackage?.downpayment_amount != null && parseFloat(selectedPackage.downpayment_amount) > 0
                                                ? parseFloat(selectedPackage.downpayment_amount)
                                                : parseFloat(selectedPackage?.package_price || 0)
                                              ).toFixed(2)}
                                            </span>
                                            <span className="text-lg font-bold text-green-600">
                                              ₱{validatedPromoFromCode.final_price.toFixed(2)}
                                            </span>
                                            <span className="text-xs text-gray-600">
                                              {selectedPackage?.package_type === 'Installment' ? 'Final Down payment' : 'Final Price'}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </button>
                              )}

                              {/* Show auto-apply promos */}
                              {availablePromos.map((promo) => {
                                // For Installment packages, apply promo to downpayment; otherwise use package_price
                                const baseAmount = selectedPackage.package_type === 'Installment' && selectedPackage.downpayment_amount != null && parseFloat(selectedPackage.downpayment_amount) > 0
                                  ? parseFloat(selectedPackage.downpayment_amount)
                                  : parseFloat(selectedPackage.package_price || 0);
                                let discountAmount = 0;
                                if (promo.promo_type === 'percentage_discount' && promo.discount_percentage) {
                                  discountAmount = (baseAmount * promo.discount_percentage) / 100;
                                } else if (promo.promo_type === 'fixed_discount' && promo.discount_amount) {
                                  discountAmount = Math.min(parseFloat(promo.discount_amount), baseAmount);
                                }
                                const finalPrice = Math.max(0, baseAmount - discountAmount);
                                
                                return (
                                  <button
                                    key={promo.promo_id}
                                    type="button"
                                    onClick={() => setSelectedPromo({ ...promo, calculated_discount: discountAmount, final_price: finalPrice })}
                                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                                      selectedPromo?.promo_id === promo.promo_id
                                        ? 'bg-[#F7C844] border-[#F7C844] text-gray-900 shadow-md'
                                        : 'bg-white border-gray-300 hover:border-blue-400 hover:shadow'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <div className="flex items-center space-x-2 mb-1">
                                          <div className="font-bold text-base text-gray-900">{promo.promo_name}</div>
                                          {selectedPromo?.promo_id === promo.promo_id && (
                                            <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                          )}
                                        </div>
                                        {promo.description && (
                                          <div className="text-xs text-gray-600 mb-2">{promo.description}</div>
                                        )}
                                        <div className="flex flex-wrap gap-2 mb-2">
                                          {promo.promo_type === 'percentage_discount' && promo.discount_percentage && (
                                            <span className="text-xs font-bold bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full">
                                              {promo.discount_percentage}% OFF
                                            </span>
                                          )}
                                          {promo.promo_type === 'fixed_discount' && promo.discount_amount && (
                                            <span className="text-xs font-bold bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full">
                                              ₱{parseFloat(promo.discount_amount).toFixed(2)} OFF
                                            </span>
                                          )}
                                          {promo.merchandise && promo.merchandise.length > 0 && (
                                            <span className="text-xs font-bold bg-purple-100 text-purple-800 px-2.5 py-1 rounded-full">
                                              🎁 Free Items ({promo.merchandise.length})
                                            </span>
                                          )}
                                        </div>
                                        {discountAmount > 0 && (
                                          <div className="mt-2 pt-2 border-t border-gray-200">
                                            <div className="flex items-baseline space-x-2">
                                              <span className="text-xs text-gray-500 line-through">
                                                ₱{baseAmount.toFixed(2)}
                                              </span>
                                              <span className="text-lg font-bold text-green-600">
                                                ₱{finalPrice.toFixed(2)}
                                              </span>
                                              <span className="text-xs text-gray-600">
                                                {selectedPackage.package_type === 'Installment' ? 'Final Down payment' : 'Final Price'}
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {selectedPromo && (
                        <div className="p-3 bg-green-50 border-2 border-green-300 rounded-lg">
                          <div className="flex items-center space-x-2">
                            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="flex-1">
                              <p className="text-sm font-bold text-green-900">
                                Promo Applied: {selectedPromo.promo_name}
                              </p>
                              {selectedPromo.calculated_discount > 0 && (
                                <p className="text-xs text-green-700 mt-0.5">
                                  You save ₱{parseFloat(selectedPromo.calculated_discount).toFixed(2)}!
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                        
                      {/* Collapsible Package Details */}
                      {showPackageDetails && (
                        <div className="p-4 bg-white border border-gray-200 rounded-lg">
                        {selectedPackage.details && selectedPackage.details.length > 0 && (() => {
                          const { pricingDetails, includedMerchandiseTypes, paidMerchandiseTypes } = selectedPackageDetails;
                          return (
                            <div className="pt-3 border-t border-gray-200">
                              <p className="text-sm font-medium text-gray-900 mb-3">
                                Package Includes
                              </p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {pricingDetails.map((detail, idx) => (
                                  <div key={`pricing-${idx}`} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                    <div className="flex items-start space-x-2">
                                      <svg className="w-4 h-4 text-[#F7C844] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      <div className="flex-1 min-w-0">
                                        <span className="text-xs font-medium text-gray-500 uppercase">Pricing</span>
                                        <p className="text-sm font-medium text-gray-900 mt-0.5 truncate">
                                          {detail.pricing_name || detail.pricinglist_name || detail.pricinglist_id}
                                        </p>
                                        {detail.pricing_type && (
                                          <span className="inline-block mt-1 text-xs text-gray-600 bg-white px-2 py-0.5 rounded border border-gray-200">
                                            {detail.pricing_type}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {/* Included Merchandise (Freebies) */}
                                {includedMerchandiseTypes.map((typeName) => (
                                  <div key={`included-merch-${typeName}`} className="p-3 bg-green-50 rounded-lg border border-green-200">
                                    <div className="flex items-start space-x-2">
                                      <svg className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                      </svg>
                                      <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-gray-500 uppercase">Merchandise</span>
                                          <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded">Included</span>
                                        </div>
                                        <p className="text-sm font-medium text-gray-900 mt-0.5">{typeName}</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {/* Paid Merchandise */}
                                {paidMerchandiseTypes.map((typeName) => (
                                  <div key={`paid-merch-${typeName}`} className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                                    <div className="flex items-start space-x-2">
                                      <svg className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                      </svg>
                                      <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-gray-500 uppercase">Merchandise</span>
                                          <span className="text-xs font-semibold text-orange-700 bg-orange-100 px-2 py-0.5 rounded">Paid</span>
                                        </div>
                                        <p className="text-sm font-medium text-gray-900 mt-0.5">{typeName}</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {selectedPackageMerchTypes.length > 0 && (
                          <div className="pt-3 mt-3 border-t border-gray-200">
                            <p className="text-sm font-medium text-gray-900 mb-3">Configure Merchandise</p>
                            
                            {/* Show per-student selection if students are selected */}
                            {selectedStudents.length > 0 ? (
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              {selectedPackageMerchTypes.map((typeName) => {
                                const itemsForType = getMerchandiseItemsByType(typeName);
                                const hasInventory = itemsForType.length > 0;
                                  const hasSizes = itemsForType.some(item => item.size);

                                return (
                                    <div key={`config-${typeName}`} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                      <label className="block text-sm font-medium text-gray-900 mb-2">
                                      {typeName}
                                    </label>
                                    {!hasInventory ? (
                                        <div className="flex items-center space-x-2 p-2 bg-red-50 border border-red-200 rounded">
                                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <p className="text-xs text-red-700 font-medium">
                                            No inventory available
                                        </p>
                                      </div>
                                      ) : hasSizes ? (
                                        (() => {
                                          const uniformCategories = Array.from(
                                            new Set(
                                              itemsForType
                                                .map(item => getUniformCategory(item))
                                                .filter(category => category && category !== 'General')
                                            )
                                          );
                                          const hasCategoryFilter = uniformCategories.length > 0;
                                          const activeCategory = hasCategoryFilter
                                            ? (uniformCategoryFilters[typeName] && uniformCategories.includes(uniformCategoryFilters[typeName])
                                                ? uniformCategoryFilters[typeName]
                                                : uniformCategories[0])
                                            : null;
                                          const filteredItemsForCategory = hasCategoryFilter
                                            ? itemsForType.filter(item => getUniformCategory(item) === activeCategory)
                                            : itemsForType;
                                          const colorSchemes = [
                                            { border: 'border-blue-300', bg: 'bg-blue-50', badge: 'bg-blue-600' },
                                            { border: 'border-green-300', bg: 'bg-green-50', badge: 'bg-green-600' },
                                            { border: 'border-purple-300', bg: 'bg-purple-50', badge: 'bg-purple-600' },
                                            { border: 'border-orange-300', bg: 'bg-orange-50', badge: 'bg-orange-600' },
                                            { border: 'border-pink-300', bg: 'bg-pink-50', badge: 'bg-pink-600' },
                                          ];
                                          
                                          return (
                                            <div className="space-y-2">
                                              {hasCategoryFilter && (
                                                <div className="flex items-center gap-1.5 mb-2">
                                                  {uniformCategories.map(category => (
                                                    <button
                                                      key={`${typeName}-${category}`}
                                                      type="button"
                                                      onClick={() => setUniformCategoryFilters(prev => ({ ...prev, [typeName]: category }))}
                                                      className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border transition-colors ${
                                                        activeCategory === category
                                                          ? 'bg-[#F7C844] text-gray-900 border-[#F7C844]'
                                                          : 'bg-white text-gray-600 border-gray-300 hover:border-[#F7C844]'
                                                      }`}
                                                    >
                                                      {category}
                                                    </button>
                                                  ))}
                                                </div>
                                              )}
                                              {filteredItemsForCategory.length === 0 ? (
                                                <div className="p-1.5 bg-yellow-50 border border-yellow-200 rounded text-[11px] text-yellow-800">
                                                  No inventory for this category.
                                                </div>
                                              ) : (
                                                <div className="space-y-1.5 max-h-64 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}>
                                                {selectedStudents.map((student, studentIndex) => {
                                                  const studentMerchSelections = studentMerchandiseSelections[student.user_id] || [];
                                                  const colorScheme = colorSchemes[studentIndex % colorSchemes.length];
                                                  // Get unique sizes from filtered items
                                                  const availableSizes = Array.from(new Set(
                                                    filteredItemsForCategory
                                                      .map(item => item.size)
                                                      .filter(Boolean)
                                                  )).sort();
                                                  const currentSelection = studentMerchSelections.find(m =>
                                                    m.merchandise_name === typeName &&
                                                    (!activeCategory || m.category === activeCategory)
                                                  );
                                                  const currentSize = currentSelection?.size || '';
                                                  
                                                  return (
                                                    <div key={`${typeName}-${activeCategory || 'all'}-${student.user_id}`} className={`p-2.5 rounded-lg border ${colorScheme.border} ${colorScheme.bg} mb-1.5`}>
                                                      <div className="flex items-center justify-between mb-1.5">
                                                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                                          <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${colorScheme.badge} text-white text-[10px] font-bold flex-shrink-0`}>
                                                            {studentIndex + 1}
                                                          </span>
                                                          <span className="text-[11px] font-semibold text-gray-900 truncate">
                                                            {student.full_name}
                                                          </span>
                                                        </div>
                                                        {hasCategoryFilter && (
                                                          <span className="text-[10px] font-semibold text-gray-600 flex-shrink-0 ml-1">
                                                            {activeCategory}
                                                          </span>
                                                        )}
                                                      </div>
                                                      <div className="flex items-center gap-1.5">
                                                        <label className="text-[10px] text-gray-700 flex-shrink-0">
                                                          Size:
                                                        </label>
                                                        <select
                                                          value={currentSize}
                                                          onChange={(e) => {
                                                            const selectedSize = e.target.value;
                                                            if (!selectedSize) {
                                                              handleStudentMerchandiseSizeChange(student.user_id, typeName, null, activeCategory);
                                                              return;
                                                            }
                                                            const selectedItem = filteredItemsForCategory.find(item => item.size === selectedSize);
                                                            if (selectedItem) {
                                                              handleStudentMerchandiseSizeChange(student.user_id, typeName, selectedItem, activeCategory);
                                                              handlePackageMerchSelectionChange(typeName, selectedItem);
                                                            }
                                                          }}
                                                          className="flex-1 px-1.5 py-1 border border-gray-300 rounded text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-[#F7C844] focus:border-transparent bg-white"
                                                        >
                                                          <option value="">Select</option>
                                                          {availableSizes.map((size, sizeIndex) => {
                                                            // Find the first item with this size in the filtered category
                                                            const sizeItem = filteredItemsForCategory.find(item => item.size === size);
                                                            const inventory = sizeItem ? checkInventoryAvailability(sizeItem.merchandise_id) : null;
                                                            const isOutOfStock = inventory?.isOutOfStock;
                                                            // Create unique key: include student_id, merchandise_id, size, category, and index for absolute uniqueness
                                                            const uniqueKey = sizeItem 
                                                              ? `${student.user_id}-${sizeItem.merchandise_id}-${size}-${activeCategory || 'all'}-${sizeIndex}` 
                                                              : `${student.user_id}-${typeName}-${activeCategory || 'all'}-${size}-${sizeIndex}`;
                                                            return (
                                                              <option
                                                                key={uniqueKey}
                                                                value={size}
                                                                disabled={isOutOfStock}
                                                              >
                                                                {size}{isOutOfStock ? ' (OOS)' : ''} {inventory && !isOutOfStock ? `(${inventory.available})` : ''}
                                                              </option>
                                                            );
                                                          })}
                                                        </select>
                                                      </div>
                                                      {currentSize && (
                                                        <div className="mt-1.5">
                                                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">
                                                            ✓ {currentSize}
                                                          </span>
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()
                                      ) : (
                                        // For items without sizes, show global checkbox
                                        <div className="space-y-2">
                                        {itemsForType.map((item) => {
                                            const selections = packageMerchSelections[typeName] || [];
                                          const isChecked = selections.some(
                                            (selection) => selection.merchandise_id === item.merchandise_id
                                          );
                                            const inventory = checkInventoryAvailability(item.merchandise_id);
                                          return (
                                            <label
                                              key={item.merchandise_id}
                                                className={`flex items-start space-x-2 p-2 rounded cursor-pointer transition-all border ${
                                                  inventory.isOutOfStock ? 'bg-red-50 border-red-200 cursor-not-allowed opacity-60' :
                                                  inventory.isLowStock ? 'bg-orange-50 border-orange-200' :
                                                isChecked 
                                                    ? 'bg-white border border-[#F7C844]' 
                                                    : 'hover:bg-white border border-gray-200'
                                              }`}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={() => handlePackageMerchSelectionChange(typeName, item)}
                                                  className="h-4 w-4 text-[#F7C844] focus:ring-[#F7C844] border-gray-300 rounded transition-all mt-0.5"
                                                  disabled={inventory.isOutOfStock}
                                              />
                                                <div className="flex-1">
                                                  <span className={`text-sm font-medium ${isChecked ? 'text-gray-900' : 'text-gray-700'}`}>
                                                {getMerchandiseOptionLabel(item)}
                                              </span>
                                                  {inventory.available !== null && (
                                                    <div className={`text-xs mt-1 ${
                                                      inventory.isOutOfStock ? 'text-red-600 font-semibold' :
                                                      inventory.isLowStock ? 'text-orange-600' :
                                                      'text-gray-500'
                                                    }`}>
                                                      Stock: {inventory.available}
                                                      {selectedStudents.length > 1 && (
                                                        <span className="ml-1">
                                                          (Need: {inventory.needed})
                                                          {inventory.isLowStock && ' ⚠ Low stock'}
                                                          {inventory.isOutOfStock && ' ✗ Out of stock'}
                                                        </span>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            ) : (
                              // Show message if no students selected yet
                              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                                <p className="text-sm text-yellow-800">
                                  Please select students first to configure merchandise sizes.
                                </p>
                          </div>
                        )}
                      </div>
                        )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manual per-phase and custom selection UI (only when no package is selected) */}
                  {!selectedPackage && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-gray-900">Select Items</h3>
                      
                      {/* Phase Selection - Only for per-phase enrollment */}
                      {selectedEnrollmentOption === 'per-phase' && selectedClassForEnrollment?.number_of_phase && selectedClassForEnrollment.number_of_phase > 0 && (
                        <div>
                          <label htmlFor="phase_selection" className="label-field">
                            Select Phase <span className="text-red-500">*</span>
                          </label>
                          <select
                            id="phase_selection"
                            value={selectedPhaseNumber !== null ? selectedPhaseNumber : ''}
                            onChange={(e) => {
                              const phaseValue = e.target.value === '' ? null : parseInt(e.target.value);
                              setSelectedPhaseNumber(phaseValue);
                            }}
                            className="input-field"
                            required
                          >
                            <option value="">Choose a phase...</option>
                            {Array.from({ length: selectedClassForEnrollment.number_of_phase }, (_, i) => i + 1).map((phaseNum) => (
                              <option key={phaseNum} value={phaseNum}>
                                Phase {phaseNum}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-gray-500">
                            Select which phase to enroll the student(s) in. This class has {selectedClassForEnrollment.number_of_phase} phase{selectedClassForEnrollment.number_of_phase !== 1 ? 's' : ''}.
                          </p>
                        </div>
                      )}
                      
                      {/* Amount Input - Only for per-phase enrollment */}
                      {selectedEnrollmentOption === 'per-phase' && (
                        <div>
                          <label htmlFor="per_phase_amount" className="label-field">
                            Enter Amount <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            id="per_phase_amount"
                            value={perPhaseAmount}
                            onChange={(e) => setPerPhaseAmount(e.target.value)}
                            placeholder="0.00"
                            step="0.01"
                            min="0"
                            className="input-field"
                            required
                          />
                          <p className="mt-1 text-xs text-gray-500">Enter the amount for this phase enrollment</p>
                        </div>
                      )}
                      
                      {/* Pricing Lists */}
                      <div>
                        <h4 className="text-xs font-bold text-gray-700 mb-2">Pricing Lists</h4>
                        {pricingLists.length === 0 ? (
                          <p className="text-xs text-gray-500 italic">No pricing lists available.</p>
                        ) : (
                          <div className="border border-gray-200 rounded-lg p-2 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}>
                            <div className="space-y-1.5">
                              {pricingLists.map((pricing) => {
                                // Check if this pricing list is "New Enrollee Installment" or "New Enrollee Fullpayment"
                                const isInstallment = isNewEnrolleeInstallment(pricing);
                                const isFullpayment = isNewEnrolleeFullpayment(pricing);
                                const isMutuallyExclusive = isInstallment || isFullpayment;
                                const isChecked = selectedPricingLists.includes(pricing.pricinglist_id);
                                
                                // Disable "New Enrollee Installment" and "New Enrollee Fullpayment" for per-phase enrollment
                                const isDisabled = selectedEnrollmentOption === 'per-phase' && (isInstallment || isFullpayment);
                                
                                return (
                                  <label
                                    key={pricing.pricinglist_id}
                                    className={`flex items-center space-x-2 p-1.5 rounded transition-all border ${
                                      isDisabled
                                        ? 'cursor-not-allowed opacity-50 bg-gray-100 border-gray-200'
                                        : isMutuallyExclusive && isChecked
                                        ? 'bg-[#F7C844] bg-opacity-10 border-[#F7C844] cursor-pointer'
                                        : isChecked
                                        ? 'bg-gray-50 border-gray-300 cursor-pointer'
                                        : 'hover:bg-gray-50 border-transparent cursor-pointer'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => !isDisabled && handlePricingListToggle(pricing.pricinglist_id)}
                                      disabled={isDisabled}
                                      className="h-3.5 w-3.5 text-[#F7C844] focus:ring-[#F7C844] border-gray-300 rounded disabled:cursor-not-allowed"
                                    />
                                    <div className="flex-1">
                                      <span className={`text-xs font-medium ${isDisabled ? 'text-gray-500' : 'text-gray-900'}`}>
                                        {pricing.name}
                                        {isDisabled && (
                                          <span className="ml-1.5 text-xs text-gray-400 italic">(Not available for per-phase enrollment)</span>
                                        )}
                                      </span>
                                      {pricing.type && (
                                        <span className="ml-1.5 text-xs text-gray-500">({pricing.type})</span>
                                      )}
                                      {pricing.price && (
                                        <span className="ml-1.5 text-xs text-gray-600">
                                          - ₱{parseFloat(pricing.price).toFixed(2)}
                                        </span>
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Merchandise */}
                      <div>
                        <h4 className="text-xs font-bold text-gray-700 mb-2">Merchandise</h4>
                        {merchandise.length === 0 ? (
                          <p className="text-xs text-gray-500 italic">No merchandise available.</p>
                        ) : (
                          <div className="border border-gray-200 rounded-lg p-2 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}>
                            <div className="space-y-2">
                              {(() => {
                                // Group merchandise by name to show only unique types
                                const uniqueMerchandise = [];
                                const seenNames = new Set();
                                
                                merchandise.forEach((item) => {
                                  if (!seenNames.has(item.merchandise_name)) {
                                    seenNames.add(item.merchandise_name);
                                    uniqueMerchandise.push(item);
                                  }
                                });
                                
                                return uniqueMerchandise.map((item) => {
                                  const isSelected = selectedMerchandise.some(m => m.merchandise_name === item.merchandise_name);
                                  const selectedItem = selectedMerchandise.find(m => m.merchandise_name === item.merchandise_name);
                                  const inventory = checkInventoryAvailability(item.merchandise_id);
                                  const itemsForType = getMerchandiseItemsByType(item.merchandise_name);
                                  const hasSizes = itemsForType.some(merchItem => merchItem.size);
                                  
                                  return (
                                    <div key={item.merchandise_id} className={`border rounded-lg p-2 ${
                                      inventory.isOutOfStock ? 'border-red-200 bg-red-50' :
                                      inventory.isLowStock ? 'border-orange-200 bg-orange-50' :
                                      'border-gray-200'
                                    }`}>
                                      <label className={`flex items-start space-x-2 ${inventory.isOutOfStock ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => handleMerchandiseToggle(item.merchandise_id, item.merchandise_name)}
                                          className="h-3.5 w-3.5 text-primary-600 focus:ring-primary-500 border-gray-300 rounded mt-0.5"
                                          disabled={inventory.isOutOfStock}
                                        />
                                        <div className="flex-1">
                                          <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-gray-900">{item.merchandise_name}</span>
                                            {item.price && (
                                              <span className="text-xs text-gray-500 ml-2">₱{parseFloat(item.price).toFixed(2)}</span>
                                            )}
                                          </div>
                                          {(item.gender || item.type) && (
                                            <div className="mt-0.5 text-xs text-gray-500 italic">
                                              {[item.gender, item.type].filter(Boolean).join(' - ')}
                                            </div>
                                          )}
                                          {inventory.available !== null && (
                                            <div className={`text-xs mt-1 ${
                                              inventory.isOutOfStock ? 'text-red-600 font-semibold' :
                                              inventory.isLowStock ? 'text-orange-600' :
                                              'text-gray-500'
                                            }`}>
                                              Stock: {inventory.available}
                                              {selectedStudents.length > 1 && (
                                                <span className="ml-1">
                                                  (Need: {inventory.needed})
                                                  {inventory.isLowStock && ' ⚠ Low stock'}
                                                  {inventory.isOutOfStock && ' ✗ Out of stock'}
                                                </span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </label>
                                      
                                      {/* Size selector for LCA Uniform with Top/Bottom categories - Only show if students are selected */}
                                      {isSelected && item.merchandise_name === 'LCA Uniform' && hasSizes && selectedStudents.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-gray-200">
                                          {(() => {
                                            const uniformCategories = Array.from(
                                              new Set(
                                                itemsForType
                                                  .map(merchItem => getUniformCategory(merchItem))
                                                  .filter(category => category && category !== 'General')
                                              )
                                            );
                                            const hasCategoryFilter = uniformCategories.length > 0;
                                            const activeCategory = hasCategoryFilter
                                              ? (uniformCategoryFilters[item.merchandise_name] && uniformCategories.includes(uniformCategoryFilters[item.merchandise_name])
                                                  ? uniformCategoryFilters[item.merchandise_name]
                                                  : uniformCategories[0])
                                              : null;
                                            const filteredItemsForCategory = hasCategoryFilter
                                              ? itemsForType.filter(merchItem => getUniformCategory(merchItem) === activeCategory)
                                              : itemsForType;
                                            const colorSchemes = [
                                              { border: 'border-blue-300', bg: 'bg-blue-50', badge: 'bg-blue-600' },
                                              { border: 'border-green-300', bg: 'bg-green-50', badge: 'bg-green-600' },
                                              { border: 'border-purple-300', bg: 'bg-purple-50', badge: 'bg-purple-600' },
                                              { border: 'border-orange-300', bg: 'bg-orange-50', badge: 'bg-orange-600' },
                                              { border: 'border-pink-300', bg: 'bg-pink-50', badge: 'bg-pink-600' },
                                            ];
                                            
                                            return (
                                              <div className="space-y-2">
                                                {hasCategoryFilter && (
                                                  <div className="flex items-center gap-1.5 mb-2">
                                                    {uniformCategories.map(category => (
                                                      <button
                                                        key={`${item.merchandise_name}-${category}`}
                                                        type="button"
                                                        onClick={() => setUniformCategoryFilters(prev => ({ ...prev, [item.merchandise_name]: category }))}
                                                        className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border transition-colors ${
                                                          activeCategory === category
                                                            ? 'bg-[#F7C844] text-gray-900 border-[#F7C844]'
                                                            : 'bg-white text-gray-600 border-gray-300 hover:border-[#F7C844]'
                                                        }`}
                                                      >
                                                        {category}
                                                      </button>
                                                    ))}
                                                  </div>
                                                )}
                                                {filteredItemsForCategory.length === 0 ? (
                                                  <div className="p-1.5 bg-yellow-50 border border-yellow-200 rounded text-[11px] text-yellow-800">
                                                    No inventory for this category.
                                                  </div>
                                                ) : (
                                                  <div className="space-y-1.5 max-h-64 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}>
                                                    {selectedStudents.map((student, studentIndex) => {
                                                      const studentMerchSelections = studentMerchandiseSelections[student.user_id] || [];
                                                      const colorScheme = colorSchemes[studentIndex % colorSchemes.length];
                                                      // Get unique sizes from filtered items
                                                      const availableSizes = Array.from(new Set(
                                                        filteredItemsForCategory
                                                          .map(merchItem => merchItem.size)
                                                          .filter(Boolean)
                                                      )).sort();
                                                      const currentSelection = studentMerchSelections.find(m =>
                                                        m.merchandise_name === item.merchandise_name &&
                                                        (!activeCategory || m.category === activeCategory)
                                                      );
                                                      const currentSize = currentSelection?.size || '';
                                                      
                                                      return (
                                                        <div key={`${item.merchandise_name}-${activeCategory || 'all'}-${student.user_id}`} className={`p-2.5 rounded-lg border ${colorScheme.border} ${colorScheme.bg} mb-1.5`}>
                                                          <div className="flex items-center justify-between mb-1.5">
                                                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                                              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${colorScheme.badge} text-white text-[10px] font-bold flex-shrink-0`}>
                                                                {studentIndex + 1}
                                                              </span>
                                                              <span className="text-[11px] font-semibold text-gray-900 truncate">
                                                                {student.full_name}
                                                              </span>
                                                            </div>
                                                            {hasCategoryFilter && (
                                                              <span className="text-[10px] font-semibold text-gray-600 flex-shrink-0 ml-1">
                                                                {activeCategory}
                                                              </span>
                                                            )}
                                                          </div>
                                                          <div className="flex items-center gap-1.5">
                                                            <label className="text-[10px] text-gray-700 flex-shrink-0">
                                                              Size:
                                          </label>
                                          <select
                                                              value={currentSize}
                                                              onChange={(e) => {
                                                                const selectedSize = e.target.value;
                                                                if (!selectedSize) {
                                                                  handleStudentMerchandiseSizeChange(student.user_id, item.merchandise_name, null, activeCategory);
                                                                  return;
                                                                }
                                                                const selectedItem = filteredItemsForCategory.find(merchItem => merchItem.size === selectedSize);
                                                                if (selectedItem) {
                                                                  handleStudentMerchandiseSizeChange(student.user_id, item.merchandise_name, selectedItem, activeCategory);
                                                                }
                                                              }}
                                                              className="flex-1 px-1.5 py-1 border border-gray-300 rounded text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-[#F7C844] focus:border-transparent bg-white"
                                          >
                                                              <option value="">Select</option>
                                                              {availableSizes.map((size, sizeIndex) => {
                                                                // Find the first item with this size in the filtered category
                                                                const sizeItem = filteredItemsForCategory.find(merchItem => merchItem.size === size);
                                                                const sizeInventory = sizeItem ? checkInventoryAvailability(sizeItem.merchandise_id) : null;
                                                                const isOutOfStock = sizeInventory?.isOutOfStock;
                                                                // Create unique key: include student_id, merchandise_id, size, category, and index for absolute uniqueness
                                                                const uniqueKey = sizeItem 
                                                                  ? `${student.user_id}-${sizeItem.merchandise_id}-${size}-${activeCategory || 'all'}-${sizeIndex}` 
                                                                  : `${student.user_id}-${item.merchandise_name}-${activeCategory || 'all'}-${size}-${sizeIndex}`;
                                                                return (
                                                                  <option
                                                                    key={uniqueKey}
                                                                    value={size}
                                                                    disabled={isOutOfStock}
                                                                  >
                                                                    {size}{isOutOfStock ? ' (OOS)' : ''} {sizeInventory && !isOutOfStock ? `(${sizeInventory.available})` : ''}
                                                                  </option>
                                                                );
                                                              })}
                                          </select>
                                                          </div>
                                                          {currentSize && (
                                                            <div className="mt-1.5">
                                                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">
                                                                ✓ {currentSize}
                                                              </span>
                                                            </div>
                                                          )}
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      )}
                                      
                                      {/* Show message if LCA Uniform is selected but no students selected yet */}
                                      {isSelected && item.merchandise_name === 'LCA Uniform' && hasSizes && selectedStudents.length === 0 && (
                                        <div className="mt-2 ml-5 p-2 bg-yellow-50 border border-yellow-200 rounded text-[11px] text-yellow-800">
                                          Please select students first to configure uniform sizes.
                                        </div>
                                      )}
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Installment Settings Toggle - Show for package option, but hide for fullpayment packages and Reserved packages */}
                  {selectedPackage && selectedEnrollmentOption !== 'per-phase' && (() => {
                    // Hide installment settings if enrollment option is reservation
                    if (selectedEnrollmentOption === 'reservation') {
                      return null;
                    }
                    
                    // Hide installment settings if package type is Reserved
                    if (selectedPackage.package_type === 'Reserved') {
                      return null;
                    }
                    
                    // Check if package has fullpayment pricing list
                    const hasFullpaymentPricing = selectedPackage.details?.some(detail => {
                      const pricing = pricingLists.find(p => p.pricinglist_id === detail.pricinglist_id);
                      return pricing && isNewEnrolleeFullpayment(pricing);
                    });
                    
                    // Hide installment settings if package is fullpayment
                    if (hasFullpaymentPricing) {
                      return null;
                    }
                    
                    return (
                    <div className="space-y-3">
                      {/* Installment Settings Toggle */}
                      <div className="p-4 bg-white border border-gray-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <div>
                              <h4 className="text-sm font-medium text-gray-900">Installment Payment</h4>
                              <p className="text-xs text-gray-600 mt-0.5">Enable to set up installment invoice settings</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const newState = !showInstallmentSettings;
                              setShowInstallmentSettings(newState);
                              if (newState) {
                                // Auto-populate default settings when toggling on
                                const defaultSettings = getDefaultInstallmentSettings();
                                setInstallmentSettings(defaultSettings);
                              } else {
                                // Reset settings when toggling off
                                updateInstallmentSettings({
                                  invoice_issue_date: '',
                                  billing_month: '',
                                  invoice_due_date: '',
                                  invoice_generation_date: '',
                                });
                              }
                            }}
                            className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-1 shadow-inner ${
                              showInstallmentSettings ? 'bg-[#F7C844]' : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                showInstallmentSettings ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {/* Installment Settings Form */}
                      {showInstallmentSettings && (
                        <div className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
                          <div className="mb-2">
                            <h3 className="text-xs font-bold text-blue-900">Installment Invoice Settings</h3>
                            <p className="text-xs text-gray-600 mt-0.5">
                              Configure the details for the first invoices that will be generated regularly.
                            </p>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {/* Invoice Issue Date */}
                            <div>
                              <label htmlFor="invoice_issue_date" className="label-field">
                                Invoice Issue Date <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="date"
                                id="invoice_issue_date"
                                value={installmentSettings.invoice_issue_date}
                                onChange={(e) => updateInstallmentSettings({ invoice_issue_date: e.target.value })}
                                className="input-field"
                                required
                              />
                            </div>

                            {/* Billing Month */}
                            <div>
                              <label htmlFor="billing_month" className="label-field flex items-center space-x-2">
                                <span>Billing Month</span>
                                <span className="text-red-500">*</span>
                                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </label>
                              <input
                                type="month"
                                id="billing_month"
                                value={installmentSettings.billing_month}
                                onChange={(e) => updateInstallmentSettings({ billing_month: e.target.value })}
                                className="input-field"
                                required
                              />
                            </div>

                            {/* Invoice Due Date */}
                            <div>
                              <label htmlFor="invoice_due_date" className="label-field">
                                Invoice Due Date <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="date"
                                id="invoice_due_date"
                                value={installmentSettings.invoice_due_date}
                                onChange={(e) => updateInstallmentSettings({ invoice_due_date: e.target.value })}
                                className="input-field"
                                required
                              />
                            </div>

                            {/* Invoice Generation Date */}
                            <div>
                              <label htmlFor="invoice_generation_date" className="label-field">
                                Invoice Generation Date <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="date"
                                id="invoice_generation_date"
                                value={installmentSettings.invoice_generation_date}
                                onChange={(e) => updateInstallmentSettings({ invoice_generation_date: e.target.value })}
                                className="input-field"
                                required
                              />
                            </div>
                          </div>

                          {/* Frequency - Fixed at 1 month */}
                          <div className="mt-2 pt-2 border-t border-blue-200">
                            <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-700">
                                Invoice will be generated every
                                <span className="inline-block w-8 px-1 py-0.5 text-xs text-blue-900 font-semibold text-center bg-blue-50 ml-1 mr-1">
                                  1
                                </span>
                              <span className="text-blue-900 font-semibold">Month(s)</span>
                            </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })()}

                  {/* Reservation Invoice Settings - Show for Reserved packages */}
                  {selectedPackage && selectedPackage.package_type === 'Reserved' && selectedEnrollmentOption !== 'per-phase' && (
                    <div className="space-y-3">
                      {/* Reservation Invoice Settings */}
                      <div className="p-4 bg-white border border-gray-200 rounded-lg">
                        <div className="mb-3">
                          <h4 className="text-sm font-medium text-gray-900 mb-1">Reservation Invoice Settings</h4>
                          <p className="text-xs text-gray-600">Configure the issue date and due date for the reservation fee invoice</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {/* Issue Date */}
                          <div>
                            <label htmlFor="reservation_issue_date" className="label-field">
                              Issue Date <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="date"
                              id="reservation_issue_date"
                              value={reservationInvoiceSettings.issue_date}
                              onChange={(e) => setReservationInvoiceSettings(prev => ({
                                ...prev,
                                issue_date: e.target.value
                              }))}
                              className="input-field"
                              required
                            />
                          </div>
                          
                          {/* Due Date */}
                          <div>
                            <label htmlFor="reservation_due_date" className="label-field">
                              Due Date <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="date"
                              id="reservation_due_date"
                              value={reservationInvoiceSettings.due_date}
                              onChange={(e) => setReservationInvoiceSettings(prev => ({
                                ...prev,
                                due_date: e.target.value
                              }))}
                              className="input-field"
                              required
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Review & Invoice */}
              {enrollStep === 'review' && (
                <div className="space-y-6">
                  {/* Phase Selection in Review - Show for per-phase enrollment */}
                  {selectedEnrollmentOption === 'per-phase' && selectedPhaseNumber !== null && (
                    <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
                      <h4 className="font-semibold text-blue-900 mb-2">Enrollment Phase</h4>
                      <div className="flex items-center space-x-2">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-blue-600 text-white">
                          Phase {selectedPhaseNumber}
                        </span>
                        <p className="text-sm text-blue-700">Selected for per-phase enrollment</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Phase Selection in Review - Show for other enrollment options */}
                  {selectedClassForEnrollment?.number_of_phase && selectedClassForEnrollment.number_of_phase > 0 && selectedEnrollmentOption !== 'per-phase' && (
                    <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
                      <h4 className="font-semibold text-blue-900 mb-2">Enrollment Phase</h4>
                      <div className="flex items-center space-x-2">
                        {selectedPhaseNumber ? (
                          <>
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-blue-600 text-white">
                              Phase {selectedPhaseNumber}
                            </span>
                            <p className="text-sm text-blue-700">Manually selected</p>
                          </>
                        ) : (
                          <>
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-gray-600 text-white">
                              Auto
                            </span>
                            <p className="text-sm text-gray-700">Will be automatically determined based on class status</p>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedStudents.length > 0 && (
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                      <h4 className="font-semibold text-gray-900 mb-3">
                        Selected Student
                      </h4>
                      <div className="space-y-4 max-h-96 overflow-y-auto">
                        {selectedStudents.map((student, index) => {
                          // Get merchandise selections for this student
                          const studentMerchSelections = studentMerchandiseSelections[student.user_id] || [];
                          // Get all merchandise items that should be available for selection
                          const availableMerchandise = selectedPackage
                            ? (() => {
                                // For packages, get merchandise from package selections
                                const allPackageMerch = Object.values(packageMerchSelections || {}).flat();
                                const allMerchItems = allPackageMerch
                                  .filter(m => m && m.merchandise_id)
                                  .map(m => {
                                    const merchItem = merchandise.find(item => item.merchandise_id === m.merchandise_id);
                                    return merchItem ? {
                                      merchandise_id: merchItem.merchandise_id,
                                      merchandise_name: merchItem.merchandise_name,
                                      size: m.size || null
                                    } : null;
                                  })
                                  .filter(Boolean);
                                
                                // For LCA Uniform, filter to show only one Top and one Bottom
                                const uniformItems = allMerchItems.filter(m => m.merchandise_name === 'LCA Uniform');
                                const nonUniformItems = allMerchItems.filter(m => m.merchandise_name !== 'LCA Uniform');
                                
                                if (uniformItems.length > 0) {
                                  // Group uniforms by category and take only one of each
                                  const topItems = [];
                                  const bottomItems = [];
                                  
                                  uniformItems.forEach(item => {
                                    const merchItem = merchandise.find(m => m.merchandise_id === item.merchandise_id);
                                    if (merchItem) {
                                      const category = getUniformCategory(merchItem);
                                      if (category === 'Top' && topItems.length === 0) {
                                        topItems.push(item);
                                      } else if (category === 'Bottom' && bottomItems.length === 0) {
                                        bottomItems.push(item);
                                      }
                                    }
                                  });
                                  
                                  return [...nonUniformItems, ...topItems, ...bottomItems];
                                }
                                
                                return allMerchItems;
                              })()
                            : selectedMerchandise.map(m => ({
                                merchandise_id: m.merchandise_id,
                                merchandise_name: m.merchandise_name,
                                size: m.size || null
                              }));
                          
                          // Color scheme for each student card (alternating colors)
                          const colorSchemes = [
                            { border: 'border-blue-300', bg: 'bg-blue-50', badge: 'bg-blue-600', text: 'text-blue-900' },
                            { border: 'border-green-300', bg: 'bg-green-50', badge: 'bg-green-600', text: 'text-green-900' },
                            { border: 'border-purple-300', bg: 'bg-purple-50', badge: 'bg-purple-600', text: 'text-purple-900' },
                            { border: 'border-orange-300', bg: 'bg-orange-50', badge: 'bg-orange-600', text: 'text-orange-900' },
                            { border: 'border-pink-300', bg: 'bg-pink-50', badge: 'bg-pink-600', text: 'text-pink-900' },
                          ];
                          const colorScheme = colorSchemes[index % colorSchemes.length];
                          
                          return (
                            <div key={student.user_id} className={`bg-white p-4 rounded-lg border-2 ${colorScheme.border} ${colorScheme.bg} shadow-sm`}>
                              {/* Student Header with Badge */}
                              <div className="mb-3 flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${colorScheme.badge} text-white text-xs font-bold`}>
                                      {index + 1}
                                    </span>
                                    <p className={`text-sm font-bold ${colorScheme.text}`}>{student.full_name}</p>
                                  </div>
                                  <p className="text-xs text-gray-600 ml-8">{student.email}</p>
                            {student.level_tag && (
                                    <p className="text-xs text-gray-500 mt-1 ml-8">Level: {student.level_tag}</p>
                            )}
                          </div>
                                <div className={`px-2 py-1 rounded text-xs font-semibold ${colorScheme.badge} text-white`}>
                                  Student {index + 1}
                                </div>
                              </div>
                              
                              {/* Per-student merchandise size selection */}
                              {availableMerchandise.length > 0 && (
                                <div className={`mt-3 pt-3 border-t-2 ${colorScheme.border}`}>
                                  <div className="flex items-center gap-2 mb-3">
                                    <svg className={`w-4 h-4 ${colorScheme.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                                    </svg>
                                    <p className={`text-xs font-bold ${colorScheme.text}`}>
                                      Select Sizes for {student.full_name.split(' ')[0]}:
                                    </p>
                                  </div>
                                  <div className="space-y-2.5">
                                    {availableMerchandise.map((merchItem) => {
                                      const merchCategory = getUniformCategory(merchItem);
                                      const studentSelection = studentMerchSelections.find(m => 
                                        m.merchandise_name === merchItem.merchandise_name &&
                                        (!m.category || m.category === merchCategory || merchCategory === 'General')
                                      );
                                      const currentSize = studentSelection?.size || null;
                                      
                                      // Get all available sizes for this merchandise type, filtered by category
                                      // This ensures we only show sizes for the current category (Top or Bottom)
                                      // Use Set to ensure unique sizes
                                      const availableSizes = Array.from(new Set(
                                        merchandise
                                          .filter(m => {
                                            if (m.merchandise_name !== merchItem.merchandise_name) return false;
                                            // For uniforms, filter by category to avoid duplicates
                                            if (merchItem.merchandise_name === 'LCA Uniform' && merchCategory && merchCategory !== 'General') {
                                              return getUniformCategory(m) === merchCategory;
                                            }
                                            return true;
                                          })
                                          .map(m => m.size)
                                          .filter(Boolean)
                                      )).sort();
                                      
                                      // Check if this merchandise type has sizes
                                      const hasSizes = availableSizes.length > 0;
                                      
                                      // Check inventory for this specific size
                                      const selectedSizeItem = currentSize 
                                        ? merchandise.find(m => 
                                            m.merchandise_name === merchItem.merchandise_name && 
                                            m.size === currentSize &&
                                            (getUniformCategory(m) === merchCategory || merchCategory === 'General')
                                          )
                                        : null;
                                      const inventory = selectedSizeItem ? checkInventoryAvailability(selectedSizeItem.merchandise_id) : null;
                                      
                                      return (
                                        <div 
                                          key={`${merchItem.merchandise_id || merchItem.merchandise_name}-${merchCategory || 'all'}-${student.user_id}`} 
                                          className={`bg-white p-2.5 rounded border ${currentSize ? 'border-gray-300' : 'border-gray-200'} ${inventory?.isOutOfStock ? 'border-red-300 bg-red-50' : ''}`}
                                        >
                                          <div className="flex items-center justify-between">
                                            <div className="flex-1">
                                              <span className="font-semibold text-gray-800 text-xs">
                                                {merchItem.merchandise_name}
                                              </span>
                                              {inventory && (
                                                <span className={`ml-2 text-xs ${
                                                  inventory.isOutOfStock ? 'text-red-600 font-bold' :
                                                  inventory.isLowStock ? 'text-orange-600' :
                                                  'text-gray-500'
                                                }`}>
                                                  (Stock: {inventory.available}
                                                  {inventory.isOutOfStock && ' - OUT OF STOCK'}
                                                  {inventory.isLowStock && ' - LOW STOCK'}
                                                  )
                                                </span>
                                              )}
                                            </div>
                                            {hasSizes ? (
                                              <select
                                                value={currentSize || ''}
                                                onChange={(e) => {
                                                  const selectedSize = e.target.value;
                                                  if (!selectedSize) {
                                                    handleStudentMerchandiseSizeChange(student.user_id, merchItem.merchandise_name, null, merchCategory);
                                                    return;
                                                  }
                                                  const sizeItem = merchandise.find(m => 
                                                    m.merchandise_name === merchItem.merchandise_name && 
                                                    m.size === selectedSize &&
                                                    (getUniformCategory(m) === merchCategory || merchCategory === 'General')
                                                  );
                                                  if (sizeItem) {
                                                    handleStudentMerchandiseSizeChange(student.user_id, merchItem.merchandise_name, sizeItem, merchCategory);
                                                  }
                                                }}
                                                className={`ml-2 px-3 py-1.5 border rounded text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent ${
                                                  currentSize ? 'border-[#F7C844] bg-yellow-50 text-gray-900' : 'border-gray-300 bg-white text-gray-700'
                                                } ${inventory?.isOutOfStock ? 'border-red-300 bg-red-50' : ''}`}
                                              >
                                                <option value="">Select Size</option>
                                                {availableSizes.map((size, sizeIndex) => {
                                                  // Find the first item with this size matching the category
                                                  const sizeItem = merchandise.find(m => 
                                                    m.merchandise_name === merchItem.merchandise_name && 
                                                    m.size === size &&
                                                    (getUniformCategory(m) === merchCategory || merchCategory === 'General')
                                                  );
                                                  const sizeInventory = sizeItem ? checkInventoryAvailability(sizeItem.merchandise_id) : null;
                                                  const isOutOfStock = sizeInventory?.isOutOfStock;
                                                  // Create unique key: include student_id, merchandise_id, size, category, and index for absolute uniqueness
                                                  const uniqueKey = sizeItem 
                                                    ? `${student.user_id}-${sizeItem.merchandise_id}-${size}-${merchCategory || 'all'}-${sizeIndex}` 
                                                    : `${student.user_id}-${merchItem.merchandise_id || merchItem.merchandise_name}-${size}-${merchCategory || 'all'}-${sizeIndex}`;
                                                  return (
                                                    <option 
                                                      key={uniqueKey} 
                                                      value={size}
                                                      disabled={isOutOfStock}
                                                    >
                                                      {size}{isOutOfStock ? ' (Out of Stock)' : ''}
                                                    </option>
                                                  );
                                                })}
                                              </select>
                                            ) : (
                                              <span className="ml-2 text-gray-500 italic text-xs">No size options</span>
                                            )}
                                          </div>
                                          {currentSize && (
                                            <div className="mt-1.5 ml-1">
                                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                                inventory?.isOutOfStock ? 'bg-red-100 text-red-800' :
                                                inventory?.isLowStock ? 'bg-orange-100 text-orange-800' :
                                                'bg-green-100 text-green-800'
                                              }`}>
                                                ✓ Selected: {currentSize}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectedPackage && (
                    <div className="space-y-4">
                      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                        <h4 className="font-semibold text-gray-900 mb-3">Selected Package</h4>
                        <div className="space-y-2 mb-3">
                          <p className="text-sm text-gray-700">
                            <strong>Package:</strong> {selectedPackage.package_name}
                          </p>
                          {selectedPackage.package_type === 'Installment' ? (
                            <>
                              {selectedPackage.downpayment_amount != null && parseFloat(selectedPackage.downpayment_amount) > 0 && (
                                <p className="text-sm text-gray-700">
                                  <strong>Down payment:</strong> ₱{parseFloat(selectedPackage.downpayment_amount).toFixed(2)}
                                </p>
                              )}
                              {selectedPackage.package_price && (
                                <p className="text-sm text-gray-700">
                                  <strong>Monthly:</strong> ₱{parseFloat(selectedPackage.package_price).toFixed(2)}
                                </p>
                              )}
                            </>
                          ) : (
                            selectedPackage.package_price && (
                              <p className="text-sm text-gray-700">
                                <strong>Package Price:</strong> ₱{parseFloat(selectedPackage.package_price).toFixed(2)}
                              </p>
                            )
                          )}
                          {selectedPromo && (
                            <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded">
                              <p className="text-sm text-green-800">
                                <strong>Promo Applied:</strong> {selectedPromo.promo_name}
                                {selectedPromo.calculated_discount && (
                                  <span className="ml-2">
                                    - ₱{parseFloat(selectedPromo.calculated_discount).toFixed(2)}
                                  </span>
                                )}
                              </p>
                              {selectedPromo.final_price && (
                                <p className="text-sm font-semibold text-green-900 mt-1">
                                  Final Price: ₱{parseFloat(selectedPromo.final_price).toFixed(2)}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Promo Selection */}
                        {availablePromos.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-gray-300">
                            <h4 className="text-sm font-semibold text-gray-900 mb-2">Available Promos</h4>
                            {loadingPromos ? (
                              <div className="text-sm text-gray-500">Loading promos...</div>
                            ) : (
                              <div className="space-y-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedPromo(null)}
                                  className={`w-full text-left p-2 rounded border transition-colors ${
                                    !selectedPromo
                                      ? 'bg-[#F7C844] border-[#F7C844] text-gray-900'
                                      : 'bg-white border-gray-300 hover:border-[#F7C844]'
                                  }`}
                                >
                                  <span className="text-sm font-medium">No Promo</span>
                                </button>
                                {availablePromos.map((promo) => (
                                  <button
                                    key={promo.promo_id}
                                    type="button"
                                    onClick={() => setSelectedPromo(promo)}
                                    className={`w-full text-left p-3 rounded border transition-colors ${
                                      selectedPromo?.promo_id === promo.promo_id
                                        ? 'bg-[#F7C844] border-[#F7C844] text-gray-900'
                                        : 'bg-white border-gray-300 hover:border-[#F7C844]'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <div className="font-medium text-sm">{promo.promo_name}</div>
                                        {promo.description && (
                                          <div className="text-xs text-gray-600 mt-1">{promo.description}</div>
                                        )}
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {promo.promo_type === 'percentage_discount' && promo.discount_percentage && (
                                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                              {promo.discount_percentage}% OFF
                                            </span>
                                          )}
                                          {promo.promo_type === 'fixed_discount' && promo.discount_amount && (
                                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                              ₱{parseFloat(promo.discount_amount).toFixed(2)} OFF
                                            </span>
                                          )}
                                          {promo.merchandise && promo.merchandise.length > 0 && (
                                            <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                                              Free Items ({promo.merchandise.length})
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      {selectedPromo?.promo_id === promo.promo_id && (
                                        <svg className="w-5 h-5 text-gray-900 ml-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        
                      {selectedPackage.details && selectedPackage.details.length > 0 && (() => {
                        const { pricingDetails, includedMerchandiseTypes, paidMerchandiseTypes, merchandiseTypes } = selectedPackageDetails;
                        return (
                          <div className="mt-3 pt-3 border-t border-gray-300">
                            <p className="text-sm font-medium text-gray-900 mb-2">Package Includes:</p>
                            
                            {/* Show warning if enrolling multiple students */}
                            <div className="space-y-2">
                              {pricingDetails.map((detail, idx) => (
                                <div key={`review-pricing-${idx}`} className="text-sm text-gray-700 bg-white p-2 rounded border border-gray-200">
                                  <div>
                                    <span className="font-medium">Pricing:</span> {detail.pricing_name || detail.pricinglist_name || detail.pricinglist_id}
                                    {detail.pricing_type && <span className="text-xs ml-1 text-gray-500">({detail.pricing_type})</span>}
                                  </div>
                                </div>
                              ))}
                              {merchandiseTypes.map((typeName) => {
                                const selectionList = packageMerchSelections[typeName] || [];
                                
                                // For LCA Uniform, filter to show only one Top and one Bottom
                                // Use per-student selections if available, otherwise use package selections
                                let filteredLabels = [];
                                if (typeName === 'LCA Uniform') {
                                  // Get unique Top and Bottom selections
                                  // First, try to get from per-student selections (if students are selected)
                                  if (selectedStudents.length > 0 && Object.keys(studentMerchandiseSelections).length > 0) {
                                    // Get selections from the first student (since package selections are shared)
                                    const firstStudent = selectedStudents[0];
                                    const studentMerchSelections = studentMerchandiseSelections[firstStudent.user_id] || [];
                                    const uniformSelections = studentMerchSelections.filter(m => m.merchandise_name === 'LCA Uniform');
                                    
                                    // Group by category and get one of each
                                    const topSelection = uniformSelections.find(m => m.category === 'Top');
                                    const bottomSelection = uniformSelections.find(m => m.category === 'Bottom');
                                    
                                    if (topSelection) {
                                      const topItem = merchandise.find(item => item.merchandise_id === topSelection.merchandise_id);
                                      if (topItem) {
                                        filteredLabels.push(getMerchandiseOptionLabel(topItem));
                                      }
                                    }
                                    if (bottomSelection) {
                                      const bottomItem = merchandise.find(item => item.merchandise_id === bottomSelection.merchandise_id);
                                      if (bottomItem) {
                                        filteredLabels.push(getMerchandiseOptionLabel(bottomItem));
                                      }
                                    }
                                  } else {
                                    // Fallback to package selections - group by category and take only one of each
                                    const topItems = [];
                                    const bottomItems = [];
                                    
                                    selectionList.forEach(selection => {
                                      const merchItem = merchandise.find(item => item.merchandise_id === selection.merchandise_id);
                                      if (merchItem) {
                                        const category = getUniformCategory(merchItem);
                                        const label = getMerchandiseOptionLabel(merchItem);
                                        if (label) {
                                          if (category === 'Top' && topItems.length === 0) {
                                            topItems.push(label);
                                          } else if (category === 'Bottom' && bottomItems.length === 0) {
                                            bottomItems.push(label);
                                          }
                                        }
                                      }
                                    });
                                    
                                    filteredLabels = [...topItems, ...bottomItems];
                                  }
                                } else {
                                  // For non-uniforms, show all selections (deduplicated)
                                  const seenLabels = new Set();
                                  filteredLabels = selectionList
                                    .map(selection => {
                                      const label = getMerchandiseOptionLabel(
                                      merchandise.find(item => item.merchandise_id === selection.merchandise_id)
                                      );
                                      return label;
                                    })
                                    .filter(label => {
                                      if (!label || seenLabels.has(label)) return false;
                                      seenLabels.add(label);
                                      return true;
                                    });
                                }
                                
                                return (
                                  <div key={`review-merch-${typeName}`} className="text-sm text-gray-700 bg-white p-2 rounded border border-gray-200">
                                    <div>
                                      <span className="font-medium">Merchandise:</span> {typeName}
                                    </div>
                                    {filteredLabels.length > 0 ? (
                                      <ul className="text-xs text-gray-500 list-disc list-inside mt-1">
                                        {filteredLabels.map((label, idx) => (
                                          <li key={`${typeName}-label-${idx}`}>{label}</li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="text-xs text-gray-500 mt-1">No inventory selected.</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                      </div>

                      {/* Display Installment Settings if configured */}
                      {showInstallmentSettings && (
                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                          <h4 className="font-semibold text-blue-900 mb-3">Installment Invoice Settings</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            <div>
                              <span className="font-medium text-gray-700">Invoice Issue Date:</span>
                              <p className="text-gray-900">{installmentSettings.invoice_issue_date || '-'}</p>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Billing Month:</span>
                              <p className="text-gray-900">{installmentSettings.billing_month || '-'}</p>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Invoice Due Date:</span>
                              <p className="text-gray-900">{installmentSettings.invoice_due_date || '-'}</p>
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Invoice Generation Date:</span>
                              <p className="text-gray-900">{installmentSettings.invoice_generation_date || '-'}</p>
                            </div>
                            <div className="md:col-span-2">
                              <span className="font-medium text-gray-700">Frequency:</span>
                              <p className="text-gray-900">Every {installmentSettings.frequency_months} month(s)</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!selectedPackage && (selectedPricingLists.length > 0 || selectedMerchandise.length > 0 || (selectedEnrollmentOption === 'per-phase' && perPhaseAmount)) && (
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                      <h4 className="font-semibold text-gray-900 mb-3">Selected Items</h4>
                      
                      {/* Per-Phase Amount */}
                      {selectedEnrollmentOption === 'per-phase' && perPhaseAmount && (
                        <div className="mb-4 pb-4 border-b border-gray-300">
                          <p className="text-sm font-medium text-gray-700 mb-1">Per-Phase Amount:</p>
                          <p className="text-sm text-gray-900 font-semibold">
                            ₱{parseFloat(perPhaseAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      )}
                      
                      {/* Pricing Lists */}
                      {selectedPricingLists.length > 0 && (
                        <div className="mb-4">
                          <p className="text-sm font-medium text-gray-700 mb-2">Pricing Lists:</p>
                          <div className="bg-white rounded-lg border border-gray-200 p-3">
                            <ul className="space-y-2">
                            {pricingLists
                              .filter(p => selectedPricingLists.includes(p.pricinglist_id))
                                .map((pricing) => {
                                  const price = pricing.price ? parseFloat(pricing.price) : 0;
                                  return (
                                    <li key={pricing.pricinglist_id} className="flex justify-between items-center text-sm">
                                      <span className="text-gray-700">{pricing.name}</span>
                                      <span className="text-gray-900 font-semibold">
                                        ₱{price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                </li>
                                  );
                                })}
                          </ul>
                          </div>
                        </div>
                      )}
                      
                      {/* Merchandise */}
                      {(() => {
                        // For per-phase enrollment, collect merchandise from per-student selections
                        // For other enrollments, use selectedMerchandise
                        let merchandiseToShow = [];
                        
                        if (selectedEnrollmentOption === 'per-phase' && selectedStudents.length > 0 && Object.keys(studentMerchandiseSelections).length > 0) {
                          // Collect all unique merchandise from per-student selections
                          const merchMap = new Map();
                          selectedStudents.forEach(student => {
                            const studentMerchSelections = studentMerchandiseSelections[student.user_id] || [];
                            studentMerchSelections.forEach(merchSelection => {
                              if (merchSelection.merchandise_id) {
                                const merchItem = merchandise.find(m => m.merchandise_id === merchSelection.merchandise_id);
                                if (merchItem) {
                                  const key = merchSelection.merchandise_name === 'LCA Uniform' && merchSelection.category
                                    ? `${merchSelection.merchandise_name}-${merchSelection.category}-${merchSelection.size}`
                                    : `${merchSelection.merchandise_name}-${merchSelection.size || 'no-size'}`;
                                  
                                  if (!merchMap.has(key)) {
                                    merchMap.set(key, {
                                      merchandise_name: merchSelection.merchandise_name,
                                      size: merchSelection.size,
                                      category: merchSelection.category,
                                      price: merchItem.price,
                                      count: 1
                                    });
                                  } else {
                                    merchMap.get(key).count += 1;
                                  }
                                }
                              }
                            });
                          });
                          merchandiseToShow = Array.from(merchMap.values());
                        } else {
                          // Use selectedMerchandise for other enrollment types
                          merchandiseToShow = selectedMerchandise.map(selected => {
                              let item = null;
                              if (selected.merchandise_name === 'LCA Uniform' && selected.size) {
                                item = merchandise.find(
                                  m => m.merchandise_name === selected.merchandise_name && m.size === selected.size
                                );
                              } else {
                                item = merchandise.find(
                                  m => m.merchandise_name === selected.merchandise_name
                                );
                              }
                            return {
                              merchandise_name: selected.merchandise_name,
                              size: selected.size,
                              category: selected.category,
                              price: item?.price || 0,
                              count: selectedStudents.length > 0 ? selectedStudents.length : 1
                            };
                          });
                        }
                        
                        if (merchandiseToShow.length === 0) return null;
                        
                              return (
                          <div>
                            <p className="text-sm font-medium text-gray-700 mb-2">Merchandise:</p>
                            <div className="bg-white rounded-lg border border-gray-200 p-3">
                              <ul className="space-y-2">
                                {merchandiseToShow.map((merch, idx) => {
                                  const displayName = merch.merchandise_name === 'LCA Uniform' && merch.category
                                    ? `${merch.merchandise_name} - ${merch.category}`
                                    : merch.merchandise_name;
                                  const sizeText = merch.size ? ` (${merch.size})` : '';
                                  const countText = merch.count > 1 ? ` x${merch.count}` : '';
                                  const totalPrice = parseFloat(merch.price || 0) * merch.count;
                                  
                                  return (
                                    <li key={idx} className="flex justify-between items-center text-sm">
                                      <span className="text-gray-700">
                                        {displayName}{sizeText}{countText}
                                      </span>
                                      <span className="text-gray-900 font-semibold">
                                        ${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                </li>
                              );
                            })}
                          </ul>
                            </div>
                          </div>
                        );
                      })()}
                      
                      {/* Total Amount for Per-Phase Enrollment (hidden when using Phase packages) */}
                      {selectedEnrollmentOption === 'per-phase' && !selectedPackage && (
                        <div className="mt-4 pt-4 border-t-2 border-gray-300">
                          <div className="flex justify-between items-center">
                            <p className="text-base font-bold text-gray-900">Total Amount:</p>
                            <p className="text-lg font-bold text-blue-700">
                              ${calculatePerPhaseTotal().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {generatedInvoices.length > 0 && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <h4 className="font-semibold text-green-900 mb-3">
                        Enrollment Successful - {generatedInvoices.length} Invoice(s) Generated
                      </h4>
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {generatedInvoices.map((item, idx) => (
                          <div key={idx} className="bg-white p-3 rounded border border-green-200">
                            <p className="text-sm font-medium text-gray-900 mb-2">
                              {item.student.full_name}
                            </p>
                            <div className="space-y-1 text-xs">
                              <p><strong>Invoice ID:</strong> {item.invoice.invoice_id}</p>
                              <p><strong>Description:</strong> {item.invoice.invoice_description}</p>
                              <p><strong>Total Amount:</strong> ₱{parseFloat(item.invoice.amount || 0).toFixed(2)}</p>
                              <p><strong>Status:</strong> {item.invoice.status}</p>
                              {item.invoice.items && item.invoice.items.length > 0 && (
                                <div className="mt-2">
                                  <p className="font-medium mb-1">Items:</p>
                                  <ul className="list-disc list-inside space-y-0.5">
                                    {item.invoice.items.map((invoiceItem, itemIdx) => (
                                      <li key={itemIdx}>
                                        {invoiceItem.description} - ₱{parseFloat(invoiceItem.amount || 0).toFixed(2)}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-2 p-3 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
              {enrollStep === 'view' && (
                <button
                  type="button"
                  onClick={closeEnrollModal}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Close
                </button>
              )}
              {enrollStep === 'package-selection' && (
                <button
                  type="button"
                  onClick={() => {
                    // Clear package selection when going back
                    setSelectedPackage(null);
                    setPackageMerchSelections({});
                    setShowPackageDetails(false);
                    setShowInstallmentSettings(false);
                    updateInstallmentSettings({
                      invoice_issue_date: '',
                      billing_month: '',
                      invoice_due_date: '',
                      invoice_generation_date: '',
                    });
                    setEnrollStep('enrollment-option');
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  disabled={enrollSubmitting}
                >
                  Back
                </button>
              )}
              {enrollStep !== 'view' && enrollStep !== 'enrollment-option' && enrollStep !== 'package-selection' && !(enrollStep === 'review' && generatedInvoices.length > 0) && (
                <div className="flex items-center gap-3">
                  {/* Total Amount Display - For per-phase enrollment in student-selection and review steps */}
                  {(enrollStep === 'student-selection' || enrollStep === 'review') && (
                    <>
                      {selectedEnrollmentOption === 'per-phase' && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                          <span className="text-xs font-medium text-blue-900">Total Amount:</span>
                          <span className="text-sm font-bold text-blue-700">
                            ${calculatePerPhaseTotal().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                <button
                  type="button"
                  onClick={() => {
                    if (enrollStep === 'student-selection') {
                      if (selectedEnrollmentOption === 'package' || selectedEnrollmentOption === 'reservation') {
                        // Don't clear package when going back to package-selection
                        setEnrollStep('package-selection');
                      } else {
                        // Clear package-related state when going back to enrollment-option from student-selection
                        setSelectedPackage(null);
                        setPackageMerchSelections({});
                        setShowPackageDetails(false);
                        setShowInstallmentSettings(false);
                        updateInstallmentSettings({
                          invoice_issue_date: '',
                          billing_month: '',
                          invoice_due_date: '',
                          invoice_generation_date: '',
                        });
                        setEnrollStep('enrollment-option');
                      }
                    } else if (enrollStep === 'review') {
                      setEnrollStep('student-selection');
                    }
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  disabled={enrollSubmitting}
                >
                  Back
                </button>
                </div>
              )}
              {enrollStep === 'student-selection' && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedStudents.length === 0) {
                      alert('Please select a student to continue');
                      return;
                    }
                    
                    // Validate per-phase enrollment requirements
                    if (selectedEnrollmentOption === 'per-phase') {
                      if (selectedPhaseNumber === null || selectedPhaseNumber === undefined) {
                        alert('Please select a phase for per-phase enrollment');
                        return;
                      }
                      if (!perPhaseAmount || parseFloat(perPhaseAmount) <= 0) {
                        alert('Please enter a valid amount for per-phase enrollment');
                        return;
                      }
                    }
                    
                    // Validate installment settings if toggle is enabled
                    if (showInstallmentSettings) {
                      if (!installmentSettings.invoice_issue_date || 
                          !installmentSettings.billing_month || 
                          !installmentSettings.invoice_due_date || 
                          !installmentSettings.invoice_generation_date) {
                        alert('Please fill in all installment settings fields');
                        return;
                      }
                    }
                    
                    // Validate uniform size selection if package includes uniforms
                    if (selectedPackage && selectedStudents.length > 0) {
                      const { merchandiseTypes } = groupPackageDetails(selectedPackage.details || []);
                      // Check all merchandise types that require sizing
                      const uniformsRequiringSizing = merchandiseTypes.filter(typeName => requiresSizingForMerchandise(typeName));
                      
                      if (uniformsRequiringSizing.length > 0) {
                        // Check if all students have uniform sizes selected
                        for (const student of selectedStudents) {
                          const studentMerchSelections = studentMerchandiseSelections[student.user_id] || [];
                          
                          // Validate each uniform type that requires sizing
                          for (const typeName of uniformsRequiringSizing) {
                            const uniformItems = getMerchandiseItemsByType(typeName);
                            const hasSizes = uniformItems.some(item => item.size);
                            
                            if (hasSizes) {
                              // Check if uniform categories exist (for LCA Uniform with Top/Bottom)
                              const uniformCategories = Array.from(
                                new Set(
                                  uniformItems
                                    .map(item => getUniformCategory(item))
                                    .filter(category => category && category !== 'General')
                                )
                              );
                              
                              if (uniformCategories.length > 0) {
                                // Check that each category has a size selected for this student
                                for (const category of uniformCategories) {
                                  const categorySelection = studentMerchSelections.find(m => 
                                    m.merchandise_name === typeName && m.category === category
                                  );
                                  
                                  if (!categorySelection || !categorySelection.size || categorySelection.size.trim() === '') {
                                    alert(`Please select a size for ${typeName} (${category}) for student: ${student.full_name}`);
                                    return;
                                  }
                                }
                              } else {
                                // No categories, just check for any uniform selection with size
                                const uniformSelection = studentMerchSelections.find(m => 
                                  m.merchandise_name === typeName
                                );
                                
                                if (!uniformSelection || !uniformSelection.size || uniformSelection.size.trim() === '') {
                                  alert(`Please select a size for ${typeName} for student: ${student.full_name}`);
                                  return;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                    
                    setEnrollStep('review');
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  disabled={selectedStudents.length === 0}
                >
                  Continue {selectedStudents.length > 0 ? `(1 selected)` : '(0 selected)'}
                </button>
              )}
              {enrollStep !== 'view' && (
                <button
                  type="button"
                  onClick={() => {
                    if (generatedInvoices.length > 0) {
                      // Reset and go back to view
                      setEnrollStep('view');
                      setGeneratedInvoices([]);
                      setSelectedPackage(null);
                      setSelectedStudents([]);
                      setSelectedPricingLists([]);
                      setSelectedMerchandise([]);
                      setStudentSearchTerm('');
                      setShowStudentDropdown(false);
                      if (selectedClassForEnrollment) {
                        fetchEnrolledStudents(selectedClassForEnrollment.class_id);
                      }
                    } else {
                      closeEnrollModal();
                    }
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  disabled={enrollSubmitting}
                >
                  {generatedInvoices.length > 0 ? 'Back to List' : 'Cancel'}
                </button>
              )}
              {enrollStep === 'review' && generatedInvoices.length === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedStudents.length === 0) {
                      alert('Please select a student');
                      setEnrollStep('student-selection');
                      return;
                    }
                    handleEnrollSubmit();
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  disabled={enrollSubmitting || selectedStudents.length === 0}
                >
                  {enrollSubmitting ? (
                    <span className="flex items-center space-x-2">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Enrolling...</span>
                    </span>
                  ) : (
                    `Enroll Student & Generate Invoice`
                  )}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Merge Class Modal */}
      {isMergeModalOpen && selectedClassForMerge && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeMergeModal}
        >
          <div className="flex items-start justify-center gap-4 w-full max-w-7xl">
          <div 
            className="bg-white rounded-lg shadow-xl relative z-[101] max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {mergeStep === 'select-class' && 'Select Class to Merge'}
                  {mergeStep === 'choose-schedule' && 'Choose Schedule'}
                  {mergeStep === 'review' && 'Review Merge'}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Merge classes with the same phase number and level tag
                </p>
              </div>
              <button
                onClick={closeMergeModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {/* Step 1: Select Class to Merge */}
              {mergeStep === 'select-class' && (
                <div className="space-y-6">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h3 className="font-semibold text-blue-900 mb-2">{selectedClassForMerge.class_name || selectedClassForMerge.level_tag}</h3>
                    <div className="space-y-1 text-sm text-blue-800">
                      <p><strong>Program:</strong> {selectedClassForMerge.program_name}</p>
                      <p><strong>Program Code:</strong> {selectedClassForMerge.program_code || '-'}</p>
                      <p><strong>Level Tag:</strong> {selectedClassForMerge.level_tag}</p>
                      <p><strong>Phase:</strong> {selectedClassForMerge.class_phase_number ? `Phase ${selectedClassForMerge.class_phase_number}` : 'Phase 1'}</p>
                      <p><strong>Enrolled Students:</strong> {selectedClassForMerge.enrolled_students || 0}</p>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Select Classes to Merge With
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Select multiple classes to merge. Selected classes will have their schedules temporarily inactivated.
                    </p>
                    {mergeTargetClasses.length === 0 ? (
                      <div className="p-8 bg-gray-50 rounded-lg border border-gray-200 text-center">
                        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <h3 className="mt-2 text-sm font-medium text-gray-900">No mergeable classes found</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          No other classes found with the same phase number ({selectedClassForMerge.class_phase_number || 'N/A'}) and level tag ({selectedClassForMerge.level_tag || 'N/A'}).
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {mergeTargetClasses.map((targetClass) => {
                          const isSelected = selectedMergeTargetClasses.some(c => c.class_id === targetClass.class_id);
                          const hasInactivatedSchedule = classesWithInactivatedSchedules.has(targetClass.class_id);
                          
                          return (
                            <label
                            key={targetClass.class_id}
                              className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                                isSelected
                                  ? 'border-primary-500 bg-primary-50'
                                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                              } ${hasInactivatedSchedule ? 'opacity-75' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleMergeTargetToggle(targetClass)}
                                className="mt-1 mr-3 w-5 h-5 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                              />
                              <div className="flex-1">
                            <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                <h5 className="font-semibold text-gray-900">{targetClass.program_name}</h5>
                                <div className="mt-1 space-y-0.5 text-sm text-gray-600">
                                  <p><strong>Program Code:</strong> {targetClass.program_code || '-'}</p>
                                  <p><strong>Class Name:</strong> {targetClass.class_name || targetClass.level_tag}</p>
                                  <p><strong>Level Tag:</strong> {targetClass.level_tag}</p>
                                  <p><strong>Phase:</strong> {targetClass.class_phase_number ? `Phase ${targetClass.class_phase_number}` : 'Phase 1'}</p>
                                  <p><strong>Enrolled Students:</strong> {targetClass.enrolled_students || 0}</p>
                                </div>
                              </div>
                                </div>
                                {hasInactivatedSchedule && (
                                  <div className="mt-2 inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                                    Schedule temporarily inactivated
                            </div>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {selectedMergeTargetClasses.length > 0 && (
                      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800">
                          <strong>{selectedMergeTargetClasses.length}</strong> class{selectedMergeTargetClasses.length !== 1 ? 'es' : ''} selected for merge.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Configure Schedule */}
              {mergeStep === 'choose-schedule' && selectedMergeTargetClasses.length > 0 && (
                <div className="space-y-6">
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm text-yellow-800">
                      <strong>Note:</strong> Configure the schedule for the merged class. The source class schedule is shown below and can be manually edited.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Level Tag (Read-only) */}
                    <div>
                      <label htmlFor="merge_level_tag" className="label-field">
                        Level Tag
                      </label>
                      <input
                        type="text"
                        id="merge_level_tag"
                        value={selectedClassForMerge.level_tag || ''}
                        readOnly
                        className="input-field bg-gray-50 cursor-not-allowed"
                        disabled
                      />
                      <p className="mt-1 text-xs text-gray-500">Level tag cannot be changed (must match for merge)</p>
                    </div>

                    {/* Class Name (Editable) */}
                    <div>
                      <label htmlFor="merge_class_name" className="label-field">
                        Class Name
                      </label>
                      <input
                        type="text"
                        id="merge_class_name"
                        value={mergeFormData.class_name}
                        onChange={(e) => setMergeFormData(prev => ({ ...prev, class_name: e.target.value }))}
                        className="input-field"
                        placeholder="Enter class name for merged class"
                        maxLength={100}
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Current: Source "{selectedClassForMerge.class_name || selectedClassForMerge.level_tag}"
                        {selectedMergeTargetClasses.length > 0 && (
                          <> & {selectedMergeTargetClasses.map(c => c.class_name || c.level_tag).join(' & ')}</>
                        )}
                      </p>
                    </div>

                    {/* Teachers (Multiple Selection with Dropdown) */}
                    <div>
                      <label htmlFor="merge_teacher_search" className="label-field">
                        Teachers <span className="text-gray-500 font-normal text-xs">(Optional - Can select multiple)</span>
                      </label>
                      <div className="relative">
                        {/* Multi-select input container with chips */}
                        <div 
                          className="min-h-[42px] w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus-within:border-[#F7C844] focus-within:ring-2 focus-within:ring-[#F7C844] focus-within:ring-opacity-20 transition-all flex flex-wrap items-center gap-2 cursor-text"
                          onClick={() => {
                            // Focus the input when clicking on the container
                            const input = document.getElementById('merge_teacher_search');
                            if (input) input.focus();
                          }}
                        >
                          {/* Selected Teachers as Pills */}
                          {mergeFormData.teacher_ids.map((teacherIdStr) => {
                            const teacher = teachers.find(t => t.user_id.toString() === teacherIdStr);
                            if (!teacher) return null;
                            return (
                              <span
                                key={teacher.user_id}
                                className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#F7C844] text-gray-900 text-sm font-medium rounded-full"
                              >
                              {teacher.full_name}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMergeFormData(prev => ({
                                      ...prev,
                                      teacher_ids: prev.teacher_ids.filter(id => id !== teacherIdStr)
                                    }));
                                  }}
                                  className="hover:bg-[#F5B82E] rounded-full p-0.5 transition-colors flex items-center justify-center"
                                  title="Remove teacher"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </span>
                            );
                          })}
                          
                          {/* Search Input */}
                          <div className="flex-1 min-w-[120px] relative">
                            <div className="absolute inset-y-0 left-0 pl-0 flex items-center pointer-events-none">
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                              </svg>
                            </div>
                            <input
                              type="text"
                              id="merge_teacher_search"
                              value={teacherSearchTerm}
                              onChange={(e) => {
                                setTeacherSearchTerm(e.target.value);
                                setShowTeacherDropdown(true);
                              }}
                              onFocus={() => setShowTeacherDropdown(true)}
                              placeholder={mergeFormData.teacher_ids.length === 0 ? "Search by name or branch..." : ""}
                              className="w-full pl-6 pr-2 py-1 text-sm border-none outline-none bg-transparent"
                            />
                          </div>
                        </div>
                        
                        {showTeacherDropdown && (
                          <>
                            {(() => {
                              // Filter teachers: exclude already selected and filter by search term
                              const filteredTeachers = teachers.filter((teacher) => {
                                // Exclude already selected teachers
                                const isSelected = mergeFormData.teacher_ids.includes(teacher.user_id.toString());
                                if (isSelected) return false;
                                
                                // Filter by search term
                                if (teacherSearchTerm) {
                                  const searchLower = teacherSearchTerm.toLowerCase();
                                  const teacherName = teacher.full_name?.toLowerCase() || '';
                                  const branchName = selectedBranchName?.toLowerCase() || '';
                                  if (!teacherName.includes(searchLower) && !branchName.includes(searchLower)) {
                                    return false;
                                  }
                                }
                                return true;
                              });

                              return filteredTeachers.length > 0 ? (
                                <div className="teacher-dropdown-container absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                                  <div className="py-1">
                                    {filteredTeachers.map((teacher) => {
                                      return (
                                        <button
                                          key={teacher.user_id}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const teacherIdStr = teacher.user_id.toString();
                                            setMergeFormData(prev => ({
                                              ...prev,
                                              teacher_ids: [...prev.teacher_ids, teacherIdStr]
                                            }));
                                            setTeacherSearchTerm('');
                                            setShowTeacherDropdown(false);
                                          }}
                                          className="w-full flex items-center space-x-2 px-3 py-2 mx-1 my-0.5 rounded-lg transition-all hover:bg-gray-50 text-left"
                                        >
                                          <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium text-gray-900 truncate">{teacher.full_name}</div>
                                            {teacher.branch_id && (
                                              <div className="text-xs text-gray-500 truncate">
                                                {selectedBranchName}
                                              </div>
                                            )}
                                          </div>
                                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                          </svg>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <div className="teacher-dropdown-container absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                                  <div className="px-4 py-3 text-sm text-gray-500 text-center">
                                    {teacherSearchTerm 
                                      ? `No teachers found matching "${teacherSearchTerm}"`
                                      : 'No more teachers available'}
                                  </div>
                                </div>
                              );
                            })()}
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Current: {selectedClassForMerge.teacher_name || 'None'} 
                        {selectedMergeTargetClasses.map(c => c.teacher_name).filter(Boolean).map(name => ` / ${name}`).join('')}
                      </p>
                    </div>

                    {/* Room Selection */}
                    <div>
                      <label htmlFor="merge_room_id" className="label-field">
                        Room <span className="text-red-500">*</span>
                      </label>
                      <select
                        id="merge_room_id"
                        value={mergeFormData.room_id}
                        onChange={(e) => {
                          setMergeFormData(prev => ({ ...prev, room_id: e.target.value }));
                          // Fetch room schedules when room changes, excluding classes involved in merge
                          const mergeClassIds = [
                            selectedClassForMerge.class_id,
                            ...selectedMergeTargetClasses.map(c => c.class_id)
                          ];
                          fetchRoomSchedules(e.target.value, mergeClassIds);
                        }}
                        className="input-field"
                        required
                      >
                        <option value="">Select Room</option>
                        {rooms
                          .filter(room => room.branch_id === selectedClassForMerge.branch_id)
                          .map((room) => (
                            <option key={room.room_id} value={room.room_id}>
                              {room.room_name}
                            </option>
                          ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        Select a room for the merged class. Only rooms from the same branch are shown.
                      </p>
                    </div>

                    {/* Schedule Configuration Option */}
                    <div>
                      <label className="label-field">
                        Schedule Configuration <span className="text-red-500">*</span>
                      </label>
                      <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="schedule-mode"
                              checked={useSourceSchedule}
                              onChange={() => {
                                setUseSourceSchedule(true);
                                // Reset manual schedule to source schedule when switching
                                if (sourceClassSchedule.length > 0) {
                                  setManualSchedule(sourceClassSchedule.map(day => ({ ...day })));
                                }
                              }}
                              className="w-4 h-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                            />
                            <span className="text-sm font-medium text-gray-700">
                              Use {selectedClassForMerge?.class_name || selectedClassForMerge?.level_tag || 'Source Class'} Schedule
                            </span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="schedule-mode"
                              checked={!useSourceSchedule}
                              onChange={() => {
                                setUseSourceSchedule(false);
                                // Clear conflicts when switching to manual (will be recalculated by useEffect)
                                setMergeScheduleConflicts([]);
                              }}
                              className="w-4 h-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                            />
                            <span className="text-sm font-medium text-gray-700">Manual Schedule Setup</span>
                          </label>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          {useSourceSchedule 
                            ? `The merged class will use the same schedule as ${selectedClassForMerge?.class_name || selectedClassForMerge?.level_tag || 'the source class'}.`
                            : 'You can manually configure the schedule for the merged class.'}
                        </p>
                      </div>

                      {/* Source Schedule Display (Read-only when selected) */}
                      {useSourceSchedule && sourceClassSchedule.length > 0 && (
                        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                          <h4 className="text-sm font-semibold text-blue-900 mb-3">
                            {selectedClassForMerge?.class_name || selectedClassForMerge?.level_tag || 'Source Class'} Schedule
                          </h4>
                          <div className="space-y-2">
                            {sourceClassSchedule.map((daySchedule, idx) => (
                              daySchedule.start_time && daySchedule.end_time ? (
                                <div key={idx} className="flex items-center justify-between p-2 bg-white rounded border border-blue-100">
                                  <span className="text-sm font-medium text-gray-700">{daySchedule.day_of_week}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-600">
                                      {daySchedule.start_time.substring(0, 5)} - {daySchedule.end_time.substring(0, 5)}
                                    </span>
                                    {(() => {
                                      // Calculate duration
                                      const start = new Date(`2000-01-01T${daySchedule.start_time}`);
                                      const end = new Date(`2000-01-01T${daySchedule.end_time}`);
                                      const diffMs = end - start;
                                      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                                      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                                      const duration = diffHours > 0 
                                        ? `${diffHours}h ${diffMinutes > 0 ? diffMinutes + 'm' : ''}`.trim()
                                        : `${diffMinutes}m`;
                                      return (
                                        <span className="text-xs font-medium text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                                          {duration}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                </div>
                              ) : null
                            ))}
                            {sourceClassSchedule.filter(s => s.start_time && s.end_time).length === 0 && (
                              <p className="text-sm text-gray-500 italic">No schedule configured for source class</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Manual Schedule Configuration */}
                      {!useSourceSchedule && (
                        <div className="space-y-3">
                          {/* Schedule Conflict Warnings */}
                          {mergeScheduleConflicts.length > 0 && (
                            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <svg className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <div className="flex-1">
                                  <h4 className="text-sm font-semibold text-red-900 mb-2">
                                    Schedule Conflicts Detected
                                  </h4>
                                  <p className="text-xs text-red-800 mb-2">
                                    The selected schedule overlaps with existing classes. Please choose a different time slot or room.
                                  </p>
                                  <div className="space-y-1">
                                    {mergeScheduleConflicts.map((conflict, idx) => (
                                      <div key={idx} className="text-xs text-red-700 bg-red-100 p-2 rounded">
                                        <strong>{conflict.day}</strong> {conflict.start_time} - {conflict.end_time}: {conflict.message}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((dayName) => {
                          const daySchedule = manualSchedule.find(d => d.day_of_week === dayName) || { day_of_week: dayName, start_time: '', end_time: '' };
                          const dayIndex = manualSchedule.findIndex(d => d.day_of_week === dayName);
                          // Get source schedule for this day to preserve duration
                          const sourceDaySchedule = sourceClassSchedule.find(d => d.day_of_week === dayName);
                          
                          // Helper function to calculate end time based on source duration
                          const getDefaultTimes = () => {
                            if (sourceDaySchedule && sourceDaySchedule.start_time && sourceDaySchedule.end_time) {
                              // Use source class times to preserve duration
                              return {
                                start_time: sourceDaySchedule.start_time,
                                end_time: sourceDaySchedule.end_time
                              };
                            }
                            // Default fallback if no source schedule
                            return {
                              start_time: '09:00:00',
                              end_time: '17:00:00'
                            };
                          };
                          
                          return (
                            <div key={dayName} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                              <div className="flex items-center gap-2 min-w-[120px]">
                                <input
                                  type="checkbox"
                                  checked={daySchedule.start_time && daySchedule.end_time ? true : false}
                                  onChange={(e) => {
                                    const newSchedule = [...manualSchedule];
                                    if (e.target.checked) {
                                      // If source schedule exists for this day, use it with calculated end time
                                      if (sourceDaySchedule && sourceDaySchedule.start_time && sourceDaySchedule.end_time) {
                                        const defaultTimes = getDefaultTimes();
                                        // Calculate duration from source
                                        const sourceStart = new Date(`2000-01-01T${sourceDaySchedule.start_time}`);
                                        const sourceEnd = new Date(`2000-01-01T${sourceDaySchedule.end_time}`);
                                        const durationMs = sourceEnd - sourceStart;
                                        // Apply same duration to default start time
                                        const newStart = new Date(`2000-01-01T${defaultTimes.start_time}`);
                                        const calculatedEnd = new Date(newStart.getTime() + durationMs);
                                        const endTime = calculatedEnd.toTimeString().substring(0, 8);
                                        if (dayIndex >= 0) {
                                          newSchedule[dayIndex] = { ...newSchedule[dayIndex], start_time: defaultTimes.start_time, end_time: endTime };
                                        } else {
                                          newSchedule.push({ day_of_week: dayName, start_time: defaultTimes.start_time, end_time: endTime });
                                        }
                                      } else {
                                        // No source schedule - start with default start time and 00:00:00 end time
                                        // End time will be calculated when user sets start time
                                        const defaultTimes = getDefaultTimes();
                                        if (dayIndex >= 0) {
                                          newSchedule[dayIndex] = { ...newSchedule[dayIndex], start_time: defaultTimes.start_time, end_time: '00:00:00' };
                                        } else {
                                          newSchedule.push({ day_of_week: dayName, start_time: defaultTimes.start_time, end_time: '00:00:00' });
                                        }
                                      }
                                    } else {
                                      if (dayIndex >= 0) {
                                        newSchedule[dayIndex] = { ...newSchedule[dayIndex], start_time: '', end_time: '' };
                                      }
                                    }
                                    setManualSchedule(newSchedule);
                                  }}
                                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                                />
                                <label className="text-sm font-medium text-gray-700">{dayName}</label>
                                </div>
                              {daySchedule.start_time && daySchedule.end_time ? (
                                <div className="flex items-center gap-2 flex-1">
                                  <input
                                    type="time"
                                    value={daySchedule.start_time.substring(0, 5)}
                                    onChange={(e) => {
                                      const newSchedule = [...manualSchedule];
                                      const timeValue = e.target.value + ':00';
                                      // Calculate end time based on source class duration
                                      let newEndTime = '00:00:00';
                                      if (sourceDaySchedule && sourceDaySchedule.start_time && sourceDaySchedule.end_time) {
                                        // Calculate duration from source class (e.g., 3 hours)
                                        const sourceStart = new Date(`2000-01-01T${sourceDaySchedule.start_time}`);
                                        const sourceEnd = new Date(`2000-01-01T${sourceDaySchedule.end_time}`);
                                        const durationMs = sourceEnd - sourceStart;
                                        // Apply same duration to new start time
                                        const newStart = new Date(`2000-01-01T${timeValue}`);
                                        const calculatedEnd = new Date(newStart.getTime() + durationMs);
                                        newEndTime = calculatedEnd.toTimeString().substring(0, 8);
                                      } else {
                                        // Default 3-hour duration if no source schedule
                                        const newStart = new Date(`2000-01-01T${timeValue}`);
                                        const calculatedEnd = new Date(newStart.getTime() + (3 * 60 * 60 * 1000)); // 3 hours
                                        newEndTime = calculatedEnd.toTimeString().substring(0, 8);
                                      }
                                      
                                      if (dayIndex >= 0) {
                                        newSchedule[dayIndex] = { ...newSchedule[dayIndex], start_time: timeValue, end_time: newEndTime };
                                      } else {
                                        newSchedule.push({ day_of_week: dayName, start_time: timeValue, end_time: newEndTime });
                                      }
                                      setManualSchedule(newSchedule);
                                    }}
                                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                  />
                                  <span className="text-gray-500">to</span>
                                  <input
                                    type="time"
                                    value={daySchedule.end_time ? daySchedule.end_time.substring(0, 5) : '00:00'}
                                    readOnly
                                    disabled
                                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-gray-50 cursor-not-allowed text-gray-600"
                                    title="End time is automatically calculated based on start time and source class duration"
                                  />
                                  {(() => {
                                    // Calculate duration
                                    const start = new Date(`2000-01-01T${daySchedule.start_time}`);
                                    const end = new Date(`2000-01-01T${daySchedule.end_time}`);
                                    const diffMs = end - start;
                                    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                                    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                                    const duration = diffHours > 0 
                                      ? `${diffHours}h ${diffMinutes > 0 ? diffMinutes + 'm' : ''}`.trim()
                                      : `${diffMinutes}m`;
                                    return (
                                      <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
                                        {duration}
                                      </span>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <span className="text-sm text-gray-400 italic">Not scheduled</span>
                              )}
                            </div>
                          );
                        })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Review */}
              {mergeStep === 'review' && selectedMergeTargetClasses.length > 0 && (
                <div className="space-y-6">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h3 className="font-semibold text-green-900 mb-3">Merge Summary</h3>
                    <div className="space-y-2 text-sm text-green-800">
                      <p><strong>Phase Number:</strong> {selectedClassForMerge.class_phase_number || 'N/A'} (must match)</p>
                      <p><strong>Level Tag:</strong> {selectedClassForMerge.level_tag} (must match, read-only)</p>
                      <p><strong>Class Name:</strong> {mergeFormData.class_name || '(Empty)'}</p>
                      <p><strong>Teachers:</strong> {
                        mergeFormData.teacher_ids && mergeFormData.teacher_ids.length > 0
                          ? mergeFormData.teacher_ids.map(id => {
                              const teacher = teachers.find(t => t.user_id === parseInt(id));
                              return teacher?.full_name || `Teacher ${id}`;
                            }).join(', ')
                          : 'None'
                      }</p>
                      <p><strong>Total Students to Merge:</strong> {
                        (() => {
                          // Calculate unique student count by parsing enrolled_students correctly
                          const sourceCount = parseInt(String(selectedClassForMerge.enrolled_students || 0), 10) || 0;
                          const targetCount = selectedMergeTargetClasses.reduce((sum, c) => {
                            const count = parseInt(String(c.enrolled_students || 0), 10) || 0;
                            return sum + count;
                          }, 0);
                          // Note: This is the sum of enrollments, not unique students
                          // If students are enrolled in multiple classes, they'll be counted multiple times
                          // The backend will handle deduplication during merge
                          return sourceCount + targetCount;
                        })()
                      }</p>
                      <p><strong>Total Classes to Merge:</strong> {selectedMergeTargetClasses.length + 1}</p>
                      <p><strong>Room:</strong> {
                        mergeFormData.room_id 
                          ? rooms.find(r => r.room_id === parseInt(mergeFormData.room_id))?.room_name || 'N/A'
                          : 'Not selected'
                      }</p>
                      <p><strong>Schedule:</strong> {useSourceSchedule ? `Using ${selectedClassForMerge?.class_name || selectedClassForMerge?.level_tag || 'source class'} schedule` : 'Manually configured schedule'}</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Classes to Merge</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 bg-blue-50 border-2 border-blue-300 rounded-lg">
                        <h5 className="font-semibold text-blue-900 mb-2">{selectedClassForMerge.class_name || selectedClassForMerge.level_tag}</h5>
                        <div className="space-y-1 text-sm text-blue-800">
                        <p><strong>Program:</strong> {selectedClassForMerge.program_name}</p>
                        <p><strong>Students:</strong> {selectedClassForMerge.enrolled_students || 0}</p>
                        <p><strong>Room:</strong> {selectedClassForMerge.room_name || 'N/A'}</p>
                      </div>
                    </div>

                      {selectedMergeTargetClasses.map((targetClass) => (
                        <div key={targetClass.class_id} className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                          <h5 className="font-semibold text-gray-900 mb-2">{targetClass.class_name || targetClass.level_tag}</h5>
                      <div className="space-y-1 text-sm text-gray-700">
                            <p><strong>Program:</strong> {targetClass.program_name}</p>
                            <p><strong>Students:</strong> {targetClass.enrolled_students || 0}</p>
                            <p><strong>Room:</strong> {targetClass.room_name || 'N/A'}</p>
                      </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <h4 className="font-semibold text-gray-900 mb-2">
                      Configured Schedule {useSourceSchedule && <span className="text-xs font-normal text-blue-600">(Using {selectedClassForMerge?.class_name || selectedClassForMerge?.level_tag || 'Source Class'} Schedule)</span>}
                    </h4>
                    <div className="space-y-1 text-sm text-gray-700">
                      {(() => {
                        const scheduleToDisplay = useSourceSchedule ? sourceClassSchedule : manualSchedule;
                        return scheduleToDisplay.filter(d => d.start_time && d.end_time).length > 0 ? (
                          scheduleToDisplay
                            .filter(d => d.start_time && d.end_time)
                            .map((day, idx) => (
                              <p key={idx}>
                                <strong>{day.day_of_week}:</strong> {formatTime(day.start_time)} - {formatTime(day.end_time)}
                              </p>
                            ))
                        ) : (
                          <p className="text-gray-500 italic">No schedule configured</p>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-800">
                      <strong>Warning:</strong> This action cannot be undone. All original classes ({selectedMergeTargetClasses.length + 1} total) will be deleted and all students will be moved to a new merged class with the configured schedule.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
              {mergeStep !== 'select-class' && (
                <button
                  type="button"
                  onClick={() => {
                    if (mergeStep === 'choose-schedule') {
                      setMergeStep('select-class');
                    } else if (mergeStep === 'review') {
                      setMergeStep('choose-schedule');
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  disabled={mergeSubmitting}
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={closeMergeModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                disabled={mergeSubmitting}
              >
                Cancel
              </button>
              {mergeStep === 'select-class' && (
                <button
                  type="button"
                  onClick={handleContinueToSchedule}
                  className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  disabled={selectedMergeTargetClasses.length === 0}
                >
                  Continue to Schedule
                </button>
              )}
              {mergeStep === 'choose-schedule' && (
                <button
                  type="button"
                  onClick={handleMergeReview}
                  className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                  disabled={
                    !mergeFormData.room_id || 
                    (useSourceSchedule 
                      ? (!sourceClassSchedule || sourceClassSchedule.filter(d => d.start_time && d.end_time).length === 0)
                      : (!manualSchedule || manualSchedule.filter(d => d.start_time && d.end_time).length === 0 || mergeScheduleConflicts.length > 0)
                    )
                  }
                  title={!useSourceSchedule && mergeScheduleConflicts.length > 0 ? 'Please resolve schedule conflicts before continuing' : ''}
                >
                  Continue to Review
                </button>
              )}
              {mergeStep === 'review' && (
                <button
                  type="button"
                  onClick={handleMergeSubmit}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                  disabled={mergeSubmitting}
                >
                  {mergeSubmitting ? (
                    <span className="flex items-center space-x-2">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Merging...</span>
                    </span>
                  ) : (
                    'Confirm Merge'
                  )}
                </button>
              )}
            </div>
          </div>
          
          {/* Existing Schedules Sidebar - Show when room is selected and in choose-schedule step */}
          {mergeFormData.room_id && mergeStep === 'choose-schedule' && (
            <div 
              className="bg-white rounded-lg shadow-xl relative z-[101] w-80 max-h-[90vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Sidebar Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0 bg-blue-50">
                <div>
                  <h3 className="text-sm font-semibold text-blue-900">
                    📅 Existing Schedules
                  </h3>
                  <p className="text-xs text-blue-700 mt-0.5">
                    {rooms.find(r => r.room_id === parseInt(mergeFormData.room_id))?.room_name || 'Selected Room'}
                  </p>
                </div>
              </div>
              
              {/* Sidebar Content - Minimal Calendar View */}
              <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}>
                {loadingRoomSchedules ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="flex items-center space-x-2 text-blue-600">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span className="text-sm">Loading...</span>
                    </div>
                  </div>
                ) : (() => {
                  // Filter out schedules for classes involved in the merge
                  const mergeClassIds = [
                    selectedClassForMerge.class_id,
                    ...selectedMergeTargetClasses.map(c => c.class_id)
                  ];
                  const filteredSchedules = roomSchedules.filter(
                    schedule => schedule.class_id && !mergeClassIds.includes(schedule.class_id)
                  );
                  
                  return filteredSchedules.length > 0 ? (
                    <div className="space-y-2">
                      {/* Expand/Collapse All Controls */}
                      {filteredSchedules.length > 10 && (
                        <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200">
                          <button
                            type="button"
                            onClick={() => {
                              const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                              const hasSchedules = allDays.filter(day => 
                                filteredSchedules.some(s => s.day_of_week === day)
                              );
                              if (expandedCalendarDays.size === hasSchedules.length) {
                                setExpandedCalendarDays(new Set());
                              } else {
                                setExpandedCalendarDays(new Set(hasSchedules));
                              }
                            }}
                            className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {expandedCalendarDays.size > 0 ? 'Collapse All' : 'Expand All'}
                          </button>
                          <span className="text-[10px] text-gray-500">
                            {filteredSchedules.length} schedule{filteredSchedules.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                      
                      {/* Group schedules by day of week */}
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => {
                        const daySchedules = filteredSchedules.filter(s => s.day_of_week === day);
                        const isExpanded = expandedCalendarDays.has(day);
                        const INITIAL_SHOW_COUNT = 3;
                        const showCount = expandedSchedulesPerDay[day] || INITIAL_SHOW_COUNT;
                        const displayedSchedules = isExpanded ? daySchedules.slice(0, showCount) : [];
                        const hasMore = daySchedules.length > showCount;
                        
                        if (daySchedules.length === 0) {
                          return (
                            <div key={day} className="border border-gray-200 rounded-lg p-2 bg-gray-50">
                              <div className="text-xs font-semibold text-gray-500 uppercase">
                                {day.substring(0, 3)}
                              </div>
                              <div className="text-xs text-gray-400 italic mt-1">No schedule</div>
                            </div>
                          );
                        }
                        
                        return (
                          <div key={day} className="border border-blue-200 rounded-lg bg-blue-50">
                            {/* Day Header - Clickable to expand/collapse */}
                            <button
                              type="button"
                              onClick={() => toggleCalendarDay(day)}
                              className="w-full flex items-center justify-between p-2 hover:bg-blue-100 transition-colors rounded-t-lg"
                            >
                              <div className="flex items-center space-x-2">
                                <span className="text-xs font-semibold text-blue-900 uppercase">
                                  {day.substring(0, 3)}
                                </span>
                                <span className="text-[10px] text-blue-600 bg-blue-200 px-1.5 py-0.5 rounded-full">
                                  {daySchedules.length}
                                </span>
                              </div>
                              <svg
                                className={`w-3 h-3 text-blue-700 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            
                            {/* Schedules List - Only show when expanded */}
                            {isExpanded && (
                              <div className="p-2 space-y-1.5">
                                {displayedSchedules.map((schedule, idx) => {
                                  const startTime = schedule.start_time ? schedule.start_time.substring(0, 5) : '--:--';
                                  const endTime = schedule.end_time ? schedule.end_time.substring(0, 5) : '--:--';
                                  const className = schedule.class_name 
                                    ? `${schedule.program_name || ''} - ${schedule.class_name}`.trim()
                                    : schedule.level_tag 
                                      ? `${schedule.program_name || ''} - ${schedule.level_tag}`.trim()
                                      : schedule.program_name || `Class ${schedule.class_id}`;
                                  
                                  return (
                                    <div key={idx} className="bg-white rounded border border-blue-100 p-1.5 hover:bg-blue-50 transition-colors">
                                      <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[10px] font-medium text-blue-700">
                                          {startTime} - {endTime}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-blue-900 truncate font-medium" title={className}>
                                        {className}
                                      </p>
                                      {schedule.teacher_names && (
                                        <p className="text-[10px] text-blue-600 truncate mt-0.5" title={schedule.teacher_names}>
                                          {schedule.teacher_names}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                                
                                {/* Show More Button */}
                                {hasMore && (
                                  <button
                                    type="button"
                                    onClick={() => showMoreSchedules(day, daySchedules.length)}
                                    className="w-full text-[10px] text-blue-600 hover:text-blue-800 font-medium py-1 hover:bg-blue-100 rounded transition-colors"
                                  >
                                    Show {daySchedules.length - showCount} more...
                                  </button>
                                )}
                                
                                {/* Show Less Button (when all are shown) */}
                                {!hasMore && showCount > INITIAL_SHOW_COUNT && (
                                  <button
                                    type="button"
                                    onClick={() => showMoreSchedules(day, INITIAL_SHOW_COUNT)}
                                    className="w-full text-[10px] text-blue-600 hover:text-blue-800 font-medium py-1 hover:bg-blue-100 rounded transition-colors"
                                  >
                                    Show less
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-sm text-gray-500 italic text-center">
                        No existing schedules found for this room.
                      </p>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
        </div>,
        document.body
      )}

      {/* View Students Modal */}
      {isViewStudentsModalOpen && selectedClassForView && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeViewStudentsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl relative z-[101] max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {viewStudentsStep === 'phase-selection' ? 'Select Phase' : 'Students'}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {selectedClassForView.program_name} - {selectedClassForView.class_name || selectedClassForView.level_tag}
                </p>
              </div>
              <button
                onClick={closeViewStudentsModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            {viewStudentsStep === 'phase-selection' ? (
              <div className="flex flex-col overflow-hidden">
                <div className="p-6">
                  <div className="mb-4">
                    <label htmlFor="phase_select" className="label-field">
                      Select Phase <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="phase_select"
                      value={selectedPhaseForView !== null ? selectedPhaseForView : 'all'}
                      onChange={(e) => {
                        const phaseValue = e.target.value === 'all' ? null : parseInt(e.target.value);
                        if (e.target.value === 'all') {
                          setSelectedPhaseForView(null);
                          setViewStudentsStep('students-list');
                          if (selectedClassForView) {
                            fetchEnrolledStudentsForView(selectedClassForView.class_id, null);
                          }
                        } else if (phaseValue !== null) {
                          handlePhaseSelectForView(phaseValue);
                        }
                      }}
                      className="input-field"
                      required
                    >
                      <option value="all">All Phases</option>
                      {selectedClassForView.number_of_phase && Array.from({ length: selectedClassForView.number_of_phase }, (_, i) => i + 1).map((phaseNum) => (
                        <option key={phaseNum} value={phaseNum}>
                          Phase {phaseNum}
                        </option>
                      ))}
                    </select>
                    {selectedClassForView.number_of_phase && (
                      <p className="mt-2 text-sm text-gray-500">
                        This class has {selectedClassForView.number_of_phase} phase{selectedClassForView.number_of_phase !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end space-x-3 px-6 pb-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                  <button
                    type="button"
                    onClick={closeViewStudentsModal}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const selectElement = document.getElementById('phase_select');
                      if (selectElement && selectElement.value !== '') {
                        const phaseValue = selectElement.value === 'all' ? null : parseInt(selectElement.value);
                        if (phaseValue === null) {
                          setSelectedPhaseForView(null);
                          setViewStudentsStep('students-list');
                          if (selectedClassForView) {
                            fetchEnrolledStudentsForView(selectedClassForView.class_id, null);
                          }
                        } else {
                          handlePhaseSelectForView(phaseValue);
                        }
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 overflow-y-auto flex-1">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-gray-900">
                      Students
                      {selectedPhaseForView !== null ? ` - Phase ${selectedPhaseForView}` : ' - All Phases'} ({getCountableStudents(viewEnrolledStudents)})
                      {selectedClassForView.max_students && (
                        <span className="text-sm font-normal text-gray-500 ml-2">
                          / {selectedClassForView.max_students} max
                        </span>
                      )}
                    </h3>
                    <button
                      onClick={() => {
                        setViewStudentsStep('phase-selection');
                        setViewEnrolledStudents([]);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex items-center space-x-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      <span>Change Phase</span>
                    </button>
                  </div>

                  {loadingViewStudents ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                    </div>
                  ) : viewEnrolledStudents.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                      <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <h3 className="mt-2 text-sm font-medium text-gray-900">No students found</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        {selectedPhaseForView !== null 
                          ? `No students found in Phase ${selectedPhaseForView}.`
                          : 'No enrolled or reserved students in this class.'}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white rounded-lg border border-gray-200">
                      <div
                        className="overflow-x-auto rounded-lg"
                        style={{
                          scrollbarWidth: 'thin',
                          scrollbarColor: '#cbd5e0 #f7fafc',
                          WebkitOverflowScrolling: 'touch',
                        }}
                      >
                        <table
                          className="divide-y divide-gray-200"
                          style={{ width: '100%', minWidth: '1000px' }}
                        >
                        <thead className="bg-white">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Student Name
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Email
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Status
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Level Tag / Package
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Phase
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Date
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Enrolled By
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                          {viewEnrolledStudents.map((student) => {
                            const isReserved = student.student_type === 'reserved';
                            const uniqueKey = isReserved 
                              ? `reserved-${student.reservation_id}` 
                              : `enrolled-${student.classstudent_id}`;
                            
                            return (
                              <tr key={uniqueKey} className={isReserved ? 'bg-yellow-50' : ''}>
                                <td className="px-4 py-4">
                                  <div className="text-sm font-medium text-gray-900">{student.full_name}</div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="text-sm text-gray-500">{student.email || '-'}</div>
                                </td>
                                <td className="px-4 py-4">
                                  {isReserved ? (
                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                      student.reservation_status === 'Fee Paid'
                                        ? 'bg-green-100 text-green-800'
                                        : student.reservation_status === 'Upgraded'
                                        ? 'bg-blue-100 text-blue-800'
                                        : student.reservation_status === 'Cancelled'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-yellow-100 text-yellow-800'
                                    }`}>
                                      {student.reservation_status || 'Reserved'}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                      Enrolled
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-4">
                                  <div className="text-sm text-gray-500">
                                    {isReserved ? (student.package_name || '-') : (student.level_tag || '-')}
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  {isReserved ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                      Reserved
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                      Phase {student.phase_number}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-4">
                                  <div className="text-sm text-gray-500">
                                    {student.earliestEnrollment || student.enrolled_at
                                      ? formatDateManila(student.earliestEnrollment || student.enrolled_at)
                                      : '-'}
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="text-sm text-gray-500">{student.enrolled_by || '-'}</div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Modal Footer - Only show when viewing students list */}
            {viewStudentsStep === 'students-list' && (
              <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                <button
                  type="button"
                  onClick={closeViewStudentsModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Substitute Teacher Assignment Modal */}
      {isSubstituteModalOpen && selectedSessionForSubstitute && selectedClassForDetails && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={() => setIsSubstituteModalOpen(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Assign Substitute Teacher</h2>
              <button
                onClick={() => setIsSubstituteModalOpen(false)}
                className="text-gray-400 hover:text-gray-500 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <div className="space-y-4">
                {/* Session Info */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Session Details</h3>
                  <div className="space-y-1 text-sm text-gray-600">
                    <div>Phase {selectedSessionForSubstitute.phase_number} - Session {selectedSessionForSubstitute.phase_session_number}</div>
                    {selectedSessionForSubstitute.scheduled_date && (
                      <div>Date: {formatDate(selectedSessionForSubstitute.scheduled_date)}</div>
                    )}
                    {selectedSessionForSubstitute.original_teacher_name && (
                      <div>Original Teacher: <span className="font-medium">{selectedSessionForSubstitute.original_teacher_name}</span></div>
                    )}
                  </div>
                </div>

                {/* Current Substitute Info */}
                {selectedSessionForSubstitute.substitute_teacher_name && (
                  <div className="bg-orange-50 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-orange-800 mb-2">Current Substitute</h3>
                    <div className="text-sm text-orange-700">
                      {selectedSessionForSubstitute.substitute_teacher_name}
                      {selectedSessionForSubstitute.substitute_reason && (
                        <div className="mt-1 text-xs text-orange-600">
                          Reason: {selectedSessionForSubstitute.substitute_reason}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Teacher Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Substitute Teacher
                  </label>
                  <select
                    id="substituteTeacher"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    defaultValue={selectedSessionForSubstitute.substitute_teacher_id || ''}
                  >
                    <option value="">-- Select Teacher --</option>
                    {teachers
                      .filter(teacher => teacher.user_id !== selectedSessionForSubstitute.original_teacher_id)
                      .map((teacher) => (
                        <option key={teacher.user_id} value={teacher.user_id}>
                          {teacher.full_name}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Reason Field */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason for Substitute (Optional)
                  </label>
                  <textarea
                    id="substituteReason"
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="e.g., Teacher is on leave, Emergency, etc."
                    defaultValue={selectedSessionForSubstitute.substitute_reason || ''}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
              {selectedSessionForSubstitute.substitute_teacher_id && (
                <button
                  onClick={() => {
                    if (selectedSessionForSubstitute.classsession_id) {
                      handleRemoveSubstitute(selectedSessionForSubstitute.classsession_id);
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                  disabled={substitutingSession}
                >
                  Remove Substitute
                </button>
              )}
              <button
                onClick={() => setIsSubstituteModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                disabled={substitutingSession}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const substituteTeacherId = document.getElementById('substituteTeacher').value;
                  const substituteReason = document.getElementById('substituteReason').value;
                  
                  if (!substituteTeacherId) {
                    alert('Please select a substitute teacher');
                    return;
                  }
                  
                  if (selectedSessionForSubstitute.classsession_id) {
                    handleAssignSubstitute(selectedSessionForSubstitute.classsession_id, substituteTeacherId, substituteReason);
                  } else {
                    alert('Session not found. Please generate sessions first.');
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={substitutingSession}
              >
                {substitutingSession ? 'Assigning...' : 'Assign Substitute'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Reserved Students Modal */}
      {isReservedStudentsModalOpen && selectedClassForReservations && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeReservedStudentsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  Reserved Students
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {selectedClassForReservations.program_name} - {selectedClassForReservations.class_name || selectedClassForReservations.level_tag}
                </p>
              </div>
              <button
                onClick={closeReservedStudentsModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {loadingReservedStudents ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                </div>
              ) : reservedStudents.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500">No reserved students found for this class.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                  <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '850px' }}>
                    <thead className="bg-white">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Student Name
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Package
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Reservation Fee
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Due Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {reservedStudents.map((reservation) => (
                        <tr key={reservation.reserved_id}>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {reservation.student_name || '-'}
                            </div>
                            {reservation.student_email && (
                              <div className="text-xs text-gray-500">{reservation.student_email}</div>
                            )}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {reservation.package_name || '-'}
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {reservation.reservation_fee !== null && reservation.reservation_fee !== undefined
                                ? `₱${parseFloat(reservation.reservation_fee).toFixed(2)}`
                                : '-'}
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                reservation.status === 'Fee Paid'
                                  ? 'bg-green-100 text-green-800'
                                  : reservation.status === 'Upgraded'
                                  ? 'bg-blue-100 text-blue-800'
                                  : reservation.status === 'Cancelled'
                                  ? 'bg-red-100 text-red-800'
                                  : reservation.status === 'Expired'
                                  ? 'bg-orange-100 text-orange-800'
                                  : 'bg-yellow-100 text-yellow-800'
                              }`}
                            >
                              {reservation.status || 'Reserved'}
                            </span>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {reservation.due_date
                                ? formatDateManila(reservation.due_date)
                                : reservation.reservation_invoice_due_date
                                ? formatDateManila(reservation.reservation_invoice_due_date)
                                : '-'}
                            </div>
                            {reservation.due_date && new Date(reservation.due_date) < new Date() && reservation.status === 'Reserved' && (
                              <div className="text-xs text-red-600 mt-1">Overdue</div>
                            )}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                            {(reservation.status === 'Fee Paid' || reservation.status === 'Expired') && (
                              <button
                                onClick={() => handleUpgradeReservation(reservation)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                  reservation.status === 'Expired'
                                    ? 'text-white bg-orange-600 hover:bg-orange-700'
                                    : 'text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E]'
                                }`}
                              >
                                {reservation.status === 'Expired' ? 'Re-upgrade' : 'Upgrade'}
                              </button>
                            )}
                            {reservation.status === 'Reserved' && (
                              <span className="text-xs text-gray-500 italic">Pay fee to upgrade</span>
                            )}
                            {reservation.status === 'Upgraded' && (
                              <span className="text-gray-400">Upgraded</span>
                            )}
                            {reservation.status === 'Cancelled' && (
                              <span className="text-gray-400">Cancelled</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Upgrade Reservation Modal */}
      {isUpgradeModalOpen && selectedReservationForUpgrade && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={() => setIsUpgradeModalOpen(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  Upgrade Reservation to Enrollment
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {selectedReservationForUpgrade.student_name}
                </p>
              </div>
              <button
                onClick={() => setIsUpgradeModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {/* Enrollment Option Selection Step */}
              {upgradeStep === 'enrollment-option' && (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Select Enrollment Option</h3>
                    <p className="text-sm text-gray-500">Choose how you want to enroll the student</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Enrollment Option <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={upgradeEnrollmentOption}
                      onChange={(e) => {
                        setUpgradeEnrollmentOption(e.target.value);
                        if (e.target.value === 'package') {
                          setUpgradeStep('package-selection');
                        } else if (e.target.value === 'per-phase') {
                          setUpgradeStep('per-phase-selection');
                        }
                      }}
                      className="input-field"
                      required
                    >
                      <option value="">Choose an option...</option>
                      <option value="package">Select Package</option>
                      {selectedClassForReservations?.number_of_phase && selectedClassForReservations.number_of_phase > 0 && (
                        <option value="per-phase">Enroll per Phase</option>
                      )}
                    </select>
                    <p className="mt-2 text-sm text-gray-500">
                      Choose how you want to enroll the student. You can select a package or enroll per phase.
                    </p>
                  </div>
                </div>
              )}

              {/* Package Selection Step - For Entire Class Reservations */}
              {upgradeStep === 'package-selection' && (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Select a Package</h3>
                    <p className="text-sm text-gray-500">Choose a package to upgrade the reservation to enrollment</p>
                  </div>
                  
                  {packages.length > 0 ? (
                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}>
                      {packages
                        .filter(pkg => pkg.package_type !== 'Reserved')
                        .filter(pkg => {
                          // Filter by level_tag if class has one
                          if (selectedClassForEnrollment?.level_tag) {
                            return pkg.level_tag === selectedClassForEnrollment.level_tag;
                          }
                          return true;
                        })
                        .map((pkg) => {
                        const hasFullpaymentPricing = pkg.details?.some(detail => {
                          const pricing = pricingLists.find(p => p.pricinglist_id === detail.pricinglist_id);
                          return pricing && isNewEnrolleeFullpayment(pricing);
                        });
                        
                        return (
                          <button
                            key={pkg.package_id}
                            onClick={async () => {
                              setUpgradeSelectedPackage(pkg);
                              setUpgradeSelectedPromo(null); // Clear selected promo when package changes
                              setUpgradeAvailablePromos([]); // Clear available promos
                              setUpgradeShowPackageDetails(true); // Show package details by default when package is selected
                              
                              // Initialize package merchandise selections
                              if (pkg.details) {
                                const { merchandiseTypes } = groupPackageDetails(pkg.details || []);
                                const updatedSelections = {};
                                merchandiseTypes.forEach((typeName) => {
                                  const items = getMerchandiseItemsByType(typeName);
                                  if (items.length === 0) {
                                    updatedSelections[typeName] = [];
                                    return;
                                  }
                                  // Check if this merchandise type requires sizing
                                  const requiresSizing = requiresSizingForMerchandise(typeName);
                                  
                                  // For items that don't require sizing, auto-select first item
                                  if (!requiresSizing) {
                                    updatedSelections[typeName] = [{
                                      merchandise_id: items[0].merchandise_id,
                                      size: items[0].size || null,
                                    }];
                                    return;
                                  }
                                  // For items that require sizing, start empty (user will select)
                                  updatedSelections[typeName] = [];
                                });
                                setUpgradePackageMerchSelections(updatedSelections);
                              }
                              
                              // Fetch available promos for this package and student
                              if (pkg.package_id && selectedReservationForUpgrade?.student_id) {
                                await fetchUpgradeAvailablePromos(pkg.package_id, selectedReservationForUpgrade.student_id);
                              } else if (pkg.package_id) {
                                await fetchUpgradeAvailablePromos(pkg.package_id);
                              }
                              
                              if (pkg.package_type === 'Installment' && !hasFullpaymentPricing) {
                                setUpgradeShowInstallmentSettings(true);
                                const defaultSettings = getDefaultInstallmentSettings();
                                setUpgradeInstallmentSettings(defaultSettings);
                              } else {
                                setUpgradeShowInstallmentSettings(false);
                                setUpgradeInstallmentSettings({
                                  invoice_issue_date: '',
                                  billing_month: '',
                                  invoice_due_date: '',
                                  invoice_generation_date: '',
                                  frequency_months: 1,
                                });
                              }
                              setUpgradeStep('package-config');
                            }}
                            className={`group w-full p-5 bg-white border-2 rounded-xl transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2 ${
                              upgradeSelectedPackage?.package_id === pkg.package_id
                                ? 'border-[#F7C844] bg-yellow-50 hover:shadow-lg'
                                : 'border-gray-200 hover:border-[#F7C844] hover:shadow-lg'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-2 mb-2">
                                  <h5 className="font-bold text-gray-900 text-base transition-colors truncate group-hover:text-[#F7C844]">
                                    {pkg.package_name}
                                  </h5>
                                  {pkg.package_type === 'Installment' && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                                      Installment
                                    </span>
                                  )}
                                </div>
                                {pkg.package_price && (
                                  <div className="flex flex-col space-y-1 mb-2">
                                    {pkg.package_type === 'Installment' ? (
                                      <>
                                        {pkg.downpayment_amount != null && parseFloat(pkg.downpayment_amount) > 0 && (
                                          <div className="flex items-baseline space-x-2">
                                            <span className="text-sm text-gray-600">Down payment:</span>
                                            <span className="text-lg font-bold text-gray-900">
                                              ₱{parseFloat(pkg.downpayment_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                        )}
                                        <div className="flex items-baseline space-x-2">
                                          <span className="text-sm text-gray-600">Monthly:</span>
                                          <span className="text-lg font-bold text-gray-900">
                                            ₱{parseFloat(pkg.package_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                          </span>
                                        </div>
                                      </>
                                    ) : (
                                      <div className="flex items-baseline space-x-2">
                                        <span className="text-xl font-bold text-gray-900">
                                          ₱{parseFloat(pkg.package_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex-shrink-0 ml-4">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                              upgradeSelectedPackage?.package_id === pkg.package_id
                                ? 'bg-[#F7C844]'
                                : 'bg-gray-100 group-hover:bg-[#F7C844]'
                            }`}>
                                  <svg className={`w-5 h-5 transition-colors ${
                              upgradeSelectedPackage?.package_id === pkg.package_id
                                ? 'text-white'
                                : 'text-gray-600 group-hover:text-white'
                            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center p-12 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl">
                      <div className="text-center">
                        <p className="text-sm font-medium text-gray-500">No packages available</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Package Configuration Step - Show after package selection */}
              {upgradeStep === 'package-config' && upgradeSelectedPackage && (
                <div className="space-y-6">
                  {/* Selected Package Section */}
                  <div className="space-y-3">
                    {/* Collapsible Package Header */}
                    <div className="p-4 bg-white border border-gray-200 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setUpgradeShowPackageDetails(!upgradeShowPackageDetails)}
                        className="w-full flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-[#F7C844] rounded-lg flex items-center justify-center">
                            <svg className="w-5 h-5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                            </svg>
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                              Selected Package
                            </p>
                            <p className="text-base font-semibold text-gray-900 mt-0.5">
                              {upgradeSelectedPackage.package_name}
                            </p>
                            {upgradeSelectedPackage.package_type === 'Installment' ? (
                              <div className="flex flex-col gap-1 mt-1">
                                {upgradeSelectedPackage.downpayment_amount != null && parseFloat(upgradeSelectedPackage.downpayment_amount) > 0 && (
                                  <div className="flex items-baseline space-x-2">
                                    <span className="text-base font-bold text-gray-900">
                                      ₱{parseFloat(upgradeSelectedPackage.downpayment_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-xs text-gray-600 font-medium">Down payment</span>
                                  </div>
                                )}
                                {upgradeSelectedPackage.package_price && (
                                  <div className="flex items-baseline space-x-2">
                                    <span className="text-base font-bold text-gray-900">
                                      ₱{parseFloat(upgradeSelectedPackage.package_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-xs text-gray-600 font-medium">Monthly</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              upgradeSelectedPackage.package_price && (
                                <div className="flex items-baseline space-x-2 mt-1">
                                  <span className="text-xl font-bold text-gray-900">
                                    ₱{parseFloat(upgradeSelectedPackage.package_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                  <span className="text-xs text-gray-600 font-medium">Package Price</span>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${upgradeShowPackageDetails ? 'transform rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    
                    {/* Collapsible Package Details */}
                    {upgradeShowPackageDetails && (
                      <div className="p-4 bg-white border border-gray-200 rounded-lg">
                        {upgradeSelectedPackage.details && upgradeSelectedPackage.details.length > 0 && (() => {
                          const { pricingDetails, includedMerchandiseTypes, paidMerchandiseTypes } = groupPackageDetails(upgradeSelectedPackage.details || []);
                          return (
                            <div className="pt-3 border-t border-gray-200">
                              <p className="text-sm font-medium text-gray-900 mb-3">
                                Package Includes
                              </p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {pricingDetails.map((detail, idx) => (
                                  <div key={`pricing-${idx}`} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                    <div className="flex items-start space-x-2">
                                      <svg className="w-4 h-4 text-[#F7C844] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                      </svg>
                                      <div className="flex-1 min-w-0">
                                        <span className="text-xs font-medium text-gray-500 uppercase">Pricing</span>
                                        <p className="text-sm font-medium text-gray-900 mt-0.5 truncate">
                                          {detail.pricing_name || detail.pricinglist_name || detail.pricinglist_id}
                                        </p>
                                        {detail.pricing_type && (
                                          <span className="inline-block mt-1 text-xs text-gray-600 bg-white px-2 py-0.5 rounded border border-gray-200">
                                            {detail.pricing_type}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {/* Included Merchandise (Freebies) */}
                                {includedMerchandiseTypes.map((typeName) => (
                                  <div key={`included-merch-${typeName}`} className="p-3 bg-green-50 rounded-lg border border-green-200">
                                    <div className="flex items-start space-x-2">
                                      <svg className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                      </svg>
                                      <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-gray-500 uppercase">Merchandise</span>
                                          <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded">Included</span>
                                        </div>
                                        <p className="text-sm font-medium text-gray-900 mt-0.5">{typeName}</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {/* Paid Merchandise */}
                                {paidMerchandiseTypes.map((typeName) => (
                                  <div key={`paid-merch-${typeName}`} className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                                    <div className="flex items-start space-x-2">
                                      <svg className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                      </svg>
                                      <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-gray-500 uppercase">Merchandise</span>
                                          <span className="text-xs font-semibold text-orange-700 bg-orange-100 px-2 py-0.5 rounded">Paid</span>
                                        </div>
                                        <p className="text-sm font-medium text-gray-900 mt-0.5">{typeName}</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Configure Merchandise - Only for items that require sizing */}
                        {(() => {
                          const { merchandiseTypes } = groupPackageDetails(upgradeSelectedPackage.details || []);
                          const uniformTypes = merchandiseTypes.filter(typeName => requiresSizingForMerchandise(typeName));
                          
                          return uniformTypes.length > 0 && (
                            <div className="pt-3 mt-3 border-t border-gray-200">
                              <p className="text-sm font-medium text-gray-900 mb-3">Configure Merchandise</p>
                              
                              {uniformTypes.map((typeName) => {
                                const itemsForType = getMerchandiseItemsByType(typeName);
                                const hasSizes = itemsForType.some(item => item.size);
                                const studentId = selectedReservationForUpgrade?.student_id;
                                const studentName = selectedReservationForUpgrade?.student_name || 'Student';
                                
                                if (!hasSizes) return null;
                                
                                return (
                                  <div key={`config-${typeName}`} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                                    <label className="block text-sm font-medium text-gray-900 mb-2">
                                      {typeName}
                                    </label>
                                    {(() => {
                                      const uniformCategories = Array.from(
                                        new Set(
                                          itemsForType
                                            .map(item => getUniformCategory(item))
                                            .filter(category => category && category !== 'General')
                                        )
                                      );
                                      const hasCategoryFilter = uniformCategories.length > 0;
                                      const activeCategory = hasCategoryFilter
                                        ? (upgradeUniformCategoryFilters[typeName] && uniformCategories.includes(upgradeUniformCategoryFilters[typeName])
                                            ? upgradeUniformCategoryFilters[typeName]
                                            : uniformCategories[0])
                                        : null;
                                      const filteredItemsForCategory = hasCategoryFilter
                                        ? itemsForType.filter(item => getUniformCategory(item) === activeCategory)
                                        : itemsForType;
                                      
                                      return (
                                        <div className="space-y-2">
                                          {hasCategoryFilter && (
                                            <div className="flex items-center gap-1.5 mb-2">
                                              {uniformCategories.map(category => (
                                                <button
                                                  key={`${typeName}-${category}`}
                                                  type="button"
                                                  onClick={() => setUpgradeUniformCategoryFilters(prev => ({ ...prev, [typeName]: category }))}
                                                  className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border transition-colors ${
                                                    activeCategory === category
                                                      ? 'bg-[#F7C844] text-gray-900 border-[#F7C844]'
                                                      : 'bg-white text-gray-600 border-gray-300 hover:border-[#F7C844]'
                                                  }`}
                                                >
                                                  {category}
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                          <div className="p-2.5 rounded-lg border border-blue-300 bg-blue-50">
                                            <div className="flex items-center justify-between mb-1.5">
                                              <span className="text-[11px] font-semibold text-gray-900">
                                                {studentName}
                                              </span>
                                              {hasCategoryFilter && (
                                                <span className="text-[10px] font-semibold text-gray-600">
                                                  {activeCategory}
                                                </span>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                              <label className="text-[10px] text-gray-700 flex-shrink-0">
                                                Size:
                                              </label>
                                              <select
                                                value={(upgradeStudentMerchandiseSelections[studentId] || []).find(m => 
                                                  m.merchandise_name === typeName && 
                                                  (!activeCategory || m.category === activeCategory)
                                                )?.size || ''}
                                                onChange={(e) => {
                                                  const selectedSize = e.target.value;
                                                  if (!selectedSize) {
                                                    setUpgradeStudentMerchandiseSelections(prev => {
                                                      const studentSelections = (prev[studentId] || []).filter(m => 
                                                        !(m.merchandise_name === typeName && (!activeCategory || m.category === activeCategory))
                                                      );
                                                      return { ...prev, [studentId]: studentSelections };
                                                    });
                                                    return;
                                                  }
                                                  const selectedItem = filteredItemsForCategory.find(item => item.size === selectedSize);
                                                  if (selectedItem) {
                                                    setUpgradeStudentMerchandiseSelections(prev => {
                                                      const studentSelections = (prev[studentId] || []).filter(m => 
                                                        !(m.merchandise_name === typeName && (!activeCategory || m.category === activeCategory))
                                                      );
                                                      studentSelections.push({
                                                        merchandise_id: selectedItem.merchandise_id,
                                                        merchandise_name: typeName,
                                                        size: selectedSize,
                                                        category: activeCategory,
                                                      });
                                                      return { ...prev, [studentId]: studentSelections };
                                                    });
                                                  }
                                                }}
                                                className="flex-1 px-1.5 py-1 border border-gray-300 rounded text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-[#F7C844] focus:border-transparent bg-white"
                                              >
                                                <option value="">Select</option>
                                                {Array.from(new Set(filteredItemsForCategory.map(item => item.size).filter(Boolean))).map((size) => {
                                                  const sizeItem = filteredItemsForCategory.find(item => item.size === size);
                                                  const inventory = sizeItem ? checkInventoryAvailability(sizeItem.merchandise_id) : null;
                                                  return (
                                                    <option
                                                      key={size}
                                                      value={size}
                                                      disabled={inventory?.isOutOfStock}
                                                    >
                                                      {size}{inventory?.isOutOfStock ? ' (OOS)' : ''} {inventory && !inventory.isOutOfStock ? `(${inventory.available})` : ''}
                                                    </option>
                                                  );
                                                })}
                                              </select>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Available Promos Section */}
                  {upgradeAvailablePromos.length > 0 && (
                    <div className="space-y-3">
                      <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg">
                        <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center">
                          <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                          </svg>
                          Available Promos
                        </h4>
                        {loadingUpgradePromos ? (
                          <div className="flex items-center justify-center py-4">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <button
                              type="button"
                              onClick={() => setUpgradeSelectedPromo(null)}
                              className={`w-full p-3 text-left rounded-lg border-2 transition-all ${
                                upgradeSelectedPromo === null
                                  ? 'border-blue-500 bg-blue-100'
                                  : 'border-gray-200 bg-white hover:border-gray-300'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-gray-900">No Promo</span>
                                {upgradeSelectedPromo === null && (
                                  <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </div>
                            </button>
                            {upgradeAvailablePromos.map((promo) => (
                              <button
                                key={promo.promo_id}
                                type="button"
                                onClick={() => setUpgradeSelectedPromo(promo)}
                                className={`w-full p-3 text-left rounded-lg border-2 transition-all ${
                                  upgradeSelectedPromo?.promo_id === promo.promo_id
                                    ? 'border-blue-500 bg-blue-100'
                                    : 'border-gray-200 bg-white hover:border-gray-300'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center space-x-2">
                                      <span className="font-semibold text-gray-900">{promo.promo_name}</span>
                                      {promo.promo_type === 'percentage_discount' && promo.discount_percentage && (
                                        <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded">
                                          {promo.discount_percentage}% OFF
                                        </span>
                                      )}
                                      {promo.promo_type === 'fixed_discount' && promo.discount_amount && (
                                        <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded">
                                          ₱{parseFloat(promo.discount_amount).toFixed(2)} OFF
                                        </span>
                                      )}
                                      {promo.promo_type === 'combined' && (
                                        <span className="text-xs font-medium text-purple-700 bg-purple-100 px-2 py-0.5 rounded">
                                          Combined
                                        </span>
                                      )}
                                      {promo.promo_type === 'free_merchandise' && (
                                        <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                                          Free Merchandise
                                        </span>
                                      )}
                                    </div>
                                    {promo.description && (
                                      <p className="text-xs text-gray-600 mt-1">{promo.description}</p>
                                    )}
                                  </div>
                                  {upgradeSelectedPromo?.promo_id === promo.promo_id && (
                                    <svg className="w-5 h-5 text-blue-600 flex-shrink-0 ml-2" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Installment Settings Toggle - Show for Installment packages */}
                  {(() => {
                    const hasFullpaymentPricing = upgradeSelectedPackage.details?.some(detail => {
                      const pricing = pricingLists.find(p => p.pricinglist_id === detail.pricinglist_id);
                      return pricing && isNewEnrolleeFullpayment(pricing);
                    });
                    
                    if (hasFullpaymentPricing || upgradeSelectedPackage.package_type !== 'Installment') {
                      return null;
                    }
                    
                    return (
                      <div className="space-y-3">
                        {/* Installment Settings Toggle */}
                        <div className="p-4 bg-white border border-gray-200 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium text-gray-900">Installment Payment</h4>
                                <p className="text-xs text-gray-600 mt-0.5">Enable to set up installment invoice settings</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const newState = !upgradeShowInstallmentSettings;
                                setUpgradeShowInstallmentSettings(newState);
                                if (newState) {
                                  const defaultSettings = getDefaultInstallmentSettings();
                                  setUpgradeInstallmentSettings(defaultSettings);
                                } else {
                                  setUpgradeInstallmentSettings({
                                    invoice_issue_date: '',
                                    billing_month: '',
                                    invoice_due_date: '',
                                    invoice_generation_date: '',
                                    frequency_months: 1,
                                  });
                                }
                              }}
                              className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-1 shadow-inner ${
                                upgradeShowInstallmentSettings ? 'bg-[#F7C844]' : 'bg-gray-300'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                                  upgradeShowInstallmentSettings ? 'translate-x-5' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {/* Installment Settings Form */}
                        {upgradeShowInstallmentSettings && (
                          <div className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
                            <div className="mb-2">
                              <h3 className="text-xs font-bold text-blue-900">Installment Invoice Settings</h3>
                              <p className="text-xs text-gray-600 mt-0.5">
                                Configure the details for the first invoices that will be generated regularly.
                              </p>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <div>
                                <label className="label-field">
                                  Invoice Issue Date <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="date"
                                  value={upgradeInstallmentSettings.invoice_issue_date}
                                  onChange={(e) => setUpgradeInstallmentSettings(prev => ({ ...prev, invoice_issue_date: e.target.value }))}
                                  className="input-field"
                                  required
                                />
                              </div>
                              <div>
                                <label className="label-field flex items-center space-x-2">
                                  <span>Billing Month</span>
                                  <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="month"
                                  value={upgradeInstallmentSettings.billing_month}
                                  onChange={(e) => setUpgradeInstallmentSettings(prev => ({ ...prev, billing_month: e.target.value }))}
                                  className="input-field"
                                  required
                                />
                              </div>
                              <div>
                                <label className="label-field">
                                  Invoice Due Date <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="date"
                                  value={upgradeInstallmentSettings.invoice_due_date}
                                  onChange={(e) => setUpgradeInstallmentSettings(prev => ({ ...prev, invoice_due_date: e.target.value }))}
                                  className="input-field"
                                  required
                                />
                              </div>
                              <div>
                                <label className="label-field">
                                  Invoice Generation Date <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="date"
                                  value={upgradeInstallmentSettings.invoice_generation_date}
                                  onChange={(e) => setUpgradeInstallmentSettings(prev => ({ ...prev, invoice_generation_date: e.target.value }))}
                                  className="input-field"
                                  required
                                />
                              </div>
                            </div>
                            <div className="mt-2 pt-2 border-t border-blue-200">
                              <p className="text-xs text-gray-700">
                                Invoice will be generated every
                                <span className="inline-block w-8 px-1 py-0.5 text-xs text-blue-900 font-semibold text-center bg-blue-50 ml-1 mr-1">
                                  {upgradeInstallmentSettings.frequency_months}
                                </span>
                                <span className="text-blue-900 font-semibold">Month(s)</span>
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Per-Phase Selection Step - Now based on Phase packages */}
              {upgradeStep === 'per-phase-selection' && (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Enroll per Phase</h3>
                    <p className="text-sm text-gray-500">
                      Choose a Phase package. The package defines the covered phases and amount.
                    </p>
                  </div>

                  {packages.length > 0 ? (
                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}>
                      {packages
                        .filter(pkg => pkg.package_type === 'Phase')
                        .map((pkg) => (
                          <button
                            key={pkg.package_id}
                            type="button"
                            onClick={async () => {
                              setUpgradeSelectedPackage(pkg);
                              setUpgradeSelectedPromo(null); // Clear selected promo when package changes
                              setUpgradeAvailablePromos([]); // Clear available promos
                              setUpgradeShowPackageDetails(true); // Show package details by default when package is selected
                              
                              // Initialize package merchandise selections (e.g., uniforms)
                              if (pkg.details) {
                                const { merchandiseTypes } = groupPackageDetails(pkg.details || []);
                                const updatedSelections = {};
                                merchandiseTypes.forEach((typeName) => {
                                  const items = getMerchandiseItemsByType(typeName);
                                  if (items.length === 0) {
                                    updatedSelections[typeName] = [];
                                    return;
                                  }
                                  // Check if this merchandise type requires sizing
                                  const requiresSizing = requiresSizingForMerchandise(typeName);
                                  
                                  // For items that don't require sizing, auto-select first item
                                  if (!requiresSizing) {
                                    updatedSelections[typeName] = [{
                                      merchandise_id: items[0].merchandise_id,
                                      size: items[0].size || null,
                                    }];
                                    return;
                                  }
                                  // For items that require sizing, start empty (user will select size per student)
                                  updatedSelections[typeName] = [];
                                });
                                setUpgradePackageMerchSelections(updatedSelections);
                              }
                              
                              // Fetch available promos for this package and student
                              if (pkg.package_id && selectedReservationForUpgrade?.student_id) {
                                await fetchUpgradeAvailablePromos(pkg.package_id, selectedReservationForUpgrade.student_id);
                              } else if (pkg.package_id) {
                                await fetchUpgradeAvailablePromos(pkg.package_id);
                              }
                              
                              // Go directly to review; enrollment type will be Per-Phase with Phase package
                              setUpgradeStep('review');
                            }}
                            className={`group w-full p-5 bg-white border-2 rounded-xl hover:shadow-lg transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2 ${
                              upgradeSelectedPackage?.package_id === pkg.package_id
                                ? 'border-[#F7C844] bg-yellow-50'
                                : 'border-gray-200 hover:border-[#F7C844]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-2 mb-2">
                                  <h5 className="font-bold text-gray-900 text-base group-hover:text-[#F7C844] transition-colors truncate">
                                    {pkg.package_name}
                                  </h5>
                                </div>
                                {pkg.package_price && (
                                  <div className="flex items-baseline space-x-2 mb-2">
                                    <span className="text-xl font-bold text-gray-900">
                                      ₱{parseFloat(pkg.package_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className="text-xs text-gray-600 font-medium">Phase Package Price</span>
                                  </div>
                                )}
                                {pkg.phase_start && (
                                  <p className="text-xs text-gray-600">
                                    Phases: {pkg.phase_start}{pkg.phase_end ? ` - ${pkg.phase_end}` : ''}
                                  </p>
                                )}
                              </div>
                              <div className="flex-shrink-0 ml-4">
                                <div
                                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                                    upgradeSelectedPackage?.package_id === pkg.package_id
                                      ? 'bg-[#F7C844]'
                                      : 'bg-gray-100 group-hover:bg-[#F7C844]'
                                  }`}
                                >
                                  <svg
                                    className={`w-5 h-5 transition-colors ${
                                      upgradeSelectedPackage?.package_id === pkg.package_id
                                        ? 'text-white'
                                        : 'text-gray-600 group-hover:text-white'
                                    }`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center p-12 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl">
                      <div className="text-center">
                        <p className="text-sm font-medium text-gray-500">No Phase packages available</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Review Step */}
              {upgradeStep === 'review' && (
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Review Upgrade</h3>
                    <p className="text-sm text-gray-500">Review the upgrade details before submitting</p>
                  </div>

                  {upgradeSelectedPackage ? (
                    <div className="space-y-4">
                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <h4 className="font-semibold text-gray-900 mb-2">Selected Package</h4>
                        <p className="text-sm text-gray-700">{upgradeSelectedPackage.package_name}</p>
                        {upgradeSelectedPackage.package_type === 'Installment' ? (
                          <div className="mt-2 space-y-2">
                            {upgradeSelectedPackage.downpayment_amount != null && parseFloat(upgradeSelectedPackage.downpayment_amount) > 0 && (
                              <p className="text-sm text-gray-700">
                                <strong>Down payment:</strong> <span className="font-medium">₱{parseFloat(upgradeSelectedPackage.downpayment_amount).toFixed(2)}</span>
                              </p>
                            )}
                            {upgradeSelectedPackage.package_price && (
                              <p className="text-sm text-gray-700">
                                <strong>Monthly:</strong> <span className="font-medium">₱{parseFloat(upgradeSelectedPackage.package_price).toFixed(2)}</span>
                              </p>
                            )}
                            {upgradeSelectedPromo && (() => {
                              const baseAmount = upgradeSelectedPackage.downpayment_amount != null && parseFloat(upgradeSelectedPackage.downpayment_amount) > 0
                                ? parseFloat(upgradeSelectedPackage.downpayment_amount)
                                : parseFloat(upgradeSelectedPackage.package_price || 0);
                              let promoDiscount = 0;
                              if (upgradeSelectedPromo.promo_type === 'percentage_discount' && upgradeSelectedPromo.discount_percentage) {
                                promoDiscount = (baseAmount * upgradeSelectedPromo.discount_percentage) / 100;
                              } else if (upgradeSelectedPromo.promo_type === 'fixed_discount' && upgradeSelectedPromo.discount_amount) {
                                promoDiscount = Math.min(parseFloat(upgradeSelectedPromo.discount_amount), baseAmount);
                              }
                              return promoDiscount > 0 ? (
                                <p className="text-sm text-blue-700">
                                  Promo Discount on Down payment ({upgradeSelectedPromo.promo_name}): <span className="font-medium">-₱{promoDiscount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </p>
                              ) : null;
                            })()}
                            {reservationFeePaid > 0 && (
                              <p className="text-sm text-green-700">
                                Reservation Fee Paid: <span className="font-medium">-₱{reservationFeePaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </p>
                            )}
                            {upgradeSelectedPackage.downpayment_amount != null && parseFloat(upgradeSelectedPackage.downpayment_amount) > 0 && (
                              <div className="pt-2 border-t border-gray-300">
                                <p className="text-sm font-semibold text-gray-900">
                                  Final Down payment Amount: <span className="text-lg">₱{(() => {
                                    const baseAmount = parseFloat(upgradeSelectedPackage.downpayment_amount);
                                    let promoDiscount = 0;
                                    if (upgradeSelectedPromo) {
                                      if (upgradeSelectedPromo.promo_type === 'percentage_discount' && upgradeSelectedPromo.discount_percentage) {
                                        promoDiscount = (baseAmount * upgradeSelectedPromo.discount_percentage) / 100;
                                      } else if (upgradeSelectedPromo.promo_type === 'fixed_discount' && upgradeSelectedPromo.discount_amount) {
                                        promoDiscount = Math.min(parseFloat(upgradeSelectedPromo.discount_amount), baseAmount);
                                      }
                                    }
                                    const finalAmount = Math.max(0, baseAmount - promoDiscount - reservationFeePaid);
                                    return finalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                  })()}</span>
                                </p>
                              </div>
                            )}
                          </div>
                        ) : (
                          upgradeSelectedPackage.package_price && (
                            <div className="mt-2 space-y-1">
                              <p className="text-sm text-gray-700">
                                Original Price: <span className="font-medium">₱{parseFloat(upgradeSelectedPackage.package_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </p>
                              {upgradeSelectedPromo && (() => {
                                const packagePrice = parseFloat(upgradeSelectedPackage.package_price);
                                let promoDiscount = 0;
                                if (upgradeSelectedPromo.promo_type === 'percentage_discount' && upgradeSelectedPromo.discount_percentage) {
                                  promoDiscount = (packagePrice * upgradeSelectedPromo.discount_percentage) / 100;
                                } else if (upgradeSelectedPromo.promo_type === 'fixed_discount' && upgradeSelectedPromo.discount_amount) {
                                  promoDiscount = parseFloat(upgradeSelectedPromo.discount_amount);
                                }
                                return promoDiscount > 0 ? (
                                  <p className="text-sm text-blue-700">
                                    Promo Discount ({upgradeSelectedPromo.promo_name}): <span className="font-medium">-₱{promoDiscount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  </p>
                                ) : null;
                              })()}
                              {reservationFeePaid > 0 && (
                                <p className="text-sm text-green-700">
                                  Reservation Fee Paid: <span className="font-medium">-₱{reservationFeePaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </p>
                              )}
                              <div className="pt-2 border-t border-gray-300">
                                <p className="text-sm font-semibold text-gray-900">
                                  Final Amount: <span className="text-lg">₱{(() => {
                                    const packagePrice = parseFloat(upgradeSelectedPackage.package_price);
                                    let promoDiscount = 0;
                                    if (upgradeSelectedPromo) {
                                      if (upgradeSelectedPromo.promo_type === 'percentage_discount' && upgradeSelectedPromo.discount_percentage) {
                                        promoDiscount = (packagePrice * upgradeSelectedPromo.discount_percentage) / 100;
                                      } else if (upgradeSelectedPromo.promo_type === 'fixed_discount' && upgradeSelectedPromo.discount_amount) {
                                        promoDiscount = parseFloat(upgradeSelectedPromo.discount_amount);
                                      }
                                    }
                                    const finalAmount = Math.max(0, packagePrice - promoDiscount - reservationFeePaid);
                                    return finalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                  })()}</span>
                                </p>
                              </div>
                            </div>
                          )
                        )}
                        <p className="text-sm text-gray-700 mt-1">
                          Type: {upgradeSelectedPackage.package_type}
                        </p>
                        {upgradeSelectedPromo && (
                          <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                            <p className="text-xs font-medium text-blue-900">Applied Promo: {upgradeSelectedPromo.promo_name}</p>
                            {upgradeSelectedPromo.description && (
                              <p className="text-xs text-blue-700 mt-1">{upgradeSelectedPromo.description}</p>
                            )}
                          </div>
                        )}
                      </div>

                      {upgradeShowInstallmentSettings && upgradeInstallmentSettings.invoice_issue_date && (
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                          <h4 className="font-semibold text-blue-900 mb-2">Installment Settings</h4>
                          <div className="text-sm text-blue-800 space-y-1">
                            <p>Issue Date: {upgradeInstallmentSettings.invoice_issue_date}</p>
                            <p>Due Date: {upgradeInstallmentSettings.invoice_due_date}</p>
                            <p>Billing Month: {upgradeInstallmentSettings.billing_month}</p>
                            <p>Generation Date: {upgradeInstallmentSettings.invoice_generation_date}</p>
                            <p>Frequency: {upgradeInstallmentSettings.frequency_months} month(s)</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <h4 className="font-semibold text-gray-900 mb-2">Per-Phase Enrollment</h4>
                        <p className="text-sm text-gray-700">Phase: {upgradePhaseNumber}</p>
                        {upgradePerPhaseAmount && (
                          <div className="mt-2 space-y-1">
                            <p className="text-sm text-gray-700">
                              Original Amount: <span className="font-medium">₱{parseFloat(upgradePerPhaseAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </p>
                            {reservationFeePaid > 0 && (
                              <>
                                <p className="text-sm text-green-700">
                                  Reservation Fee Paid: <span className="font-medium">-₱{reservationFeePaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </p>
                                <div className="pt-2 border-t border-gray-300">
                                  <p className="text-sm font-semibold text-gray-900">
                                    Final Amount: <span className="text-lg">₱{Math.max(0, parseFloat(upgradePerPhaseAmount || 0) - reservationFeePaid).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  </p>
                                </div>
                              </>
                            )}
                            {reservationFeePaid === 0 && (
                              <p className="text-sm font-semibold text-gray-900 mt-1">
                                Final Amount: <span className="text-lg">₱{parseFloat(upgradePerPhaseAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {upgradeSelectedPricingLists.length > 0 && (
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                          <h4 className="font-semibold text-blue-900 mb-2">Selected Pricing Lists</h4>
                          <ul className="text-sm text-blue-800 space-y-1">
                            {upgradeSelectedPricingLists.map(id => {
                              const pricing = pricingLists.find(p => p.pricinglist_id === id);
                              return pricing ? <li key={id}>• {pricing.name}</li> : null;
                            })}
                          </ul>
                        </div>
                      )}

                      {upgradeSelectedMerchandise.length > 0 && (
                        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                          <h4 className="font-semibold text-green-900 mb-2">Selected Merchandise</h4>
                          <ul className="text-sm text-green-800 space-y-1">
                            {upgradeSelectedMerchandise.map(id => {
                              const merch = merchandise.find(m => m.merchandise_id === id);
                              return merch ? <li key={id}>• {merch.merchandise_name}</li> : null;
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between space-x-3 p-6 border-t border-gray-200 flex-shrink-0">
              <div>
                {upgradeStep === 'package-selection' && (
                  <button
                    onClick={() => {
                      setUpgradeStep('enrollment-option');
                      setUpgradeEnrollmentOption('');
                      setUpgradeSelectedPackage(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    disabled={enrollSubmitting}
                  >
                    Back
                  </button>
                )}
                {upgradeStep === 'per-phase-selection' && (
                  <button
                    onClick={() => {
                      setUpgradeStep('enrollment-option');
                      setUpgradeEnrollmentOption('');
                      setUpgradePhaseNumber(null);
                      setUpgradePerPhaseAmount('');
                      setUpgradeSelectedPricingLists([]);
                      setUpgradeSelectedMerchandise([]);
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    disabled={enrollSubmitting}
                  >
                    Back
                  </button>
                )}
                {upgradeStep === 'review' && (
                  <button
                    onClick={() => {
                      if (upgradeSelectedPackage) {
                        setUpgradeStep('package-selection');
                      } else {
                        setUpgradeStep('per-phase-selection');
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    disabled={enrollSubmitting}
                  >
                    Back
                  </button>
                )}
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => {
                    setIsUpgradeModalOpen(false);
                    setSelectedReservationForUpgrade(null);
                    setUpgradeStep('enrollment-option');
                    setUpgradeEnrollmentOption('');
                    setUpgradeSelectedPackage(null);
                    setUpgradeSelectedPricingLists([]);
                    setUpgradeSelectedMerchandise([]);
                    setUpgradePerPhaseAmount('');
                    setUpgradePhaseNumber(null);
                    setUpgradeInstallmentSettings({
                      invoice_issue_date: '',
                      billing_month: '',
                      invoice_due_date: '',
                      invoice_generation_date: '',
                      frequency_months: 1,
                    });
                    setUpgradeShowInstallmentSettings(false);
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  disabled={enrollSubmitting}
                >
                  Cancel
                </button>
                {upgradeStep === 'package-config' && (
                  <button
                    onClick={() => {
                      if (upgradeShowInstallmentSettings && upgradeSelectedPackage.package_type === 'Installment') {
                        // Validate installment settings before proceeding
                        if (!upgradeInstallmentSettings.invoice_issue_date || 
                            !upgradeInstallmentSettings.billing_month || 
                            !upgradeInstallmentSettings.invoice_due_date || 
                            !upgradeInstallmentSettings.invoice_generation_date) {
                          alert('Please fill in all installment settings fields');
                          return;
                        }
                      }
                      
                      // Validate uniform size selection if package includes uniforms
                      if (upgradeSelectedPackage && selectedReservationForUpgrade) {
                        const { merchandiseTypes } = groupPackageDetails(upgradeSelectedPackage.details || []);
                        // Check all merchandise types that require sizing
                        const uniformsRequiringSizing = merchandiseTypes.filter(typeName => requiresSizingForMerchandise(typeName));
                        
                        if (uniformsRequiringSizing.length > 0) {
                          const studentId = selectedReservationForUpgrade.student_id;
                          const studentMerchSelections = upgradeStudentMerchandiseSelections[studentId] || [];
                          
                          // Validate each uniform type that requires sizing
                          for (const typeName of uniformsRequiringSizing) {
                            const uniformItems = getMerchandiseItemsByType(typeName);
                            const hasSizes = uniformItems.some(item => item.size);
                            
                            if (hasSizes) {
                              // Check if uniform categories exist (for LCA Uniform with Top/Bottom)
                              const uniformCategories = Array.from(
                                new Set(
                                  uniformItems
                                    .map(item => getUniformCategory(item))
                                    .filter(category => category && category !== 'General')
                                )
                              );
                              
                              if (uniformCategories.length > 0) {
                                // Check that each category has a size selected for this student
                                for (const category of uniformCategories) {
                                  const categorySelection = studentMerchSelections.find(m => 
                                    m.merchandise_name === typeName && m.category === category
                                  );
                                  
                                  if (!categorySelection || !categorySelection.size || categorySelection.size.trim() === '') {
                                    alert(`Please select a size for ${typeName} (${category}) for the student`);
                                    return;
                                  }
                                }
                              } else {
                                // No categories, just check for any uniform selection with size
                                const uniformSelection = studentMerchSelections.find(m => 
                                  m.merchandise_name === typeName
                                );
                                
                                if (!uniformSelection || !uniformSelection.size || uniformSelection.size.trim() === '') {
                                  alert(`Please select a size for ${typeName} for the student`);
                                  return;
                                }
                              }
                            }
                          }
                        }
                      }
                      
                      setUpgradeStep('review');
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                    disabled={enrollSubmitting}
                  >
                    Continue to Review
                  </button>
                )}
                {upgradeStep === 'per-phase-selection' && (
                  <button
                    onClick={() => {
                      if (!upgradePhaseNumber) {
                        alert('Please select a phase');
                        return;
                      }
                      if (!upgradePerPhaseAmount || parseFloat(upgradePerPhaseAmount) <= 0) {
                        alert('Please enter a valid per-phase amount');
                        return;
                      }
                      if (upgradeSelectedPricingLists.length === 0 && upgradeSelectedMerchandise.length === 0) {
                        alert('Please select at least one pricing list or merchandise');
                        return;
                      }
                      setUpgradeStep('review');
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                    disabled={enrollSubmitting}
                  >
                    Continue to Review
                  </button>
                )}
                {upgradeStep === 'review' && (
                  <button
                    onClick={handleUpgradeSubmit}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={enrollSubmitting}
                  >
                    {enrollSubmitting ? 'Upgrading...' : 'Upgrade to Enrollment'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Merge History Modal */}
      {isMergeHistoryModalOpen && selectedClassForHistory && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Merge History</h2>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedClassForHistory.program_name} - {selectedClassForHistory.class_name || selectedClassForHistory.level_tag}
                </p>
              </div>
              <button
                onClick={closeMergeHistoryModal}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {loadingMergeHistory ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
                </div>
              ) : mergeHistory.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500">No merge history found for this class.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {mergeHistory.map((history) => (
                    <div key={history.merge_history_id} className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            Merge Operation
                            {history.is_undone && (
                              <span className="ml-2 inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-200 text-gray-700">
                                Undone
                              </span>
                            )}
                          </h3>
                          <div className="text-sm text-gray-600 space-y-1">
                            <p>Merged on: {new Date(history.merged_at).toLocaleString()}</p>
                            {history.merged_by_name && <p>Merged by: {history.merged_by_name}</p>}
                            {history.is_undone && history.undone_at && (
                              <>
                                <p>Undone on: {new Date(history.undone_at).toLocaleString()}</p>
                                {history.undone_by_name && <p>Undone by: {history.undone_by_name}</p>}
                              </>
                            )}
                          </div>
                        </div>
                        {!history.is_undone && (
                          <button
                            onClick={() => handleUndoMerge(history.merge_history_id, history.merged_class_id)}
                            disabled={undoingMerge}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {undoingMerge ? 'Undoing...' : 'Undo Merge'}
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div className="bg-white rounded p-3">
                          <div className="text-xs text-gray-500 mb-1">Original Classes</div>
                          <div className="text-lg font-semibold text-gray-900">{history.summary.original_class_count}</div>
                        </div>
                        <div className="bg-white rounded p-3">
                          <div className="text-xs text-gray-500 mb-1">Enrollments</div>
                          <div className="text-lg font-semibold text-gray-900">{history.summary.original_enrollment_count}</div>
                        </div>
                        <div className="bg-white rounded p-3">
                          <div className="text-xs text-gray-500 mb-1">Unique Students</div>
                          <div className="text-lg font-semibold text-gray-900">{history.summary.unique_students}</div>
                        </div>
                        <div className="bg-white rounded p-3">
                          <div className="text-xs text-gray-500 mb-1">Schedules</div>
                          <div className="text-lg font-semibold text-gray-900">{history.summary.original_schedule_count}</div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <h4 className="text-sm font-semibold text-gray-900 mb-3">Original Classes</h4>
                        <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                          <table style={{ width: '100%', minWidth: '600px' }} className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Class Name</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Level Tag</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Students</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {history.original_classes.map((origClass) => (
                                <tr key={origClass.class_id}>
                                  <td className="px-4 py-3 text-sm text-gray-900">{origClass.class_name || '-'}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900">{origClass.level_tag || '-'}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900">{origClass.max_students || '-'}</td>
                                  <td className="px-4 py-3 text-sm">
                                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                                      origClass.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                    }`}>
                                      {origClass.status || 'Active'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0">
              <button
                onClick={closeMergeHistoryModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Alternative Classes Modal - Shown when class is full during upgrade */}
      {isAlternativeClassesModalOpen && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={() => setIsAlternativeClassesModalOpen(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Class is Full - Alternative Classes Available
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  The class you selected is full. Here are alternative classes with available slots:
                </p>
              </div>
              <button
                onClick={() => setIsAlternativeClassesModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {alternativeClasses.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500">No alternative classes found with available slots.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                  <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '800px' }}>
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Class Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Program</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Branch</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Enrolled</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reserved</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Students</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Available Slots</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {alternativeClasses.map((altClass) => (
                        <tr key={altClass.class_id} className="hover:bg-gray-50">
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {altClass.class_name || `Class ${altClass.class_id}`}
                            </div>
                            <div className="text-xs text-gray-500">{altClass.level_tag || '-'}</div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{altClass.program_name || '-'}</div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{selectedBranchName || '-'}</div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{altClass.enrolled_students || 0}</div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{altClass.reserved_students || 0}</div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{altClass.max_students || 'Unlimited'}</div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className={`text-sm font-medium ${
                              altClass.available_slots > 0 ? 'text-green-600' : 'text-gray-500'
                            }`}>
                              {altClass.available_slots > 0 ? altClass.available_slots : 'Full'}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0">
              <button
                onClick={() => setIsAlternativeClassesModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default AdminClasses;

