import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from './supabaseClient';
import { useRouter } from 'next/router';
import { toast } from 'react-hot-toast';

// User cache key for localStorage
export const USER_CACHE_KEY = 'aditi_user_cache';

export type UserRole = 'user' | 'manager' | 'admin';

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  teamId?: string;
  teamName?: string;
  lastChecked?: number;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  checkUserRole: () => Promise<UserRole>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false); // Start with false to prevent initial loading flash
  const router = useRouter();

  // Initialize user from localStorage if available
  useEffect(() => {
    // This prevents Vercel from showing loading spinner too early
    if (typeof window !== 'undefined') {
      try {
        const cachedUser = localStorage.getItem(USER_CACHE_KEY);
        if (cachedUser) {
          setUser(JSON.parse(cachedUser));
        }
      } catch (error) {
        console.error('Error loading cached user:', error);
      }
    }
    
    // Check session in the background without showing loading state
    checkSessionQuietly();
    
    // Always force clear loading state after 3 seconds no matter what
    const safetyTimer = setTimeout(() => {
      if (isLoading) {
        console.log('SAFETY: Force clearing loading state');
        setIsLoading(false);
      }
    }, 3000);
    
    return () => clearTimeout(safetyTimer);
  }, []);

  // Handle tab visibility changes to prevent session loss
  useEffect(() => {
    // Define handler to maintain session when tab becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Check if we have a cached user but not a current user state
        const cachedUser = localStorage.getItem(USER_CACHE_KEY);
        if (cachedUser && !user) {
          console.log('Tab visible - restoring user from cache');
          try {
            setUser(JSON.parse(cachedUser));
          } catch (err) {
            console.error('Error parsing cached user:', err);
          }
        }
      }
    };
    
    // Add visibility change listener
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Clean up listener
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user]);

  // Set up auth state listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        try {
          await updateUserData(session.user);
        } catch (error) {
          console.error('Error updating user data on sign in:', error);
          setIsLoading(false);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        localStorage.removeItem(USER_CACHE_KEY);
        
        if (router.pathname !== '/') {
          router.push('/');
        }
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, [router.pathname]);
  
  // Quiet session check without loading spinner
  const checkSessionQuietly = async () => {
    // Skip session check if returning from tab switch
    if (typeof window !== 'undefined' && 
        (sessionStorage?.getItem('returning_from_tab_switch') || 
         sessionStorage?.getItem('prevent_auto_refresh'))) {
      console.log('Skipping quiet session check due to tab switch');
      return;
    }
    
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('Session check error:', error);
        setUser(null);
        localStorage.removeItem(USER_CACHE_KEY);
        return;
      }
      
      if (session && session.user) {
        updateUserData(session.user, false);
      } else if (!session && user) {
        // Only clear user if we have one set
        // But check if we might be returning from a tab switch first
        const cachedUser = localStorage.getItem(USER_CACHE_KEY);
        if (!cachedUser) {
          setUser(null);
          localStorage.removeItem(USER_CACHE_KEY);
        } else if (document.visibilityState !== 'visible') {
          // Don't clear user during tab visibility changes
          console.log('Preserving user during tab switch');
        }
      }
    } catch (error) {
      console.error('Error checking session:', error);
    }
  };

  // Update user data from Supabase user
  const updateUserData = async (authUser: any, showLoading = true) => {
    if (showLoading) {
      setIsLoading(true);
    }
    
    try {
      if (!authUser?.email) {
        setUser(null);
        return;
      }
      
      // Get user role
      let role: UserRole = 'user';
      
      try {
        // Check if admin
        const { data: adminData } = await supabase
          .from('aditi_admins')
          .select('*')
          .eq('email', authUser.email)
          .single();
        
        if (adminData) {
          role = 'admin';
        } else {
          // Check if manager
          const { data: managerData } = await supabase
            .from('aditi_teams')
            .select('*')
            .eq('manager_email', authUser.email);
          
          if (managerData && managerData.length > 0) {
            role = 'manager';
          }
        }
      } catch (error) {
        console.error('Error checking user role:', error);
      }
      
      // Get team info
      let teamId = undefined;
      let teamName = undefined;
      
      try {
        const { data: userData } = await supabase
          .from('aditi_team_members')
          .select('*, aditi_teams(*)')
          .eq('employee_email', authUser.email)
          .single();
        
        if (userData) {
          teamId = userData.team_id;
          teamName = userData.aditi_teams?.team_name;
        }
      } catch (error) {
        console.error('Error getting user team info:', error);
      }
      
      // Create user object
      const updatedUser = {
        id: authUser.id,
        email: authUser.email,
        name: authUser.user_metadata?.name || authUser.email.split('@')[0] || 'User',
        role,
        teamId,
        teamName,
        lastChecked: Date.now()
      };
      
      // Update state and cache
      setUser(updatedUser);
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(updatedUser));
      
    } catch (error) {
      console.error('Error updating user data:', error);
      setUser(null);
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  const refreshUser = async () => {
    try {
      setIsLoading(true);
      
      const { data: { user: authUser }, error } = await supabase.auth.getUser();
      
      if (error) {
        console.error('Error getting user:', error);
        setUser(null);
        return;
      }
      
      if (authUser) {
        await updateUserData(authUser);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Error refreshing user:', error);
      setUser(null);
    } finally {
      setIsLoading(false);
      
      // Safety timeout to ensure loading state is cleared
      setTimeout(() => {
        if (isLoading) {
          console.log('Safety timeout clearing loading state in refreshUser');
          setIsLoading(false);
        }
      }, 1000);
    }
  };

  const checkUserRole = async (): Promise<UserRole> => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (!authUser?.email) return 'user';
      
      // Check if admin
      const { data: adminData } = await supabase
        .from('aditi_admins')
        .select('*')
        .eq('email', authUser.email)
        .single();
      
      if (adminData) return 'admin';
      
      // Check if manager
      const { data: managerData } = await supabase
        .from('aditi_teams')
        .select('*')
        .eq('manager_email', authUser.email);
      
      if (managerData && managerData.length > 0) return 'manager';
      
      return 'user';
    } catch (error) {
      console.error('Error checking user role:', error);
      return 'user';
    }
  };

  const signOut = async () => {
    try {
      setIsLoading(true);
      await supabase.auth.signOut();
      setUser(null);
      localStorage.removeItem(USER_CACHE_KEY);
      toast.success('Successfully signed out');
      router.push('/');
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signOut, checkUserRole, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
} 