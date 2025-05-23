import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Toaster } from 'react-hot-toast';
import Head from 'next/head';
import { AuthProvider } from "@/lib/authContext";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ensureTokenInRequests } from "@/lib/tabSwitchUtil";

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [isAdminRoute, setIsAdminRoute] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');

  // Initialize token persistence for API requests
  useEffect(() => {
    // Ensure tokens are included in all API requests
    ensureTokenInRequests();
    
    // Add debug info for Vercel production
    const environment = process.env.NODE_ENV;
    const isProduction = environment === 'production';
    
    if (isProduction && typeof window !== 'undefined') {
      console.log('=== VERCEL PRODUCTION DEBUG INFO ===');
      console.log('Environment:', environment);
      console.log('Current URL:', window.location.href);
      console.log('Supabase URL available:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
      
      // Check localStorage for auth data
      const authKeys = Object.keys(localStorage).filter(key => 
        key.includes('auth') || key.includes('token') || key.includes('sb-')
      );
      console.log('Auth-related localStorage keys:', authKeys);
      
      // Set up visibility change monitoring for debugging
      document.addEventListener('visibilitychange', () => {
        console.log(`=== TAB VISIBILITY CHANGED ===`);
        console.log('Document visibility state:', document.visibilityState);
        console.log('Current route:', router.pathname);
        console.log('Timestamp:', new Date().toISOString());
        
        if (document.visibilityState === 'visible') {
          // Check if auth state is still valid
          setTimeout(() => {
            const currentAuthKeys = Object.keys(localStorage).filter(key => 
              key.includes('auth') || key.includes('token') || key.includes('sb-')
            );
            console.log('Auth keys after tab switch:', currentAuthKeys);
          }, 1000);
        }
      });
      
      setDebugInfo(`Production environment detected. Auth keys: ${authKeys.length}`);
    }
  }, [router.pathname]);

  // Route-specific handling
  useEffect(() => {
    // Check if current route is an admin/manager route
    const adminRoutes = ['/dashboard', '/team-management'];
    const currentIsAdminRoute = adminRoutes.includes(router.pathname);
    setIsAdminRoute(currentIsAdminRoute);
    
    // Log route changes in production for debugging
    if (process.env.NODE_ENV === 'production') {
      console.log('Route changed to:', router.pathname, 'Is admin route:', currentIsAdminRoute);
    }
  }, [router.pathname]);

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
    
    // Listen for route change end and errors
    const handleRouteChangeComplete = () => {
      html.classList.remove('js-loading');
    };

    const handleRouteChangeError = () => {
      html.classList.remove('js-loading');
      console.log('Route change error - clearing loading state');
    };
    
    router.events.on('routeChangeComplete', handleRouteChangeComplete);
    router.events.on('routeChangeError', handleRouteChangeError);
    
    return () => {
      clearTimeout(globalTimeout);
      router.events.off('routeChangeComplete', handleRouteChangeComplete);
      router.events.off('routeChangeError', handleRouteChangeError);
    };
  }, [router, isAdminRoute]);

  return (
    <>
      <Head>
        <title>Aditi Daily Updates</title>
        <meta name="description" content="Daily updates tracking system for Aditi team" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <meta name="robots" content="noindex, nofollow" />
        
        {/* Prevent zoom on mobile devices */}
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        
        {/* Add debugging info for production */}
        {process.env.NODE_ENV === 'production' && (
          <meta name="debug-info" content={debugInfo} />
        )}
      </Head>
      
      <AuthProvider>
        <div className="min-h-screen bg-gray-50">
          <Component {...pageProps} />
          
          {/* Debug panel for production */}
          {process.env.NODE_ENV === 'production' && typeof window !== 'undefined' && (
            <div 
              style={{ 
                position: 'fixed', 
                bottom: '10px', 
                right: '10px', 
                background: 'rgba(0,0,0,0.8)', 
                color: 'white', 
                padding: '8px', 
                borderRadius: '4px', 
                fontSize: '12px',
                zIndex: 9999,
                maxWidth: '300px',
                display: window.location.search.includes('debug=true') ? 'block' : 'none'
              }}
            >
              <div>Route: {router.pathname}</div>
              <div>Admin Route: {isAdminRoute ? 'Yes' : 'No'}</div>
              <div>Environment: {process.env.NODE_ENV}</div>
              <div>Visibility: {typeof document !== 'undefined' ? document.visibilityState : 'unknown'}</div>
            </div>
          )}
        </div>
        
        {/* Toast notifications */}
        <Toaster 
          position="top-center"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#363636',
              color: '#fff',
            },
            success: {
              duration: 3000,
              iconTheme: {
                primary: '#10B981',
                secondary: '#fff',
              },
            },
            error: {
              duration: 5000,
              iconTheme: {
                primary: '#EF4444',
                secondary: '#fff',
              },
            },
          }}
        />
      </AuthProvider>
    </>
  );
}
