import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';

const TeacherCurriculum = () => {
  const [curricula, setCurricula] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedCurriculumForDetails, setSelectedCurriculumForDetails] = useState(null);
  const [phaseSessions, setPhaseSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => {
    fetchCurricula();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openStatusDropdown && !event.target.closest('.status-filter-dropdown')) {
        setOpenStatusDropdown(false);
      }
    };

    if (openStatusDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openStatusDropdown]);

  const fetchCurricula = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/curriculum');
      setCurricula(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch curricula');
      console.error('Error fetching curricula:', err);
    } finally {
      setLoading(false);
    }
  };

  const openViewDetailsModal = (curriculum) => {
    setSelectedCurriculumForDetails(curriculum);
    setIsDetailsModalOpen(true);
    fetchPhaseSessions(curriculum.curriculum_id);
  };

  const closeDetailsModal = () => {
    setIsDetailsModalOpen(false);
    setSelectedCurriculumForDetails(null);
    setPhaseSessions([]);
  };

  const fetchPhaseSessions = async (curriculumId) => {
    try {
      setLoadingSessions(true);
      const response = await apiRequest(`/phasesessions?curriculum_id=${curriculumId}`);
      setPhaseSessions(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch phase sessions');
      console.error('Error fetching phase sessions:', err);
      setPhaseSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  };

  const uniqueStatuses = [...new Set(curricula.map(c => c.status).filter(Boolean))];

  const filteredCurricula = curricula.filter((curriculum) => {
    const matchesNameSearch = !nameSearchTerm || 
      curriculum.curriculum_name?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    const matchesStatus = !filterStatus || curriculum.status === filterStatus;
    return matchesNameSearch && matchesStatus;
  });

  const getStatusBadgeColor = (status) => {
    const colors = {
      Active: 'bg-green-100 text-green-800',
      Inactive: 'bg-gray-100 text-gray-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Curriculum</h1>
          <p className="text-sm text-gray-600">View curriculum templates (system-wide)</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {filteredCurricula.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterStatus
              ? 'No curricula found matching your criteria.'
              : 'No curricula found.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div
            className="overflow-x-auto rounded-lg"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
          >
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '800px' }}>
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
                          placeholder="Search curriculum..."
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
                    Number of Phases
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sessions per Phase
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
                        <span className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${filterStatus ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openStatusDropdown && (
                        <div className="absolute left-0 mt-2 w-40 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
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
                            {uniqueStatuses.map((status) => (
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
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredCurricula.map((curriculum) => (
                  <tr key={curriculum.curriculum_id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {curriculum.curriculum_name || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {curriculum.number_of_phase !== null && curriculum.number_of_phase !== undefined
                          ? curriculum.number_of_phase
                          : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {curriculum.number_of_session_per_phase !== null && curriculum.number_of_session_per_phase !== undefined
                          ? curriculum.number_of_session_per_phase
                          : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeColor(
                          curriculum.status
                        )}`}
                      >
                        {curriculum.status || 'Active'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => openViewDetailsModal(curriculum)}
                        className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredCurricula.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredCurricula.length} of {curricula.length} curricula
        </div>
      )}

      {isDetailsModalOpen && selectedCurriculumForDetails && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeDetailsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Phase Sessions - {selectedCurriculumForDetails.curriculum_name}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  View curriculum phase sessions
                </p>
              </div>
              <button
                onClick={closeDetailsModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="p-4 overflow-y-auto flex-1">
                {loadingSessions ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                  </div>
                ) : phaseSessions.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500 text-sm">No phase sessions found.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                    <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '600px' }}>
                      <thead className="bg-white">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Phase
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Session
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Topic
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Goal
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Agenda
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                        {phaseSessions.map((session) => (
                          <tr key={session.phasesessiondetail_id}>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                              {session.phase_number}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                              {session.phase_session_number}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              <div className="min-h-[24px]">
                                {session.topic || <span className="text-gray-400 italic">-</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 max-w-xs">
                              <div className="min-h-[24px]">
                                {session.goal || <span className="text-gray-400 italic">-</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 max-w-xs">
                              <div className="min-h-[24px]">
                                {session.agenda || <span className="text-gray-400 italic">-</span>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 p-4 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
              <button
                type="button"
                onClick={closeDetailsModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
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

export default TeacherCurriculum;

