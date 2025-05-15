import { useState, useEffect } from 'react';
import React from 'react';
import Head from 'next/head';
import { supabase, DailyUpdate } from '../lib/supabaseClient';
import { useAuth } from '../lib/authContext';
import ProtectedRoute from '../components/ProtectedRoute';
import { useRouter } from 'next/router';
import { toast } from 'react-hot-toast';
import EditUpdateModal from '../components/EditUpdateModal';
import { isReturningFromTabSwitch, preventNextTabSwitchRefresh } from '../lib/tabSwitchUtil';

export default function UserDashboard() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [userUpdates, setUserUpdates] = useState<DailyUpdate[]>([]);
  const [filteredUpdates, setFilteredUpdates] = useState<DailyUpdate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [loadingTimeout, setLoadingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<DailyUpdate | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [stats, setStats] = useState({
    totalUpdates: 0,
    completedTasks: 0,
    inProgressTasks: 0,
    blockedTasks: 0
  });

  useEffect(() => {
    if (user) {
      fetchUserUpdates();
    }
  }, [user, dateRange]);

  // Add effect to apply filters when updates or activeFilter changes
  useEffect(() => {
    applyFilters();
  }, [userUpdates, activeFilter]);

  // Calculate stats from the updates
  const calculateStats = (updates: DailyUpdate[]) => {
    const newStats = {
      totalUpdates: updates.length,
      completedTasks: updates.filter(update => update.status === 'completed').length,
      inProgressTasks: updates.filter(update => update.status === 'in-progress').length,
      blockedTasks: updates.filter(update => update.status === 'blocked').length
    };
    setStats(newStats);
  };

  // Filter the updates based on the active filter
  const applyFilters = () => {
    if (!userUpdates.length) {
      setFilteredUpdates([]);
      return;
    }

    let filtered = [...userUpdates];

    // Apply the active filter
    switch (activeFilter) {
      case 'completed':
        filtered = filtered.filter(update => update.status === 'completed');
        break;
      case 'in-progress':
        filtered = filtered.filter(update => update.status === 'in-progress');
        break;
      case 'blocked':
        filtered = filtered.filter(update => update.status === 'blocked');
        break;
      case 'all':
      default:
        // No additional filtering
        break;
    }

    setFilteredUpdates(filtered);
    calculateStats(userUpdates);
    
    // Debug log
    console.log('Filtered updates:', filtered.length, 'items, filter:', activeFilter);
  };

  // Function to filter data by card type
  const filterByCardType = (filterType: string) => {
    setActiveFilter(filterType);
    
    // Apply the filters immediately
    setTimeout(() => {
      applyFilters();
    }, 100);
    
    // Provide visual feedback
    toast.success(`Filtered by ${filterType === 'all' ? 'all updates' : filterType} status`);
  };

  // Add a function for manual refresh
  const refreshData = async () => {
    if (isReturningFromTabSwitch()) {
      console.log('Skipping refresh due to tab switch');
      toast('Tab switch detected, refresh deferred', {
        icon: 'ℹ️',
        style: {
          borderRadius: '10px',
          background: '#333',
          color: '#fff',
        },
      });
      return;
    }
    
    setIsLoading(true);
    preventNextTabSwitchRefresh();
    
    try {
      await fetchUserUpdates();
      toast.success('Data refreshed successfully');
    } catch (error) {
      console.error('Error refreshing data:', error);
      toast.error('Failed to refresh data');
    } finally {
      setIsLoading(false);
    }
  };

  // Modify your existing fetchUserUpdates function to check for tab switches
  const fetchUserUpdates = async () => {
    if (isReturningFromTabSwitch()) {
      console.log('Skipping data fetch due to tab switch');
      return;
    }
    
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
            // Calculate stats with the new data
            calculateStats(updatesWithTeams || []);
            
            // Debug log
            console.log('User updates fetched:', updatesWithTeams?.length || 0, 'items');
          } else {
            setUserUpdates([]);
            // Reset stats when no data is available
            calculateStats([]);
            
            // Debug log
            console.log('No user updates found');
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
        // Calculate stats with the new data
        calculateStats(updatesWithTeams || []);
        
        // Debug log
        console.log('User updates fetched:', updatesWithTeams?.length || 0, 'items');
      } else {
        setUserUpdates([]);
        // Reset stats when no data is available
        calculateStats([]);
        
        // Debug log
        console.log('No user updates found');
      }
      
      setLastFetched(new Date());
      setDataLoaded(true);
    } catch (error) {
      console.error('Error fetching user updates:', error);
      toast.error('Failed to load your updates');
      // Even in case of error, provide empty data to prevent UI from being stuck
      setUserUpdates([]);
      calculateStats([]);
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
      case 'to-do':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-700 text-gray-300">To Do</span>;
      case 'reopen':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-900 text-purple-200">Reopened</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-700 text-gray-300">{status}</span>;
    }
  };

  const goToDailyUpdateForm = () => {
    router.push('/daily-update-form');
  };

  // Add function to handle edit button click
  const handleEditClick = (e: React.MouseEvent, update: DailyUpdate) => {
    e.stopPropagation(); // Prevent row expansion when clicking edit
    setEditingUpdate(update);
    setShowEditModal(true);
  };

  // Add function to handle successful edit
  const handleEditSuccess = () => {
    fetchUserUpdates();
  };

  // Function to determine if a task is editable by the current user
  const isTaskEditable = (status: string) => {
    // Admins and managers can edit any task
    if (user?.role === 'admin' || user?.role === 'manager') {
      return true;
    }
    
    // Regular users can only edit tasks that are in To Do or In Progress status
    return status === 'to-do' || status === 'in-progress';
  };

  return (
    <ProtectedRoute allowedRoles={['user', 'manager', 'admin']}>
      <div className="min-h-screen bg-[#1a1f2e] text-white">
        <Head>
          <title>Your Updates | Aditi Daily Updates</title>
          <meta name="description" content="View your submitted daily updates and status reports" />
          <style>{`
            .hover-shadow-custom-purple:hover {
              box-shadow: 0 0 15px rgba(139, 92, 246, 0.5);
            }
          `}</style>
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

          {/* Add stat cards */}
          {userUpdates.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div 
                className="bg-[#262d40] p-4 rounded-lg shadow-lg hover-shadow-custom-purple transition-shadow duration-300 cursor-pointer hover:bg-[#2a3349] relative group"
                onClick={() => filterByCardType('all')}
                title="Click to view all updates"
              >
                <div className="absolute top-2 right-2 text-gray-500 group-hover:text-gray-300">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
                <h3 className="text-gray-400 text-sm">Total Updates</h3>
                <p className="text-2xl font-bold text-white">{stats.totalUpdates}</p>
              </div>
              
              <div 
                className="bg-[#262d40] p-4 rounded-lg shadow-lg hover-shadow-custom-purple transition-shadow duration-300 cursor-pointer hover:bg-[#2a3349] relative group"
                onClick={() => filterByCardType('completed')}
                title="Click to view completed tasks"
              >
                <div className="absolute top-2 right-2 text-gray-500 group-hover:text-gray-300">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
                <h3 className="text-gray-400 text-sm">Completed Tasks</h3>
                <p className="text-2xl font-bold text-green-400">{stats.completedTasks}</p>
              </div>
              
              <div 
                className="bg-[#262d40] p-4 rounded-lg shadow-lg hover-shadow-custom-purple transition-shadow duration-300 cursor-pointer hover:bg-[#2a3349] relative group"
                onClick={() => filterByCardType('in-progress')}
                title="Click to view in-progress tasks"
              >
                <div className="absolute top-2 right-2 text-gray-500 group-hover:text-gray-300">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
                <h3 className="text-gray-400 text-sm">In Progress</h3>
                <p className="text-2xl font-bold text-blue-400">{stats.inProgressTasks}</p>
              </div>
              
              <div 
                className="bg-[#262d40] p-4 rounded-lg shadow-lg hover-shadow-custom-purple transition-shadow duration-300 cursor-pointer hover:bg-[#2a3349] relative group"
                onClick={() => filterByCardType('blocked')}
                title="Click to view blocked tasks"
              >
                <div className="absolute top-2 right-2 text-gray-500 group-hover:text-gray-300">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
                <h3 className="text-gray-400 text-sm">Stuck (Blockers)</h3>
                <p className="text-2xl font-bold text-red-400">{stats.blockedTasks}</p>
              </div>
            </div>
          )}

          {/* Filter pills */}
          {userUpdates.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                onClick={() => filterByCardType('all')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 ${
                  activeFilter === 'all' 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-[#262d40] text-gray-300 hover:bg-[#2a3347]'
                }`}
              >
                All Updates
              </button>
              <button
                onClick={() => filterByCardType('completed')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 ${
                  activeFilter === 'completed' 
                    ? 'bg-green-600 text-white' 
                    : 'bg-[#262d40] text-gray-300 hover:bg-[#2a3347]'
                }`}
              >
                Completed
              </button>
              <button
                onClick={() => filterByCardType('in-progress')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 ${
                  activeFilter === 'in-progress' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-[#262d40] text-gray-300 hover:bg-[#2a3347]'
                }`}
              >
                In Progress
              </button>
              <button
                onClick={() => filterByCardType('blocked')}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 ${
                  activeFilter === 'blocked' 
                    ? 'bg-red-600 text-white' 
                    : 'bg-[#262d40] text-gray-300 hover:bg-[#2a3347]'
                }`}
              >
                Blocked
              </button>
            </div>
          )}

          {/* Updates table */}
          <div className="bg-[#1e2538] shadow-lg rounded-lg overflow-hidden">
            <div className="px-4 py-5 border-b border-gray-700 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-white">
                Your Submitted Updates
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-300">
                {filteredUpdates.length} updates found
              </p>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : filteredUpdates.length === 0 ? (
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
                        Team
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Tasks
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Points
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Priority
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Status
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Start Date
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        End Date
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Edit
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#1e2538] divide-y divide-gray-700">
                    {filteredUpdates.map((update) => (
                      <React.Fragment key={update.id}>
                        <tr 
                          className={`${expandedRows[update.id] ? 'bg-[#262d40]' : ''} hover:bg-[#2a3349] cursor-pointer transition-colors duration-150`}
                          onClick={() => toggleRowExpansion(update.id)}
                        >     
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {formatDate(update.created_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                            {update.aditi_teams?.team_name || 'Unknown Team'}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-200 max-w-xs truncate">
                            {update.tasks_completed}
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
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              update.priority === 'High' ? 'bg-red-900 text-red-200' :
                              update.priority === 'Medium' ? 'bg-yellow-900 text-yellow-200' :
                              'bg-green-900 text-green-200'
                            }`}>
                              {update.priority || 'Medium'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(update.status)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {update.start_date ? new Date(update.start_date).toLocaleDateString() : 
                            <span className="text-gray-400">Not specified</span>}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {update.end_date ? new Date(update.end_date).toLocaleDateString() : 
                            <span className="text-gray-400">Not specified</span>}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            <div className="flex items-center space-x-3">
                              {((user?.role === 'admin' || user?.role === 'manager') || isTaskEditable(update.status)) && (
                            <button
                                  onClick={(e) => handleEditClick(e, update)}
                                  className="text-blue-400 hover:text-blue-300 transition-colors duration-150 focus:outline-none"
                                  disabled={user?.role !== 'admin' && user?.role !== 'manager' && update.status === 'completed'}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" 
                                    className={`h-5 w-5 ${user?.role !== 'admin' && user?.role !== 'manager' && update.status === 'completed' ? 'opacity-40 cursor-not-allowed' : ''}`} 
                                    fill="none" 
                                    viewBox="0 0 24 24" 
                                    stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                            </button>
                              )}
                              {!(user?.role === 'admin' || user?.role === 'manager' || isTaskEditable(update.status)) && (
                                <span className="text-gray-500">-</span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedRows[update.id] && (
                          <tr className="bg-[#262d40]">
                            <td colSpan={10} className="px-8 py-4 text-sm text-gray-200">
                              <div className="w-full">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                  {/* Left Column - Tasks */}
                                  <div>
                                    <h4 className="text-sm font-medium text-purple-300 mb-3">Tasks</h4>
                                    <div className="bg-[#1e2538] p-4 rounded-md">
                                      <p className="text-sm text-white whitespace-pre-wrap break-words leading-relaxed">{update.tasks_completed || 'None'}</p>
                                    </div>
                                    
                                    {update.additional_notes && (
                                      <div className="mt-4">
                                        <h4 className="text-sm font-medium text-purple-300 mb-3">Additional Notes</h4>
                                        <div className="bg-[#1e2538] p-4 rounded-md">
                                          <p className="text-sm text-white whitespace-pre-wrap break-words leading-relaxed">{update.additional_notes}</p>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  
                                  {/* Right Column - Task Details */}
                                  <div>
                                    <h4 className="text-sm font-medium text-purple-300 mb-3">Task Details</h4>
                                    <div className="bg-[#1e2538] p-4 rounded-md">
                                      <div className="grid grid-cols-[120px_1fr] md:grid-cols-[150px_1fr] gap-y-4">
                                        <div className="text-sm text-gray-400">Start Date:</div>
                                        <div className="text-sm text-white font-medium">
                                          {update.start_date ? new Date(update.start_date).toLocaleDateString() : 'Not specified'}
                                        </div>
                                        
                                        <div className="text-sm text-gray-400">End Date:</div>
                                        <div className="text-sm text-white font-medium">
                                          {update.end_date ? new Date(update.end_date).toLocaleDateString() : 'Not specified'}
                                        </div>
                                        
                                        <div className="text-sm text-gray-400">Story Points:</div>
                                        <div className="text-sm text-white font-medium">
                                          {update.story_points !== null ? update.story_points : 'Not specified'}
                                        </div>
                                        
                                        <div className="text-sm text-gray-400">Status:</div>
                                        <div className={`text-sm font-medium ${
                                          update.status === 'completed' ? 'text-green-400' :
                                          update.status === 'in-progress' ? 'text-blue-400' :
                                          update.status === 'blocked' ? 'text-red-400' :
                                          update.status === 'reopen' ? 'text-purple-400' :
                                          'text-gray-400'
                                        }`}>
                                          {update.status}
                                        </div>
                                        
                                        <div className="text-sm text-gray-400">Priority:</div>
                                        <div className="text-sm font-medium">
                                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                            update.priority === 'High' ? 'bg-red-500/20 text-red-400' :
                                            update.priority === 'Medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                            'bg-green-500/20 text-green-400'
                                          }`}>
                                            {update.priority || 'Medium'}
                                          </span>
                                        </div>
                                        
                                        {((user?.role === 'admin' || user?.role === 'manager') || isTaskEditable(update.status)) && (
                                          <>
                                            <div className="text-sm text-gray-400">Actions:</div>
                                            <div>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleEditClick(e, update);
                                                }}
                                                className="inline-flex items-center text-blue-400 hover:text-blue-300 text-sm transition-colors duration-150 focus:outline-none bg-[#262d40] px-3 py-1.5 rounded"
                                                disabled={user?.role !== 'admin' && user?.role !== 'manager' && update.status === 'completed'}
                                              >
                                                <svg xmlns="http://www.w3.org/2000/svg" 
                                                  className={`h-4 w-4 mr-1.5 ${user?.role !== 'admin' && user?.role !== 'manager' && update.status === 'completed' ? 'opacity-40' : ''}`} 
                                                  fill="none" 
                                                  viewBox="0 0 24 24" 
                                                  stroke="currentColor"
                                                >
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                </svg>
                                                Edit Task
                                              </button>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Edit Modal */}
      <EditUpdateModal 
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        update={editingUpdate}
        onSuccess={handleEditSuccess}
      />
    </ProtectedRoute>
  );
} 