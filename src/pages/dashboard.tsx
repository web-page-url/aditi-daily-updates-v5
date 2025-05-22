"use client";

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { supabase, DailyUpdate, TeamMember } from '../lib/supabaseClient';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '../lib/authContext';
import ProtectedRoute from '../components/ProtectedRoute';
import EditUpdateModal from '../components/EditUpdateModal';
import { isReturningFromTabSwitch, preventNextTabSwitchRefresh } from '../lib/tabSwitchUtil';

interface DashboardUser {
  userName: string;
  userEmail: string;
  teamName: string;
  isManager: boolean;
}

export default function Dashboard() {
  const router = useRouter();
  const { user, signOut, refreshUser } = useAuth();
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingFailed, setLoadingFailed] = useState(false);
  const [historicalData, setHistoricalData] = useState<DailyUpdate[]>([]);
  const [filteredData, setFilteredData] = useState<DailyUpdate[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'recent' | 'blockers' | 'completed' | 'in-progress' | 'blocked'>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [teams, setTeams] = useState<TeamMember[]>([]);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState({
    totalUpdates: 0,
    totalBlockers: 0,
    completedTasks: 0,
    inProgressTasks: 0,
    stuckTasks: 0
  });

  // Additional state for data loading and pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [loadingTimeout, setLoadingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [sessionRecoveryAttempted, setSessionRecoveryAttempted] = useState(false);
  const [recoveryInProgress, setRecoveryInProgress] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<DailyUpdate | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Load saved dashboard state from localStorage
  useEffect(() => {
    if (user) {
      try {
        // Load saved filters and state
        const savedActiveTab = localStorage.getItem(`dashboard_activeTab_${user.email}`);
        const savedSelectedTeam = localStorage.getItem(`dashboard_selectedTeam_${user.email}`);
        const savedDateRange = localStorage.getItem(`dashboard_dateRange_${user.email}`);
        const savedExpandedRows = localStorage.getItem(`dashboard_expandedRows_${user.email}`);
        const savedCurrentPage = localStorage.getItem(`dashboard_currentPage_${user.email}`);

        // Apply saved values if they exist
        if (savedActiveTab) {
          setActiveTab(savedActiveTab as 'all' | 'recent' | 'blockers' | 'completed' | 'in-progress' | 'blocked');
        }
        
        if (savedSelectedTeam) {
          setSelectedTeam(savedSelectedTeam);
        }
        
        if (savedDateRange) {
          setDateRange(JSON.parse(savedDateRange));
        }
        
        if (savedExpandedRows) {
          setExpandedRows(JSON.parse(savedExpandedRows));
        }
        
        if (savedCurrentPage) {
          setCurrentPage(parseInt(savedCurrentPage));
        }
      } catch (error) {
        console.error('Error loading dashboard state from localStorage:', error);
      }
    }
  }, [user]);

  // Save active tab to localStorage whenever it changes
  useEffect(() => {
    if (user?.email) {
      localStorage.setItem(`dashboard_activeTab_${user.email}`, activeTab);
    }
  }, [activeTab, user]);

  // Save selected team to localStorage whenever it changes
  useEffect(() => {
    if (user?.email) {
      localStorage.setItem(`dashboard_selectedTeam_${user.email}`, selectedTeam);
    }
  }, [selectedTeam, user]);

  // Save date range to localStorage whenever it changes
  useEffect(() => {
    if (user?.email) {
      localStorage.setItem(`dashboard_dateRange_${user.email}`, JSON.stringify(dateRange));
    }
  }, [dateRange, user]);

  // Save expanded rows to localStorage whenever they change
  useEffect(() => {
    if (user?.email) {
      localStorage.setItem(`dashboard_expandedRows_${user.email}`, JSON.stringify(expandedRows));
    }
  }, [expandedRows, user]);

  // Save current page to localStorage whenever it changes
  useEffect(() => {
    if (user?.email) {
      localStorage.setItem(`dashboard_currentPage_${user.email}`, currentPage.toString());
    }
  }, [currentPage, user]);

  // Save fetched data to localStorage whenever it changes
  useEffect(() => {
    if (user?.email && historicalData.length > 0) {
      try {
        // Implementation of data chunking for large datasets
        // Break down the historical data into smaller chunks to avoid localStorage size limits
        const chunkSize = 50; // Number of records per chunk
        const chunks = [];
        
        // Split historical data into chunks
        for (let i = 0; i < historicalData.length; i += chunkSize) {
          const chunk = historicalData.slice(i, i + chunkSize);
          chunks.push(chunk);
        }
        
        // Clear any existing chunks first
        for (let i = 0; i < 100; i++) { // Assume max 100 chunks (generous upper limit)
          localStorage.removeItem(`dashboard_historicalData_chunk_${i}_${user.email}`);
        }
        
        // Store new chunks
        chunks.forEach((chunk, index) => {
          localStorage.setItem(`dashboard_historicalData_chunk_${index}_${user.email}`, JSON.stringify(chunk));
        });
        
        // Store chunk metadata (count of chunks)
        localStorage.setItem(`dashboard_historicalData_chunkCount_${user.email}`, chunks.length.toString());
        
        // Also save filtered data (but not chunked, as it's likely smaller)
        // If it's still too large, we'll just skip it and recompute
        try {
          localStorage.setItem(`dashboard_filteredData_${user.email}`, JSON.stringify(filteredData));
        } catch (err) {
          console.log('Filtered data too large for localStorage, will recompute on load');
        }
        
        // Save stats - small data, should always work
        localStorage.setItem(`dashboard_stats_${user.email}`, JSON.stringify(stats));
        
        // Save last refreshed time
        if (lastRefreshed) {
          localStorage.setItem(`dashboard_lastRefreshed_${user.email}`, lastRefreshed.toISOString());
        }
      } catch (error) {
        console.error('Error saving dashboard data to localStorage:', error);
        // If we encounter an error, clear previous data
        localStorage.removeItem(`dashboard_historicalData_${user.email}`);
        localStorage.removeItem(`dashboard_filteredData_${user.email}`);
        localStorage.removeItem(`dashboard_stats_${user.email}`);
      }
    }
  }, [historicalData, filteredData, stats, lastRefreshed, user]);

  // Update the existing load function to also load historicalData, filteredData, stats and lastRefreshed
  useEffect(() => {
    if (user) {
      try {
        // First, check if we have chunked data
        const chunkCountStr = localStorage.getItem(`dashboard_historicalData_chunkCount_${user.email}`);
        
        // Load all saved data (already loading filters in previous useEffect)
        let savedHistoricalData = null;
        
        if (chunkCountStr) {
          // We have chunked data, load all chunks and combine them
          const chunkCount = parseInt(chunkCountStr);
          let combinedData: DailyUpdate[] = [];
          
          // Load each chunk
          for (let i = 0; i < chunkCount; i++) {
            const chunkData = localStorage.getItem(`dashboard_historicalData_chunk_${i}_${user.email}`);
            if (chunkData) {
              const parsedChunk = JSON.parse(chunkData) as DailyUpdate[];
              combinedData = [...combinedData, ...parsedChunk];
            }
          }
          
          // Use the combined data if we have any
          if (combinedData.length > 0) {
            savedHistoricalData = combinedData;
          }
        } else {
          // Try the old approach as a fallback
          const oldDataStr = localStorage.getItem(`dashboard_historicalData_${user.email}`);
          if (oldDataStr) {
            savedHistoricalData = JSON.parse(oldDataStr);
          }
        }
        
        const savedFilteredData = localStorage.getItem(`dashboard_filteredData_${user.email}`);
        const savedStats = localStorage.getItem(`dashboard_stats_${user.email}`);
        const savedLastRefreshed = localStorage.getItem(`dashboard_lastRefreshed_${user.email}`);
        const savedTeams = localStorage.getItem(`dashboard_teams_${user.email}`);
        
        // Set data loaded flag to true if we have saved data
        let hasData = false;
        
        if (savedHistoricalData && savedHistoricalData.length > 0) {
          setHistoricalData(savedHistoricalData);
          hasData = true;
          
          // If we have historical data but no filtered data, apply filters immediately
          if (!savedFilteredData && savedHistoricalData.length > 0) {
            // Create a filtered copy based on current filters
            let filtered = [...savedHistoricalData];
            
            // Apply date range filter
            filtered = filtered.filter(update => {
              const updateDate = new Date(update.created_at).toISOString().split('T')[0];
              return updateDate >= dateRange.start && updateDate <= dateRange.end;
            });
            
            // Apply team filter if we have one
            const currentSelectedTeam = localStorage.getItem(`dashboard_selectedTeam_${user.email}`);
            if (currentSelectedTeam) {
              filtered = filtered.filter(update => update.team_id === currentSelectedTeam);
            }
            
            // Set the filtered data
            setFilteredData(filtered);
            calculateStats(filtered);
          }
        }
        
        if (savedFilteredData) {
          try {
            const parsedFilteredData = JSON.parse(savedFilteredData);
            setFilteredData(parsedFilteredData);
            
            // If we didn't have historical data but have filtered data, set historical as well
            if (!savedHistoricalData && parsedFilteredData.length > 0) {
              setHistoricalData(parsedFilteredData);
              hasData = true;
            }
          } catch (error) {
            console.error('Error parsing filtered data from localStorage:', error);
            // If we can't parse the filtered data, but have historical data,
            // we can recompute the filtered data
            if (savedHistoricalData && savedHistoricalData.length > 0) {
              applyFilters();
            }
          }
        }
        
        if (savedStats) {
          setStats(JSON.parse(savedStats));
        }
        
        if (savedLastRefreshed) {
          setLastRefreshed(new Date(savedLastRefreshed));
        }
        
        // Restore teams data if available
        if (savedTeams) {
          const parsedTeams = JSON.parse(savedTeams);
          setTeams(parsedTeams);
        }
        
        if (hasData) {
          setDataLoaded(true);
          
          // After loading data, also make sure to apply filters
          // This will ensure filteredData is correctly set based on current filters
          setTimeout(() => {
            applyFilters();
          }, 100);
        }
        
        // Even if we have saved data, always fetch fresh data after a delay
        // This ensures we eventually get fresh data even if the saved data is stale
        const refreshDelay = hasData ? 5000 : 0; // If we have saved data, delay the refresh
        setTimeout(() => {
          fetchTeamsBasedOnRole();
        }, refreshDelay);
        
      } catch (error) {
        console.error('Error loading saved dashboard data:', error);
        // If we hit an error loading saved data, fetch fresh data immediately
        fetchTeamsBasedOnRole();
      }
    }
  }, [user]);

  // Add a timeout to ensure applyFilters runs after all state is loaded
  useEffect(() => {
    if (dataLoaded && historicalData.length > 0) {
      // Short timeout to ensure all state has been updated
      const timer = setTimeout(() => {
        console.log('Running applyFilters after data loaded - Historical data length:', historicalData.length);
        applyFilters();
      }, 200);
      
      return () => clearTimeout(timer);
    }
  }, [dataLoaded, historicalData, selectedTeam, dateRange, activeTab]);

  // For debugging - log filtered data changes
  useEffect(() => {
    console.log('Filtered data changed - new length:', filteredData.length);
  }, [filteredData]);

  // Save filtered data to localStorage whenever it changes
  useEffect(() => {
    if (user?.email && filteredData.length > 0) {
      try {
        localStorage.setItem(`dashboard_filteredData_${user.email}`, JSON.stringify(filteredData));
        
        // Also save stats when filtered data changes
        localStorage.setItem(`dashboard_stats_${user.email}`, JSON.stringify(stats));
      } catch (error) {
        console.error('Error saving filtered data to localStorage:', error);
      }
    }
  }, [filteredData, stats, user]);

  useEffect(() => {
    // Safety timeout to prevent infinite loading
    const safetyTimeout = setTimeout(() => {
      if (isLoading) {
        console.log('Dashboard safety timeout reached');
        setIsLoading(false);
        setLoadingFailed(true);
        
        // Try to recover data from localStorage even if loading failed
        tryRecoverFromLocalStorage();
      }
    }, 10000);
    
    if (user) {
      // Only fetch teams data if we don't already have it
      if (!dataLoaded || teams.length === 0) {
        fetchTeamsBasedOnRole();
      }
    } else if (!isLoading && !recoveryInProgress) {
      // If no user and not loading, attempt recovery once
      if (!sessionRecoveryAttempted) {
        console.log('No user detected, attempting session recovery');
        setSessionRecoveryAttempted(true);
        setRecoveryInProgress(true);
        
        // Try to refresh the user session
        refreshUser().then(() => {
          console.log('User session refreshed');
          setRecoveryInProgress(false);
        }).catch(error => {
          console.error('Failed to refresh user session:', error);
          setRecoveryInProgress(false);
          // Try to recover data from localStorage
          tryRecoverFromLocalStorage();
        });
      }
    }
    
    return () => clearTimeout(safetyTimeout);
  }, [user, dataLoaded, teams.length, sessionRecoveryAttempted, recoveryInProgress]);

  // Add function to try recovering data from localStorage without authentication
  const tryRecoverFromLocalStorage = () => {
    console.log('Attempting to recover data from localStorage');
    
    try {
      // Get cached email from localStorage
      let userEmail = null;
      
      // Try to get the user email from various sources
      const cachedUser = localStorage.getItem('aditi_user_cache');
      if (cachedUser) {
        try {
          const parsedUser = JSON.parse(cachedUser);
          userEmail = parsedUser.email;
        } catch (e) {
          console.error('Error parsing cached user:', e);
        }
      }
      
      if (!userEmail) {
        // Look for dashboard keys to determine the email
        const keys = Object.keys(localStorage);
        const dashboardKey = keys.find(key => key.startsWith('dashboard_') && key.includes('@'));
        if (dashboardKey) {
          userEmail = dashboardKey.split('dashboard_')[1].split('_')[0];
        }
      }
      
      if (userEmail) {
        console.log('Recovered user email:', userEmail);
        
        // Check for chunked data first
        const chunkCountStr = localStorage.getItem(`dashboard_historicalData_chunkCount_${userEmail}`);
        
        if (chunkCountStr) {
          // We have chunked data, load all chunks and combine them
          const chunkCount = parseInt(chunkCountStr);
          let combinedData: DailyUpdate[] = [];
          
          // Load each chunk
          for (let i = 0; i < chunkCount; i++) {
            const chunkData = localStorage.getItem(`dashboard_historicalData_chunk_${i}_${userEmail}`);
            if (chunkData) {
              const parsedChunk = JSON.parse(chunkData) as DailyUpdate[];
              combinedData = [...combinedData, ...parsedChunk];
            }
          }
          
          // Use the combined data if we have any
          if (combinedData.length > 0) {
            console.log('Recovered data from localStorage chunks:', combinedData.length);
            setHistoricalData(combinedData);
            setFilteredData(combinedData);
            calculateStats(combinedData);
            setDataLoaded(true);
            setLoadingFailed(false);
            return true;
          }
        }
        
        // Try the old approach as fallback
        const oldDataStr = localStorage.getItem(`dashboard_historicalData_${userEmail}`);
        if (oldDataStr) {
          try {
            const parsedData = JSON.parse(oldDataStr);
            console.log('Recovered data from localStorage (old format):', parsedData.length);
            setHistoricalData(parsedData);
            setFilteredData(parsedData);
            calculateStats(parsedData);
            setDataLoaded(true);
            setLoadingFailed(false);
            return true;
          } catch (e) {
            console.error('Error parsing old format data:', e);
          }
        }
        
        // If we get here, recovery failed
        console.log('Data recovery failed - no valid data found');
        return false;
      } else {
        console.log('Could not determine user email for recovery');
        return false;
      }
    } catch (error) {
      console.error('Error during data recovery:', error);
      return false;
    }
  };

  // Add a new effect to handle visibility changes (tab switching)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchDataSilently(selectedTeam);
        toast.success('Dashboard refreshed after tab switch');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [selectedTeam]);

  // Also save teams data to localStorage
  useEffect(() => {
    if (user?.email && teams.length > 0) {
      try {
        localStorage.setItem(`dashboard_teams_${user.email}`, JSON.stringify(teams));
      } catch (error) {
        console.error('Error saving teams data to localStorage:', error);
      }
    }
  }, [teams, user]);

  const fetchTeamsBasedOnRole = async () => {
    if (!user) return;
    
    try {
      setIsLoading(true);
      console.log('Fetching teams based on role:', user.role);
      
      // Admin can see all teams
      if (user.role === 'admin') {
        const { data, error } = await supabase
          .from('aditi_teams')
          .select('*')
          .order('team_name', { ascending: true });
          
        if (error) throw error;
        console.log('Admin teams loaded:', data?.length || 0);
        setTeams(data || []);
        await fetchData(''); // Begin data fetch immediately after teams are loaded
      } 
      // Manager can only see their teams
      else if (user.role === 'manager') {
        const { data, error } = await supabase
          .from('aditi_teams')
          .select('*')
          .eq('manager_email', user.email)
          .order('team_name', { ascending: true });
          
        if (error) throw error;
        console.log('Manager teams loaded:', data?.length || 0);
        setTeams(data || []);
        
        // If manager has exactly one team, auto-select it
        if (data && data.length === 1) {
          setSelectedTeam(data[0].id);
          await fetchData(data[0].id); // Begin data fetch with the selected team
        } else {
          await fetchData(''); // Fetch all teams' data if multiple teams
        }
      }
      // Regular users shouldn't reach this dashboard, but just in case
      else {
        // If it's a regular user who somehow accessed this page, 
        // redirect them to the user dashboard
        router.replace('/user-dashboard');
      }
    } catch (error) {
      console.error('Error fetching teams:', error);
      toast.error('Failed to load teams');
      setIsLoading(false);
      setLoadingFailed(true);
    }
  };

  useEffect(() => {
    applyFilters();
  }, [activeTab, selectedTeam, dateRange, historicalData]);

  // Modify fetchData to handle filters better
  const fetchData = async (teamFilter: string = '') => {
    try {
      console.log('fetchData called with teamFilter:', teamFilter);
      setIsLoading(true);
      
      // Set a hard timeout to prevent the loader from getting stuck
      const timeout = setTimeout(() => {
        setIsLoading(false);
        console.log('Fetch data timeout reached');
      }, 8000);
      
      if (loadingTimeout) clearTimeout(loadingTimeout);
      setLoadingTimeout(timeout);

      let query = supabase
        .from('aditi_daily_updates')
        .select('*');

      // Apply role-based filters
      if (user?.role === 'admin' && !teamFilter) {
        // No additional filters needed - admin sees all
      } else if (teamFilter) {
        query = query.eq('team_id', teamFilter);
      } else if (user?.role === 'manager') {
        const managerTeamIds = teams.map(team => team.id);
        if (managerTeamIds.length > 0) {
          query = query.in('team_id', managerTeamIds);
        } else {
          setHistoricalData([]);
          setFilteredData([]);
          calculateStats([]);
          setIsLoading(false);
          if (loadingTimeout) clearTimeout(loadingTimeout);
          return;
        }
      }

      // Apply date range filter
      if (dateRange.start) {
        query = query.gte('created_at', `${dateRange.start}T00:00:00`);
      }
      if (dateRange.end) {
        query = query.lte('created_at', `${dateRange.end}T23:59:59`);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      let updatesWithTeams = data || [];
      if (data && data.length > 0) {
        const teamIds = [...new Set(data.map(update => update.team_id))];
        const { data: teamsData } = await supabase
          .from('aditi_teams')
          .select('*')
          .in('id', teamIds);
        
        updatesWithTeams = data.map(update => {
          const team = teamsData?.find(t => t.id === update.team_id);
          return {
            ...update,
            aditi_teams: team || null
          };
        });
      }

      // Update state with fetched data
      setHistoricalData(updatesWithTeams);
      
      // Apply filters immediately after setting data
      setTimeout(() => {
        applyFilters(updatesWithTeams);
      }, 0);

      const now = new Date();
      setLastRefreshed(now);
      setDataLoaded(true);

    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load updates');
      setHistoricalData([]);
      setFilteredData([]);
      calculateStats([]);
      setLoadingFailed(true);
    } finally {
      setIsLoading(false);
      if (loadingTimeout) clearTimeout(loadingTimeout);
    }
  };

  // Modify applyFilters to accept optional data parameter
  const applyFilters = (data?: DailyUpdate[]) => {
    const updates = data || historicalData;
    if (!updates || updates.length === 0) {
      setFilteredData([]);
      calculateStats([]);
      return;
    }

    let filtered = [...updates];

    // Apply date range filter
    filtered = filtered.filter(update => {
      const updateDate = new Date(update.created_at).toISOString().split('T')[0];
      return updateDate >= dateRange.start && updateDate <= dateRange.end;
    });

    // Apply team filter
    if (selectedTeam) {
      filtered = filtered.filter(update => update.team_id === selectedTeam);
    }

    // Apply tab filter
    if (activeTab !== 'all') {
      const filteredByType = filterByCardType(activeTab);
      if (filteredByType) {
        filtered = filteredByType;
      }
    }

    setFilteredData(filtered);
    calculateStats(filtered);

    console.log('Filters applied:', {
      activeTab,
      selectedTeam,
      dateRange,
      totalUpdates: updates.length,
      filteredCount: filtered.length
    });
  };

  // Modify visibility change handler to ensure filters are preserved
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && user) {
        // Save current filter state
        const currentFilters = {
          activeTab,
          selectedTeam,
          dateRange
        };
        
        // Fetch fresh data
        await fetchData(selectedTeam);
        
        // Restore filters
        setActiveTab(currentFilters.activeTab);
        setSelectedTeam(currentFilters.selectedTeam);
        setDateRange(currentFilters.dateRange);
        
        toast.success('Dashboard refreshed');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, activeTab, selectedTeam, dateRange]);

  // Ensure filters are applied whenever filter states change
  useEffect(() => {
    if (dataLoaded) {
      applyFilters();
    }
  }, [activeTab, selectedTeam, dateRange, dataLoaded]);

  // Modify handleEditSuccess to maintain filters
  const handleEditSuccess = async () => {
    const currentFilters = {
      activeTab,
      selectedTeam,
      dateRange
    };
    
    await fetchData(selectedTeam);
    
    // Restore filters
    setActiveTab(currentFilters.activeTab);
    setSelectedTeam(currentFilters.selectedTeam);
    setDateRange(currentFilters.dateRange);
  };

  // Remove all caching-related code and periodic refresh effects

  const calculateStats = (data: DailyUpdate[]) => {
    const stats = {
      totalUpdates: data.length,
      totalBlockers: data.filter(update => update.blocker_type).length,
      completedTasks: data.filter(update => update.status === 'completed').length,
      inProgressTasks: data.filter(update => update.status === 'in-progress').length,
      stuckTasks: data.filter(update => update.status === 'blocked').length
    };
    setStats(stats);
  };

  // Filter data based on card type
  const filterByCardType = (filterType: string): DailyUpdate[] => {
    let filtered = [...historicalData];
    
    switch (filterType) {
      case 'recent':
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return filtered.filter(update => 
          new Date(update.created_at) >= sevenDaysAgo
        );
      case 'blockers':
        return filtered.filter(update => update.blocker_type);
      case 'completed':
        return filtered.filter(update => update.status === 'completed');
      case 'in-progress':
        return filtered.filter(update => update.status === 'in-progress');
      case 'blocked':
        return filtered.filter(update => update.status === 'blocked');
      default:
        return filtered;
    }
  };

  useEffect(() => {
    if (user) {
      fetchData(selectedTeam);
    }
  }, [selectedTeam, user]);

  const toggleRowExpansion = (id: string) => {
    setExpandedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const exportToCSV = () => {
    const headers = [
      'Date',
      'Start Date',
      'End Date',
      'Story Points',
      'Team',
      'Employee',
      'Tasks Completed',
      'Status',
      'Priority',
      'Additional Notes'
    ];

    const csvContent = [
      headers.join(','),
      ...filteredData.map(update => [
        new Date(update.created_at).toLocaleDateString(),
        update.start_date ? new Date(update.start_date).toLocaleDateString() : '',
        update.end_date ? new Date(update.end_date).toLocaleDateString() : '',
        update.story_points !== null ? update.story_points : '',
        update.aditi_teams?.team_name || team_name_from_teams(update) || '',
        update.employee_email,
        update.tasks_completed,
        update.status,
        update.priority,
        update.additional_notes || ''
      ].join(','))
    ].join('\n');

    // Helper function to get team name from teams array if aditi_teams is not present
    function team_name_from_teams(update: DailyUpdate) {
      if (update.team_id) {
        const team = (Array.isArray(teams) ? teams : []).find(t => t.id === update.team_id);
        return team?.team_name || '';
      }
      return '';
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `daily-updates-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const refreshData = async () => {
    // Prevent multiple rapid refreshes
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    preventNextTabSwitchRefresh();
    try {
      await fetchData(selectedTeam);
      const now = new Date();
      setLastRefreshed(now);
      if (user?.email) {
        localStorage.setItem(`dashboard_lastRefreshed_${user.email}`, now.toISOString());
      }
      toast.success('Data refreshed successfully');
    } catch (error) {
      console.error('Error refreshing data:', error);
      toast.error('Failed to refresh data');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Add a silent data fetching function (no loading state, for background refresh)
  const fetchDataSilently = async (teamFilter: string = '') => {
    try {
      console.log('Silent data refresh starting, teamFilter:', teamFilter);
      let query = supabase
        .from('aditi_daily_updates')
        .select('*');

      // Apply role-based filters
      if (user?.role === 'admin' && !teamFilter) {
        // No additional filters needed - admin sees all
      } else if (teamFilter) {
        query = query.eq('team_id', teamFilter);
      } else if (user?.role === 'manager') {
        const managerTeamIds = teams.map(team => team.id);
        if (managerTeamIds.length > 0) {
          query = query.in('team_id', managerTeamIds);
        } else {
          return;
        }
      }

      // Apply date range filter
      if (dateRange.start) {
        query = query.gte('created_at', `${dateRange.start}T00:00:00`);
      }
      if (dateRange.end) {
        query = query.lte('created_at', `${dateRange.end}T23:59:59`);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      let updatesWithTeams = data || [];
      if (data && data.length > 0) {
        const teamIds = [...new Set(data.map(update => update.team_id))];
        const { data: teamsData } = await supabase
          .from('aditi_teams')
          .select('*')
          .in('id', teamIds);
        
        updatesWithTeams = data.map(update => {
          const team = teamsData?.find(t => t.id === update.team_id);
          return {
            ...update,
            aditi_teams: team || null
          };
        });
      }

      // Update state with new data
      setHistoricalData(updatesWithTeams);
      
      // Apply current filters to new data
      let filtered = [...updatesWithTeams];
      
      // Apply date range filter
      filtered = filtered.filter(update => {
        const updateDate = new Date(update.created_at).toISOString().split('T')[0];
        return updateDate >= dateRange.start && updateDate <= dateRange.end;
      });
      
      // Apply team filter
      if (selectedTeam) {
        filtered = filtered.filter(update => update.team_id === selectedTeam);
      }
      
      // Apply tab filter
      if (activeTab !== 'all') {
        const filteredByType = filterByCardType(activeTab);
        if (filteredByType) {
          filtered = filteredByType;
        }
      }
      
      // Update filtered data and stats
      setFilteredData(filtered);
      calculateStats(filtered);

      const now = new Date();
      setLastRefreshed(now);
      setDataLoaded(true);

      // No more caching needed
      if (user?.email) {
        localStorage.setItem(`dashboard_lastRefreshed_${user.email}`, now.toISOString());
      }
    } catch (error) {
      console.error('Error in silent data refresh:', error);
      // Don't show error toast in silent refresh
    }
  };

  // Add a function to handle edit button click
  const handleEditClick = (e: React.MouseEvent, update: DailyUpdate) => {
    e.stopPropagation(); // Prevent row expansion when clicking edit
    setEditingUpdate(update);
    setShowEditModal(true);
  };

  // Restore the Clear Cache button click handler
  const clearCache = () => {
    if (user?.email) {
      // Clear all localStorage data related to the dashboard
      for (let i = 0; i < 100; i++) { // Clear potential chunked data
        localStorage.removeItem(`dashboard_historicalData_chunk_${i}_${user.email}`);
      }
      localStorage.removeItem(`dashboard_historicalData_chunkCount_${user.email}`);
      localStorage.removeItem(`dashboard_historicalData_${user.email}`);
      localStorage.removeItem(`dashboard_filteredData_${user.email}`);
      localStorage.removeItem(`dashboard_stats_${user.email}`);
      localStorage.removeItem(`dashboard_activeTab_${user.email}`);
      localStorage.removeItem(`dashboard_selectedTeam_${user.email}`);
      localStorage.removeItem(`dashboard_dateRange_${user.email}`);
      localStorage.removeItem(`dashboard_expandedRows_${user.email}`);
      localStorage.removeItem(`dashboard_currentPage_${user.email}`);
      localStorage.removeItem(`dashboard_lastRefreshed_${user.email}`);
      toast.success('Cache cleared, refreshing data...');
    }
    // Fetch fresh data
    setTimeout(() => {
      fetchTeamsBasedOnRole();
    }, 300);
  };

  // Handle visibility changes for tab switches
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && user) {
        // Save current filter state before potential refresh
        const currentFilters = {
          activeTab,
          selectedTeam,
          dateRange,
          currentPage
        };
        
        // Store current filters in sessionStorage (temporary storage)
        sessionStorage.setItem('current_dashboard_filters', JSON.stringify(currentFilters));
        
        try {
          // Attempt to refresh data silently
          await fetchDataSilently(selectedTeam);
          
          // Restore filters and apply them
          const savedFilters = sessionStorage.getItem('current_dashboard_filters');
          if (savedFilters) {
            const filters = JSON.parse(savedFilters);
            
            // Restore filter states
            setActiveTab(filters.activeTab);
            setSelectedTeam(filters.selectedTeam);
            setDateRange(filters.dateRange);
            setCurrentPage(filters.currentPage);
            
            // Apply filters to the new data
            let filtered = [...historicalData];
            
            // Apply date range filter
            filtered = filtered.filter(update => {
              const updateDate = new Date(update.created_at).toISOString().split('T')[0];
              return updateDate >= filters.dateRange.start && updateDate <= filters.dateRange.end;
            });
            
            // Apply team filter
            if (filters.selectedTeam) {
              filtered = filtered.filter(update => update.team_id === filters.selectedTeam);
            }
            
            // Apply tab filter
            if (filters.activeTab !== 'all') {
              filtered = filterByCardType(filters.activeTab);
            }
            
            // Update filtered data and stats
            setFilteredData(filtered);
            calculateStats(filtered);
          }
          
          // Clear temporary storage
          sessionStorage.removeItem('current_dashboard_filters');
        } catch (error) {
          console.error('Error refreshing data after tab switch:', error);
          toast.error('Failed to refresh data');
        }
      }
    };

    // Add visibility change listener
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, activeTab, selectedTeam, dateRange, currentPage, historicalData]);

  return (
    <ProtectedRoute allowedRoles={['admin', 'manager']}>
      <Head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Dashboard | Aditi Daily Updates</title>
        <meta name="description" content="Manager dashboard for Aditi daily updates tracking" />
        <style>{`
          .hover-shadow-custom-purple:hover {
            box-shadow: 0 0 15px rgba(139, 92, 246, 0.5);
          }
        `}</style>
      </Head>
      
      <div className="min-h-screen bg-gray-100">
        <div className="fixed top-4 right-4 z-10">
          <button 
            onClick={() => signOut()}
            className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-300 shadow-md hover:shadow-lg flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
        
        <div className="bg-indigo-900 text-white">
          <div className="max-w-7xl mx-auto py-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between">
              <div className="flex-1 flex items-center">
                <span className="flex p-2 rounded-lg bg-indigo-800">
                  <svg className="h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </span>
                <p className="ml-3 font-medium truncate">
                  <span className="md:hidden">
                    {user?.role === 'admin' ? 'Admin Dashboard' : 'Manager Dashboard'}
                  </span>
                  <span className="hidden md:inline">
                    {user?.role === 'admin' 
                      ? 'Admin Dashboard - Full Access' 
                      : `Manager Dashboard - ${user?.name} (${user?.email})`}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="min-h-screen bg-[#1a1f2e] text-white flex flex-col">
          <nav className="bg-[#1e2538] shadow-md">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex items-center">
                  <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent">
                    Aditi Manager Dashboard
                  </h1>
                  {dataLoaded && !isLoading && (
                    <span className="ml-3 text-xs text-gray-400 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      State preserved
                    </span>
                  )}
                </div>
                <div className="flex items-center">
                  <span className="mr-4 text-sm text-gray-300">
                    {user ? `Welcome, ${user.name}` : 'Loading...'}
                  </span>
                  <button
                    onClick={() => router.push('/team-management')}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-md text-sm transition-colors duration-300"
                  >
                    Team Management
                  </button>
                </div>
              </div>
            </div>
          </nav>
          
          <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {isLoading ? (
              <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
              </div>
            ) : loadingFailed ? (
              <div className="bg-[#1e2538] rounded-lg shadow-lg p-6 text-center">
                <h2 className="text-xl font-semibold text-red-400 mb-4">There was an issue loading the dashboard</h2>
                <p className="mb-4">We encountered an error while loading your data. Please try again.</p>
                <div className="flex justify-center space-x-4">
                  <button 
                    onClick={() => {
                      setLoadingFailed(false);
                      fetchTeamsBasedOnRole();
                    }}
                    className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
                  >
                    Retry
                  </button>
                  <button 
                    onClick={clearCache}
                    className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                  >
                    Clear Cache
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
                  <div 
                    className="bg-[#262d40] p-4 rounded-lg shadow-lg hover-shadow-custom-purple transition-shadow duration-300 cursor-pointer hover:bg-[#2a3349] relative group"
                    onClick={() => filterByCardType('total')}
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
                    <p className="text-2xl font-bold text-red-400">{stats.stuckTasks}</p>
                  </div>
                </div>
                
                <div className="bg-[#1e2538] rounded-lg shadow-lg p-4 mb-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4 md:mb-0">
                      <div>
                        <label htmlFor="team-filter" className="block text-sm text-gray-400 mb-1">Team</label>
                        <select
                          id="team-filter"
                          value={selectedTeam}
                          onChange={(e) => setSelectedTeam(e.target.value)}
                          className="bg-[#262d40] border border-gray-600 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="">All Teams</option>
                          {(Array.isArray(teams) ? teams : []).map((team, index) => (
                            <option key={index} value={team.id}>{team.team_name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="date-start" className="block text-sm text-gray-400 mb-1">Start Date</label>
                        <input
                          type="date"
                          id="date-start"
                          value={dateRange.start}
                          onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                          className="bg-[#262d40] border border-gray-600 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                      <div>
                        <label htmlFor="date-end" className="block text-sm text-gray-400 mb-1">End Date</label>
                        <input
                          type="date"
                          id="date-end"
                          value={dateRange.end}
                          onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                          className="bg-[#262d40] border border-gray-600 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={refreshData}
                        disabled={isRefreshing}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isRefreshing ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Refreshing...
                          </>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refresh Data
                          </>
                        )}
                      </button>
                      <button
                        onClick={exportToCSV}
                        disabled={!filteredData.length || isRefreshing}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Export CSV
                      </button>
                      <button
                        onClick={clearCache}
                        className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-300"
                      >  
                        {/* Clear Cache   */}
                      </button>
                    </div>
                  </div>
                  {lastRefreshed && (
                    <div className="mt-3 text-xs text-gray-400 text-right">
                      Last updated: {lastRefreshed.toLocaleString()} 
                      {dataLoaded && !isLoading && (
                        <span className="ml-2 text-green-400">• Data preserved across tabs</span>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="mb-6">
                  <div className="border-b border-gray-700">
                    <nav className="flex flex-wrap -mb-px">
                      <button
                        onClick={() => setActiveTab('all')}
                        className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors duration-300 ${
                          activeTab === 'all'
                            ? 'border-purple-500 text-purple-400'
                            : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        All Updates
                      </button>
                      <button
                        onClick={() => setActiveTab('recent')}
                        className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors duration-300 ${
                          activeTab === 'recent'
                            ? 'border-purple-500 text-purple-400'
                            : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        Recent (5 Days)
                      </button>
                      <button
                        onClick={() => setActiveTab('blockers')}
                        className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors duration-300 ${
                          activeTab === 'blockers'
                            ? 'border-purple-500 text-purple-400'
                            : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        Blockers Only
                      </button>
                      <button
                        onClick={() => setActiveTab('completed')}
                        className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors duration-300 ${
                          activeTab === 'completed'
                            ? 'border-purple-500 text-purple-400'
                            : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        Completed
                      </button>
                      <button
                        onClick={() => setActiveTab('in-progress')}
                        className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors duration-300 ${
                          activeTab === 'in-progress'
                            ? 'border-purple-500 text-purple-400'
                            : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        In Progress
                      </button>
                      <button
                        onClick={() => setActiveTab('blocked')}
                        className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors duration-300 ${
                          activeTab === 'blocked'
                            ? 'border-purple-500 text-purple-400'
                            : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        Blocked
                      </button>
                    </nav>
                  </div>
                </div>
                
                {filteredData.length > 0 ? (
                  <div className="bg-[#1e2538] rounded-lg shadow-lg overflow-hidden">
                    <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}>
                      <div className="inline-block align-middle" style={{ maxWidth: '100%' }}>
                        <div className="overflow-hidden">
                          <table className="w-full divide-y divide-gray-700 table-fixed">
                            <thead className="bg-[#262d40]">
                              <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[90px]">
                                  Created
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[120px]">
                                  Team
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[150px]">
                                  Employee
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[250px]">
                                  Tasks
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[60px]">
                                  Points
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[80px]">
                                  Priority
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[100px]">
                                  Status
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[100px]">
                                  Start Date
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[100px]">
                                  End Date
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[120px]">
                                  Additional Notes
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[60px]">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                              {filteredData.map((item, index) => {
                                const rowId = `row-${index}`;
                                const isExpanded = expandedRows[rowId] || false;
                                const team = (Array.isArray(teams) ? teams : []).find(t => t.id === item.team_id);

                                return (
                                  <React.Fragment key={rowId}>
                                    <tr 
                                      className="hover:bg-[#2a3347] transition-colors duration-200 cursor-pointer"
                                      onClick={() => toggleRowExpansion(rowId)}
                                    >
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        {new Date(item.created_at).toLocaleDateString()}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        {team?.team_name || '-'}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="text-sm text-gray-300 block max-w-[140px] truncate" title={item.employee_name}>
                                          {item.employee_name}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4 text-sm">
                                        <span className="text-gray-300 block max-w-[230px] truncate" title={item.tasks_completed}>
                                          {item.tasks_completed}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        {item.story_points !== null ? (
                                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-indigo-900 text-indigo-200">
                                            {item.story_points}
                                          </span>
                                        ) : (
                                          '-'
                                        )}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                          item.priority === 'High' ? 'bg-red-500/20 text-red-400' :
                                          item.priority === 'Medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                          'bg-green-500/20 text-green-400'
                                        }`}>
                                          {item.priority}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                          item.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                          item.status === 'in-progress' ? 'bg-blue-500/20 text-blue-400' :
                                          'bg-red-500/20 text-red-400'
                                        }`}>
                                          {item.status}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        {item.start_date ? new Date(item.start_date).toLocaleDateString() : '-'}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        {item.end_date ? new Date(item.end_date).toLocaleDateString() : '-'}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        {item.additional_notes ? (
                                          <span className="block max-w-[100px] truncate" title={item.additional_notes}>
                                            {item.additional_notes}
                                          </span>
                                        ) : '-'}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        <button
                                          onClick={(e) => handleEditClick(e, item)}
                                          className="text-blue-400 hover:text-blue-300 transition-colors duration-150 focus:outline-none"
                                        >

                                            {/* Uncomment this to get the Edit Function */}
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                          </svg>
                                          {/* Uncomment this to get the Edit Function */}


                                        </button>
                                      </td>
                                    </tr>
                                    {isExpanded && (
                                      <tr>
                                        <td colSpan={11} className="px-6 py-4 bg-[#1e2538]">
                                          <div className="w-full">
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                              {/* Left Column - Current Tasks */}
                                              <div>
                                                <h4 className="text-sm font-medium text-gray-300 mb-3">Current Tasks</h4>
                                                <div className="bg-[#262d40] p-4 rounded-md">
                                                  <p className="text-sm text-white whitespace-pre-wrap break-words leading-relaxed">{item.tasks_completed}</p>
                                              </div>
                                              
                                                {item.additional_notes && (
                                                  <div className="mt-4">
                                                    <h4 className="text-sm font-medium text-gray-300 mb-3">Additional Notes</h4>
                                                    <div className="bg-[#262d40] p-4 rounded-md">
                                                      <p className="text-sm text-white whitespace-pre-wrap break-words leading-relaxed">{item.additional_notes}</p>
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                              
                                              {/* Right Column - Task Details */}
                                              <div>
                                                <h4 className="text-sm font-medium text-gray-300 mb-3">Task Details</h4>
                                                <div className="bg-[#262d40] p-4 rounded-md">
                                                  <div className="grid grid-cols-[120px_1fr] md:grid-cols-[150px_1fr] gap-y-4">
                                                    <div className="text-sm text-gray-400">Start Date:</div>
                                                    <div className="text-sm text-white font-medium">
                                                      {item.start_date ? new Date(item.start_date).toLocaleDateString() : '-'}
                                                    </div>
                                                    
                                                    <div className="text-sm text-gray-400">End Date:</div>
                                                    <div className="text-sm text-white font-medium">
                                                      {item.end_date ? new Date(item.end_date).toLocaleDateString() : '-'}
                                                    </div>
                                                    
                                                    <div className="text-sm text-gray-400">Story Points:</div>
                                                    <div className="text-sm text-white font-medium">
                                                      {item.story_points !== null ? item.story_points : 'Not specified'}
                                                    </div>
                                                    
                                                    <div className="text-sm text-gray-400">Status:</div>
                                                    <div className={`text-sm font-medium ${
                                                      item.status === 'completed' ? 'text-green-400' :
                                                      item.status === 'in-progress' ? 'text-blue-400' :
                                                      'text-red-400'
                                                    }`}>
                                                      {item.status}
                                                    </div>
                                                    
                                                    <div className="text-sm text-gray-400">Priority:</div>
                                                    <div className="text-sm font-medium">
                                                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                        item.priority === 'High' ? 'bg-red-500/20 text-red-400' :
                                                        item.priority === 'Medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                                        'bg-green-500/20 text-green-400'
                                                      }`}>
                                                        {item.priority || 'Medium'}
                                                    </span>
                                                    </div>
                                                    
                                                    <div className="text-sm text-gray-400">Actions:</div>
                                                    <div>
                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          handleEditClick(e, item);
                                                        }}
                                                        className="inline-flex items-center text-blue-400 hover:text-blue-300 text-sm transition-colors duration-150 focus:outline-none bg-[#1e2538] px-3 py-1.5 rounded"
                                                      >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                        </svg>
                                                        Edit Task
                                                      </button>
                                                    </div>
                                                </div>
                                              </div>
                                              
                                              {item.blocker_type && (
                                                  <div className="mt-4">
                                                    <h4 className="text-sm font-medium text-gray-300 mb-3">Blockers / Risks / Dependencies</h4>
                                                    <div className="bg-[#262d40] p-4 rounded-md">
                                                      <div className="flex items-center space-x-2 mb-3">
                                                        <span className={`inline-block px-2.5 py-1 text-xs rounded-full ${
                                                          item.blocker_type === 'Risks' ? 'bg-yellow-500/20 text-yellow-400' :
                                                          item.blocker_type === 'Blockers' ? 'bg-red-500/20 text-red-400' :
                                                          'bg-blue-500/20 text-blue-400'
                                                        }`}>
                                                          {item.blocker_type}
                                                        </span>
                                                        <span className="text-sm text-gray-400">
                                                          Resolution Date: {item.expected_resolution_date ? new Date(item.expected_resolution_date).toLocaleDateString() : 'Not set'}
                                                        </span>
                                                      </div>
                                                      <p className="text-sm text-white whitespace-pre-wrap break-words leading-relaxed">{item.blocker_description}</p>
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                              </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#1e2538] rounded-lg shadow-lg p-8 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 14h.01M12 17h.01M12 20a8 8 0 100-16 8 8 0 000 16z" />
                    </svg>
                    <h3 className="text-lg font-medium text-gray-300 mb-1">No data found</h3>
                    <p className="text-gray-400">
                      {activeTab === 'blockers' 
                        ? 'No blockers reported for the selected filters.' 
                        : 'No updates available for the selected filters.'}
                    </p>
                  </div>
                )}
                
                {filteredData.length > 0 && totalPages > 1 && (
                  <div className="flex justify-between items-center mt-6 bg-[#1e2538] rounded-lg p-3">
                    <div className="text-sm text-gray-400">
                      Showing {filteredData.length} of {historicalData.length} entries
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1 bg-[#262d40] text-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#2a3347] transition-colors duration-200"
                      >
                        Previous
                      </button>
                      <div className="flex items-center space-x-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          let pageNum: number;
                          if (totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (currentPage <= 3) {
                            pageNum = i + 1;
                          } else if (currentPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                          } else {
                            pageNum = currentPage - 2 + i;
                          }
                          
                          return (
                            <button
                              key={i}
                              onClick={() => setCurrentPage(pageNum)}
                              className={`w-8 h-8 flex items-center justify-center rounded-md text-sm
                                ${pageNum === currentPage 
                                  ? 'bg-purple-600 text-white' 
                                  : 'bg-[#262d40] text-gray-300 hover:bg-[#2a3347]'} 
                                transition-colors duration-200`}
                            >
                              {pageNum}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1 bg-[#262d40] text-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#2a3347] transition-colors duration-200"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </main>
          
          <footer className="bg-[#1e2538] py-3 mt-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <p className="text-center text-gray-400 text-sm">
                © {new Date().getFullYear()} Aditi Updates. All rights reserved.
              </p>
            </div>
          </footer>
        </div>
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