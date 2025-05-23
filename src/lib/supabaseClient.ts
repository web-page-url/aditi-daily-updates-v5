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

// Create the Supabase client with enhanced configuration for Vercel
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Enhanced settings for production
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'aditi-supabase-auth',
    flowType: 'pkce'
  },
  // Add retry logic for production
  global: {
    headers: {
      'x-my-custom-header': 'aditi-daily-updates',
    },
  },
});

// Make supabase client available globally for session recovery
if (typeof window !== 'undefined') {
  (window as any).supabase = supabase;
  console.log('Supabase client made available globally for session recovery');
}

// Get current auth token from localStorage
export const getSupabaseToken = async (): Promise<string | null> => {
  try {
    if (typeof window === 'undefined') return null;
    
    // Try to get the current session first
    try {
      const { data, error } = await supabase.auth.getSession();
      if (!error && data.session?.access_token) {
        console.log('Found token from current session');
        return data.session.access_token;
      }
    } catch (sessionError) {
      console.log('Could not get current session:', sessionError);
    }
    
    // Fallback to localStorage scanning
    const keys = Object.keys(localStorage);
    const authKey = keys.find(key => 
      (key.includes('sb-') && key.includes('auth')) ||
      key.includes('aditi-supabase-auth')
    );
    
    if (authKey) {
      const authData = localStorage.getItem(authKey);
      if (authData) {
        try {
          const parsed = JSON.parse(authData);
          const token = parsed?.access_token || parsed?.session?.access_token || null;
          if (token) {
            console.log('Found token from localStorage:', authKey);
            return token;
          }
        } catch (e) {
          console.log('Error parsing auth data from key:', authKey);
        }
      }
    }
    
    console.warn('No auth token found');
    return null;
  } catch (error) {
    console.error('Error getting Supabase token:', error);
    return null;
  }
};

// Auth state change listener with enhanced error handling
supabase.auth.onAuthStateChange((event, session) => {
  console.log('Auth state changed:', event);
  
  if (event === 'SIGNED_IN' && session) {
    console.log('User signed in successfully');
    // Store session info for recovery
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('aditi-last-auth-event', JSON.stringify({
          event,
          timestamp: Date.now(),
          hasSession: !!session
        }));
      } catch (e) {
        console.error('Error storing auth event:', e);
      }
    }
  } else if (event === 'SIGNED_OUT') {
    console.log('User signed out');
    // Clean up stored auth info
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('aditi-last-auth-event');
      } catch (e) {
        console.error('Error cleaning up auth event:', e);
      }
    }
  } else if (event === 'TOKEN_REFRESHED' && session) {
    console.log('Token refreshed successfully');
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