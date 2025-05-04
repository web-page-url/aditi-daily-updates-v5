import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Log connection details (without exposing full key)
console.log('Supabase URL:', supabaseUrl);
console.log('Supabase key available:', !!supabaseAnonKey);
console.log('Supabase key prefix:', supabaseAnonKey.substring(0, 5) + '...');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase credentials are missing. Please check your environment variables.');
}

// Create client with auto refresh and token persistence
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'aditi_supabase_auth',
    storage: {
      getItem: (key) => {
        const storedSession = localStorage.getItem(key);
        if (typeof window !== 'undefined' && storedSession && window.sessionStorage.getItem('returning_from_tab_switch')) {
          console.log('Using cached session during tab switch');
        }
        return storedSession;
      },
      setItem: (key, value) => {
        localStorage.setItem(key, value);
      },
      removeItem: (key) => {
        localStorage.removeItem(key);
      }
    }
  },
  global: {
    fetch: async (url, options = {}) => {
      // Check if we just returned from a tab switch
      const isReturningFromTabSwitch = typeof window !== 'undefined' && 
        (sessionStorage?.getItem('returning_from_tab_switch') || 
         sessionStorage?.getItem('prevent_auto_refresh'));
      
      // Skip unnecessary fetches when returning from tab switch
      if (isReturningFromTabSwitch && typeof url === 'string' && url.includes('/auth/')) {
        console.log('Handling auth fetch during tab switch:', url);
        
        // Try to use cached user if available
        const cachedUser = localStorage.getItem('aditi_user_cache');
        const cachedSession = localStorage.getItem('aditi_supabase_auth');
        
        if (cachedUser || cachedSession) {
          console.log('Using cached user/session during tab switch');
          
          // Return a response that maintains the session
          return new Response(JSON.stringify({ 
            data: { 
              session: cachedSession ? JSON.parse(cachedSession) : null,
              user: cachedUser ? JSON.parse(cachedUser) : null
            },
            error: null
          }), {
            status: 200,
            headers: new Headers({
              'Content-Type': 'application/json'
            })
          });
        }
        
        // If no cached data, return a neutral response
        return new Response(JSON.stringify({ 
          data: { session: null },
          error: null
        }), {
          status: 200,
          headers: new Headers({
            'Content-Type': 'application/json'
          })
        });
      }
      
      // Add custom error handling for fetch operations
      try {
        const response = await fetch(url, options);
        
        // Handle 406 errors by attempting to refresh the token
        if (response.status === 406) {
          console.log('Received 406 error, attempting to refresh session...');
          
          // Try to refresh the session
          const { data, error } = await supabase.auth.refreshSession();
          
          if (error || !data.session) {
            console.error('Failed to refresh session after 406 error:', error);
            // Let the original 406 response continue
            return response;
          }
          
          // Clone the options and update the Authorization header with the new token
          const newOptions = { ...options };
          if (newOptions.headers) {
            // @ts-ignore - TypeScript may complain about this
            newOptions.headers['Authorization'] = `Bearer ${data.session.access_token}`;
          }
          
          // Retry the fetch with the new token
          console.log('Retrying fetch with refreshed token');
          return fetch(url, newOptions);
        }
        
        return response;
      } catch (error) {
        console.error('Fetch error in Supabase client:', error);
        throw error;
      }
    }
  }
});

// Test the connection
supabase.auth.getSession().then(({ data, error }) => {
  if (error) {
    console.error('Supabase connection error:', error);
  } else {
    console.log('Supabase connection successful');
  }
});

// Type definitions for our tables
export interface Team {
  id: string;
  team_name: string;
  manager_email: string;
  created_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  team_name: string;
  employee_email: string;
  employee_id: string;
  team_member_name: string;
  manager_name: string;
  created_at: string;
  aditi_teams?: {
    id: string;
    team_name: string;
  }
}

export interface DailyUpdate {
  id: string;
  created_at: string;
  employee_email: string;
  employee_name: string;
  team_id: string;
  tasks_completed: string;
  status: string;
  blocker_type: string | null;
  blocker_description: string | null;
  expected_resolution_date: string | null;
  additional_notes: string | null;
  start_date: string | null;
  end_date: string | null;
  story_points: number | null;
  aditi_teams?: {
    id: string;
    team_name: string;
  }
} 