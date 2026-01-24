import { useState, useEffect } from 'react';
import { apiRequest } from '../../config/api';

const TeacherProgram = () => {
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterCurriculum, setFilterCurriculum] = useState('');
  const [openCurriculumDropdown, setOpenCurriculumDropdown] = useState(false);
  const [curricula, setCurricula] = useState([]);

  useEffect(() => {
    fetchPrograms();
    fetchCurricula();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openCurriculumDropdown && !event.target.closest('.curriculum-filter-dropdown')) {
        setOpenCurriculumDropdown(false);
      }
    };

    if (openCurriculumDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openCurriculumDropdown]);

  const fetchPrograms = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/programs');
      setPrograms(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch programs');
      console.error('Error fetching programs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurricula = async () => {
    try {
      const response = await apiRequest('/curriculum');
      setCurricula(response.data || []);
    } catch (err) {
      console.error('Error fetching curricula:', err);
    }
  };

  const uniqueCurricula = [...new Set(programs.map(p => p.curriculum_id).filter(Boolean))];

  const getCurriculumName = (curriculumId) => {
    if (!curriculumId) return null;
    const curriculum = curricula.find(c => c.curriculum_id === curriculumId);
    return curriculum ? curriculum.curriculum_name : null;
  };

  const filteredPrograms = programs.filter((program) => {
    const matchesNameSearch = !nameSearchTerm || 
      program.program_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      program.program_code?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    const matchesCurriculum = !filterCurriculum || program.curriculum_id?.toString() === filterCurriculum;
    return matchesNameSearch && matchesCurriculum;
  });

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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Program</h1>
          <p className="text-sm text-gray-600">View program templates (system-wide)</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {filteredPrograms.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterCurriculum
              ? 'No programs found matching your criteria.'
              : 'No programs found.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div
            className="overflow-x-auto rounded-lg"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
          >
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '900px' }}>
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
                          placeholder="Search program..."
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
                    Program Code
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="relative curriculum-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenCurriculumDropdown(!openCurriculumDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Curriculum</span>
                        {filterCurriculum && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openCurriculumDropdown && (
                        <div className="absolute left-0 mt-0.5 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                          <div className="py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterCurriculum('');
                                setOpenCurriculumDropdown(false);
                              }}
                              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                !filterCurriculum ? 'bg-gray-100 font-medium' : 'text-gray-700'
                              }`}
                            >
                              All Curricula
                            </button>
                            {uniqueCurricula.map((curriculumId) => {
                              const curriculumName = getCurriculumName(curriculumId);
                              return (
                                <button
                                  key={curriculumId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFilterCurriculum(curriculumId.toString());
                                    setOpenCurriculumDropdown(false);
                                  }}
                                  className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                    filterCurriculum === curriculumId.toString() ? 'bg-gray-100 font-medium' : 'text-gray-700'
                                  }`}
                                >
                                  {curriculumName || `Curriculum ${curriculumId}`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Session Duration
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredPrograms.map((program) => {
                  const formatSessionDuration = (duration) => {
                    if (!duration && duration !== 0) return '-';
                    const numDuration = parseFloat(duration);
                    if (isNaN(numDuration)) return '-';
                    if (numDuration % 1 === 0) {
                      return `${numDuration} ${numDuration === 1 ? 'hour' : 'hours'}`;
                    } else {
                      return `${numDuration} hours`;
                    }
                  };

                  return (
                    <tr key={program.program_id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {program.program_name || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {program.program_code || '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {program.curriculum_id ? getCurriculumName(program.curriculum_id) || '-' : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {formatSessionDuration(program.session_duration_hours)}
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

      {filteredPrograms.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredPrograms.length} of {programs.length} programs
        </div>
      )}
    </div>
  );
};

export default TeacherProgram;

