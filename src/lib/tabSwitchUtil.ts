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

  // Override fetch: always call the original fetch, never block or fake API calls
  window.fetch = function(...args) {
    return originalFetch.apply(this, args);
  };

  // Keep the rest of the tab state/session logic if needed, but do not block fetches
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      saveTabState({ lastVisible: Date.now() });
      setTimeout(() => {
        sessionStorage.removeItem('returning_from_tab_switch');
        document.body.classList.remove('tab-just-activated');
      }, 2500);
    } else {
      saveTabState({ lastHidden: Date.now() });
    }
  }, true);

  // Keep history override if needed, but do not block navigation based on tab switch
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function(...args) {
    return originalPushState.apply(this, args);
  };
  history.replaceState = function(...args) {
    return originalReplaceState.apply(this, args);
  };
}; 