import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Toaster } from 'react-hot-toast';
import Head from 'next/head';
import { AuthProvider } from "@/lib/authContext";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { applySwitchPreventionToFetch, saveTabState, restoreTabState, isReturningFromTabSwitch } from '@/lib/tabSwitchUtil';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [isAdminRoute, setIsAdminRoute] = useState(false);
  const [restoredFromTab, setRestoredFromTab] = useState(false);

  // Add mechanism to prevent refreshes on tab switching
  useEffect(() => {
    // Apply the fetch prevention mechanism
    applySwitchPreventionToFetch();
    
    // Save current tab state immediately on load
    saveTabState({ initialLoad: true });
    
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
    
    // Handle Next.js router events to prevent unnecessary refreshes
    const handleRouteChangeStart = (url: string) => {
      if (isReturningFromTabSwitch()) {
        console.log('Preventing route change during tab switch:', url);
        // Only prevent navigation if it's to the same page we're already on
        if (url === router.asPath) {
          router.events.emit('routeChangeError');
          throw new Error('Route change cancelled due to tab switch');
        }
      }
      
      // Save state before any navigation
      saveTabState({ navigatingTo: url });
    };
    
    const handleRouteChangeComplete = (url: string) => {
      // Update tab state after successful navigation
      saveTabState({ currentRoute: url });
    };
    
    // Listen to router events
    router.events.on('routeChangeStart', handleRouteChangeStart);
    router.events.on('routeChangeComplete', handleRouteChangeComplete);
    
    // Cleanup function
    return () => {
      document.head.removeChild(style);
      router.events.off('routeChangeStart', handleRouteChangeStart);
      router.events.off('routeChangeComplete', handleRouteChangeComplete);
    };
  }, [router]);

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

  // Restore tab state on initial load
  useEffect(() => {
    // Check if we're restoring from a tab switch
    if (!restoredFromTab) {
      const tabState = restoreTabState();
      
      if (tabState && tabState.route && tabState.route !== router.pathname) {
        console.log('Restoring page from tab state:', tabState.route);
        // Only restore if the routes don't match (means we loaded a different page)
        setRestoredFromTab(true);
        
        // Don't attempt to restore if we're on a protected route or login page
        if (router.pathname === '/' || !tabState.route.includes('/user-dashboard')) {
          router.replace(tabState.route, undefined, { shallow: true });
        }
      }
    }
  }, [router, restoredFromTab]);

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
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
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
