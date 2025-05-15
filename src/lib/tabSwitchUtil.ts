/**
 * Tab Switch Prevention Utility
 * 
 * This utility helps prevent unwanted page refreshes when users switch tabs
 * by providing helper functions to detect tab visibility changes and control
 * behavior when returning to the tab.
 */

// Set a common key for all tab state storage
const TAB_STATE_KEY = 'aditi_tab_state';
const RETURNING_FLAG = 'returning_from_tab_switch';
const PREVENT_REFRESH = 'prevent_auto_refresh';
const TAB_ACTIVE_CLASS = 'tab-just-activated';
const TAB_ID_KEY = 'aditi_tab_id';

/**
 * Generates a unique tab ID if one doesn't exist already
 */
export const getTabId = (): string => {
  if (typeof window === 'undefined') return '';
  
  // Get existing tab ID or create a new one
  let tabId = sessionStorage.getItem(TAB_ID_KEY);
  if (!tabId) {
    tabId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }
  
  return tabId;
};

/**
 * Checks if the current view state is due to returning from a tab switch
 */
export const isReturningFromTabSwitch = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  return !!(
    sessionStorage.getItem(RETURNING_FLAG) || 
    sessionStorage.getItem(PREVENT_REFRESH) ||
    document.body.classList.contains(TAB_ACTIVE_CLASS) ||
    document.body.classList.contains('dashboard-tab-active')
  );
};

/**
 * Sets flags to prevent refresh on the next tab switch return
 */
export const preventNextTabSwitchRefresh = (): void => {
  if (typeof window === 'undefined') return;
  
  sessionStorage.setItem(PREVENT_REFRESH, Date.now().toString());
  
  // Also set the tab's last active timestamp in localStorage to persist across refreshes
  try {
    const tabState = {
      tabId: getTabId(),
      lastActive: Date.now(),
      route: window.location.pathname
    };
    localStorage.setItem(TAB_STATE_KEY, JSON.stringify(tabState));
  } catch (e) {
    console.error('Error saving tab state:', e);
  }
  
  // Clear the flag after some time
  setTimeout(() => {
    sessionStorage.removeItem(PREVENT_REFRESH);
  }, 5000);
};

/**
 * Stores the current application state for the tab
 */
export const saveTabState = (additionalData = {}): void => {
  if (typeof window === 'undefined') return;
  
  try {
    const tabState = {
      tabId: getTabId(),
      lastActive: Date.now(),
      route: window.location.pathname,
      ...additionalData
    };
    localStorage.setItem(TAB_STATE_KEY, JSON.stringify(tabState));
  } catch (e) {
    console.error('Error saving tab state:', e);
  }
};

/**
 * Restores state when returning to a tab
 */
export const restoreTabState = (): any => {
  if (typeof window === 'undefined') return null;
  
  try {
    const savedState = localStorage.getItem(TAB_STATE_KEY);
    if (!savedState) return null;
    
    return JSON.parse(savedState);
  } catch (e) {
    console.error('Error restoring tab state:', e);
    return null;
  }
};

/**
 * Applies the prevention mechanism specifically for fetch/XHR requests
 * Can be used with a custom fetch wrapper
 */
export const applySwitchPreventionToFetch = (): void => {
  if (typeof window === 'undefined') return;
  
  // Store original fetch
  const originalFetch = window.fetch;
  
  // Override fetch
  window.fetch = function(...args) {
    // If we're returning from a tab switch, handle special cases
    if (isReturningFromTabSwitch()) {
      const url = typeof args[0] === 'string' ? args[0] : args[0].toString();
      
      // Block automatic auth/session requests 
      if (url.includes('/auth/') || url.includes('/session')) {
        console.log('Handling auth fetch during tab switch', url);
        
        // If there's a saved session in localStorage, return that instead
        const cachedUser = localStorage.getItem('aditi_user_cache');
        
        // Return a fake successful response that doesn't nullify the session
        return Promise.resolve(new Response(JSON.stringify({ 
          data: { 
            session: cachedUser ? { user: JSON.parse(cachedUser) } : null 
          },
          error: null
        }), { 
          status: 200,
          headers: new Headers({
            'Content-Type': 'application/json'
          })
        }));
      }
      
      // For other API requests, check if they should be blocked
      if ((url.includes('/api/') || url.includes('supabase')) && 
          !url.includes('critical') && !url.includes('force-fetch')) {
        console.log('Preventing API fetch during tab switch:', url);
        
        // Return an empty success response to prevent errors
        return Promise.resolve(new Response(JSON.stringify({ 
          data: null,
          error: null,
          skipped: true,
          message: 'Fetch skipped due to tab switch'
        }), { 
          status: 200,
          headers: new Headers({
            'Content-Type': 'application/json'
          })
        }));
      }
    }
    
    // Otherwise proceed with original fetch
    return originalFetch.apply(this, args);
  };
  
  // Additionally set up visibilitychange handler at the utility level
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Save the current tab state with active timestamp
      saveTabState({ lastVisible: Date.now() });
      
      console.log('Tab visible again - maintaining session');
      sessionStorage.setItem(RETURNING_FLAG, 'true');
      document.body.classList.add(TAB_ACTIVE_CLASS);
      
      // Stop any pending navigations that might be causing refreshes
      if (window.stop) {
        try {
          window.stop();
        } catch (err) {
          console.log('Could not stop pending navigations');
        }
      }
      
      // Keep the session alive by extending flags timeout
      setTimeout(() => {
        sessionStorage.removeItem(RETURNING_FLAG);
        document.body.classList.remove(TAB_ACTIVE_CLASS);
      }, 2500); // Extended timeout
    } else {
      // Tab is hidden, save current state
      saveTabState({ lastHidden: Date.now() });
    }
  }, true); // Use capture to ensure this runs before other handlers
  
  // Override history methods to handle router navigations properly
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    // If we're just returning from a tab switch, don't change history
    if (isReturningFromTabSwitch() && args[2] && typeof args[2] === 'string') {
      console.log('Prevented pushState during tab switch:', args[2]);
      return;
    }
    return originalPushState.apply(this, args);
  };
  
  history.replaceState = function(...args) {
    // If we're just returning from a tab switch, don't change history
    if (isReturningFromTabSwitch() && args[2] && typeof args[2] === 'string') {
      console.log('Prevented replaceState during tab switch:', args[2]);
      return;
    }
    return originalReplaceState.apply(this, args);
  };
}; 