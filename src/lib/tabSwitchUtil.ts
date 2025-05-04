/**
 * Tab Switch Prevention Utility
 * 
 * This utility helps prevent unwanted page refreshes when users switch tabs
 * by providing helper functions to detect tab visibility changes and control
 * behavior when returning to the tab.
 */

/**
 * Checks if the current view state is due to returning from a tab switch
 */
export const isReturningFromTabSwitch = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  return !!(
    sessionStorage.getItem('returning_from_tab_switch') || 
    sessionStorage.getItem('prevent_auto_refresh') ||
    document.body.classList.contains('tab-just-activated') ||
    document.body.classList.contains('dashboard-tab-active')
  );
};

/**
 * Sets flags to prevent refresh on the next tab switch return
 */
export const preventNextTabSwitchRefresh = (): void => {
  if (typeof window === 'undefined') return;
  
  sessionStorage.setItem('prevent_auto_refresh', Date.now().toString());
  
  // Clear the flag after some time
  setTimeout(() => {
    sessionStorage.removeItem('prevent_auto_refresh');
  }, 5000);
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
    }
    
    // Otherwise proceed with original fetch
    return originalFetch.apply(this, args);
  };
  
  // Additionally set up visibilitychange handler at the utility level
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('Tab visible again - maintaining session');
      sessionStorage.setItem('returning_from_tab_switch', 'true');
      document.body.classList.add('tab-just-activated');
      
      // Keep the session alive by extending flags timeout
      setTimeout(() => {
        sessionStorage.removeItem('returning_from_tab_switch');
        document.body.classList.remove('tab-just-activated');
      }, 2500); // Extended timeout
    }
  }, true); // Use capture to ensure this runs before other handlers
}; 