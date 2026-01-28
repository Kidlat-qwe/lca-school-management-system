import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import API_BASE_URL, { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const AdminInvoice = () => {
  const { userInfo } = useAuth();
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  // Removed filterBranch - admin only sees their branch
  const [filterStatus, setFilterStatus] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  // Removed openBranchDropdown - admin only sees their branch
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  // Removed branches state - admin only sees their branch
  const [students, setStudents] = useState([]);
  const [formData, setFormData] = useState({
    branch_id: '',
    amount: '',
    status: 'Draft',
    remarks: '',
    issue_date: '',
    due_date: '',
    items: [],
    students: [],
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedInvoiceForDetails, setSelectedInvoiceForDetails] = useState(null);
  const [newItem, setNewItem] = useState({
    description: '',
    amount: '',
    tax_item: '',
    tax_percentage: '',
    discount_amount: '',
    penalty_amount: '',
  });
  const [newStudentId, setNewStudentId] = useState('');
  const [packageDetails, setPackageDetails] = useState({}); // Store package details by package name
  const [editingStatus, setEditingStatus] = useState(false);
  const [tempStatus, setTempStatus] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState(null);
  const [paymentFormData, setPaymentFormData] = useState({
    student_id: '',
    payment_method: 'Cash',
    payment_type: '',
    payable_amount: '',
    issue_date: new Date().toISOString().split('T')[0],
    reference_number: '',
    remarks: '',
  });
  const [paymentFormErrors, setPaymentFormErrors] = useState({});
  const [submittingPayment, setSubmittingPayment] = useState(false);

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
    // Don't fetch branches for admin - they only see their branch
    if (adminBranchId) {
      fetchInvoices();
      fetchStudents();
    }
  }, [adminBranchId]);

  // Auto-set branch_id from adminBranchId when available
  useEffect(() => {
    if (adminBranchId && isModalOpen && !editingInvoice) {
      setFormData(prev => ({
        ...prev,
        branch_id: adminBranchId.toString(),
      }));
    }
  }, [adminBranchId, isModalOpen, editingInvoice]);

  // Fetch package details by package name
  const fetchPackageDetails = async (packageName) => {
    if (packageDetails[packageName]) {
      return packageDetails[packageName];
    }

    try {
      const response = await apiRequest('/packages?limit=1000');
      const packages = response.data || [];
      const packageData = packages.find(pkg => pkg.package_name === packageName);
      
      if (packageData) {
        setPackageDetails(prev => ({
          ...prev,
          [packageName]: packageData.details || []
        }));
        return packageData.details || [];
      }
      return [];
    } catch (err) {
      console.error('Error fetching package details:', err);
      return [];
    }
  };

  // Get expanded invoice items (package + inclusions)
  const getExpandedInvoiceItems = async (items) => {
    const expandedItems = [];
    
    for (const item of items) {
      // Check if item is a package
      if (item.description && item.description.startsWith('Package:')) {
        const packageName = item.description.replace('Package:', '').trim();
        expandedItems.push(item); // Add the package item itself
        
        // Fetch and add package details
        const details = await fetchPackageDetails(packageName);
        for (const detail of details) {
          if (detail.pricing_name) {
            expandedItems.push({
              invoice_item_id: `pricing-${detail.packagedtl_id}`,
              description: `Pricing: ${detail.pricing_name}`,
              amount: null, // No price for pricing list
              isInclusion: true
            });
          } else if (detail.merchandise_name) {
            expandedItems.push({
              invoice_item_id: `merchandise-${detail.packagedtl_id}`,
              description: `Merchandise: ${detail.merchandise_name}${detail.size ? ` (${detail.size})` : ''}`,
              amount: null, // No price for merchandise
              isInclusion: true
            });
          }
        }
      } else {
        expandedItems.push(item);
      }
    }
    
    return expandedItems;
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      // Removed openBranchDropdown - admin only sees their branch
      if (openStatusDropdown && !event.target.closest('.status-filter-dropdown')) {
        setOpenStatusDropdown(false);
      }
    };

    if (openMenuId || openStatusDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openStatusDropdown]);

  const handleMenuClick = (invoiceId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === invoiceId) {
      setOpenMenuId(null);
      setMenuPosition({ top: 0, right: 0 });
    } else {
      // Calculate available space
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedDropdownHeight = 250; // Approximate height for 5 menu items
      const dropdownWidth = 192; // w-48 = 12rem = 192px
      
      // Determine vertical position (above or below)
      let top, bottom;
      if (spaceBelow >= estimatedDropdownHeight) {
        // Enough space below - position below button with small gap (4px)
        top = rect.bottom + 4;
        bottom = 'auto';
      } else if (spaceAbove >= estimatedDropdownHeight) {
        // Not enough space below, but enough above - position above button
        bottom = viewportHeight - rect.top + 4;
        top = 'auto';
      } else {
        // Not enough space in either direction - use the side with more space
        if (spaceBelow > spaceAbove) {
          top = rect.bottom + 4;
          bottom = 'auto';
        } else {
          bottom = viewportHeight - rect.top + 4;
          top = 'auto';
        }
      }
      
      // Determine horizontal position (right or left)
      let right, left;
      right = viewportWidth - rect.right;
      left = 'auto';
      
      setMenuPosition({
        top: top !== 'auto' ? top : undefined,
        bottom: bottom !== 'auto' ? bottom : undefined,
        right: right !== 'auto' ? right : undefined,
        left: left !== 'auto' ? left : undefined,
      });
      setOpenMenuId(invoiceId);
    }
  };

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      // Filter by admin's branch
      const response = await apiRequest(`/invoices?branch_id=${adminBranchId}&limit=100`);
      setInvoices(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch invoices');
      console.error('Error fetching invoices:', err);
    } finally {
      setLoading(false);
    }
  };

  // Removed fetchBranches - admin only sees their branch

  const fetchStudents = async () => {
    try {
      // Fetch users with user_type = 'Student' filtered by admin's branch
      const response = await apiRequest('/users?limit=100');
      const studentUsers = (response.data || []).filter(user => 
        user.user_type === 'Student' && 
        (adminBranchId ? (user.branch_id === adminBranchId) : true)
      );
      setStudents(studentUsers);
    } catch (err) {
      console.error('Error fetching students:', err);
    }
  };

  const handleDelete = async (invoiceId) => {
    setOpenMenuId(null);
    
    // Verify invoice belongs to admin's branch
    const invoice = invoices.find(inv => inv.invoice_id === invoiceId);
    if (invoice && invoice.branch_id !== adminBranchId) {
      alert('You can only delete invoices from your branch.');
      return;
    }
    
    if (!window.confirm('Are you sure you want to delete this invoice? This will also delete all invoice items and student associations.')) {
      return;
    }

    try {
      await apiRequest(`/invoices/${invoiceId}`, {
        method: 'DELETE',
      });
      fetchInvoices();
    } catch (err) {
      alert(err.message || 'Failed to delete invoice');
    }
  };

  const openCreateModal = () => {
    setEditingInvoice(null);
    setError('');
    setFormData({
      branch_id: adminBranchId ? adminBranchId.toString() : '',
      amount: '',
      status: 'Draft',
      remarks: '',
      issue_date: '',
      due_date: '',
      items: [],
      students: [],
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (invoice) => {
    setOpenMenuId(null);
    
    // Verify invoice belongs to admin's branch
    if (invoice.branch_id !== adminBranchId) {
      alert('You can only edit invoices from your branch.');
      return;
    }
    
    setEditingInvoice(invoice);
    setError('');
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
    
    setFormData({
      branch_id: invoice.branch_id?.toString() || '',
      amount: invoice.amount?.toString() || '',
      status: invoice.status || 'Draft',
      remarks: invoice.remarks || '',
      issue_date: formatDateForInput(invoice.issue_date),
      due_date: formatDateForInput(invoice.due_date),
      items: invoice.items || [],
      students: invoice.students?.map(s => s.student_id) || [],
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingInvoice(null);
    setFormErrors({});
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (formErrors[name]) {
      setFormErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const addItem = () => {
    if (!newItem.description || !newItem.amount) {
      alert('Please fill in description and amount');
      return;
    }

    const item = {
      description: newItem.description.trim(),
      amount: parseFloat(newItem.amount) || 0,
      tax_item: newItem.tax_item?.trim() || null,
      tax_percentage: newItem.tax_percentage ? parseFloat(newItem.tax_percentage) : null,
      discount_amount: newItem.discount_amount ? parseFloat(newItem.discount_amount) : null,
      penalty_amount: newItem.penalty_amount ? parseFloat(newItem.penalty_amount) : null,
    };

    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, item],
    }));

    setNewItem({
      description: '',
      amount: '',
      tax_item: '',
      tax_percentage: '',
      discount_amount: '',
      penalty_amount: '',
    });
  };

  const removeItem = (index) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const addStudent = () => {
    if (!newStudentId) {
      alert('Please select a student');
      return;
    }

    const studentId = parseInt(newStudentId);
    if (formData.students.includes(studentId)) {
      alert('Student is already added');
      return;
    }

    setFormData((prev) => ({
      ...prev,
      students: [...prev.students, studentId],
    }));

    setNewStudentId('');
  };

  const removeStudent = (studentId) => {
    setFormData((prev) => ({
      ...prev,
      students: prev.students.filter(id => id !== studentId),
    }));
  };

  const validateForm = () => {
    const errors = {};
    
    if (formData.issue_date && formData.due_date) {
      const issueDate = new Date(formData.issue_date);
      const dueDate = new Date(formData.due_date);
      if (issueDate > dueDate) {
        errors.due_date = 'Due date must be after issue date';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      if (editingInvoice) {
        // When editing, only update invoice info (not items/students - they're managed separately)
        const payload = {
          amount: formData.amount && formData.amount !== '' ? parseFloat(formData.amount) : null,
          status: formData.status || 'Draft',
          remarks: formData.remarks?.trim() || null,
          issue_date: formData.issue_date || null,
          due_date: formData.due_date || null,
        };
        await apiRequest(`/invoices/${editingInvoice.invoice_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        // When creating, include items and students
        // Ensure branch_id is set to admin's branch
        const payload = {
          branch_id: adminBranchId || (formData.branch_id && formData.branch_id !== '' ? parseInt(formData.branch_id) : null),
          amount: formData.amount && formData.amount !== '' ? parseFloat(formData.amount) : null,
          status: formData.status || 'Draft',
          remarks: formData.remarks?.trim() || null,
          issue_date: formData.issue_date || null,
          due_date: formData.due_date || null,
          items: formData.items,
          students: formData.students,
        };
        await apiRequest('/invoices', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      
      closeModal();
      fetchInvoices();
    } catch (err) {
      setError(err.message || `Failed to ${editingInvoice ? 'update' : 'create'} invoice`);
      console.error('Error saving invoice:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const openViewEditInvoice = async (invoice) => {
    setOpenMenuId(null);
    // Fetch the latest invoice data with details
    try {
      const response = await apiRequest(`/invoices/${invoice.invoice_id}`);
      const invoiceData = response.data;
      
      // Expand invoice items with package details
      if (invoiceData.items && invoiceData.items.length > 0) {
        const expandedItems = await getExpandedInvoiceItems(invoiceData.items);
        invoiceData.expandedItems = expandedItems;
      }
      
      setSelectedInvoiceForDetails(invoiceData);
    } catch (err) {
      console.error('Error fetching invoice details:', err);
      setSelectedInvoiceForDetails(invoice);
    }
    setNewItem({
      description: '',
      amount: '',
      tax_item: '',
      tax_percentage: '',
      discount_amount: '',
      penalty_amount: '',
    });
    setNewStudentId('');
    setShowDetailsModal(true);
  };

  const openDetailsModal = async (invoice) => {
    // Fetch the latest invoice data with details
    try {
      const response = await apiRequest(`/invoices/${invoice.invoice_id}`);
      setSelectedInvoiceForDetails(response.data);
    } catch (err) {
      console.error('Error fetching invoice details:', err);
      setSelectedInvoiceForDetails(invoice);
    }
    setNewItem({
      description: '',
      amount: '',
      tax_item: '',
      tax_percentage: '',
      discount_amount: '',
      penalty_amount: '',
    });
    setNewStudentId('');
    setShowDetailsModal(true);
  };

  const handleDownloadPDF = async (invoice) => {
    setOpenMenuId(null);
    try {
      const token = localStorage.getItem('firebase_token');
      const response = await fetch(`${API_BASE_URL}/invoices/${invoice.invoice_id}/pdf`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to download invoice PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Optional: revoke later
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Download invoice PDF failed:', err);
      alert(err.message || 'Failed to download invoice PDF');
    }
  };

  const handleViewEditReceipt = async (invoice) => {
    setOpenMenuId(null);
    alert('Receipt management is not yet implemented.');
  };

  const handleDeleteReceipt = async (invoice) => {
    setOpenMenuId(null);
    alert('Receipt deletion is not yet implemented.');
  };

  const handleOpenPaymentModal = async (invoice) => {
    setOpenMenuId(null);
    try {
      // Fetch the latest invoice data with details
      const response = await apiRequest(`/invoices/${invoice.invoice_id}`);
      const invoiceData = response.data;
      
      setSelectedInvoiceForPayment(invoiceData);
      
      // Pre-select first student if available
      const defaultStudentId = invoiceData.students && invoiceData.students.length > 0 
        ? invoiceData.students[0].student_id 
        : '';
      
      setPaymentFormData({
        student_id: defaultStudentId,
        payment_method: 'Cash',
        payment_type: '',
        payable_amount: invoiceData.amount || '',
        issue_date: new Date().toISOString().split('T')[0],
        reference_number: '',
        remarks: '',
      });
      setPaymentFormErrors({});
      setShowPaymentModal(true);
    } catch (err) {
      console.error('Error fetching invoice details:', err);
      alert('Error loading invoice details. Please try again.');
    }
  };

  const handleClosePaymentModal = () => {
    setShowPaymentModal(false);
    setSelectedInvoiceForPayment(null);
    setPaymentFormData({
      student_id: '',
      payment_method: 'Cash',
      payment_type: '',
      payable_amount: '',
      issue_date: new Date().toISOString().split('T')[0],
      reference_number: '',
      remarks: '',
    });
    setPaymentFormErrors({});
  };

  const handlePaymentInputChange = (e) => {
    const { name, value } = e.target;
    setPaymentFormData(prev => {
      const updated = {
        ...prev,
        [name]: value,
      };
      // Clear reference number when switching to Cash
      if (name === 'payment_method' && value === 'Cash') {
        updated.reference_number = '';
      }
      return updated;
    });
    // Clear error for this field
    if (paymentFormErrors[name]) {
      setPaymentFormErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const validatePaymentForm = () => {
    const errors = {};
    
    if (!paymentFormData.student_id) {
      errors.student_id = 'Student is required';
    }
    // Payment method is now fixed to "Cash" and cannot be changed
    if (!paymentFormData.payment_type) {
      errors.payment_type = 'Payment type is required';
    }
    if (!paymentFormData.payable_amount || parseFloat(paymentFormData.payable_amount) <= 0) {
      errors.payable_amount = 'Payable amount must be greater than 0';
    }
    if (!paymentFormData.issue_date) {
      errors.issue_date = 'Issue date is required';
    }
    
    setPaymentFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmitPayment = async (e) => {
    e.preventDefault();
    
    if (!validatePaymentForm()) {
      return;
    }
    
    setSubmittingPayment(true);
    
    try {
      const payload = {
        invoice_id: selectedInvoiceForPayment.invoice_id,
        student_id: parseInt(paymentFormData.student_id, 10),
        payment_method: paymentFormData.payment_method,
        payment_type: paymentFormData.payment_type,
        payable_amount: parseFloat(paymentFormData.payable_amount),
        issue_date: paymentFormData.issue_date,
      };

      if (paymentFormData.reference_number && paymentFormData.reference_number.trim() !== '') {
        payload.reference_number = paymentFormData.reference_number.trim();
      }

      if (paymentFormData.remarks && paymentFormData.remarks.trim() !== '') {
        payload.remarks = paymentFormData.remarks.trim();
      }
      
      await apiRequest('/payments', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      
      alert('Payment recorded successfully!');
      handleClosePaymentModal();
      fetchInvoices(); // Refresh invoice list to show updated status
    } catch (err) {
      console.error('Error submitting payment:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Error recording payment. Please try again.';
      alert(`Error: ${errorMessage}`);
    } finally {
      setSubmittingPayment(false);
    }
  };

  const closeDetailsModal = () => {
    setShowDetailsModal(false);
    setSelectedInvoiceForDetails(null);
    setEditingStatus(false);
    setTempStatus('');
  };

  const handleStatusChange = (newStatus) => {
    setTempStatus(newStatus);
  };

  const updateInvoiceStatus = async () => {
    if (!selectedInvoiceForDetails || !tempStatus) {
      return;
    }

    if (tempStatus === selectedInvoiceForDetails.status) {
      setEditingStatus(false);
      return;
    }

    setUpdatingStatus(true);
    try {
      await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: tempStatus }),
      });

      // Update local state
      setSelectedInvoiceForDetails({
        ...selectedInvoiceForDetails,
        status: tempStatus,
      });

      // Refresh invoices list
      await fetchInvoices();

      setEditingStatus(false);
    } catch (err) {
      alert(err.message || 'Failed to update invoice status');
      setTempStatus(selectedInvoiceForDetails.status); // Revert on error
    } finally {
      setUpdatingStatus(false);
    }
  };

  const startEditingStatus = () => {
    setTempStatus(selectedInvoiceForDetails.status || 'Pending');
    setEditingStatus(true);
  };

  const cancelEditingStatus = () => {
    setTempStatus('');
    setEditingStatus(false);
  };

  const addInvoiceItem = async () => {
    if (!newItem.description || !newItem.amount) {
      alert('Please fill in description and amount');
      return;
    }

    try {
      const payload = {
        description: newItem.description.trim(),
        amount: parseFloat(newItem.amount) || 0,
        tax_item: newItem.tax_item?.trim() || null,
        tax_percentage: newItem.tax_percentage ? parseFloat(newItem.tax_percentage) : null,
        discount_amount: newItem.discount_amount ? parseFloat(newItem.discount_amount) : null,
        penalty_amount: newItem.penalty_amount ? parseFloat(newItem.penalty_amount) : null,
      };

      await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}/items`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setNewItem({
        description: '',
        amount: '',
        tax_item: '',
        tax_percentage: '',
        discount_amount: '',
        penalty_amount: '',
      });
      
      // Refresh invoice data
      await fetchInvoices();
      const updatedInvoice = await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}`);
      const invoiceData = updatedInvoice.data;
      
      // Expand invoice items with package details
      if (invoiceData.items && invoiceData.items.length > 0) {
        const expandedItems = await getExpandedInvoiceItems(invoiceData.items);
        invoiceData.expandedItems = expandedItems;
      }
      
      setSelectedInvoiceForDetails(invoiceData);
    } catch (err) {
      alert(err.message || 'Failed to add invoice item');
    }
  };

  const removeInvoiceItem = async (itemId) => {
    if (!window.confirm('Are you sure you want to remove this item?')) {
      return;
    }

    try {
      await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}/items/${itemId}`, {
        method: 'DELETE',
      });
      
      // Refresh invoice data
      await fetchInvoices();
      const updatedInvoice = await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}`);
      const invoiceData = updatedInvoice.data;
      
      // Expand invoice items with package details
      if (invoiceData.items && invoiceData.items.length > 0) {
        const expandedItems = await getExpandedInvoiceItems(invoiceData.items);
        invoiceData.expandedItems = expandedItems;
      }
      
      setSelectedInvoiceForDetails(invoiceData);
    } catch (err) {
      alert(err.message || 'Failed to remove invoice item');
    }
  };

  const addInvoiceStudent = async () => {
    if (!newStudentId) {
      alert('Please select a student');
      return;
    }

    try {
      await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}/students`, {
        method: 'POST',
        body: JSON.stringify({ student_id: parseInt(newStudentId) }),
      });

      setNewStudentId('');
      
      // Refresh invoice data
      await fetchInvoices();
      const updatedInvoice = await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}`);
      setSelectedInvoiceForDetails(updatedInvoice.data);
    } catch (err) {
      alert(err.message || 'Failed to add student to invoice');
    }
  };

  const removeInvoiceStudent = async (studentId) => {
    if (!window.confirm('Are you sure you want to remove this student from the invoice?')) {
      return;
    }

    try {
      await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}/students/${studentId}`, {
        method: 'DELETE',
      });
      
      // Refresh invoice data
      await fetchInvoices();
      const updatedInvoice = await apiRequest(`/invoices/${selectedInvoiceForDetails.invoice_id}`);
      setSelectedInvoiceForDetails(updatedInvoice.data);
    } catch (err) {
      alert(err.message || 'Failed to remove student from invoice');
    }
  };

  // Helper functions
  // Removed getBranchName, formatBranchName, getUniqueBranches - admin only sees their branch
  const getStudentName = (studentId) => {
    if (!studentId) return null;
    const student = students.find(s => s.user_id === studentId);
    return student ? student.full_name : null;
  };

  const getUniqueStatuses = [...new Set(invoices.map(i => i.status).filter(Boolean))];

  const filteredInvoices = invoices.filter((invoice) => {
    const invoiceIdStr = `INV-${invoice.invoice_id}`;
    const matchesSearch = !nameSearchTerm || 
      invoiceIdStr.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      invoice.invoice_id?.toString().includes(nameSearchTerm) ||
      invoice.invoice_description?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    // Removed matchesBranch - admin only sees their branch
    // Show all invoices by default, including Paid (needed for PDF download)
    const matchesStatus = filterStatus
      ? invoice.status === filterStatus
      : true;
    
    return matchesSearch && matchesStatus;
  });

  const calculateItemTotal = (item) => {
    const amount = parseFloat(item.amount) || 0;
    const discount = parseFloat(item.discount_amount) || 0;
    const penalty = parseFloat(item.penalty_amount) || 0;
    const taxPercent = parseFloat(item.tax_percentage) || 0;
    const subtotal = amount - discount + penalty;
    const tax = subtotal * (taxPercent / 100);
    return subtotal + tax;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Invoices</h1>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Invoices List */}
      {filteredInvoices.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterStatus
              ? 'No invoices found matching your criteria.'
              : 'No invoices found. Add your first invoice to get started.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Desktop Table View */}
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1200px' }}>
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-1">
                        {nameSearchTerm && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          value={nameSearchTerm}
                          onChange={(e) => setNameSearchTerm(e.target.value)}
                          placeholder="Search invoice..."
                          className="px-2 py-1 pr-6 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 w-full"
                          onClick={(e) => e.stopPropagation()}
                        />
                        {nameSearchTerm && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setNameSearchTerm('');
                            }}
                            className="absolute right-1 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    STUDENT NAME
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Branch
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="relative status-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenStatusDropdown(!openStatusDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Status</span>
                        {filterStatus && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openStatusDropdown && (
                        <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                          <div className="py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterStatus('');
                                setOpenStatusDropdown(false);
                              }}
                              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                !filterStatus ? 'bg-gray-100 font-medium' : 'text-gray-700'
                              }`}
                            >
                              All Statuses
                            </button>
                            {getUniqueStatuses.map((status) => (
                              <button
                                key={status}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFilterStatus(status);
                                  setOpenStatusDropdown(false);
                                }}
                                className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                  filterStatus === status ? 'bg-gray-100 font-medium' : 'text-gray-700'
                                }`}
                              >
                                {status}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Due Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.invoice_id}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <span>INV-{invoice.invoice_id}</span>
                        {invoice.status === 'Partially Paid' && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200">
                            Partial payment
                          </span>
                        )}
                      </div>
                      {invoice.invoice_description && (
                        <div className="text-xs text-gray-500 mt-1">
                          {invoice.invoice_description}
                        </div>
                      )}
                      {invoice.reservation && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                            Reservation
                          </span>
                          {invoice.reservation.is_expired && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-800 border border-red-200 font-semibold">
                              Expired
                            </span>
                          )}
                          {invoice.reservation.status === 'Expired' && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-800 border border-red-200 font-semibold">
                              Reservation Expired
                            </span>
                          )}
                          {invoice.reservation.due_date && !invoice.reservation.is_expired && invoice.reservation.status !== 'Expired' && (
                            <span className="text-xs text-gray-500">
                              Due: {new Date(invoice.reservation.due_date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {invoice.students && invoice.students.length > 0 ? (
                          <div className="space-y-1">
                            {invoice.students.slice(0, 2).map((student, idx) => (
                              <div key={student.invoice_student_id || idx} className="font-medium">
                                {student.full_name || '-'}
                              </div>
                            ))}
                            {invoice.students.length > 2 && (
                              <div className="text-xs text-gray-500">
                                +{invoice.students.length - 2} more
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">No student</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {selectedBranchName}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          invoice.status === 'Paid'
                            ? 'bg-green-100 text-green-800'
                            : invoice.status === 'Pending'
                            ? 'bg-yellow-100 text-yellow-800'
                            : invoice.status === 'Unpaid'
                            ? 'bg-red-100 text-red-800'
                            : invoice.status === 'Overdue'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {invoice.status || 'Draft'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {invoice.amount !== null && invoice.amount !== undefined
                          ? `₱${parseFloat(invoice.amount).toFixed(2)}`
                          : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {invoice.due_date
                          ? new Date(invoice.due_date).toLocaleDateString()
                          : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="relative action-menu-container">
                        <button
                          onClick={(e) => handleMenuClick(invoice.invoice_id, e)}
                          className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                        >
                          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Results Count */}
      {filteredInvoices.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredInvoices.length} of {invoices.length} invoices
        </div>
      )}

      {/* Action Menu Overlay */}
      {openMenuId && createPortal(
        <>
          <div 
            className="fixed inset-0 z-40 bg-transparent" 
            onClick={() => {
              setOpenMenuId(null);
              setMenuPosition({ top: 0, right: 0 });
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
              {(() => {
                const selectedInvoice = filteredInvoices.find(i => i.invoice_id === openMenuId);
                if (!selectedInvoice) return null;
                return (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        setMenuPosition({ top: 0, right: 0 });
                        handleDownloadPDF(selectedInvoice);
                      }}
                      className="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <span>Download Invoice PDF</span>
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        setMenuPosition({ top: 0, right: 0 });
                        handleDelete(openMenuId);
                      }}
                      className="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <span>Delete Invoice</span>
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        setMenuPosition({ top: 0, right: 0 });
                        handleOpenPaymentModal(selectedInvoice);
                      }}
                      className="flex items-center justify-between w-full text-left px-4 py-2 text-sm text-green-600 hover:bg-green-50 transition-colors"
                    >
                      <span>Pay</span>
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Create/Edit Invoice Modal */}
      {isModalOpen && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingInvoice ? 'Edit Invoice' : 'Create New Invoice'}
                </h2>
                {!editingInvoice && (
                  <p className="text-sm text-gray-500 mt-1">Fill in the details to create a new invoice</p>
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
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="p-6 overflow-y-auto flex-1">
                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                    {error}
                  </div>
                )}
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    {!editingInvoice && (
                      <div>
                        <label htmlFor="branch_id" className="label-field">
                          Branch
                        </label>
                        {/* Branch is auto-set to admin's branch - read-only display */}
                        <div>
                          <input
                            type="text"
                            value={selectedBranchName}
                            readOnly
                            className="input-field bg-gray-50 cursor-not-allowed"
                          />
                          <input
                            type="hidden"
                            id="branch_id"
                            name="branch_id"
                            value={formData.branch_id}
                          />
                          <p className="mt-1 text-xs text-gray-500">
                            Branch is automatically set to your branch
                          </p>
                        </div>
                      </div>
                    )}

                    <div>
                      <label htmlFor="status" className="label-field">
                        Status
                      </label>
                      <select
                        id="status"
                        name="status"
                        value={formData.status}
                        onChange={handleInputChange}
                        className="input-field"
                      >
                        <option value="Draft">Draft</option>
                        <option value="Pending">Pending</option>
                        <option value="Paid">Paid</option>
                        <option value="Overdue">Overdue</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="amount" className="label-field">
                        Total Amount
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        id="amount"
                        name="amount"
                        value={formData.amount}
                        onChange={handleInputChange}
                        className="input-field"
                        placeholder="0.00"
                      />
                    </div>

                    <div>
                      <label htmlFor="issue_date" className="label-field">
                        Issue Date
                      </label>
                      <input
                        type="date"
                        id="issue_date"
                        name="issue_date"
                        value={formData.issue_date}
                        onChange={handleInputChange}
                        className="input-field"
                      />
                    </div>

                    <div>
                      <label htmlFor="due_date" className="label-field">
                        Due Date
                      </label>
                      <input
                        type="date"
                        id="due_date"
                        name="due_date"
                        value={formData.due_date}
                        onChange={handleInputChange}
                        className={`input-field ${formErrors.due_date ? 'border-red-500' : ''}`}
                      />
                      {formErrors.due_date && (
                        <p className="mt-1 text-sm text-red-600">{formErrors.due_date}</p>
                      )}
                    </div>

                    <div className="md:col-span-2">
                      <label htmlFor="remarks" className="label-field">
                        Remarks
                      </label>
                      <textarea
                        id="remarks"
                        name="remarks"
                        value={formData.remarks}
                        onChange={handleInputChange}
                        className="input-field"
                        rows="3"
                        placeholder="Additional notes or remarks..."
                      />
                    </div>
                  </div>

                  {/* Invoice Items Section - Only show when creating */}
                  {!editingInvoice && (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">Invoice Items</h3>
                        <button
                          type="button"
                          onClick={addItem}
                          className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                        >
                          + Add Item
                        </button>
                      </div>

                      {formData.items.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No items added yet. Click "Add Item" to add invoice line items.</p>
                      ) : (
                        <div className="space-y-3">
                          {formData.items.map((item, index) => (
                            <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                              <div className="flex items-start justify-between">
                                <div className="flex-1 space-y-2">
                                  <div>
                                    <span className="text-xs text-gray-500">Description:</span>
                                    <span className="ml-2 text-sm font-medium text-gray-900">{item.description}</span>
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                    <div>
                                      <span className="text-gray-500">Amount:</span>
                                      <span className="ml-1 font-medium">₱{parseFloat(item.amount || 0).toFixed(2)}</span>
                                    </div>
                                    {item.tax_percentage && (
                                      <div>
                                        <span className="text-gray-500">Tax ({item.tax_percentage}%):</span>
                                        <span className="ml-1 font-medium">₱{(parseFloat(item.amount || 0) * parseFloat(item.tax_percentage) / 100).toFixed(2)}</span>
                                      </div>
                                    )}
                                    {item.discount_amount && (
                                      <div>
                                        <span className="text-gray-500">Discount:</span>
                                        <span className="ml-1 font-medium text-green-600">-₱{parseFloat(item.discount_amount).toFixed(2)}</span>
                                      </div>
                                    )}
                                    {item.penalty_amount && (
                                      <div>
                                        <span className="text-gray-500">Penalty:</span>
                                        <span className="ml-1 font-medium text-red-600">+₱{parseFloat(item.penalty_amount).toFixed(2)}</span>
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <span className="text-xs text-gray-500">Total:</span>
                                    <span className="ml-2 text-sm font-bold text-gray-900">₱{calculateItemTotal(item).toFixed(2)}</span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeItem(index)}
                                  className="text-red-600 hover:text-red-700 ml-4"
                                >
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add Item Form */}
                      <div className="mt-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="label-field text-xs">Description *</label>
                            <input
                              type="text"
                              value={newItem.description}
                              onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                              className="input-field text-sm"
                              placeholder="Item description"
                            />
                          </div>
                          <div>
                            <label className="label-field text-xs">Amount *</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={newItem.amount}
                              onChange={(e) => setNewItem({ ...newItem, amount: e.target.value })}
                              className="input-field text-sm"
                              placeholder="0.00"
                            />
                          </div>
                          <div>
                            <label className="label-field text-xs">Tax Item</label>
                            <input
                              type="text"
                              value={newItem.tax_item}
                              onChange={(e) => setNewItem({ ...newItem, tax_item: e.target.value })}
                              className="input-field text-sm"
                              placeholder="e.g., VAT, GST"
                            />
                          </div>
                          <div>
                            <label className="label-field text-xs">Tax Percentage (%)</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={newItem.tax_percentage}
                              onChange={(e) => setNewItem({ ...newItem, tax_percentage: e.target.value })}
                              className="input-field text-sm"
                              placeholder="0.00"
                            />
                          </div>
                          <div>
                            <label className="label-field text-xs">Discount Amount</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={newItem.discount_amount}
                              onChange={(e) => setNewItem({ ...newItem, discount_amount: e.target.value })}
                              className="input-field text-sm"
                              placeholder="0.00"
                            />
                          </div>
                          <div>
                            <label className="label-field text-xs">Penalty Amount</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={newItem.penalty_amount}
                              onChange={(e) => setNewItem({ ...newItem, penalty_amount: e.target.value })}
                              className="input-field text-sm"
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Invoice Students Section - Only show when creating */}
                  {!editingInvoice && (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">Students</h3>
                        <button
                          type="button"
                          onClick={addStudent}
                          className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                        >
                          + Add Student
                        </button>
                      </div>

                      {formData.students.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">No students added yet. Click "Add Student" to link students to this invoice.</p>
                      ) : (
                        <div className="space-y-2">
                          {formData.students.map((studentId) => (
                            <div key={studentId} className="flex items-center justify-between border border-gray-200 rounded-lg p-3 bg-gray-50">
                              <span className="text-sm text-gray-900">{getStudentName(studentId) || `Student ID: ${studentId}`}</span>
                              <button
                                type="button"
                                onClick={() => removeStudent(studentId)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add Student Form */}
                      <div className="mt-4">
                        <select
                          value={newStudentId}
                          onChange={(e) => setNewStudentId(e.target.value)}
                          className="input-field"
                        >
                          <option value="">Select Student</option>
                          {students
                            .filter(s => !formData.students.includes(s.user_id))
                            .map((student) => (
                              <option key={student.user_id} value={student.user_id}>
                                {student.full_name} {student.email ? `(${student.email})` : ''}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {editingInvoice && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
                      <p>To manage invoice items and students, use the "Manage Details" option from the action menu after saving.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
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
                      <span>Saving...</span>
                    </span>
                  ) : (
                    editingInvoice ? 'Update Invoice' : 'Create Invoice'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Manage Details Modal */}
      {showDetailsModal && selectedInvoiceForDetails && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeDetailsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  View & Edit Invoice
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  INV-{selectedInvoiceForDetails.invoice_id}
                  {selectedInvoiceForDetails.invoice_description && (
                    <span className="ml-2">- {selectedInvoiceForDetails.invoice_description}</span>
                  )}
                </p>
              </div>
              <button
                onClick={closeDetailsModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              {/* Invoice Details Section */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Invoice Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <span className="text-xs text-gray-500">Branch:</span>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {selectedBranchName || '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Status:</span>
                    {editingStatus ? (
                      <div className="mt-1 flex items-center gap-2">
                        <select
                          value={tempStatus}
                          onChange={(e) => handleStatusChange(e.target.value)}
                          disabled={updatingStatus}
                          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent bg-white"
                        >
                          <option value="Pending">Pending</option>
                          <option value="Unpaid">Unpaid</option>
                          <option value="Paid">Paid</option>
                        </select>
                        <button
                          onClick={updateInvoiceStatus}
                          disabled={updatingStatus}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {updatingStatus ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEditingStatus}
                          disabled={updatingStatus}
                          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            selectedInvoiceForDetails.status === 'Paid'
                              ? 'bg-green-100 text-green-800'
                              : selectedInvoiceForDetails.status === 'Pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : selectedInvoiceForDetails.status === 'Unpaid'
                              ? 'bg-orange-100 text-orange-800'
                              : selectedInvoiceForDetails.status === 'Overdue'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {selectedInvoiceForDetails.status || 'Draft'}
                        </span>
                        <button
                          onClick={startEditingStatus}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                          title="Edit status"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Total Amount:</span>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {selectedInvoiceForDetails.amount !== null && selectedInvoiceForDetails.amount !== undefined
                        ? `₱${parseFloat(selectedInvoiceForDetails.amount).toFixed(2)}`
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Issue Date:</span>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {selectedInvoiceForDetails.issue_date
                        ? new Date(selectedInvoiceForDetails.issue_date).toLocaleDateString()
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Due Date:</span>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {selectedInvoiceForDetails.due_date
                        ? new Date(selectedInvoiceForDetails.due_date).toLocaleDateString()
                        : '-'}
                    </p>
                  </div>
                  {selectedInvoiceForDetails.remarks && (
                    <div className="md:col-span-2">
                      <span className="text-xs text-gray-500">Remarks:</span>
                      <p className="text-sm text-gray-900 mt-1">{selectedInvoiceForDetails.remarks}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Invoice Items Section */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Invoice Items</h3>
                {selectedInvoiceForDetails.expandedItems && selectedInvoiceForDetails.expandedItems.length > 0 ? (
                  <div className="space-y-3 mb-4">
                    {selectedInvoiceForDetails.expandedItems.map((item) => {
                      const isInclusion = item.isInclusion;
                      const isPackage = item.description && item.description.startsWith('Package:');
                      
                      return (
                        <div key={item.invoice_item_id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 space-y-2">
                              <div>
                                <span className="text-xs text-gray-500">Description:</span>
                                <span className="ml-2 text-sm font-medium text-gray-900">{item.description || '-'}</span>
                              </div>
                              {/* Only show amount and total for packages, not for inclusions */}
                              {!isInclusion && (
                                <>
                                  {item.amount !== null && item.amount !== undefined && (
                                    <div>
                                      <span className="text-xs text-gray-500">Amount:</span>
                                      <span className="ml-2 text-sm font-medium text-gray-900">₱{parseFloat(item.amount || 0).toFixed(2)}</span>
                                    </div>
                                  )}
                                  <div>
                                    <span className="text-xs text-gray-500">Total:</span>
                                    <span className="ml-2 text-sm font-bold text-gray-900">₱{calculateItemTotal(item).toFixed(2)}</span>
                                  </div>
                                </>
                              )}
                            </div>
                            {/* Only show delete button for actual invoice items, not inclusions */}
                            {!isInclusion && (
                              <button
                                onClick={() => removeInvoiceItem(item.invoice_item_id)}
                                className="text-red-600 hover:text-red-700 ml-4"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : selectedInvoiceForDetails.items && selectedInvoiceForDetails.items.length > 0 ? (
                  <div className="space-y-3 mb-4">
                    {selectedInvoiceForDetails.items.map((item) => (
                      <div key={item.invoice_item_id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 space-y-2">
                            <div>
                              <span className="text-xs text-gray-500">Description:</span>
                              <span className="ml-2 text-sm font-medium text-gray-900">{item.description || '-'}</span>
                            </div>
                            {item.amount !== null && item.amount !== undefined && (
                              <div>
                                <span className="text-xs text-gray-500">Amount:</span>
                                <span className="ml-2 text-sm font-medium text-gray-900">₱{parseFloat(item.amount || 0).toFixed(2)}</span>
                              </div>
                            )}
                            <div>
                              <span className="text-xs text-gray-500">Total:</span>
                              <span className="ml-2 text-sm font-bold text-gray-900">₱{calculateItemTotal(item).toFixed(2)}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => removeInvoiceItem(item.invoice_item_id)}
                            className="text-red-600 hover:text-red-700 ml-4"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic mb-4">No items added yet.</p>
                )}

                {/* Add New Item */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-md font-semibold text-gray-900 mb-3">Add New Item</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="label-field text-xs">Description *</label>
                      <input
                        type="text"
                        value={newItem.description}
                        onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                        className="input-field text-sm"
                        placeholder="Item description"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Amount *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={newItem.amount}
                        onChange={(e) => setNewItem({ ...newItem, amount: e.target.value })}
                        className="input-field text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Tax Item</label>
                      <input
                        type="text"
                        value={newItem.tax_item}
                        onChange={(e) => setNewItem({ ...newItem, tax_item: e.target.value })}
                        className="input-field text-sm"
                        placeholder="e.g., VAT, GST"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Tax Percentage (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={newItem.tax_percentage}
                        onChange={(e) => setNewItem({ ...newItem, tax_percentage: e.target.value })}
                        className="input-field text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Discount Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={newItem.discount_amount}
                        onChange={(e) => setNewItem({ ...newItem, discount_amount: e.target.value })}
                        className="input-field text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="label-field text-xs">Penalty Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={newItem.penalty_amount}
                        onChange={(e) => setNewItem({ ...newItem, penalty_amount: e.target.value })}
                        className="input-field text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <button
                        type="button"
                        onClick={addInvoiceItem}
                        className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                      >
                        Add Item
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Invoice Students Section */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Students</h3>
                {selectedInvoiceForDetails.students && selectedInvoiceForDetails.students.length > 0 ? (
                  <div className="space-y-2 mb-4">
                    {selectedInvoiceForDetails.students.map((student) => (
                      <div key={student.invoice_student_id} className="flex items-center justify-between border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <div>
                          <span className="text-sm font-medium text-gray-900">{student.full_name || `Student ID: ${student.student_id}`}</span>
                          {student.email && (
                            <span className="ml-2 text-sm text-gray-500">({student.email})</span>
                          )}
                        </div>
                        <button
                          onClick={() => removeInvoiceStudent(student.student_id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic mb-4">No students linked yet.</p>
                )}

                {/* Add New Student */}
                <div className="border-t border-gray-200 pt-4">
                  <h4 className="text-md font-semibold text-gray-900 mb-3">Add Student</h4>
                  <div className="flex gap-2">
                    <select
                      value={newStudentId}
                      onChange={(e) => setNewStudentId(e.target.value)}
                      className="input-field flex-1"
                    >
                      <option value="">Select Student</option>
                      {students
                        .filter(s => !selectedInvoiceForDetails.students?.some(linked => linked.student_id === s.user_id))
                        .map((student) => (
                          <option key={student.user_id} value={student.user_id}>
                            {student.full_name} {student.email ? `(${student.email})` : ''}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={addInvoiceStudent}
                      className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                    >
                      Add Student
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
              <button
                type="button"
                onClick={closeDetailsModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedInvoiceForPayment && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">Record Payment</h2>
              <button
                onClick={handleClosePaymentModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmitPayment} className="p-6 space-y-6">
              {/* Invoice Information */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Invoice Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-600">Invoice ID</label>
                    <p className="text-sm font-medium text-gray-900">{selectedInvoiceForPayment.invoice_description || `INV-${selectedInvoiceForPayment.invoice_id}`}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Invoice Amount</label>
                    <p className="text-sm font-medium text-gray-900">₱{parseFloat(selectedInvoiceForPayment.amount || 0).toFixed(2)}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Issue Date</label>
                    <p className="text-sm font-medium text-gray-900">{selectedInvoiceForPayment.issue_date || '-'}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Due Date</label>
                    <p className="text-sm font-medium text-gray-900">{selectedInvoiceForPayment.due_date || '-'}</p>
                  </div>
                </div>
              </div>

              {/* Payment Form */}
              <div className="space-y-4">
                <div>
                  <label className="label-field text-xs">
                    Student <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="student_id"
                    value={paymentFormData.student_id}
                    onChange={handlePaymentInputChange}
                    className={`input-field text-sm ${paymentFormErrors.student_id ? 'border-red-500' : ''}`}
                    required
                  >
                    <option value="">Select Student</option>
                    {selectedInvoiceForPayment.students && selectedInvoiceForPayment.students.map((student) => (
                      <option key={student.student_id} value={student.student_id}>
                        {student.full_name} {student.email ? `(${student.email})` : ''}
                      </option>
                    ))}
                  </select>
                  {paymentFormErrors.student_id && (
                    <p className="text-xs text-red-500 mt-1">{paymentFormErrors.student_id}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Payment Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="payment_type"
                      value={paymentFormData.payment_type}
                      onChange={handlePaymentInputChange}
                      className={`input-field text-sm ${paymentFormErrors.payment_type ? 'border-red-500' : ''}`}
                      required
                    >
                      <option value="">Select Payment Type</option>
                      <option value="Full Payment">Full Payment</option>
                      <option value="Partial Payment">Partial Payment</option>
                      <option value="Advance Payment">Advance Payment</option>
                    </select>
                    {paymentFormErrors.payment_type && (
                      <p className="text-xs text-red-500 mt-1">{paymentFormErrors.payment_type}</p>
                    )}
                  </div>

                  <div>
                    <label className="label-field text-xs">
                      Payment Method <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="payment_method"
                      value={paymentFormData.payment_method}
                      onChange={handlePaymentInputChange}
                      className={`input-field text-sm ${paymentFormErrors.payment_method ? 'border-red-500' : ''}`}
                      required
                    >
                      <option value="Cash">Cash</option>
                      <option value="Online Banking">Online Banking</option>
                      <option value="Credit Card">Credit Card</option>
                      <option value="E-wallets">E-wallets</option>
                    </select>
                    {paymentFormErrors.payment_method && (
                      <p className="text-xs text-red-500 mt-1">{paymentFormErrors.payment_method}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Payable Amount <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      name="payable_amount"
                      value={paymentFormData.payable_amount}
                      onChange={handlePaymentInputChange}
                      className={`input-field text-sm ${paymentFormErrors.payable_amount ? 'border-red-500' : ''}`}
                      placeholder="0.00"
                      required
                    />
                    {paymentFormErrors.payable_amount && (
                      <p className="text-xs text-red-500 mt-1">{paymentFormErrors.payable_amount}</p>
                    )}
                  </div>

                  <div>
                    <label className="label-field text-xs">
                      Issue Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      name="issue_date"
                      value={paymentFormData.issue_date}
                      onChange={handlePaymentInputChange}
                      className={`input-field text-sm ${paymentFormErrors.issue_date ? 'border-red-500' : ''}`}
                      required
                    />
                    {paymentFormErrors.issue_date && (
                      <p className="text-xs text-red-500 mt-1">{paymentFormErrors.issue_date}</p>
                    )}
                  </div>
                </div>

                {(paymentFormData.payment_method === 'Online Banking' || 
                  paymentFormData.payment_method === 'Credit Card' || 
                  paymentFormData.payment_method === 'E-wallets') && (
                  <div>
                    <label className="label-field text-xs">Reference Number</label>
                    <input
                      type="text"
                      name="reference_number"
                      value={paymentFormData.reference_number}
                      onChange={handlePaymentInputChange}
                      className="input-field text-sm"
                      placeholder="Enter reference number"
                    />
                  </div>
                )}

                <div>
                  <label className="label-field text-xs">Remarks</label>
                  <textarea
                    name="remarks"
                    value={paymentFormData.remarks}
                    onChange={handlePaymentInputChange}
                    className="input-field text-sm"
                    rows="3"
                    placeholder="Optional remarks or notes"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={handleClosePaymentModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  disabled={submittingPayment}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={submittingPayment}
                >
                  {submittingPayment ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default AdminInvoice;

