import { useState, useEffect } from 'react';
import Head from 'next/head';
import { supabase, DailyUpdate } from '../lib/supabaseClient';
import { useAuth } from '../lib/authContext';
import ProtectedRoute from '../components/ProtectedRoute';
import { useRouter } from 'next/router';
import { toast } from 'react-hot-toast';

export default function UserDashboard() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [userUpdates, setUserUpdates] = useState<DailyUpdate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [loadingTimeout, setLoadingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    if (user) {
      fetchUserUpdates();
    }
  }, [user, dateRange]);

  const fetchUserUpdates = async () => {
    try {
      setIsLoading(true);
      
      // Set a hard timeout to prevent the loader from getting stuck forever
      const timeout = setTimeout(() => {
        setIsLoading(false);
        console.log('User updates fetch timeout reached, forcing loading state to false');
      }, 15000); // 15 seconds max loading time
      
      if (loadingTimeout) clearTimeout(loadingTimeout);
      setLoadingTimeout(timeout);
      
      const { data, error } = await supabase
        .from('aditi_daily_updates')
        .select('*')
        .eq('employee_email', user?.email)
        .gte('created_at', `${dateRange.start}T00:00:00.000Z`)
        .lte('created_at', `${dateRange.end}T23:59:59.999Z`)
        .order('created_at', { ascending: false });

      if (error) {
        // Check for 406 error (Not Acceptable)
        if (error.code === '406' || error.message?.includes('406') || (error as any).status === 406) {
          console.error('Session token issue detected (406 error). Attempting to refresh session...');
          
          // Try to refresh the session
          const { data: sessionData, error: refreshError } = await supabase.auth.refreshSession();
          
          if (refreshError || !sessionData.session) {
            console.error('Failed to refresh session after 406 error:', refreshError);
            // Force user to sign out and go to login page
            await signOut();
            return;
          }
          
          // Retry the fetch after successful token refresh
          console.log('Session refreshed, retrying data fetch...');
          const { data: retryData, error: retryError } = await supabase
            .from('aditi_daily_updates')
            .select('*')
            .eq('employee_email', user?.email)
            .gte('created_at', `${dateRange.start}T00:00:00.000Z`)
            .lte('created_at', `${dateRange.end}T23:59:59.999Z`)
            .order('created_at', { ascending: false });
            
          if (retryError) {
            throw retryError;
          }
          
          // Now fetch team data separately
          if (retryData && retryData.length > 0) {
            const teamIds = [...new Set(retryData.map(update => update.team_id))];
            const { data: teamsData } = await supabase
              .from('aditi_teams')
              .select('*')
              .in('id', teamIds);
            
            // Merge team data with updates
            const updatesWithTeams = retryData.map(update => {
              const team = teamsData?.find(t => t.id === update.team_id);
              return {
                ...update,
                aditi_teams: team || null
              };
            });
            
            setUserUpdates(updatesWithTeams || []);
          } else {
            setUserUpdates([]);
          }
          
          setLastFetched(new Date());
          setDataLoaded(true);
          return;
        }
        
        throw error;
      }
      
      // Fetch team data separately
      if (data && data.length > 0) {
        const teamIds = [...new Set(data.map(update => update.team_id))];
        const { data: teamsData } = await supabase
          .from('aditi_teams')
          .select('*')
          .in('id', teamIds);
        
        // Merge team data with updates
        const updatesWithTeams = data.map(update => {
          const team = teamsData?.find(t => t.id === update.team_id);
          return {
            ...update,
            aditi_teams: team || null
          };
        });
        
        setUserUpdates(updatesWithTeams || []);
      } else {
        setUserUpdates([]);
      }
      
      setLastFetched(new Date());
      setDataLoaded(true);
    } catch (error) {
      console.error('Error fetching user updates:', error);
      toast.error('Failed to load your updates');
      // Even in case of error, provide empty data to prevent UI from being stuck
      setUserUpdates([]);
    } finally {
      setIsLoading(false);
      if (loadingTimeout) clearTimeout(loadingTimeout);
    }
  };

  const toggleRowExpansion = (id: string) => {
    setExpandedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDateRange(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'in-progress':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-900 text-blue-200">In Progress</span>;
      case 'completed':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-900 text-green-200">Completed</span>;
      case 'blocked':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-900 text-red-200">Blocked</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-700 text-gray-300">{status}</span>;
    }
  };

  const goToDailyUpdateForm = () => {
    router.push('/daily-update-form');
  };

  return (
    <ProtectedRoute allowedRoles={['user', 'manager', 'admin']}>
      <div className="min-h-screen bg-[#1a1f2e] text-white">
        <Head>
          <title>Your Updates | Aditi Daily Updates</title>
          <meta name="description" content="View your submitted daily updates and status reports" />
        </Head>

        {/* Header */}
        <header className="bg-[#1e2538] shadow-md">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <div>
              <h1 className="text-xl font-semibold text-white">Your Daily Updates</h1>
              <p className="text-sm text-gray-300">
                {user?.name} ({user?.email})
              </p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={goToDailyUpdateForm}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="-ml-1 mr-2 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                New Update
              </button>
              
              <button
                onClick={signOut}
                className="inline-flex items-center px-4 py-2 border border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-200 bg-[#262d40] hover:bg-[#2a3349] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="-ml-1 mr-2 h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Date range filter */}
          <div className="bg-[#1e2538] rounded-lg shadow-lg p-6 mb-6">
            <h2 className="text-lg font-medium text-white mb-4">Filter by Date</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="start" className="block text-sm font-medium text-gray-200 mb-1">Start Date</label>
                <input
                  type="date"
                  id="start"
                  name="start"
                  value={dateRange.start}
                  onChange={handleDateChange}
                  className="bg-[#262d40] shadow-sm focus:ring-purple-500 focus:border-purple-500 block w-full sm:text-sm border-gray-600 rounded-md text-white"
                />
              </div>
              <div>
                <label htmlFor="end" className="block text-sm font-medium text-gray-200 mb-1">End Date</label>
                <input
                  type="date"
                  id="end"
                  name="end"
                  value={dateRange.end}
                  onChange={handleDateChange}
                  className="bg-[#262d40] shadow-sm focus:ring-purple-500 focus:border-purple-500 block w-full sm:text-sm border-gray-600 rounded-md text-white"
                />
              </div>
            </div>
          </div>

          {/* Updates table */}
          <div className="bg-[#1e2538] shadow-lg rounded-lg overflow-hidden">
            <div className="px-4 py-5 border-b border-gray-700 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-white">
                Your Submitted Updates
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-300">
                {userUpdates.length} updates found
              </p>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : userUpdates.length === 0 ? (
              <div className="text-center py-16 px-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="mt-2 text-lg font-medium text-white">No updates found</h3>
                <p className="mt-1 text-sm text-gray-300">
                  You haven't submitted any updates in the selected date range.
                </p>
                <div className="mt-6">
                  <button
                    onClick={goToDailyUpdateForm}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                  >
                    Create your first update
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-700">
                  <thead className="bg-[#262d40]">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Created
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Date Range
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Team
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Status
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Points
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Tasks
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Blockers
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#1e2538] divide-y divide-gray-700">
                    {userUpdates.map((update) => (
                      <>
                        <tr 
                          key={update.id} 
                          className={`${expandedRows[update.id] ? 'bg-[#262d40]' : ''} hover:bg-[#2a3349] cursor-pointer transition-colors duration-150`}
                          onClick={() => toggleRowExpansion(update.id)}
                        >     
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {formatDate(update.created_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {update.start_date && update.end_date ? (
                              <>
                                {new Date(update.start_date).toLocaleDateString()} - {new Date(update.end_date).toLocaleDateString()}
                              </>
                            ) : (
                              <span className="text-gray-400">Not specified</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                            {update.aditi_teams?.team_name || 'Unknown Team'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(update.status)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {update.story_points !== null ? (
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-indigo-900 text-indigo-200">
                                {update.story_points}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-200 max-w-xs truncate">
                            {update.tasks_completed}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {update.blocker_type ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-900 text-red-200">
                                {update.blocker_type}
                              </span>
                            ) : (
                              <span className="text-gray-400">None</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            <button
                              onClick={(e) => {
                                e.stopPropagation(); // Prevent row click from triggering
                                toggleRowExpansion(update.id);
                              }}
                              className="text-purple-400 hover:text-purple-300 transition-colors duration-150"
                            >
                              {expandedRows[update.id] ? 'Collapse' : 'Expand'}
                            </button>
                          </td>
                        </tr>
                        {expandedRows[update.id] && (
                          <tr className="bg-[#262d40]">
                            <td colSpan={8} className="px-8 py-4 text-sm text-gray-200">
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-2">
                                <div>
                                  <h4 className="font-medium text-purple-300 mb-2">Tasks Completed</h4>
                                  <p className="whitespace-pre-wrap">{update.tasks_completed || 'None'}</p>
                                </div>
                                <div>
                                  <h4 className="font-medium text-purple-300 mb-2">Task Details</h4>
                                  <p className="mb-1"><span className="font-medium">Date Range:</span> {update.start_date ? new Date(update.start_date).toLocaleDateString() : 'Not specified'} - {update.end_date ? new Date(update.end_date).toLocaleDateString() : 'Not specified'}</p>
                                  <p className="mb-1"><span className="font-medium">Story Points:</span> {update.story_points !== null ? update.story_points : 'Not specified'}</p>
                                  <p className="mb-1"><span className="font-medium">Status:</span> {update.status}</p>
                                </div>
                                <div>
                                  <h4 className="font-medium text-purple-300 mb-2">Blockers</h4>
                                  {update.blocker_type ? (
                                    <div>
                                      <p className="mb-1"><span className="font-medium">Type:</span> {update.blocker_type}</p>
                                      <p className="mb-1"><span className="font-medium">Description:</span> {update.blocker_description || 'No description provided'}</p>
                                      {update.expected_resolution_date && (
                                        <p><span className="font-medium">Expected Resolution:</span> {formatDate(update.expected_resolution_date)}</p>
                                      )}
                                    </div>
                                  ) : (
                                    <p>No blockers reported</p>
                                  )}
                                </div>
                                {update.additional_notes && (
                                  <div className="lg:col-span-3">
                                    <h4 className="font-medium text-purple-300 mb-2">Additional Notes</h4>
                                    <p className="whitespace-pre-wrap">{update.additional_notes}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
} 