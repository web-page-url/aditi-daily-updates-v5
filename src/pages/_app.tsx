import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Toaster } from 'react-hot-toast';
import Head from 'next/head';
import { AuthProvider } from "@/lib/authContext";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { applySwitchPreventionToFetch } from '@/lib/tabSwitchUtil';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [isAdminRoute, setIsAdminRoute] = useState(false);

  // Add mechanism to prevent refreshes on tab switching
  useEffect(() => {
    // Apply the fetch prevention mechanism
    applySwitchPreventionToFetch();
    
    // This will override any page-specific visibility change handlers
    const handleVisibilityChange = (e: Event) => {
      // More aggressively prevent page reloads when switching tabs
      if (document.visibilityState === 'visible') {
        // Set multiple flags to prevent different refresh mechanisms
        sessionStorage.setItem('returning_from_tab_switch', 'true');
        sessionStorage.setItem('prevent_auto_refresh', Date.now().toString());
        document.body.classList.add('tab-just-activated');
        
        // Stop any pending navigations or revalidations
        if (window.stop) {
          try {
            window.stop();
          } catch (err) {
            console.log('Could not stop pending navigations');
          }
        }
        
        // Preserve cached user across tab switches by ensuring it's not cleared
        const cachedUser = localStorage.getItem('aditi_user_cache');
        if (cachedUser) {
          // Re-save it to refresh the storage timestamp
          console.log('Re-caching user data during tab switch');
          localStorage.setItem('aditi_user_cache', cachedUser);
        }
        
        // Remove the flags after a short delay
        setTimeout(() => {
          sessionStorage.removeItem('returning_from_tab_switch');
          document.body.classList.remove('tab-just-activated');
        }, 2500); // Extended timeout to ensure all components respect the flag
        
        // Remove the prevent_auto_refresh after a longer period
        setTimeout(() => {
          sessionStorage.removeItem('prevent_auto_refresh');
        }, 5000); // Extended from 3000 to 5000ms to give more time
      }
    };
    
    // Add the event listener with capture=true to ensure it runs first
    document.addEventListener('visibilitychange', handleVisibilityChange, true);
    
    // Add special styling to temporarily prevent flash of content when switching tabs
    const style = document.createElement('style');
    style.textContent = `
      body.tab-just-activated * {
        transition: none !important;
      }
      body.tab-just-activated {
        pointer-events: none;
      }
      body.tab-just-activated::after {
        content: '';
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 9999;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
    
    // Also override any window.onblur/onfocus handlers that might cause refreshes
    const originalBlur = window.onblur;
    const originalFocus = window.onfocus;
    
    window.onblur = function(e: FocusEvent) {
      // Set a flag that we're switching away from the tab
      sessionStorage.setItem('tab_switching_away', 'true');
      if (originalBlur) return originalBlur.call(window, e);
    };
    
    window.onfocus = function(e: FocusEvent) {
      if (sessionStorage.getItem('tab_switching_away')) {
        // We're returning from a tab switch
        sessionStorage.removeItem('tab_switching_away');
        sessionStorage.setItem('returning_from_tab_switch', 'true');
        
        // Extended to prevent immediate clearing
        setTimeout(() => {
          sessionStorage.removeItem('returning_from_tab_switch');
        }, 2500);
        
        // Prevent default focus behavior
        if (e && typeof e.stopPropagation === 'function') {
          e.stopPropagation();
        }

        // Then call original handler
        if (originalFocus) originalFocus.call(window, e);
        return false;
      }
      if (originalFocus) return originalFocus.call(window, e);
    };
    
    // Cleanup function
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange, true);
      document.head.removeChild(style);
      
      // Restore original handlers
      window.onblur = originalBlur;
      window.onfocus = originalFocus;
    };
  }, []);

  // Route-specific handling
  useEffect(() => {
    // Check if current route is an admin/manager route
    const adminRouteCheck = () => {
      const isAdmin = router.pathname === '/dashboard' || 
                      router.pathname.includes('/team-management') || 
                      router.pathname.includes('/admin');
      setIsAdminRoute(isAdmin);
    };
    
    adminRouteCheck();
    router.events.on('routeChangeComplete', adminRouteCheck);
    
    return () => {
      router.events.off('routeChangeComplete', adminRouteCheck);
    };
  }, [router.pathname, router.events]);

  // Global loading state timeout handler
  useEffect(() => {
    // This adds a safety mechanism for all pages to prevent hanging loading states
    const html = document.documentElement;
    html.classList.add('js-loading');
    
    // Force remove loading class after timeout
    // Use shorter timeout for admin routes since they have their own handling
    const timeoutDuration = isAdminRoute ? 5000 : 8000;
    
    const globalTimeout = setTimeout(() => {
      html.classList.remove('js-loading');
      console.log(`Global loading safety timeout reached (${isAdminRoute ? 'admin route' : 'standard route'})`);
    }, timeoutDuration);
    
    // Listen for route change end
    const handleRouteChangeComplete = () => {
      html.classList.remove('js-loading');
    };
    
    router.events.on('routeChangeComplete', handleRouteChangeComplete);
    
    return () => {
      clearTimeout(globalTimeout);
      router.events.off('routeChangeComplete', handleRouteChangeComplete);
    };
  }, [router, isAdminRoute]);

  return (
    <AuthProvider>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#1a1f2e" />
      </Head>
      <Component {...pageProps} />
      <Toaster position="top-right" toastOptions={{
        style: {
          background: '#1a1f2e',
          color: '#ffffff',
        },
        success: {
          duration: 3000,
        },
        error: {
          duration: 4000,
        },
      }} />
    </AuthProvider>
  );
}
