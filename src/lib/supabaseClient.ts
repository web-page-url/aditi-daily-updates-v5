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

// Get current auth token from localStorage
export const getSupabaseToken = (): string | null => {
  try {
    if (typeof window === 'undefined') return null;
    
    // Try to get the token from localStorage
    const storageKey = 'aditi_supabase_auth';
    const authData = localStorage.getItem(storageKey);
    
    if (!authData) return null;
    
    const parsedData = JSON.parse(authData);
    return parsedData?.access_token || null;
  } catch (error) {
    console.error('Error getting Supabase token:', error);
    return null;
  }
};

// Create client with auto refresh and token persistence
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'aditi_supabase_auth',
    // Note: Session expiration is set to 7 days in the OTP signin options
    // The actual expiration period is controlled by Supabase project settings
    // and the options provided during sign-in
    storage: {
      getItem: (key) => {
        return localStorage.getItem(key);
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
      // Get the current headers from options
      const headers = new Headers(options.headers || {});
      
      // Get the auth token and add it to the request if available
      const token = getSupabaseToken();
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      
      // Create new options with updated headers
      const updatedOptions = {
        ...options,
        headers
      };
      
      // Always call the original fetch with updated options
      return fetch(url, updatedOptions);
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

export type TaskStatus = 'in-progress' |  'to-do' |  'completed' | 'blocked' |'reopen';
export type PriorityLevel = 'High' | 'Medium' | 'Low';

export interface DailyUpdate {
  id: string;
  created_at: string;
  employee_email: string;
  employee_name: string;
  team_id: string;
  tasks_completed: string;
  status: TaskStatus;
  priority: PriorityLevel;
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