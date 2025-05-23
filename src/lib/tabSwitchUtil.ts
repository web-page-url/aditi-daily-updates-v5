/**
 * Tab Switch Utility - Simplified Version
 * 
 * Contains only essential functions for handling tab switches and authentication
 */

/**
 * Gets the current auth token from localStorage - Vercel Production Compatible
 */
export const getAuthToken = async (): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  
  try {
    // Method 1: Try to get from Supabase client directly if available
    if (typeof window !== 'undefined' && (window as any).supabase) {
      try {
        const { data } = await (window as any).supabase.auth.getSession();
        if (data.session?.access_token) {
          console.log('Found token from global supabase client');
          return data.session.access_token;
        }
      } catch (e) {
        console.log('Could not get session from global supabase client');
      }
    }

    // Method 2: Check all possible Supabase localStorage keys
    const possibleKeys = [
      // Standard Supabase key pattern
      `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]?.split('.')[0] || ''}-auth-token`,
      // Alternative patterns
      'sb-auth-token',
      'supabase.auth.token',
      'aditi-supabase-auth',
      'sb-localhost-auth-token'
    ];

    // Also scan for any keys that contain supabase auth patterns
    const allKeys = Object.keys(localStorage);
    const supabaseKeys = allKeys.filter(key => 
      key.includes('sb-') && key.includes('auth') ||
      key.includes('supabase') && key.includes('auth') ||
      key.includes('sb-') && key.includes('token')
    );

    // Combine both approaches
    const keysToCheck = [...possibleKeys, ...supabaseKeys];

    for (const key of keysToCheck) {
      try {
        const data = localStorage.getItem(key);
        if (!data) continue;

        const parsedData = JSON.parse(data);
        
        // Check various possible structures
        if (parsedData?.access_token) {
          console.log('Found token using key:', key);
          return parsedData.access_token;
        }
        
        if (parsedData?.session?.access_token) {
          console.log('Found session token using key:', key);
          return parsedData.session.access_token;
        }

        if (parsedData?.data?.session?.access_token) {
          console.log('Found nested session token using key:', key);
          return parsedData.data.session.access_token;
        }

        // Check if the value itself is a token (JWT pattern)
        if (typeof parsedData === 'string' && parsedData.includes('.') && parsedData.length > 100) {
          console.log('Found direct token using key:', key);
          return parsedData;
        }
        
      } catch (e) {
        // If JSON parse fails, check if it's a direct token string
        try {
          const rawData = localStorage.getItem(key);
          if (rawData && typeof rawData === 'string' && rawData.includes('.') && rawData.length > 100) {
            console.log('Found raw token using key:', key);
            return rawData;
          }
        } catch (e2) {
          continue;
        }
      }
    }

    console.warn('No auth token found in localStorage. Available keys:', allKeys.filter(k => k.includes('auth') || k.includes('token') || k.includes('sb-')));
    return null;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
};

/**
 * Synchronous version for immediate use
 */
export const getAuthTokenSync = (): string | null => {
  if (typeof window === 'undefined') return null;
  
  try {
    // Quick localStorage scan for immediate use
    const allKeys = Object.keys(localStorage);
    const supabaseKeys = allKeys.filter(key => 
      key.includes('sb-') && key.includes('auth') ||
      key.includes('supabase') && key.includes('auth') ||
      key.includes('aditi-supabase-auth')
    );

    for (const key of supabaseKeys) {
      try {
        const data = localStorage.getItem(key);
        if (!data) continue;

        const parsedData = JSON.parse(data);
        
        if (parsedData?.access_token) {
          return parsedData.access_token;
        }
        
        if (parsedData?.session?.access_token) {
          return parsedData.session.access_token;
        }

        if (parsedData?.data?.session?.access_token) {
          return parsedData.data.session.access_token;
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  } catch (error) {
    console.error('Error getting auth token sync:', error);
    return null;
  }
};

/**
 * Simple function to prevent aggressive refreshing (mainly for UX feedback)
 */
export const preventNextTabSwitchRefresh = (): void => {
  if (typeof window === 'undefined') return;
  
  // Just set a simple flag for a short time to prevent rapid refreshes
  sessionStorage.setItem('prevent_rapid_refresh', Date.now().toString());
  
  // Clear the flag after a short time
  setTimeout(() => {
    sessionStorage.removeItem('prevent_rapid_refresh');
  }, 2000);
};

/**
 * Simple check for tab switch return (mainly for debugging/logging)
 */
export const isReturningFromTabSwitch = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  // Check if we recently set the prevent refresh flag
  const preventFlag = sessionStorage.getItem('prevent_rapid_refresh');
  if (preventFlag) {
    const timestamp = parseInt(preventFlag);
    const now = Date.now();
    // If less than 2 seconds ago, consider it a tab switch return
    return (now - timestamp) < 2000;
  }
  
  return false;
};

/**
 * Ensures token is included in all API requests, especially after tab switches
 * Enhanced for Vercel production environment
 */
export const ensureTokenInRequests = (): void => {
  if (typeof window === 'undefined') return;
  
  const originalFetch = window.fetch;
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
    const updatedInit: RequestInit = init ? { ...init } : {};
    
    // Get URL string
    const url = typeof input === 'string' ? input : 
                input instanceof URL ? input.href : 
                input.url;
    
    // Only add token for same-origin requests or Supabase API calls
    const isSameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
    const isSupabaseCall = url.includes(process.env.NEXT_PUBLIC_SUPABASE_URL || '') || 
                          url.includes('supabase.co') || 
                          url.includes('supabase.com');
    
    if (isSameOrigin || isSupabaseCall) {
      // Use sync version first for immediate availability
      let token = getAuthTokenSync();
      
      // If no token found synchronously, try async for completeness
      if (!token) {
        try {
          token = await getAuthToken();
        } catch (e) {
          console.log('Async token fetch failed:', e);
        }
      }
      
      if (token) {
        const headers = new Headers(updatedInit.headers || {});
        
        if (!headers.has('Authorization') && !headers.has('authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
          console.log('Added auth token to request:', url);
        }
        
        updatedInit.headers = headers;
      } else {
        console.warn('No auth token available for request:', url);
      }
    }
    
    return originalFetch.call(this, input, updatedInit);
  };
};

/**
 * Simple tab state save for auth context compatibility
 */
export const saveTabState = (additionalData = {}): void => {
  if (typeof window === 'undefined') return;
  
  try {
    const tabState = {
      lastActive: Date.now(),
      route: window.location.pathname,
      ...additionalData
    };
    sessionStorage.setItem('simple_tab_state', JSON.stringify(tabState));
  } catch (e) {
    console.error('Error saving tab state:', e);
  }
};

/**
 * Enhanced session recovery for Vercel production
 */
export const recoverSessionAfterTabSwitch = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  
  try {
    // Try to get the token first
    const token = await getAuthToken();
    if (!token) {
      console.warn('No token found for session recovery');
      return false;
    }

    // If we have a global supabase client, try to refresh the session
    if ((window as any).supabase?.auth?.refreshSession) {
      try {
        const { data, error } = await (window as any).supabase.auth.refreshSession();
        if (error) {
          console.error('Failed to refresh session:', error);
          return false;
        }
        console.log('Session refreshed successfully after tab switch');
        return true;
      } catch (refreshError) {
        console.error('Error during session refresh:', refreshError);
        return false;
      }
    }

    return true; // Token exists, assume session is valid
  } catch (error) {
    console.error('Error in session recovery:', error);
    return false;
  }
}; 