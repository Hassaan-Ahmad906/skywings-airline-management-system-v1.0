
// ========== PRE-RENDER INSTANT REDIRECT CHECK ==========
(function() {
    const rawPath = (window.location.pathname || '').toLowerCase();
    const cleanPath = rawPath.split('?')[0].split('#')[0];
    const page = cleanPath.split('/').filter(Boolean).pop() || 'index.html';
    if (page === 'index.html' || page === 'login.html' || page === 'register.html') {
        try {
            const cachedRole = localStorage.getItem('skywings_auth_role');
            if (cachedRole === 'admin') {
                window.location.replace('admin-dashboard.html');
            } else if (cachedRole === 'user') {
                window.location.replace('user-dashboard.html');
            }
        } catch (e) {}
    }
})();

// ========== SCROLL RESTORATION & INITIALIZATION ==========
if (typeof window !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

// ========== API CONFIGURATION ==========
const API_BASE_URL = window.location.origin.includes('localhost') 
    ? 'http://localhost:3000/api' 
    : '/api';

// Helper function to get auth token
function getAuthToken() {
    // Tokens are now stored in an httpOnly cookie on the server.
    // Client-side code must not read or store the JWT directly.
    return null;
}

// Client-side auth state populated from server /api/auth/check
let authState = {
    isLoggedIn: false,
    userRole: null,
    userId: null,
    userName: null
};

if (document.body) {
    document.body.classList.add('nav-loading');
}

function setClientAuth(user) {
    authState.isLoggedIn = true;
    authState.userRole = user.role || null;
    authState.userId = user.userId || user.user_id || null;
    authState.userName = `${user.firstName || user.first_name || ''} ${user.lastName || user.last_name || ''}`.trim();
    try {
        if (user.role) {
            localStorage.setItem('skywings_auth_role', user.role);
        }
    } catch (e) {}
    // Update UI
    updateNavbar();
}

function clearClientAuth() {
    authState.isLoggedIn = false;
    authState.userRole = null;
    authState.userId = null;
    authState.userName = null;
    try { localStorage.removeItem('skywings_auth_role'); } catch (e) {}
    // Clean up any client-side redirect/pending flags
    try { sessionStorage.removeItem('redirectAfterLogin'); } catch (e) {}
    try { sessionStorage.removeItem('pendingFlightBooking'); } catch (e) {}
    updateNavbar();
}

// Fetch current auth status from server and populate authState
async function fetchAuthStatus() {
    try {
        const response = await apiRequest('/auth/check');
        if (response && response.success && response.data && response.data.user) {
            setClientAuth(response.data.user);
            return true;
        }
    } catch (err) {
        // ignore - not logged in or server unavailable
    }
    clearClientAuth();
    return false;
}

// Update navbar based on login status
function createNavItem(href, text, options = {}) {
    const li = document.createElement('li');
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = text;
    if (options.className) anchor.className = options.className;
    if (options.onclick) anchor.setAttribute('onclick', options.onclick);
    li.appendChild(anchor);
    return li;
}

function removeNavItems(navMenu, selectors) {
    selectors.forEach(selector => {
        navMenu.querySelectorAll(selector).forEach(el => {
            const li = el.closest('li');
            if (li) {
                li.remove();
            } else {
                el.remove();
            }
        });
    });
}

function getNavbarItems() {
    if (authState.isLoggedIn && authState.userRole === 'admin') {
        return [
            { href: 'admin-dashboard.html', text: 'Dashboard' },
            { href: 'admin-management.html', text: 'Management' },
            { href: 'admin-reports.html', text: 'Reports' },
            { href: 'index.html', text: 'Logout', onclick: 'handleLogout(); return false;' }
        ];
    }

    if (authState.isLoggedIn && authState.userRole === 'user') {
        return [
            { href: 'user-dashboard.html', text: 'Dashboard' },
            { href: 'flight-search.html', text: 'Book Flight' },
            { href: 'my-bookings.html', text: 'My Bookings' },
            { href: 'check-in.html', text: 'Check-in' },
            { href: 'user-profile.html', text: 'Profile' },
            { href: 'user-about-contact.html', text: 'About & Contact' },
            { href: 'index.html', text: 'Logout', onclick: 'handleLogout(); return false;' }
        ];
    }

    return [
        { href: 'index.html', text: 'Home' },
        { href: 'flight-search.html', text: 'Flights' },
        { href: 'about-contact.html', text: 'About & Contact' },
        { href: 'login.html', text: 'Login', className: 'btn-login' },
        { href: 'register.html', text: 'Sign Up', className: 'btn-register' }
    ];
}

function setActiveNavLink(navMenu) {
    const currentPage = getNormalizedPage();
    navMenu.querySelectorAll('a').forEach(link => {
        link.classList.remove('active');
        const href = link.getAttribute('href') || '';
        const linkPath = href.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || 'index.html';
        if (linkPath === currentPage) {
            link.classList.add('active');
        }
    });
}

function updateNavbar() {
    const navMenu = document.getElementById('navMenu') || document.querySelector('.nav-menu');
    if (!navMenu) return;

    navMenu.innerHTML = '';
    const items = getNavbarItems();

    items.forEach(item => {
        navMenu.appendChild(createNavItem(item.href, item.text, {
            className: item.className,
            onclick: item.onclick
        }));
    });

    setActiveNavLink(navMenu);
    document.body.classList.add('nav-ready');
}

// Helper function to make API requests
async function apiRequest(endpoint, options = {}) {
    // Rely on server-side httpOnly cookie for authentication.
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    const url = `${API_BASE_URL}${endpoint}`;
    console.log(`API Request: ${options.method || 'GET'} ${url}`);
    if (options.body) {
        console.log('Request body:', options.body);
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            credentials: 'include' // send cookies for auth
        });

        console.log(`API Response status: ${response.status} ${response.statusText}`);

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            console.error('Non-JSON response:', text);
            throw new Error('Server returned non-JSON response');
        }
        
        console.log('API Response data:', data);
        
        if (!response.ok) {
            // Handle authentication errors - don't clear auth data for check-in or bookings endpoints unless it's a real auth failure
            if (response.status === 401 || response.status === 403) {
                // Check if this is a check-in or bookings endpoint - if so, provide better error message without clearing session
                if (endpoint.includes('/checkin') || endpoint.includes('/bookings')) {
                    const errorMsg = data.message || 'Authentication required';
                    throw new Error(errorMsg);
                }
                // For other endpoints, clear auth data on auth failure only if token is explicitly invalid
                if (data.message && (data.message.includes('invalid token') || data.message.includes('token expired') || data.message.includes('unauthorized'))) {
                    // Don't auto-redirect - let the calling function handle it
                    throw new Error(data.message || 'Your session has expired. Please login again.');
                }
            }
            
            // For check-in endpoints, if the error is "Already checked in", return the data instead of throwing
            // This allows the calling function to handle it gracefully without redirecting to login
            if (endpoint.includes('/checkin') && response.status === 400 && 
                data.message && (data.message.includes('Already checked in') || data.message.includes('already checked in'))) {
                // Return the response data so the calling function can handle "already checked in" case
                return data;
            }
            
            // Handle validation errors
            if (data.errors && Array.isArray(data.errors)) {
                const errorMessages = data.errors.map(err => err.msg || err.message).join(', ');
                throw new Error(errorMessages || data.message || 'Request failed');
            }
            throw new Error(data.message || `Request failed with status ${response.status}`);
        }

        return data;
    } catch (error) {
        console.error('API request error:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            endpoint: url,
            method: options.method || 'GET'
        });
        if (error.message) {
            throw error;
        }
        throw new Error('Network error. Please check your connection and server status.');
    }
}

// ========== AUTHENTICATION CHECK ==========

/**
 * Check if user is authenticated
 * @param {string} requiredRole - 'user', 'admin', or null for any authenticated user
 * @returns {boolean} - true if authenticated, false otherwise
 */
// Token validation flag to prevent multiple simultaneous checks
let tokenValidationInProgress = false;
let lastTokenValidation = 0;
const TOKEN_VALIDATION_CACHE_TIME = 60000; // 1 minute cache

function checkAuthentication(requiredRole = null) {
    const isLoggedIn = !!authState.isLoggedIn;
    const userRole = authState.userRole;

    console.log('checkAuthentication:', { requiredRole, isLoggedIn, userRole });

    if (!isLoggedIn) return false;
    if (requiredRole && userRole !== requiredRole) return false;
    return true;
}

// Helper function to clear all authentication data
function clearAuthData() {
    // Clear client auth state and any session redirect/bookings stored in sessionStorage
    clearClientAuth();
}

/**
 * Require authentication before accessing page
 * Redirects to login if not authenticated
 * @param {string} requiredRole - 'user', 'admin', or null for any authenticated user
 */
function requireAuth(requiredRole = null) {
    const authResult = checkAuthentication(requiredRole);

    if (!authResult) {
        console.log('requireAuth: Authentication failed, redirecting to login');
        // Store the current page to redirect back after login
        const currentPage = window.location.pathname.split('/').pop() || window.location.pathname;
        try { sessionStorage.setItem('redirectAfterLogin', currentPage); } catch (e) {}
        // Redirect to login
        window.location.replace('login.html');
        return false;
    }

    return true;
}

function getNormalizedPage() {
    const rawPath = (window.location.pathname || '').toLowerCase();
    const cleanPath = rawPath.split('?')[0].split('#')[0];
    const segments = cleanPath.split('/').filter(Boolean);
    const lastSegment = segments.pop() || '';
    if (!lastSegment || lastSegment === 'index.html') {
        return 'index.html';
    }
    return lastSegment;
}

function isAuthOrLandingPage(page) {
    const p = page || getNormalizedPage();
    return p === 'index.html' || p === 'login.html' || p === 'register.html';
}

function isAdminRoute(page) {
    const p = page || getNormalizedPage();
    return p.startsWith('admin-') || p.includes('admin-');
}

function isUserProtectedRoute(page) {
    const p = page || getNormalizedPage();
    return (
        p.startsWith('user-') ||
        p.includes('user-') ||
        p === 'my-bookings.html' ||
        p.includes('my-bookings') ||
        p === 'check-in.html' ||
        p.includes('check-in')
    );
}

function getCurrentPageInfo() {
    const currentPath = (window.location.pathname || '').toLowerCase();
    const currentFile = getNormalizedPage();
    const currentHref = (window.location.href || '').toLowerCase();
    return { currentFile, currentHref, currentPath };
}

function isProtectedRoute(currentFile, currentHref) {
    const page = currentFile ? (currentFile.split('?')[0].split('/').filter(Boolean).pop() || 'index.html') : getNormalizedPage();
    return isAdminRoute(page) || isUserProtectedRoute(page);
}

function isLoginOrLandingPage(currentFile, currentHref) {
    const page = currentFile ? (currentFile.split('?')[0].split('/').filter(Boolean).pop() || 'index.html') : getNormalizedPage();
    return isAuthOrLandingPage(page);
}

async function handlePageRestore() {
    const page = getNormalizedPage();
    await fetchAuthStatus();
    updateNavbar();

    if (!authState.isLoggedIn && (isAdminRoute(page) || isUserProtectedRoute(page))) {
        window.location.replace('login.html');
        return;
    }

    if (authState.isLoggedIn && isAuthOrLandingPage(page)) {
        if (authState.userRole === 'admin') {
            window.location.replace('admin-dashboard.html');
        } else {
            window.location.replace('user-dashboard.html');
        }
        return;
    }
}

function isBackForwardNavigation(event) {
    const navigationEntries = performance.getEntriesByType?.('navigation') || [];
    const navigationType = navigationEntries[0]?.type || '';
    const legacyType = performance?.navigation?.type;
    return event.persisted || navigationType === 'back_forward' || legacyType === 2;
}

window.addEventListener('pageshow', function(event) {
    if (isBackForwardNavigation(event)) {
        window.location.reload();
        return;
    }
    handlePageRestore();
});

window.addEventListener('popstate', function() {
    window.location.reload();
});

// Session management is now fully server-driven.
// Auth state is determined by the server cookie and /api/auth/check.
// Browser back/forward is handled by reloads so the page always reflects live session state.

// Initialize page
document.addEventListener('DOMContentLoaded', async function() {
    const page = getNormalizedPage();
    const currentHref = (window.location.href || '').toLowerCase();
    const currentFile = page;
    
    // Check authentication and populate auth state from server (httpOnly cookie)
    await fetchAuthStatus();

    // If logged in and accessing landing (index.html), login, or register page:
    // immediately redirect to the respective dashboard based on role
    if (authState.isLoggedIn && isAuthOrLandingPage(page)) {
        if (authState.userRole === 'admin') {
            window.location.replace('admin-dashboard.html');
        } else {
            window.location.replace('user-dashboard.html');
        }
        return;
    }

    // If not logged in and on landing/auth page, ensure client auth state is clean
    if (!authState.isLoggedIn && isAuthOrLandingPage(page)) {
        clearClientAuth();
    }
    
    // Admin pages - require admin role
    if (isAdminRoute(page)) {
        if (!requireAuth('admin')) {
            return; // Stop execution if not authenticated
        }
    }
    
    // User pages - require user authentication
    if (isUserProtectedRoute(page)) {
        if (!requireAuth('user')) {
            return; // Stop execution if not authenticated
        }
    }

    // Flight search page - allow guest access but update navbar based on auth status
    if (page === 'flight-search.html') {
        updateNavbar();
        initFlightSearchFromUrl();
    }

    // About & Contact page routing based on login status
    if (page === 'about-contact.html' && authState.isLoggedIn && authState.userRole === 'user') {
        window.location.replace('user-about-contact.html');
        return;
    }

    // Populate all Origin & Destination dropdowns dynamically from database with mutual exclusion
    await initializeAllAirportDropdowns();
    
    // Homepage quick search is permanently active and accessible for all users (guests & authenticated)

    // Set minimum date to today for flight dates, max date for DOB
    const dateInputs = document.querySelectorAll('input[type="date"]');//Selects all date elements there and returns a node list
    const datetimeInputs = document.querySelectorAll('input[type="datetime-local"]');//Selects all datetime-local elements
    const today = new Date().toISOString().split('T')[0];//Split date to YYYY-MM-DD
    const maxDate = '2100-12-31'; // Maximum year 2100 (4 digits)
    const maxDob = new Date();
    maxDob.setFullYear(maxDob.getFullYear() - 18);
    const maxDobStr = maxDob.toISOString().split('T')[0];
    const minDob = '1900-01-01'; // Minimum year 1900 (4 digits)
    
    dateInputs.forEach(input => {//Iterate through each date
        if (input.name === 'departure' || input.name === 'return') {//set minimum date to today so no past dates can be selected
            input.setAttribute('min', today);
            input.setAttribute('max', maxDate);
        } else if (input.name === 'dob' || input.name.includes('dob')) {
            input.setAttribute('max', maxDobStr);
            input.setAttribute('min', minDob);
        } else {
            // For other date inputs, set max to prevent years beyond 4 digits
            input.setAttribute('max', maxDate);
        }
        
        // Add calendar synchronization to validate month-specific days
        // Store previous valid date parts to restore if needed
        let previousValidDate = null;
        let lastInputValue = input.value || '';
        
        // Handle input event to preserve day when year or month changes
        input.addEventListener('input', function() {
            const currentValue = this.value;
            
            // If we have a previous valid date and current value is being edited
            if (previousValidDate && currentValue) {
                const parts = currentValue.split('-');
                
                // Need at least year and month parts to validate
                if (parts.length >= 2 && parts[0] && parts[1]) {
                    const newYear = parseInt(parts[0]);
                    const newMonth = parseInt(parts[1]);
                    
                    // Check if year or month changed
                    const yearChanged = !isNaN(newYear) && newYear !== previousValidDate.year;
                    const monthChanged = !isNaN(newMonth) && newMonth >= 1 && newMonth <= 12 && newMonth !== previousValidDate.month;
                    
                    if (yearChanged || monthChanged) {
                        // Use new year and month
                        const year = !isNaN(newYear) && newYear > 0 ? newYear : previousValidDate.year;
                        const month = !isNaN(newMonth) && newMonth >= 1 && newMonth <= 12 ? newMonth : previousValidDate.month;
                        
                        // Preserve day from previous valid date (don't use browser's auto-filled day)
                        let day = previousValidDate.day;
                        
                        // Only use new day if it's explicitly provided and different from previous
                        // This prevents browser from auto-setting to 31 when month changes
                        if (parts.length >= 3 && parts[2]) {
                            const newDay = parseInt(parts[2]);
                            // Only use new day if it's valid and user explicitly typed it
                            // If it's 31 and month changed to a month with fewer days, ignore it
                            if (!isNaN(newDay) && newDay >= 1 && newDay <= 31) {
                                const maxDays = getDaysInMonth(year, month - 1);
                                // Only use the new day if it's valid for the new month
                                if (newDay <= maxDays) {
                                    day = newDay;
                                }
                            }
                        }
                        
                        // Check if day is valid for the new year/month
                        const maxDays = getDaysInMonth(year, month - 1);
                        if (day > maxDays) {
                            // Adjust to max days for that month
                            day = maxDays;
                        }
                        
                        // Update the input value preserving day
                        const correctedDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        if (correctedDate !== currentValue) {
                            this.value = correctedDate;
                            previousValidDate = { year: year, month: month, day: day };
                        }
                    }
                }
            }
            
            lastInputValue = currentValue;
        });
        
        input.addEventListener('change', function() {
            const result = validateCalendarDate(this, previousValidDate);
            if (result && result.valid) {
                previousValidDate = result.dateParts;
                lastInputValue = this.value;
            }
        });
        
        // Use 'blur' event to validate when user finishes with the field
        // This preserves month/day when user is editing year manually
        input.addEventListener('blur', function() {
            if (this.value) {
                const result = validateCalendarDate(this, previousValidDate);
                if (result && result.valid) {
                    previousValidDate = result.dateParts;
                    lastInputValue = this.value;
                }
            }
        });
        
        // Store initial value if it exists
        if (input.value) {
            const parts = input.value.split('-');
            if (parts.length === 3) {
                const [y, m, d] = parts.map(Number);
                if (y && m && d && !isNaN(y) && !isNaN(m) && !isNaN(d)) {
                    previousValidDate = { year: y, month: m, day: d };
                    lastInputValue = input.value;
                }
            }
        }
    });
    
    // Set max for datetime-local inputs to prevent years beyond 4 digits
    datetimeInputs.forEach(input => {
        input.setAttribute('max', '2100-12-31T23:59');
        
        // Add calendar synchronization for datetime-local inputs
        // Store previous valid date parts to restore if needed
        let previousValidDateTime = null;
        let lastInputValue = input.value || '';
        
        // Handle input event to preserve day when year or month changes
        input.addEventListener('input', function() {
            const currentValue = this.value;
            
            // If we have a previous valid date and current value is being edited
            if (previousValidDateTime && currentValue) {
                const [datePart, timePart] = currentValue.split('T');
                const time = timePart || '00:00';
                
                if (datePart) {
                    const parts = datePart.split('-');
                    
                    // Need at least year and month parts to validate
                    if (parts.length >= 2 && parts[0] && parts[1]) {
                        const newYear = parseInt(parts[0]);
                        const newMonth = parseInt(parts[1]);
                        
                        // Check if year or month changed
                        const yearChanged = !isNaN(newYear) && newYear !== previousValidDateTime.year;
                        const monthChanged = !isNaN(newMonth) && newMonth >= 1 && newMonth <= 12 && newMonth !== previousValidDateTime.month;
                        
                        if (yearChanged || monthChanged) {
                            // Use new year and month
                            const year = !isNaN(newYear) && newYear > 0 ? newYear : previousValidDateTime.year;
                            const month = !isNaN(newMonth) && newMonth >= 1 && newMonth <= 12 ? newMonth : previousValidDateTime.month;
                            
                            // Preserve day from previous valid date (don't use browser's auto-filled day)
                            let day = previousValidDateTime.day;
                            
                            // Only use new day if it's explicitly provided and valid
                            // This prevents browser from auto-setting to 31 when month changes
                            if (parts.length >= 3 && parts[2]) {
                                const newDay = parseInt(parts[2]);
                                // Only use new day if it's valid and user explicitly typed it
                                // If it's 31 and month changed to a month with fewer days, ignore it
                                if (!isNaN(newDay) && newDay >= 1 && newDay <= 31) {
                                    const maxDays = getDaysInMonth(year, month - 1);
                                    // Only use the new day if it's valid for the new month
                                    if (newDay <= maxDays) {
                                        day = newDay;
                                    }
                                }
                            }
                            
                            // Check if day is valid for the new year/month
                            const maxDays = getDaysInMonth(year, month - 1);
                            if (day > maxDays) {
                                // Adjust to max days for that month
                                day = maxDays;
                            }
                            
                            // Update the input value preserving day
                            const correctedDateTime = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time}`;
                            if (correctedDateTime !== currentValue) {
                                this.value = correctedDateTime;
                                previousValidDateTime = { year: year, month: month, day: day };
                            }
                        }
                    }
                }
            }
            
            lastInputValue = currentValue;
        });
        
        input.addEventListener('change', function() {
            const result = validateCalendarDateTime(this, previousValidDateTime);
            if (result && result.valid) {
                previousValidDateTime = result.dateParts;
                lastInputValue = this.value;
            }
        });
        
        // Use 'blur' event to validate when user finishes with the field
        // This preserves month/day when user is editing year manually
        input.addEventListener('blur', function() {
            if (this.value) {
                const result = validateCalendarDateTime(this, previousValidDateTime);
                if (result && result.valid) {
                    previousValidDateTime = result.dateParts;
                    lastInputValue = this.value;
                }
            }
        });
        
        // Store initial value if it exists
        if (input.value) {
            const [datePart] = input.value.split('T');
            if (datePart) {
                const parts = datePart.split('-');
                if (parts.length === 3) {
                    const [y, m, d] = parts.map(Number);
                    if (y && m && d && !isNaN(y) && !isNaN(m) && !isNaN(d)) {
                        previousValidDateTime = { year: y, month: m, day: d };
                        lastInputValue = input.value;
                    }
                }
            }
        }
    });

    // Hamburger menu toggle - Enhanced for all screen sizes
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');
    
    if (hamburger && navMenu) {
        // Toggle menu on hamburger click
        hamburger.addEventListener('click', function(e) {
            e.stopPropagation();
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('active');
            
            // Prevent body scroll when menu is open
            if (navMenu.classList.contains('active')) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
            }
        });

        // Close menu when clicking on a link
        const navLinks = navMenu.querySelectorAll('a');
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                hamburger.classList.remove('active');
                navMenu.classList.remove('active');
                document.body.style.overflow = '';
            });
        });

        // Close menu when clicking outside
        document.addEventListener('click', function(event) {
            if (navMenu.classList.contains('active')) {
                if (!hamburger.contains(event.target) && !navMenu.contains(event.target)) {
                    hamburger.classList.remove('active');
                    navMenu.classList.remove('active');
                    document.body.style.overflow = '';
                }
            }
        });
        
        // Close menu on window resize if screen becomes large
        window.addEventListener('resize', function() {
            if (window.innerWidth > 1024) {
                hamburger.classList.remove('active');
                navMenu.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }

    // Load dashboard data if on dashboard page
    if (window.location.pathname.includes('dashboard')) {
        loadDashboardData();
        if (window.location.pathname.includes('user-dashboard')) {
            loadUserDashboardData();
        } else if (window.location.pathname.includes('admin-dashboard')) {
            loadAdminDashboard();
        }
    }
    
    // Update navbar based on login status
    updateNavbar();
    
    // Set user name from server-driven authState
    const userName = authState.userName;
    
    // Load user profile if on profile page
    if (currentFile === 'user-profile.html' || currentHref.includes('user-profile')) {
        loadUserProfile();
    }
    if (userName) {
        const userNameEl = document.getElementById('userName');
        if (userNameEl) userNameEl.textContent = userName;
    }

    // Check-in page initialization - require authentication
    if (window.location.pathname.includes('check-in')) {
        // Check authentication status directly using server-driven authState
        const isLoggedIn = !!authState.isLoggedIn;
        const userRole = authState.userRole;

        // Only redirect if user is clearly not logged in
        if (!isLoggedIn) {
            // Store redirect destination in sessionStorage
            const currentPage = window.location.pathname.split('/').pop() || window.location.pathname;
            const queryString = window.location.search;
            try { sessionStorage.setItem('redirectAfterLogin', currentPage + queryString); } catch (e) {}
            window.location.href = 'login.html';
            return;
        }

        // If user has wrong role, still allow but log warning
        if (userRole !== 'user') {
            console.warn('Check-in page accessed by non-user role:', userRole);
        }

        // User appears to be authenticated, proceed with check-in page
        loadBookingForCheckIn();
    }

    // My bookings page - require authentication
    if (window.location.pathname.includes('my-bookings')) {
        if (!requireAuth('user')) {
            return; // Redirected to login
        }
        // Load bookings after a short delay to ensure DOM is ready
        setTimeout(() => {
            filterBookings('all', 'user');
        }, 100);
    }

    if (window.location.pathname.includes('admin-management')) {
        // Load flights immediately since flights tab is visible by default
        // Use requestAnimationFrame for better performance
        requestAnimationFrame(() => {
            if (typeof loadAdminFlights === 'function') {
                loadAdminFlights(1, '');
            }
        });
    }

    if (window.location.pathname.includes('admin-reports')) {
        // Load overview report by default
        setTimeout(() => {
            console.log('Loading admin reports...');
            loadOverviewReport();
        }, 300);
    }
});

// ========== AUTHENTICATION ==========

// Demo Credentials:
// Admin: admin@skywings.com / admin123
// User: user@skywings.com / user123

async function handleLogin(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const email = formData.get('email')?.trim();
    const password = formData.get('password');
    
    // Clear previous errors
    clearFormErrors(form);
    
    // Validation
    let hasErrors = false;
    
    if (!email) {
        showFieldError(form, 'email', 'Email is required');
        hasErrors = true;
    } else if (!isValidEmail(email)) {
        showFieldError(form, 'email', 'Please enter a valid email address');
        hasErrors = true;
    }
    
    if (!password) {
        showFieldError(form, 'password', 'Password is required');
        hasErrors = true;
    } else if (password.length < 6) {
        showFieldError(form, 'password', 'Password must be at least 6 characters');
        hasErrors = true;
    }
    
    if (hasErrors) {
        return;
    }
    
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';
    
    try {
        console.log('Attempting login for:', email);
        const response = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        console.log('Login API response:', response);

        // Validate response structure
        if (!response) {
            throw new Error('No response from server');
        }

        if (!response.success) {
            throw new Error(response.message || 'Login failed');
        }

        if (!response.data) {
            throw new Error('Invalid response data from server');
        }

        if (!response.data.user) {
            throw new Error('User data not found in response');
        }

        // Server set httpOnly cookie; populate client auth state from returned user
        setClientAuth(response.data.user);

        console.log('Auth state populated, redirecting...');
        console.log('User role:', response.data.user.role);

        // Get redirect destination if exists (sessionStorage)
        const redirectTo = sessionStorage.getItem('redirectAfterLogin');
        sessionStorage.removeItem('redirectAfterLogin');
        
        // Determine redirect URL based on role
        let redirectUrl;
        if (response.data.user.role === 'admin') {
            redirectUrl = (redirectTo && redirectTo.includes('admin')) ? redirectTo : 'admin-dashboard.html';
        } else {
            redirectUrl = (redirectTo && !redirectTo.includes('admin')) ? redirectTo : 'user-dashboard.html';
        }
        
        console.log('Redirecting to:', redirectUrl);
        
        // Set flag to prevent clearing auth data during redirect
        isRedirecting = true;
        isNavigating = true; // Mark as navigation to prevent logout on redirect
        
        // Force immediate redirect (use replace to prevent back button issues)
        // Redirect immediately after setting client auth state
        window.location.replace(redirectUrl);
        
    } catch (error) {
        console.error('Login error details:', error);
        let errorMessage = 'Login failed. Please check your credentials.';
        
        // Extract error message from various error formats
        if (error.message) {
            errorMessage = error.message;
        }
        
        // Check if it's a validation error with array
        if (error.errors && Array.isArray(error.errors)) {
            errorMessage = error.errors.map(e => e.msg || e.message).join(', ');
        }
        
        // Show error to user
        alert('Login Error: ' + errorMessage); // Show alert for debugging
        showFormError(form, errorMessage);
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    
    const firstName = formData.get('firstName')?.trim();
    const lastName = formData.get('lastName')?.trim();
    const email = formData.get('email')?.trim();
    const phone = formData.get('phone')?.trim();
    const dob = formData.get('dob');
    const password = formData.get('password');
    const confirmPassword = formData.get('confirmPassword');
    const terms = formData.get('terms');
    
    // Clear previous errors
    clearFormErrors(form);
    
    // Validation
    let hasErrors = false;
    
    if (!firstName || firstName.length < 2) {
        showFieldError(form, 'firstName', 'First name must be at least 2 characters');
        hasErrors = true;
    } else if (!/^[a-zA-Z\s'-]+$/.test(firstName)) {
        showFieldError(form, 'firstName', 'First name can only contain letters, spaces, hyphens, and apostrophes');
        hasErrors = true;
    }
    
    if (!lastName || lastName.length < 2) {
        showFieldError(form, 'lastName', 'Last name must be at least 2 characters');
        hasErrors = true;
    } else if (!/^[a-zA-Z\s'-]+$/.test(lastName)) {
        showFieldError(form, 'lastName', 'Last name can only contain letters, spaces, hyphens, and apostrophes');
        hasErrors = true;
    }
    
    if (!email) {
        showFieldError(form, 'email', 'Email is required');
        hasErrors = true;
    } else if (!isValidEmail(email)) {
        showFieldError(form, 'email', 'Please enter a valid email address');
        hasErrors = true;
    }
    
    if (!phone) {
        showFieldError(form, 'phone', 'Phone number is required');
        hasErrors = true;
    } else if (!isValidPhone(phone)) {
        showFieldError(form, 'phone', 'Please enter a valid phone number');
        hasErrors = true;
    }
    
    if (!dob) {
        showFieldError(form, 'dob', 'Date of birth is required');
        hasErrors = true;
    } else if (!isValidDateOfBirth(dob)) {
        showFieldError(form, 'dob', 'Please enter a valid date of birth (must be at least 18 years old and not in the future)');
        hasErrors = true;
    }
    
    if (!password) {
        showFieldError(form, 'password', 'Password is required');
        hasErrors = true;
    } else if (password.length < 6) {
        showFieldError(form, 'password', 'Password must be at least 6 characters long');
        hasErrors = true;
    } else {
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        
        if (!hasUpperCase || !hasLowerCase || !hasNumber) {
            showFieldError(form, 'password', 'Password must contain at least one uppercase letter, one lowercase letter, and one number');
            hasErrors = true;
        }
    }
    
    if (!confirmPassword) {
        showFieldError(form, 'confirmPassword', 'Please confirm your password');
        hasErrors = true;
    } else if (password !== confirmPassword) {
        showFieldError(form, 'confirmPassword', 'Passwords do not match');
        hasErrors = true;
    }
    
    if (!terms) {
        showFieldError(form, 'terms', 'You must agree to the Terms & Conditions');
        hasErrors = true;
    }
    
    if (hasErrors) {
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';
    
    try {
        const response = await apiRequest('/auth/register', {
            method: 'POST',
            body: JSON.stringify({
                firstName: firstName,
                lastName: lastName,
                email: email,
                password: password,
                confirmPassword: confirmPassword,
                phone: phone || null,
                dob: dob || null,
                address: null
            })
        });

        if (response.success) {
            // Registration succeeds; server sets an httpOnly auth cookie for the session.
            // Populate client auth state and redirect to dashboard.
            const newUser = {
                userId: response.data.userId,
                firstName: firstName,
                lastName: lastName,
                role: 'user'
            };
            setClientAuth(newUser);
            window.location.href = 'user-dashboard.html';
        } else {
            throw new Error(response.message || 'Registration failed');
        }
    } catch (error) {
        let errorMessage = 'Registration failed. Please try again.';
        if (error.message) {
            errorMessage = error.message;
        }
        if (error.response && error.response.message) {
            errorMessage = error.response.message;
        }
        if (error.response && error.response.errors && error.response.errors.length > 0) {
            error.response.errors.forEach(err => {
                showFieldError(form, err.param || 'general', err.msg || errorMessage);
            });
        } else {
            showFormError(form, errorMessage);
        }
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// Helper functions for validation and error display
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function isValidPhone(phone) {
    const phoneRegex = /^[\d\s\-\+\(\)]{10,20}$/;
    return phoneRegex.test(phone);
}

// Get maximum days in a month (handles leap years)
function getDaysInMonth(year, month) {
    // month is 0-indexed (0 = January, 11 = December)
    return new Date(year, month + 1, 0).getDate();
}

// Validate calendar date to ensure month-specific day limits
// Returns object with validation result and date parts for restoration if needed
function validateCalendarDate(dateInput, previousValidDate = null) {
    if (!dateInput.value) {
        // If value is cleared but we have previous valid date, restore it
        if (previousValidDate) {
            const restoredDate = `${String(previousValidDate.year).padStart(4, '0')}-${String(previousValidDate.month).padStart(2, '0')}-${String(previousValidDate.day).padStart(2, '0')}`;
            dateInput.value = restoredDate;
            return { valid: true, dateParts: previousValidDate };
        }
        return null;
    }
    
    const dateValue = dateInput.value.trim(); // Format: YYYY-MM-DD
    
    // If date is incomplete, try to restore from previous valid date
    if (!dateValue || dateValue.length < 10) {
        if (previousValidDate) {
            // Try to parse what we have and merge with previous
            const parts = dateValue.split('-');
            let year = previousValidDate.year;
            let month = previousValidDate.month;
            let day = previousValidDate.day;
            
            if (parts.length >= 1 && parts[0]) {
                const y = parseInt(parts[0]);
                if (!isNaN(y) && y > 0) year = y;
            }
            if (parts.length >= 2 && parts[1]) {
                const m = parseInt(parts[1]);
                if (!isNaN(m) && m >= 1 && m <= 12) month = m;
            }
            if (parts.length >= 3 && parts[2]) {
                const d = parseInt(parts[2]);
                if (!isNaN(d) && d >= 1 && d <= 31) day = d;
            }
            
            const restoredDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            dateInput.value = restoredDate;
            return { valid: true, dateParts: { year, month, day } };
        }
        return null; // Incomplete date, don't validate yet
    }
    
    const parts = dateValue.split('-');
    if (parts.length !== 3) {
        // Invalid format, try to restore from previous
        if (previousValidDate) {
            const restoredDate = `${String(previousValidDate.year).padStart(4, '0')}-${String(previousValidDate.month).padStart(2, '0')}-${String(previousValidDate.day).padStart(2, '0')}`;
            dateInput.value = restoredDate;
            return { valid: true, dateParts: previousValidDate };
        }
        return null; // Invalid format, don't validate
    }
    
    let year = parseInt(parts[0]);
    let month = parseInt(parts[1]);
    let day = parseInt(parts[2]);
    
    // If any part is invalid, try to use previous valid values
    if (isNaN(year) || year <= 0) {
        if (previousValidDate) year = previousValidDate.year;
        else return null;
    }
    if (isNaN(month) || month < 1 || month > 12) {
        if (previousValidDate) month = previousValidDate.month;
        else return null;
    }
    if (isNaN(day) || day < 1 || day > 31) {
        if (previousValidDate) day = previousValidDate.day;
        else return null;
    }
    
    // Check year doesn't exceed 4 digits (2100 max)
    if (year > 2100) {
        year = 2100;
    }
    
    // Get maximum days for the selected month/year
    const maxDays = getDaysInMonth(year, month - 1); // month is 1-indexed in input
    
    // Only adjust day if it exceeds maximum days for the month
    // Preserve the day if it's valid, even if year changed
    if (day > maxDays) {
        // Only adjust if day is truly invalid (e.g., Feb 30 or Feb 29 in non-leap year)
        const dateObj = new Date(year, month - 1, day);
        if (dateObj.getFullYear() !== year || dateObj.getMonth() !== month - 1 || dateObj.getDate() !== day) {
            // Date is invalid, adjust to max days
            day = maxDays;
            
            // Show a subtle notification only if we had to adjust
            const formGroup = dateInput.closest('.form-group');
            if (formGroup) {
                let notice = formGroup.querySelector('.date-notice');
                if (!notice) {
                    notice = document.createElement('small');
                    notice.className = 'date-notice';
                    notice.style.cssText = 'color: #f59e0b; font-size: 0.85rem; margin-top: 0.25rem; display: block;';
                    dateInput.parentNode.appendChild(notice);
                }
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                                  'July', 'August', 'September', 'October', 'November', 'December'];
                notice.textContent = `Adjusted to ${maxDays} days (maximum for ${monthNames[month - 1]} ${year})`;
                
                // Clear notice after 3 seconds
                setTimeout(() => {
                    if (notice) notice.textContent = '';
                }, 3000);
            }
        }
    }
    
    // Set the corrected date
    const correctedDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    dateInput.value = correctedDate;
    
    return { valid: true, dateParts: { year, month, day } };
}

// Validate datetime-local input
// Returns object with validation result and date parts for restoration if needed
function validateCalendarDateTime(dateTimeInput, previousValidDateTime = null) {
    if (!dateTimeInput.value) {
        // If value is cleared but we have previous valid date, restore it
        if (previousValidDateTime) {
            const timePart = dateTimeInput.value.includes('T') ? dateTimeInput.value.split('T')[1] : '00:00';
            const restoredDateTime = `${String(previousValidDateTime.year).padStart(4, '0')}-${String(previousValidDateTime.month).padStart(2, '0')}-${String(previousValidDateTime.day).padStart(2, '0')}T${timePart}`;
            dateTimeInput.value = restoredDateTime;
            return { valid: true, dateParts: previousValidDateTime };
        }
        return null;
    }
    
    const dateTimeValue = dateTimeInput.value.trim(); // Format: YYYY-MM-DDTHH:mm
    
    // If datetime is incomplete, try to restore from previous valid date
    if (!dateTimeValue || dateTimeValue.length < 16) {
        if (previousValidDateTime) {
            const [datePart, timePart] = dateTimeValue.split('T');
            const time = timePart || '00:00';
            
            // Try to parse what we have and merge with previous
            let year = previousValidDateTime.year;
            let month = previousValidDateTime.month;
            let day = previousValidDateTime.day;
            
            if (datePart) {
                const parts = datePart.split('-');
                if (parts.length >= 1 && parts[0]) {
                    const y = parseInt(parts[0]);
                    if (!isNaN(y) && y > 0) year = y;
                }
                if (parts.length >= 2 && parts[1]) {
                    const m = parseInt(parts[1]);
                    if (!isNaN(m) && m >= 1 && m <= 12) month = m;
                }
                if (parts.length >= 3 && parts[2]) {
                    const d = parseInt(parts[2]);
                    if (!isNaN(d) && d >= 1 && d <= 31) day = d;
                }
            }
            
            const restoredDateTime = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time}`;
            dateTimeInput.value = restoredDateTime;
            return { valid: true, dateParts: { year, month, day } };
        }
        return null; // Incomplete datetime, don't validate yet
    }
    
    const [datePart, timePart] = dateTimeValue.split('T');
    
    if (!datePart || datePart.length < 10) {
        // Invalid date part, try to restore from previous
        if (previousValidDateTime) {
            const time = timePart || '00:00';
            const restoredDateTime = `${String(previousValidDateTime.year).padStart(4, '0')}-${String(previousValidDateTime.month).padStart(2, '0')}-${String(previousValidDateTime.day).padStart(2, '0')}T${time}`;
            dateTimeInput.value = restoredDateTime;
            return { valid: true, dateParts: previousValidDateTime };
        }
        return null;
    }
    
    const parts = datePart.split('-');
    if (parts.length !== 3) {
        // Invalid format, try to restore from previous
        if (previousValidDateTime) {
            const time = timePart || '00:00';
            const restoredDateTime = `${String(previousValidDateTime.year).padStart(4, '0')}-${String(previousValidDateTime.month).padStart(2, '0')}-${String(previousValidDateTime.day).padStart(2, '0')}T${time}`;
            dateTimeInput.value = restoredDateTime;
            return { valid: true, dateParts: previousValidDateTime };
        }
        return null; // Invalid format, don't validate
    }
    
    let year = parseInt(parts[0]);
    let month = parseInt(parts[1]);
    let day = parseInt(parts[2]);
    
    // If any part is invalid, try to use previous valid values
    if (isNaN(year) || year <= 0) {
        if (previousValidDateTime) year = previousValidDateTime.year;
        else return null;
    }
    if (isNaN(month) || month < 1 || month > 12) {
        if (previousValidDateTime) month = previousValidDateTime.month;
        else return null;
    }
    if (isNaN(day) || day < 1 || day > 31) {
        if (previousValidDateTime) day = previousValidDateTime.day;
        else return null;
    }
    
    // Check year doesn't exceed 4 digits (2100 max)
    if (year > 2100) {
        year = 2100;
    }
    
    // Get maximum days for the selected month/year
    const maxDays = getDaysInMonth(year, month - 1);
    
    // Only adjust day if it exceeds maximum days for the month
    // Preserve the day if it's valid, even if year changed
    if (day > maxDays) {
        // Only adjust if day is truly invalid (e.g., Feb 30 or Feb 29 in non-leap year)
        const dateObj = new Date(year, month - 1, day);
        if (dateObj.getFullYear() !== year || dateObj.getMonth() !== month - 1 || dateObj.getDate() !== day) {
            // Date is invalid, adjust to max days
            day = maxDays;
        }
    }
    
    // Set the corrected datetime
    const time = timePart || '00:00';
    const correctedDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const correctedDateTime = `${correctedDate}T${time}`;
    dateTimeInput.value = correctedDateTime;
    
    return { valid: true, dateParts: { year, month, day } };
}

function isValidDateOfBirth(dob) {
    if (!dob) return false;
    
    const birthDate = new Date(dob);
    const today = new Date();
    
    // Validate date is actually valid (handles month-specific day limits)
    const [year, month, day] = dob.split('-').map(Number);
    if (year && month && day) {
        const maxDays = getDaysInMonth(year, month - 1);
        if (day > maxDays) {
            return false; // Invalid date (e.g., June 31st)
        }
    }
    
    const age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    // Check if date is in the future
    if (birthDate > today) {
        return false;
    }
    
    // Check if age is reasonable (between 18 and 120)
    const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate()) ? age - 1 : age;
    return actualAge >= 18 && actualAge <= 120;
}

function showFieldError(form, fieldName, message) {
    const field = form.querySelector(`[name="${fieldName}"]`);
    if (field) {
        field.style.borderColor = 'var(--danger)';
        field.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.1)';
        
        // Remove existing error message
        const existingError = field.parentElement.querySelector('.field-error');
        if (existingError) {
            existingError.remove();
        }
        
        // Add error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'field-error';
        errorDiv.style.cssText = 'color: var(--danger); font-size: 0.85rem; margin-top: 0.25rem;';
        errorDiv.textContent = message;
        field.parentElement.appendChild(errorDiv);
        
        // Focus on field
        field.focus();
    }
}

function showFormError(form, message) {
    // Remove existing form error
    const existingError = form.querySelector('.form-error');
    if (existingError) {
        existingError.remove();
    }
    
    // Add form error
    const errorDiv = document.createElement('div');
    errorDiv.className = 'form-error';
    errorDiv.style.cssText = 'background: rgba(239, 68, 68, 0.1); border: 1px solid var(--danger); color: var(--danger); padding: 0.75rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;';
    errorDiv.textContent = message;
    form.insertBefore(errorDiv, form.firstChild);
}

function clearFormErrors(form) {
    // Clear field errors
    form.querySelectorAll('.field-error').forEach(el => el.remove());
    form.querySelectorAll('input, select, textarea').forEach(field => {
        field.style.borderColor = '';
        field.style.boxShadow = '';
    });
    
    // Clear form error
    const formError = form.querySelector('.form-error');
    if (formError) {
        formError.remove();
    }
}

// Password match checker
function checkPasswordMatch(input) {
    const password = document.querySelector('[name="password"]').value;
    const confirmPassword = input.value;
    const matchDiv = document.getElementById('passwordMatch');
    
    if (!matchDiv) return;
    
    if (confirmPassword.length === 0) {
        matchDiv.textContent = '';
        matchDiv.style.color = '';
        return;
    }
    
    if (password === confirmPassword) {
        matchDiv.textContent = '✓ Passwords match';
        matchDiv.style.color = 'var(--success)';
        input.style.borderColor = 'rgba(22, 163, 74, 0.5)';
    } else {
        matchDiv.textContent = '✗ Passwords do not match';
        matchDiv.style.color = 'var(--danger)';
        input.style.borderColor = 'rgba(239, 68, 68, 0.5)';
    }
}

// Password strength checker
function checkPasswordStrength(input) {
    const password = input.value;
    const strengthDiv = document.getElementById('passwordStrength');
    const strengthBar = document.getElementById('passwordStrengthBar');
    const strengthText = document.getElementById('passwordStrengthText');
    
    if (!strengthDiv || !strengthBar || !strengthText) return;
    
    if (password.length === 0) {
        strengthDiv.style.display = 'none';
        return;
    }
    
    strengthDiv.style.display = 'block';
    
    let strength = 0;
    let feedback = [];
    
    if (password.length >= 6) strength += 25;
    else feedback.push('At least 6 characters');
    
    if (/[a-z]/.test(password)) strength += 25;
    else feedback.push('lowercase letter');
    
    if (/[A-Z]/.test(password)) strength += 25;
    else feedback.push('uppercase letter');
    
    if (/[0-9]/.test(password)) strength += 25;
    else feedback.push('number');
    
    strengthBar.style.width = strength + '%';
    
    if (strength <= 25) {
        strengthBar.style.background = 'var(--danger)';
        strengthText.textContent = 'Weak password';
        strengthText.style.color = 'var(--danger)';
    } else if (strength <= 50) {
        strengthBar.style.background = '#f59e0b';
        strengthText.textContent = 'Fair password';
        strengthText.style.color = '#f59e0b';
    } else if (strength <= 75) {
        strengthBar.style.background = '#3b82f6';
        strengthText.textContent = 'Good password';
        strengthText.style.color = '#3b82f6';
    } else {
        strengthBar.style.background = 'var(--success)';
        strengthText.textContent = 'Strong password';
        strengthText.style.color = 'var(--success)';
    }
    
    if (feedback.length > 0 && strength < 100) {
        strengthText.textContent += ' - Needs: ' + feedback.join(', ');
    }
}

async function handleLogout(event) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }
    if (typeof window !== 'undefined' && window.event && typeof window.event.preventDefault === 'function') {
        try { window.event.preventDefault(); } catch (e) {}
    }

    // Prevent multiple simultaneous logout attempts
    if (tokenValidationInProgress) {
        return;
    }

    try {
        // Logout on server and wait for the cookie to be cleared before redirecting
        await apiRequest('/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout error:', error);
    }

    // Always clear local authentication data
    clearAuthData();

    // Update navbar immediately
    updateNavbar();

    // Show logout message
    alert('Logged out successfully!');

    // Redirect to home page
    window.location.replace('index.html');
}

// ========== DYNAMIC AIRPORT LOADER & MUTUAL EXCLUSION FILTER ==========

let cachedAirportsList = [];

async function fetchDatabaseAirports() {
    if (cachedAirportsList && cachedAirportsList.length > 0) {
        return cachedAirportsList;
    }
    try {
        const response = await apiRequest('/flights/airports');
        if (response && response.success && response.data && Array.isArray(response.data.airports)) {
            cachedAirportsList = response.data.airports;
            return cachedAirportsList;
        }
    } catch (error) {
        console.warn('Could not fetch airports from DB:', error);
    }
    return cachedAirportsList;
}

function renderAirportSelectOptions(selectElement, excludeCode = '', placeholderText = 'Select Airport') {
    if (!selectElement) return;
    
    const currentValue = selectElement.value;
    const defaultPlaceholder = selectElement.dataset.placeholder || placeholderText || 'Select Airport';
    
    selectElement.innerHTML = '';
    
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = defaultPlaceholder;
    selectElement.appendChild(defaultOption);
    
    cachedAirportsList.forEach(airport => {
        // Strict mutual exclusion: do not show selected departure in arrival and vice versa
        if (excludeCode && airport.airport_code.toUpperCase() === excludeCode.toUpperCase()) {
            return;
        }
        
        const option = document.createElement('option');
        option.value = airport.airport_code;
        option.textContent = `${airport.city} (${airport.airport_code}) • ${airport.airport_name}`;
        selectElement.appendChild(option);
    });
    
    // Restore selection if it wasn't the excluded code
    if (currentValue && currentValue.toUpperCase() !== excludeCode.toUpperCase()) {
        selectElement.value = currentValue;
    } else {
        selectElement.value = '';
    }
}

function bindAirportPairSync(fromSelect, toSelect, fromPlaceholder = 'Select Origin City', toPlaceholder = 'Select Destination City') {
    if (!fromSelect || !toSelect) return;
    
    fromSelect.dataset.placeholder = fromPlaceholder;
    toSelect.dataset.placeholder = toPlaceholder;
    
    const syncOptions = () => {
        const currentFrom = fromSelect.value;
        const currentTo = toSelect.value;
        
        renderAirportSelectOptions(fromSelect, currentTo, fromPlaceholder);
        renderAirportSelectOptions(toSelect, currentFrom, toPlaceholder);
    };
    
    fromSelect.addEventListener('change', () => {
        const selectedFrom = fromSelect.value;
        renderAirportSelectOptions(toSelect, selectedFrom, toPlaceholder);
    });
    
    toSelect.addEventListener('change', () => {
        const selectedTo = toSelect.value;
        renderAirportSelectOptions(fromSelect, selectedTo, fromPlaceholder);
    });
    
    syncOptions();
}

async function initializeAllAirportDropdowns() {
    await fetchDatabaseAirports();
    if (!cachedAirportsList || cachedAirportsList.length === 0) return;
    
    // 1. Search Flights Page (flight-search.html)
    const searchFrom = document.getElementById('searchFromAirport');
    const searchTo = document.getElementById('searchToAirport');
    if (searchFrom && searchTo) {
        bindAirportPairSync(searchFrom, searchTo, 'Select Origin City', 'Select Destination City');
    }
    
    // 2. Homepage Quick Search (index.html)
    const quickForm = document.querySelector('.quick-search .search-form') || document.querySelector('#quickSearch .search-form');
    if (quickForm) {
        const quickFrom = quickForm.querySelector('select[name="from"]');
        const quickTo = quickForm.querySelector('select[name="to"]');
        if (quickFrom && quickTo) {
            bindAirportPairSync(quickFrom, quickTo, 'Select Origin City', 'Select Destination City');
        }
    }
    
    // 3. Admin Flight Modal (admin-management.html)
    const adminFlightModal = document.getElementById('flightModal');
    if (adminFlightModal) {
        const adminFrom = adminFlightModal.querySelector('select[name="from"]');
        const adminTo = adminFlightModal.querySelector('select[name="to"]');
        if (adminFrom && adminTo) {
            bindAirportPairSync(adminFrom, adminTo, 'Select Departure Airport', 'Select Arrival Airport');
        }
    }
}

// ========== FLIGHT SEARCH ==========

function handleQuickSearch(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const from = formData.get('from') || '';
    const to = formData.get('to') || '';
    const departure = formData.get('departure') || '';
    const passengers = formData.get('passengers') || '1';
    
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (departure) params.set('departure', departure);
    if (passengers) params.set('passengers', passengers);
    
    window.location.href = `flight-search.html?${params.toString()}`;
}

async function initFlightSearchFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const from = urlParams.get('from');
    const to = urlParams.get('to');
    const departure = urlParams.get('departure');
    const passengers = urlParams.get('passengers');
    const flightClass = urlParams.get('class');

    // Ensure database airports are loaded first
    await fetchDatabaseAirports();

    const fromSelect = document.getElementById('searchFromAirport');
    const toSelect = document.getElementById('searchToAirport');

    if (fromSelect && toSelect) {
        // Synchronize options with mutual exclusions
        renderAirportSelectOptions(fromSelect, to || '', 'Select Origin City');
        if (from) fromSelect.value = from;

        renderAirportSelectOptions(toSelect, from || '', 'Select Destination City');
        if (to) toSelect.value = to;
    }

    let shouldSearch = false;
    if (from || to) shouldSearch = true;

    if (departure && document.getElementById('searchDepDate')) {
        document.getElementById('searchDepDate').value = departure;
        shouldSearch = true;
    }
    if (passengers && document.getElementById('searchPassengers')) {
        document.getElementById('searchPassengers').value = passengers;
    }
    if (flightClass && document.getElementById('searchCabinClass')) {
        document.getElementById('searchCabinClass').value = flightClass;
    }

    if (shouldSearch) {
        setTimeout(() => {
            const form = document.getElementById('flightSearchForm');
            if (form) {
                form.dispatchEvent(new Event('submit'));
            }
        }, 150);
    }
}

// Global storage for flight search results
let currentSearchResults = [];
let currentSortCriterion = 'price';

function setTripType(button, type) {
    document.querySelectorAll('.trip-pill').forEach(pill => pill.classList.remove('active'));
    if (button) button.classList.add('active');
    
    const returnGroup = document.getElementById('returnDateFieldGroup');
    const returnInput = document.getElementById('searchReturnDate');
    
    if (type === 'oneway') {
        if (returnGroup) returnGroup.style.display = 'none';
        if (returnInput) returnInput.value = '';
    } else {
        if (returnGroup) returnGroup.style.display = 'block';
    }
}

function swapSearchAirports() {
    const fromSelect = document.getElementById('searchFromAirport');
    const toSelect = document.getElementById('searchToAirport');
    const btn = document.getElementById('btnSwapAirports');
    
    if (fromSelect && toSelect) {
        const oldFrom = fromSelect.value;
        const oldTo = toSelect.value;
        
        // Re-render options with swapped exclusions
        renderAirportSelectOptions(fromSelect, oldFrom, 'Select Origin City');
        fromSelect.value = oldTo;
        
        renderAirportSelectOptions(toSelect, oldTo, 'Select Destination City');
        toSelect.value = oldFrom;
    }
    
    if (btn) {
        btn.style.transform = 'rotate(180deg) scale(1.15)';
        setTimeout(() => {
            btn.style.transform = '';
        }, 300);
    }
}

function setQuickDate(preset) {
    const depInput = document.getElementById('searchDepDate');
    if (!depInput) return;
    
    const now = new Date();
    let target = new Date();
    
    if (preset === 'today') {
        target = new Date();
    } else if (preset === 'tomorrow') {
        target.setDate(now.getDate() + 1);
    } else if (preset === 'weekend') {
        const day = now.getDay();
        const diffToSaturday = (6 - day + 7) % 7 || 7;
        target.setDate(now.getDate() + diffToSaturday);
    } else if (preset === 'plus3') {
        target.setDate(now.getDate() + 3);
    }
    
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');
    depInput.value = `${yyyy}-${mm}-${dd}`;
}

function sortFlightResults(criterion) {
    currentSortCriterion = criterion;
    document.querySelectorAll('.sort-chip').forEach(chip => chip.classList.remove('active'));
    
    const activeChip = Array.from(document.querySelectorAll('.sort-chip')).find(c => {
        const text = c.textContent.toLowerCase();
        if (criterion === 'price') return text.includes('price');
        if (criterion === 'duration') return text.includes('duration');
        if (criterion === 'departure') return text.includes('departure');
        return false;
    });
    if (activeChip) activeChip.classList.add('active');
    
    if (!currentSearchResults || currentSearchResults.length === 0) return;
    
    const searchForm = document.querySelector('.search-form.detailed');
    const flightClass = searchForm ? (searchForm.querySelector('[name="class"]')?.value || 'economy') : 'economy';
    
    const sorted = [...currentSearchResults].sort((a, b) => {
        if (criterion === 'price') {
            const priceA = parseFloat(flightClass === 'business' ? (a.business_price || a.price) : flightClass === 'first' ? (a.first_class_price || a.price) : (a.price || a.base_price || a.total_price || 0));
            const priceB = parseFloat(flightClass === 'business' ? (b.business_price || b.price) : flightClass === 'first' ? (b.first_class_price || b.price) : (b.price || b.base_price || b.total_price || 0));
            return priceA - priceB;
        } else if (criterion === 'duration') {
            const durA = new Date(a.arrival_datetime) - new Date(a.departure_datetime);
            const durB = new Date(b.arrival_datetime) - new Date(b.departure_datetime);
            return durA - durB;
        } else if (criterion === 'departure') {
            return new Date(a.departure_datetime) - new Date(b.departure_datetime);
        }
        return 0;
    });
    
    const flightsList = document.getElementById('flightsList');
    if (flightsList) {
        flightsList.innerHTML = generateFlightResults(sorted);
    }
}

async function handleFlightSearch(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const from = formData.get('from');
    const to = formData.get('to');
    const departure = formData.get('departure');
    const passengers = formData.get('passengers') || 1;
    const flightClass = formData.get('class') || 'economy';
    
    const resultsDiv = document.getElementById('searchResults');
    const flightsList = document.getElementById('flightsList');
    const titleEl = document.getElementById('searchResultsTitle');
    
    if (resultsDiv) {
        resultsDiv.style.display = 'block';
        resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (flightsList) {
        flightsList.innerHTML = `
            <div style="padding: 2.5rem; text-align: center; color: #94a3b8;">
                <div style="font-size: 2.5rem; animation: spin 1s infinite linear; display: inline-block; margin-bottom: 1rem;">✈️</div>
                <h3 style="color: #f8fafc; margin-bottom: 0.5rem;">Scanning SkyWings Route Network...</h3>
                <p style="margin: 0; font-size: 0.9rem;">Fetching live fares, real-time seat inventory, and amenities.</p>
            </div>
        `;
    }
    
    try {
        const params = new URLSearchParams({
            from: from || '',
            to: to || '',
            departure: departure || '',
            passengers: passengers,
            class: flightClass
        });
        
        const response = await apiRequest(`/flights/search?${params}`);
        
        if (response.success && response.data.flights) {
            currentSearchResults = response.data.flights;
            
            if (flightsList) {
                if (currentSearchResults.length === 0) {
                    flightsList.innerHTML = `
                        <div class="checkin-status-card" style="text-align: center; padding: 2.5rem;">
                            <div style="font-size: 3rem; margin-bottom: 1rem;">🔍</div>
                            <h3 style="color: #f8fafc; margin-bottom: 0.5rem;">No Flights Found for this Route/Date</h3>
                            <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.25rem;">We could not find scheduled flights matching your criteria. Try adjusting your departure date or choosing another nearby destination.</p>
                            <button type="button" class="btn btn-secondary" onclick="setQuickDate('weekend'); document.getElementById('flightSearchForm').dispatchEvent(new Event('submit'))">Try This Weekend</button>
                        </div>
                    `;
                } else {
                    if (titleEl) {
                        titleEl.textContent = `${currentSearchResults.length} Available Flight${currentSearchResults.length > 1 ? 's' : ''} Found`;
                    }
                    sortFlightResults(currentSortCriterion);
                    if (resultsDiv) {
                        resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            }
        }
    } catch (error) {
        if (flightsList) {
            flightsList.innerHTML = `
                <div class="checkin-status-card error" style="padding: 2rem;">
                    <h3 style="color: #f87171; margin-bottom: 0.5rem;">⚠️ Flight Search Failed</h3>
                    <p style="color: #cbd5e1; margin: 0;">${error.message || 'Unable to communicate with the flight search engine.'}</p>
                </div>
            `;
        }
    }
}

function changeFlightCardClass(flightId, selectedClass, basePrice, businessPrice, firstPrice, numPassengers) {
    let activePrice = parseFloat(basePrice) || 0;
    if (selectedClass === 'business') {
        activePrice = parseFloat(businessPrice) || (activePrice * 1.5);
    } else if (selectedClass === 'first') {
        activePrice = parseFloat(firstPrice) || (activePrice * 2.0);
    }
    
    const totalPrice = (activePrice * numPassengers).toFixed(2);
    
    const priceTag = document.getElementById(`flight-price-tag-${flightId}`);
    const priceSubtext = document.getElementById(`flight-price-subtext-${flightId}`);
    if (priceTag) priceTag.textContent = `$${activePrice.toFixed(2)}`;
    if (priceSubtext) {
        priceSubtext.textContent = numPassengers > 1 ? `Total: $${totalPrice} (${numPassengers} pax • ${selectedClass.toUpperCase()})` : `per passenger • ${selectedClass.toUpperCase()}`;
    }
    
    const card = document.getElementById(`flight-card-${flightId}`);
    if (card) {
        card.querySelectorAll('.cabin-pill').forEach(btn => {
            if (btn.dataset.class === selectedClass) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });
        
        const bookBtn = card.querySelector('.btn-book-flight');
        if (bookBtn) {
            bookBtn.setAttribute('onclick', `bookFlight(${flightId}, ${activePrice}, '${selectedClass}', ${numPassengers})`);
        }
    }
}

function generateFlightResults(flights) {
    const searchForm = document.querySelector('.search-form.detailed');
    const flightClass = searchForm ? (searchForm.querySelector('[name="class"]')?.value || 'economy') : 'economy';
    const numPassengers = searchForm ? (parseInt(searchForm.querySelector('[name="passengers"]')?.value) || 1) : 1;
    
    return flights.map(flight => {
        const departure = new Date(flight.departure_datetime);
        const arrival = new Date(flight.arrival_datetime);
        const duration = Math.max(0, Math.round((arrival - departure) / (1000 * 60)));
        const hours = Math.floor(duration / 60);
        const minutes = duration % 60;
        
        const basePrice = parseFloat(flight.base_price || flight.price || 0);
        const businessPrice = parseFloat(flight.business_price || (basePrice * 1.5));
        const firstPrice = parseFloat(flight.first_class_price || (basePrice * 2.0));
        
        let price = basePrice;
        if (flightClass === 'business') {
            price = businessPrice;
        } else if (flightClass === 'first') {
            price = firstPrice;
        }
        
        const numPrice = parseFloat(price);
        const totalPrice = (numPrice * numPassengers).toFixed(2);
        
        const aircraft = flight.aircraft_model || 'Commercial Aircraft';
        const fromCode = flight.from_code || flight.from_city?.substring(0, 3)?.toUpperCase() || 'ORG';
        const toCode = flight.to_code || flight.to_city?.substring(0, 3)?.toUpperCase() || 'DST';
        const seatsLeft = (flight.available_seats !== undefined && flight.available_seats !== null) 
            ? flight.available_seats 
            : (flight.capacity || 0);
        
        // Dynamic Amenities determined from aircraft specs setup by admin
        let amenities = [
            '<span>📶 In-Flight Wi-Fi</span>',
            '<span>⚡ USB Charging</span>',
            '<span>🥤 Refreshments</span>',
            '<span>🧳 Baggage Included</span>'
        ];
        
        const modelLower = aircraft.toLowerCase();
        if (modelLower.includes('787') || modelLower.includes('777') || modelLower.includes('a350') || modelLower.includes('a380')) {
            amenities = [
                '<span>📶 High-Speed Wi-Fi</span>',
                '<span>⚡ 110V In-Seat AC Power</span>',
                '<span>🍽️ Gourmet Hot Meals</span>',
                '<span>🧳 2x 23kg Checked Bags</span>'
            ];
        } else if (modelLower.includes('737') || modelLower.includes('a320') || modelLower.includes('a321')) {
            amenities = [
                '<span>📶 Wi-Fi Available</span>',
                '<span>⚡ USB-A/C Power</span>',
                '<span>🥤 Complimentary Snacks</span>',
                '<span>🧳 1x 23kg Bag</span>'
            ];
        }
        
        return `
            <div class="flight-card modern-result-card" id="flight-card-${flight.flight_id}">
                <!-- Top Row: Flight ID, Aircraft & Real-Time Seat Status -->
                <div class="flight-card-top">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 4px 10px; border-radius: 8px; font-weight: 800; font-size: 0.85rem;">
                            ✈️ Flight ${flight.flight_number}
                        </span>
                        <span style="color: #94a3b8; font-size: 0.85rem; font-weight: 600;">
                            ${aircraft}
                        </span>
                    </div>
                    <div>
                        ${seatsLeft <= 5 && seatsLeft > 0 ? `
                            <span style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">
                                🔥 Only ${seatsLeft} seat${seatsLeft > 1 ? 's' : ''} left!
                            </span>
                        ` : seatsLeft === 0 ? `
                            <span style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">
                                ❌ Sold Out
                            </span>
                        ` : `
                            <span style="color: #34d399; font-size: 0.8rem; font-weight: 700;">
                                ✅ ${seatsLeft} seats available
                            </span>
                        `}
                    </div>
                </div>

                <!-- Middle Row: Route Timeline & Pricing Action -->
                <div class="flight-card-middle">
                    <!-- Route Timeline -->
                    <div class="flight-timeline">
                        <div class="flight-endpoint">
                            <div class="time">${departure.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                            <div class="city"><strong>${fromCode}</strong> • ${flight.from_city}</div>
                        </div>
                        
                        <div class="flight-path-visual">
                            <span class="flight-path-duration">${hours}h ${minutes}m</span>
                            <div class="flight-path-line"></div>
                            <span class="flight-path-stops">Non-Stop</span>
                        </div>
                        
                        <div class="flight-endpoint dest">
                            <div class="time">${arrival.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                            <div class="city"><strong>${toCode}</strong> • ${flight.to_city}</div>
                        </div>
                    </div>

                    <!-- Pricing & Book Action -->
                    <div class="flight-pricing-action">
                        <div class="flight-price-box">
                            <div class="price-tag" id="flight-price-tag-${flight.flight_id}">$${numPrice.toFixed(2)}</div>
                            <div class="price-subtext" id="flight-price-subtext-${flight.flight_id}">${numPassengers > 1 ? `Total: $${totalPrice} (${numPassengers} pax • ${flightClass.toUpperCase()})` : `per passenger • ${flightClass.toUpperCase()}`}</div>
                        </div>
                        <button type="button" class="btn-book-flight" ${seatsLeft === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} onclick="bookFlight(${flight.flight_id}, ${numPrice}, '${flightClass}', ${numPassengers})">
                            ${seatsLeft === 0 ? 'Sold Out' : 'Book Flight →'}
                        </button>
                    </div>
                </div>

                <!-- Bottom Row: Dynamic Amenities & Interactive Cabin Class Switcher -->
                <div class="flight-card-bottom">
                    <div class="flight-amenities-list">
                        ${amenities.join('')}
                    </div>
                    <div class="flight-cabin-pills">
                        <button type="button" class="cabin-pill ${flightClass === 'economy' ? 'selected' : ''}" data-class="economy" onclick="changeFlightCardClass(${flight.flight_id}, 'economy', ${basePrice}, ${businessPrice}, ${firstPrice}, ${numPassengers})">
                            Economy ($${basePrice.toFixed(2)})
                        </button>
                        <button type="button" class="cabin-pill ${flightClass === 'business' ? 'selected' : ''}" data-class="business" onclick="changeFlightCardClass(${flight.flight_id}, 'business', ${basePrice}, ${businessPrice}, ${firstPrice}, ${numPassengers})">
                            Business ($${businessPrice.toFixed(2)})
                        </button>
                        <button type="button" class="cabin-pill ${flightClass === 'first' ? 'selected' : ''}" data-class="first" onclick="changeFlightCardClass(${flight.flight_id}, 'first', ${basePrice}, ${businessPrice}, ${firstPrice}, ${numPassengers})">
                            First Class ($${firstPrice.toFixed(2)})
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Global variables for booking
let currentBookingFlight = null;
let currentBookingClass = 'economy';
let currentBookingPassengers = 1;

function bookFlight(flightId, price, flightClass = 'economy', numPassengers = 1) {
    if (!checkAuthentication('user')) {
        try { sessionStorage.setItem('pendingFlightBooking', String(flightId)); } catch (e) {}
        try { sessionStorage.setItem('redirectAfterLogin', 'flight-search.html'); } catch (e) {}
        alert('Please login to book a flight');
        window.location.href = 'login.html';
        return;
    }
    
    // Get flight details
    apiRequest(`/flights/${flightId}`).then(response => {
        if (response.success && response.data.flight) {
            currentBookingFlight = response.data.flight;
            currentBookingClass = flightClass;
            currentBookingPassengers = numPassengers;
            showBookingModal(flightId, price, flightClass, numPassengers);
        } else {
            alert('Failed to load flight details. Please try again.');
        }
    }).catch(error => {
        console.error('Error loading flight:', error);
        alert('Failed to load flight details. Please try again.');
    });
}

function showBookingModal(flightId, price, flightClass, numPassengers) {
    const modal = document.getElementById('bookingModal');
    const modalTitle = document.getElementById('bookingModalTitle');
    const passengerForms = document.getElementById('passengerForms');
    const bookingForm = document.getElementById('bookingForm');
    
    if (!modal) {
        alert('Booking form not available. Please refresh the page.');
        return;
    }
    
    // Set hidden fields
    document.getElementById('bookingFlightId').value = flightId;
    document.getElementById('bookingFlightClass').value = flightClass;
    document.getElementById('bookingNumPassengers').value = numPassengers;
    
    // Set modal title with flight info
    if (currentBookingFlight) {
        modalTitle.textContent = `Book Flight ${currentBookingFlight.flight_number || flightId}`;
    }
    
    // Generate passenger forms
    passengerForms.innerHTML = '';
    for (let i = 1; i <= numPassengers; i++) {
        const passengerDiv = document.createElement('div');
        passengerDiv.className = 'passenger-form-section';
        passengerDiv.style.cssText = 'margin-bottom: 2rem; padding: 1.5rem; background: rgba(255,255,255,0.05); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);';
        passengerDiv.innerHTML = `
            <h3 style="margin-bottom: 1rem; color: rgba(255,255,255,0.9);">Passenger ${i}</h3>
            <div class="form-row">
                <div class="form-group">
                    <label>First Name *</label>
                    <input type="text" name="passenger_${i}_firstName" required placeholder="First name">
                </div>
                <div class="form-group">
                    <label>Last Name *</label>
                    <input type="text" name="passenger_${i}_lastName" required placeholder="Last name">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Date of Birth</label>
                    <input type="date" name="passenger_${i}_dob" max="${new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}" min="1900-01-01" maxlength="10" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}">
                </div>
                <div class="form-group">
                    <label>Passport Number</label>
                    <input type="text" name="passenger_${i}_passport" placeholder="Optional">
                </div>
            </div>
            <div class="form-group">
                <label>Nationality</label>
                <input type="text" name="passenger_${i}_nationality" placeholder="Optional">
            </div>
        `;
        passengerForms.appendChild(passengerDiv);
    }
    
    // Show flight summary
    const summaryDiv = document.createElement('div');
    summaryDiv.style.cssText = 'margin-bottom: 1.5rem; padding: 1rem; background: rgba(45, 212, 191, 0.1); border-radius: 8px; border: 1px solid rgba(45, 212, 191, 0.3);';
    if (currentBookingFlight) {
        const dep = new Date(currentBookingFlight.departure_datetime);
        const arr = new Date(currentBookingFlight.arrival_datetime);
        summaryDiv.innerHTML = `
            <h4 style="margin-bottom: 0.5rem; color: var(--accent);">Flight Summary</h4>
            <p><strong>Route:</strong> ${currentBookingFlight.from_city || 'N/A'} → ${currentBookingFlight.to_city || 'N/A'}</p>
            <p><strong>Departure:</strong> ${dep.toLocaleString()}</p>
            <p><strong>Arrival:</strong> ${arr.toLocaleString()}</p>
            <p><strong>Class:</strong> ${flightClass.charAt(0).toUpperCase() + flightClass.slice(1)}</p>
            <p><strong>Passengers:</strong> ${numPassengers}</p>
            <p><strong>Total Price:</strong> $${(parseFloat(price) * numPassengers).toFixed(2)}</p>
        `;
    }
    passengerForms.insertBefore(summaryDiv, passengerForms.firstChild);
    
    // Clear any old/duplicate action containers before creating single unified action buttons
    modal.querySelectorAll('.booking-modal-actions, .modal-actions').forEach(el => el.remove());
    
    const actionButtons = document.createElement('div');
    actionButtons.className = 'booking-modal-actions';
    actionButtons.innerHTML = `
        <button type="button" class="btn btn-secondary btn-modal-action" onclick="closeBookingModal()">Cancel</button>
        <button type="button" class="btn btn-warning btn-modal-action" onclick="submitPendingBooking(event)">⏱️ Reserve & Hold (Pay Later)</button>
        <button type="submit" class="btn btn-primary btn-modal-action">💳 Pay & Confirm Now</button>
    `;
    const form = document.getElementById('bookingForm');
    if (form) form.appendChild(actionButtons);

    modal.style.display = 'flex';
}

function closeBookingModal() {
    const modal = document.getElementById('bookingModal');
    if (modal) {
        modal.style.display = 'none';
        const form = document.getElementById('bookingForm');
        if (form) form.reset();
        currentBookingFlight = null;
    }
}

async function submitPendingBooking(event) {
    const form = document.getElementById('bookingForm');
    if (!form) return;
    
    const hiddenField = document.createElement('input');
    hiddenField.type = 'hidden';
    hiddenField.name = 'is_pending';
    hiddenField.value = 'true';
    form.appendChild(hiddenField);
    
    form.requestSubmit();
}

async function handleBookingSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    
    const flightId = parseInt(formData.get('flightId'));
    const flightClass = formData.get('class') || 'economy';
    const numPassengers = parseInt(formData.get('numPassengers')) || 1;
    
    // Collect passenger data
    const passengers = [];
    for (let i = 1; i <= numPassengers; i++) {
        const firstName = formData.get(`passenger_${i}_firstName`);
        const lastName = formData.get(`passenger_${i}_lastName`);
        
        if (!firstName || !lastName) {
            alert(`Please fill in all required fields for Passenger ${i}`);
            return;
        }
        
        passengers.push({
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            date_of_birth: formData.get(`passenger_${i}_dob`) || null,
            passport_number: formData.get(`passenger_${i}_passport`)?.trim() || null,
            nationality: formData.get(`passenger_${i}_nationality`)?.trim() || null
        });
    }
    
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';
    
    try {
        const response = await apiRequest('/bookings/create', {
            method: 'POST',
            body: JSON.stringify({
                flight_id: flightId,
                passengers: passengers,
                class: flightClass,
                is_pending: true
            })
        });
        
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;

        if (response.success && response.data) {
            const booking = response.data.booking || response.data;
            closeBookingModal();
            openMockPaymentModal(booking);
        } else {
            throw new Error(response.message || 'Failed to initialize booking');
        }
    } catch (error) {
        console.error('Booking error:', error);
        alert('Failed to create booking: ' + error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// ========== DASHBOARD ==========

async function loadDashboardData() {
    const userRole = authState.userRole;
    
    try {
        if (userRole === 'admin') {
            // Load admin stats
            const response = await apiRequest('/admin/stats');
            if (response.success && response.data) {
                const stats = response.data;
                updateElement('totalUsers', stats.totalUsers);
                updateElement('totalFlights', stats.totalFlights);
                updateElement('totalBookings', stats.totalBookings);
                updateElement('totalRevenue', `$${stats.totalRevenue.toLocaleString()}`);
            }
        } else {
            // Load user bookings stats
            const response = await apiRequest('/bookings/list');
            if (response.success && response.data) {
                const bookings = response.data.bookings || [];
                const confirmed = bookings.filter(b => b.status === 'confirmed').length;
                const completed = bookings.filter(b => b.status === 'completed').length;
                const totalSpent = bookings
                    .filter(b => b.status === 'confirmed' || b.status === 'completed')
                    .reduce((sum, b) => sum + parseFloat(b.total_amount || 0), 0);
                
                updateElement('totalBookings', bookings.length);
                updateElement('upcomingFlights', confirmed);
                updateElement('completedTrips', completed);
                updateElement('totalSpent', `$${totalSpent.toLocaleString()}`);
            }
        }
    } catch (error) {
        console.error('Error loading dashboard data:', error);
    }
}

function updateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
        const span = element.querySelector('span');
        if (span) {
            span.textContent = value;
        } else {
            element.textContent = value;
        }
    }
}

async function loadUserDashboardData() {
    try {
        const bookingsResponse = await apiRequest('/bookings/list');
        if (bookingsResponse.success && bookingsResponse.data && bookingsResponse.data.bookings) {
            const allBookings = bookingsResponse.data.bookings || [];
            const now = new Date();
            
            // Calculate User Dashboard Stats Dynamically
            let totalBookingsCount = allBookings.length;
            let upcomingCount = 0;
            let completedCount = 0;
            let totalSpentSum = 0;

            allBookings.forEach(b => {
                const dep = new Date(b.departure_datetime || b.booking_date);
                const isFuture = !isNaN(dep) && dep >= now;
                const status = (b.status || 'pending').toLowerCase();
                const payment = (b.payment_status || 'pending').toLowerCase();

                if (isFuture && status !== 'cancelled' && status !== 'expired') {
                    upcomingCount++;
                }
                if (status === 'boarded' || status === 'completed') {
                    completedCount++;
                }
                if (payment === 'paid' && status !== 'cancelled') {
                    totalSpentSum += parseFloat(b.total_amount || 0);
                }
            });

            // Update stats elements if present
            const elTotalBookings = document.getElementById('totalBookings');
            const elUpcomingFlights = document.getElementById('upcomingFlights');
            const elCompletedTrips = document.getElementById('completedTrips');
            const elTotalSpent = document.getElementById('totalSpent');

            if (elTotalBookings) elTotalBookings.textContent = totalBookingsCount;
            if (elUpcomingFlights) elUpcomingFlights.textContent = upcomingCount;
            if (elCompletedTrips) elCompletedTrips.textContent = completedCount;
            if (elTotalSpent) elTotalSpent.textContent = totalSpentSum.toFixed(2);
            
            // Sort by departure date (upcoming first)
            const sortedBookings = [...allBookings].sort((a, b) => {
                const dateA = new Date(a.departure_datetime || a.booking_date);
                const dateB = new Date(b.departure_datetime || b.booking_date);
                return dateA - dateB;
            });
            
            // Filter upcoming flights (future departure and active status)
            const upcomingFlights = sortedBookings
                .filter(b => {
                    const depDate = new Date(b.departure_datetime || b.booking_date);
                    const status = (b.status || '').toLowerCase();
                    return depDate >= now && status !== 'cancelled' && status !== 'expired';
                })
                .slice(0, 3);
            
            const upcomingList = document.getElementById('upcomingFlightsList');
            if (upcomingList) {
                if (upcomingFlights.length === 0) {
                    upcomingList.innerHTML = '<div class="empty-state"><p>No upcoming flights. <a href="flight-search.html">Book a flight now!</a></p></div>';
                } else {
                    upcomingList.innerHTML = upcomingFlights.map(booking => {
                        const dep = new Date(booking.departure_datetime || booking.booking_date);
                        const status = (booking.status || 'pending').toLowerCase();
                        let badgeLabel = status.toUpperCase();
                        if (status === 'checked_in') badgeLabel = '✅ CHECKED IN';
                        else if (status === 'pending') badgeLabel = '⏳ PENDING';
                        else if (status === 'confirmed') badgeLabel = 'CONFIRMED';

                        return `
                            <div class="flight-card" style="display: flex; justify-content: space-between; align-items: center; padding: 16px; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; margin-bottom: 12px;">
                                <div class="flight-info">
                                    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
                                        <h3 style="margin: 0; color: #38bdf8; font-size: 1.1rem;">${booking.flight_number || 'N/A'}</h3>
                                        <span class="status-badge status-${status}" style="font-size: 0.75rem; padding: 2px 8px;">${badgeLabel}</span>
                                    </div>
                                    <p style="margin: 0 0 4px 0; font-weight: 600; color: #f8fafc;">${booking.from_city || booking.from_name || 'N/A'} (${booking.from_code || ''}) → ${booking.to_city || booking.to_name || 'N/A'} (${booking.to_code || ''})</p>
                                    <p style="margin: 0; color: #94a3b8; font-size: 0.85rem;">📅 ${dep.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} at ${dep.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                                </div>
                                <div class="flight-actions" style="display: flex; gap: 8px; align-items: center;">
                                    ${status === 'pending' ? `<button class="btn btn-sm btn-success" style="background: #10b981; color: white; border: none;" onclick="triggerPayPendingBooking(${booking.booking_id})">💳 Pay</button>` : ''}
                                    ${status === 'confirmed' ? `<button class="btn btn-sm btn-secondary" onclick="checkIn(${booking.booking_id})">Check-in</button>` : ''}
                                    <button class="btn btn-sm btn-primary" onclick="viewBookingDetails(${booking.booking_id})">View Details</button>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }
            
            // Load recent bookings (sorted by booking date, most recent first)
            const recentBookings = [...allBookings]
                .sort((a, b) => {
                    const dateA = new Date(a.booking_date);
                    const dateB = new Date(b.booking_date);
                    return dateB - dateA;
                })
                .slice(0, 5);
            
            const recentTable = document.getElementById('recentBookingsTable');
            if (recentTable) {
                if (recentBookings.length === 0) {
                    recentTable.innerHTML = '<tr><td colspan="5" class="empty-state">No recent bookings</td></tr>';
                } else {
                    recentTable.innerHTML = recentBookings.map(booking => {
                        const date = new Date(booking.booking_date);
                        const dep = new Date(booking.departure_datetime || booking.booking_date);
                        const flightHasPassed = dep < now;
                        
                        let displayStatus = String(booking.status || 'pending').toLowerCase();
                        if (flightHasPassed && (displayStatus === 'confirmed' || displayStatus === 'completed' || displayStatus === 'checked_in')) {
                            const hasSeats = booking.passengers && booking.passengers.some(p => p.seat_number && p.seat_number.trim() !== '');
                            displayStatus = hasSeats ? 'boarded' : 'missed';
                        }
                        
                        const displayStatusText = String(displayStatus).toLowerCase();
                        let badgeLabel = displayStatusText.toUpperCase();
                        if (displayStatusText === 'boarded') badgeLabel = '✈️ BOARDED';
                        else if (displayStatusText === 'missed') badgeLabel = '⚠️ MISSED';
                        else if (displayStatusText === 'checked_in') badgeLabel = '✅ CHECKED IN';
                        else if (displayStatusText === 'pending') badgeLabel = '⏳ PENDING';
                        else if (displayStatusText === 'cancelled') badgeLabel = '🚫 CANCELLED';
                        
                        return `
                            <tr>
                                <td><strong style="color: #f8fafc;">${booking.booking_reference || 'N/A'}</strong></td>
                                <td><strong style="color: #38bdf8;">${booking.flight_number || 'N/A'}</strong></td>
                                <td>${date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                                <td><span class="status-badge status-${displayStatusText}" style="display: inline-flex !important; align-items: center !important; justify-content: center !important; visibility: visible !important; opacity: 1 !important; min-width: 90px; text-align: center !important; line-height: 1 !important; margin: 0 auto !important;">${badgeLabel}</span></td>
                                <td>
                                    <div style="display: flex; gap: 6px; align-items: center;">
                                        <button class="btn btn-sm btn-secondary" onclick="viewBookingDetails(${booking.booking_id})">View</button>
                                        ${displayStatusText === 'pending' && !flightHasPassed ? `<button class="btn btn-sm btn-success" style="background: #10b981; color: white; border: none; font-size: 0.75rem; padding: 3px 8px; border-radius: 6px; cursor: pointer;" onclick="triggerPayPendingBooking(${booking.booking_id})">💳 Pay</button>` : ''}
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('');
                }
            }
        }
    } catch (error) {
        console.error('Error loading user dashboard data:', error);
        const upcomingList = document.getElementById('upcomingFlightsList');
        const recentTable = document.getElementById('recentBookingsTable');
        if (upcomingList) {
            upcomingList.innerHTML = '<div class="empty-state"><p>Failed to load upcoming flights</p></div>';
        }
        if (recentTable) {
            recentTable.innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load recent bookings</td></tr>';
        }
    }
}

// Chart instances
let revenueChart = null;
let bookingChart = null;

async function loadAdminDashboard() {
    try {
        await Promise.all([
            loadAdminStats(),
            loadDashboardRecentBookings(),
            loadReportCharts()
        ]);
    } catch (error) {
        console.error('Error loading admin dashboard:', error);
    }
}

async function loadAdminStats() {
    try {
        const response = await apiRequest('/admin/stats');
        if (response.success && response.data) {
            const stats = response.data;
            const revEl = document.getElementById('totalRevenue');
            if (revEl) revEl.textContent = `$${parseFloat(stats.totalRevenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            
            const bookEl = document.getElementById('totalBookings');
            if (bookEl) bookEl.textContent = stats.totalBookings || 0;

            const confEl = document.getElementById('confirmedBookingsCount');
            if (confEl) confEl.textContent = stats.confirmedBookings || 0;

            const pendEl = document.getElementById('pendingBookingsCount');
            if (pendEl) pendEl.textContent = stats.pendingBookings || 0;

            const fliEl = document.getElementById('totalFlights');
            if (fliEl) fliEl.textContent = stats.upcomingFlights !== undefined ? stats.upcomingFlights : (stats.activeFlights || 0);

            const actFliEl = document.getElementById('activeFlightsCount');
            if (actFliEl) actFliEl.textContent = stats.activeFlights || 0;

            const usrEl = document.getElementById('totalUsers');
            if (usrEl) usrEl.textContent = stats.totalUsers || 0;
        }
    } catch (error) {
        console.error('Error loading admin stats:', error);
    }
}

async function loadDashboardRecentBookings() {
    const tbody = document.querySelector('#dashboardRecentBookingsTable tbody');
    if (!tbody) return;

    try {
        const response = await apiRequest('/admin/bookings');
        if (response.success && response.data && response.data.bookings) {
            const bookings = response.data.bookings.slice(0, 8);
            if (bookings.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 20px;">No recent bookings found.</td></tr>';
                return;
            }

            const fragment = document.createDocumentFragment();
            const flightMap = new Map();
            bookings.forEach(b => {
                const key = `${b.flight_number || 'FLIGHT'}_${b.departure_datetime || ''}`;
                if (!flightMap.has(key)) {
                    flightMap.set(key, {
                        flight_number: b.flight_number || 'N/A',
                        from_code: b.from_code || '',
                        to_code: b.to_code || '',
                        departure_datetime: b.departure_datetime || b.booking_date,
                        bookings: []
                    });
                }
                flightMap.get(key).bookings.push(b);
            });

            flightMap.forEach(group => {
                const depDate = group.departure_datetime ? new Date(group.departure_datetime) : null;
                const formattedDep = depDate && !isNaN(depDate) ? depDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
                const routeText = group.from_code && group.to_code ? `${group.from_code} → ${group.to_code}` : 'Route';

                const headerTr = document.createElement('tr');
                headerTr.innerHTML = `
                    <td colspan="7" style="padding: 7px 14px; background: linear-gradient(90deg, rgba(2, 132, 199, 0.22), rgba(15, 23, 42, 0.85)); border-top: 1px solid rgba(56, 189, 248, 0.35);">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.84rem; flex-wrap: wrap; gap: 6px;">
                            <span style="font-weight: 800; color: #38bdf8;">✈️ Flight ${group.flight_number} <span style="color: #f8fafc; font-weight: 600;">(${routeText})</span></span>
                            <span style="color: #94a3b8;">📅 ${formattedDep} &bull; <strong style="color: #e2e8f0;">${group.bookings.length} Booking(s)</strong></span>
                        </div>
                    </td>
                `;
                fragment.appendChild(headerTr);

                group.bookings.forEach(b => {
                    const depBDate = b.departure_datetime ? new Date(b.departure_datetime) : new Date(b.booking_date);
                    const formattedBDep = !isNaN(depBDate) ? depBDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
                    let status = (b.status || 'pending').toLowerCase();
                    if (status === 'completed' || status === 'boarded' || status === 'checked_in') {
                        status = 'confirmed';
                    }

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong style="color: #f8fafc;">${b.booking_reference || 'N/A'}</strong></td>
                        <td><span style="color: #f1f5f9; font-weight: 600;">${b.user_first_name || ''} ${b.user_last_name || ''}</span></td>
                        <td><strong style="color: #38bdf8;">${b.flight_number || 'N/A'}</strong><br><small style="color: #cbd5e1;">${b.from_code || ''} → ${b.to_code || ''}</small></td>
                        <td><span style="color: #e2e8f0; font-size: 0.85rem;">${formattedBDep}</span></td>
                        <td><strong style="color: #34d399;">$${parseFloat(b.total_amount || 0).toFixed(2)}</strong></td>
                        <td><span class="status-badge status-${status}">${status.toUpperCase()}</span></td>
                        <td><button class="btn btn-sm btn-secondary" onclick="viewBookingDetails(${b.booking_id})">View</button></td>
                    `;
                    fragment.appendChild(tr);
                });
            });
            tbody.innerHTML = '';
            tbody.appendChild(fragment);
        }
    } catch (error) {
        console.error('Error loading dashboard recent bookings:', error);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #f87171; padding: 20px;">⚠️ Error loading recent bookings: ${error.message}</td></tr>`;
    }
}

async function loadReportCharts() {
    try {
        const [revenueResponse, bookingsResponse] = await Promise.all([
            apiRequest('/reports/revenue'),
            apiRequest('/reports/bookings')
        ]);

        if (revenueResponse.success && revenueResponse.data.revenueTrend) {
            renderRevenueChart(revenueResponse.data.revenueTrend);
        }

        if (bookingsResponse.success && bookingsResponse.data.bookingTrend) {
            renderBookingChart(bookingsResponse.data.bookingTrend);
        }
    } catch (error) {
        console.error('Error loading report charts:', error);
    }
}

function renderRevenueChart(revenueTrend) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;

    // Destroy existing chart if it exists
    if (revenueChart) {
        revenueChart.destroy();
    }

    const labels = revenueTrend.map(item => {
        const date = new Date(item.month + '-01');
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });
    const data = revenueTrend.map(item => parseFloat(item.revenue || 0));

    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Revenue ($)',
                data: data,
                borderColor: 'rgb(45, 212, 191)',
                backgroundColor: 'rgba(45, 212, 191, 0.1)',
                tension: 0.4,
                fill: true,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'rgba(255, 255, 255, 0.9)'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}

function renderBookingChart(bookingTrend) {
    const ctx = document.getElementById('bookingChart');
    if (!ctx) return;

    // Destroy existing chart if it exists
    if (bookingChart) {
        bookingChart.destroy();
    }

    const labels = bookingTrend.map(item => {
        const date = new Date(item.month + '-01');
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });
    const data = bookingTrend.map(item => parseInt(item.count || 0));

    bookingChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Bookings',
                data: data,
                backgroundColor: 'rgba(11, 99, 197, 0.8)',
                borderColor: 'rgb(11, 99, 197)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'rgba(255, 255, 255, 0.9)'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                }
            }
        }
    });
}


// ========== BOOKINGS ==========

// Function to synchronize booking statuses based on flight dates
async function synchronizeBookingStatuses(bookings) {
    const now = new Date();
    const updatesNeeded = [];
    
    for (const booking of bookings) {
        if (!booking.departure_datetime || !booking.arrival_datetime) continue;
        
        const dep = new Date(booking.departure_datetime);
        const arr = new Date(booking.arrival_datetime);
        
        // Only process active/confirmed bookings
        if (booking.status !== 'confirmed' && booking.status !== 'checked_in') continue;
        
        // Check if flight has arrived/departed
        if (arr < now || dep < now) {
            // Check if passenger has seat assigned (indicating check-in / boarding)
            const hasSeats = booking.passengers && Array.isArray(booking.passengers) && booking.passengers.some(p => p.seat_number && p.seat_number.trim() !== '');
            const newStatus = hasSeats ? 'boarded' : 'missed';
            
            if (newStatus !== (booking.status || '').toLowerCase()) {
                updatesNeeded.push({ bookingId: booking.booking_id, newStatus });
            }
        }
    }
    
    // Update statuses if needed (in background, don't block UI)
    if (updatesNeeded.length > 0) {
        await Promise.all(updatesNeeded.map(async ({ bookingId, newStatus }) => {
            try {
                await apiRequest(`/bookings/${bookingId}/update-status`, {
                    method: 'POST',
                    body: JSON.stringify({ status: newStatus })
                });
            } catch (error) {
                console.warn('Failed to update booking status:', error);
            }
        }));
    }
}

async function filterBookings(arg1, arg2) {
    let evt = null;
    let status = 'all';
    let context = 'auto';

    if (arg1 && typeof arg1.preventDefault === 'function') {
        evt = arg1;
        status = arg2 || 'all';
        context = 'user';
    } else {
        status = arg1 || 'all';
        context = arg2 || 'auto';
    }

    if (evt) {
        evt.preventDefault();
    }

    const bookingsList = document.getElementById('bookingsList');
    if ((context === 'user' || context === 'auto') && bookingsList) {
        // Show loading state
        bookingsList.innerHTML = '<div class="empty-state"><p>Loading bookings...</p></div>';
        
        // Update tab buttons immediately for better UX
        const tabsContainer = evt && evt.currentTarget
            ? evt.currentTarget.closest('.filter-tabs')
            : bookingsList.previousElementSibling && bookingsList.previousElementSibling.classList.contains('filter-tabs')
                ? bookingsList.previousElementSibling
                : document.querySelector('.filter-tabs');

        if (tabsContainer) {
            tabsContainer.querySelectorAll('.tab-btn[data-filter]').forEach(btn => {
                const shouldActivate = evt
                    ? btn === evt.currentTarget
                    : btn.dataset.filter === status;
                btn.classList.toggle('active', shouldActivate);
            });
        }

        // Load user bookings
        try {
            const response = await apiRequest('/bookings/list');
            
            if (response.success && response.data && response.data.bookings) {
                let allUserBookings = response.data.bookings || [];
                const now = new Date();

                // Normalize in-memory statuses for expired holds or departed flights
                allUserBookings.forEach(b => {
                    const depDate = new Date(b.departure_datetime || b.booking_date);
                    const isPast = !isNaN(depDate) && depDate < now;
                    let bStat = (b.status || 'pending').toLowerCase();
                    if (isPast) {
                        if (bStat === 'confirmed' || bStat === 'completed' || bStat === 'checked_in') {
                            const hasSeats = b.passengers && b.passengers.some(p => p.seat_number && p.seat_number.trim() !== '');
                            b.status = hasSeats ? 'boarded' : 'missed';
                        } else if (bStat === 'pending') {
                            b.status = 'expired';
                        }
                    }
                });

                // Filter by selected tab
                let filteredBookings = allUserBookings;
                if (status === 'upcoming') {
                    filteredBookings = allUserBookings.filter(b => {
                        const depDate = new Date(b.departure_datetime || b.booking_date);
                        const bStat = (b.status || '').toLowerCase();
                        return depDate >= now && bStat !== 'cancelled' && bStat !== 'expired';
                    });
                } else if (status === 'boarded' || status === 'completed') {
                    filteredBookings = allUserBookings.filter(b => (b.status || '').toLowerCase() === 'boarded' || (b.status || '').toLowerCase() === 'completed');
                } else if (status === 'missed') {
                    filteredBookings = allUserBookings.filter(b => (b.status || '').toLowerCase() === 'missed');
                } else if (status === 'pending') {
                    filteredBookings = allUserBookings.filter(b => (b.status || '').toLowerCase() === 'pending');
                } else if (status === 'cancelled') {
                    filteredBookings = allUserBookings.filter(b => (b.status || '').toLowerCase() === 'cancelled' || (b.status || '').toLowerCase() === 'expired');
                }
                
                // Sort by booking date (most recent first)
                filteredBookings.sort((a, b) => {
                    const dateA = new Date(a.booking_date);
                    const dateB = new Date(b.booking_date);
                    return dateB - dateA;
                });
                
                if (filteredBookings.length === 0) {
                    bookingsList.innerHTML = '<div class="empty-state"><p>No bookings found for this category.</p><p><a href="flight-search.html">Find and book your next flight</a></p></div>';
                } else {
                    const fragment = document.createDocumentFragment();
                    
                    filteredBookings.forEach(booking => {
                        const dep = new Date(booking.departure_datetime || booking.booking_date);
                        const arr = new Date(booking.arrival_datetime || booking.departure_datetime || booking.booking_date);
                        const bookingDate = new Date(booking.booking_date);
                        const flightHasPassed = dep < now;
                        
                        const displayStatus = String(booking.status || 'pending').toLowerCase();
                        
                        let badgeLabel = displayStatus.toUpperCase();
                        let statusNote = '';
                        if (displayStatus === 'boarded') {
                            badgeLabel = '✈️ BOARDED';
                            statusNote = '<p style="margin-top: 0.35rem; color: #22d3ee; font-size: 0.85rem; font-weight: 600;">✈️ Flight Completed • Passenger Boarded</p>';
                        } else if (displayStatus === 'missed') {
                            badgeLabel = '⚠️ MISSED';
                            statusNote = '<p style="margin-top: 0.35rem; color: #fbbf24; font-size: 0.85rem; font-weight: 600;">⚠️ Flight Departed • Check-in Missed</p>';
                        } else if (displayStatus === 'checked_in') {
                            badgeLabel = '✅ CHECKED IN';
                            statusNote = '<p style="margin-top: 0.35rem; color: #2dd4bf; font-size: 0.85rem; font-weight: 600;">✅ Checked In • Ready for Boarding</p>';
                        } else if (displayStatus === 'confirmed') {
                            badgeLabel = 'CONFIRMED';
                            statusNote = '<p style="margin-top: 0.35rem; color: #34d399; font-size: 0.85rem; font-weight: 600;">✅ Confirmed & Scheduled</p>';
                        } else if (displayStatus === 'pending') {
                            badgeLabel = '⏳ PENDING';
                            statusNote = '<p style="margin-top: 0.35rem; color: #fbbf24; font-size: 0.85rem; font-weight: 600;">⏳ Seat Reserved • Awaiting Payment</p>';
                        } else if (displayStatus === 'cancelled') {
                            badgeLabel = '🚫 CANCELLED';
                            statusNote = `<p style="margin-top: 0.35rem; color: #f87171; font-size: 0.85rem; font-weight: 600;">🚫 Cancelled ${booking.state_change_reason ? `(${booking.state_change_reason})` : ''}</p>`;
                        } else if (displayStatus === 'expired') {
                            badgeLabel = 'EXPIRED';
                            statusNote = '<p style="margin-top: 0.35rem; color: #94a3b8; font-size: 0.85rem; font-weight: 600;">⏳ Unpaid Hold Expired</p>';
                        }
                        
                        const canCheckIn = (displayStatus === 'confirmed') && !flightHasPassed;
                        const canCancel = (displayStatus === 'confirmed' || displayStatus === 'pending' || displayStatus === 'checked_in') && !flightHasPassed;
                        
                        const bookingCard = document.createElement('div');
                        bookingCard.className = 'booking-card';
                        bookingCard.setAttribute('data-status', displayStatus);
                        bookingCard.innerHTML = `
                            <div class="booking-header">
                                <div class="booking-id">
                                    <h3>Booking #${booking.booking_reference || 'N/A'}</h3>
                                    <span class="status-badge status-${displayStatus}" style="display: inline-flex !important; align-items: center !important; justify-content: center !important; visibility: visible !important; opacity: 1 !important; min-width: 90px; text-align: center !important; line-height: 1 !important; margin: 0 !important;">${badgeLabel}</span>
                                </div>
                                <div class="booking-date">
                                    <p>Booked on: ${bookingDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                                    <p style="margin-top: 0.35rem; font-weight: 600; color: rgba(255,255,255,0.9);">Departure: ${dep.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} at ${dep.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                                    ${statusNote}
                                </div>
                            </div>
                            <div class="booking-details">
                                <div class="flight-info">
                                    <div class="flight-route">
                                        <div class="route-item">
                                            <h4>${booking.from_city || booking.from_name || 'N/A'} (${booking.from_code || 'N/A'})</h4>
                                            <p>${booking.from_name || 'Origin Airport'}</p>
                                            <span class="time">${dep.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${dep.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                        <div class="route-arrow">→</div>
                                        <div class="route-item">
                                            <h4>${booking.to_city || booking.to_name || 'N/A'} (${booking.to_code || 'N/A'})</h4>
                                            <p>${booking.to_name || 'Destination Airport'}</p>
                                            <span class="time">${arr.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${arr.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    </div>
                                    <div class="flight-meta">
                                        <span>Flight: <strong>${booking.flight_number || 'N/A'}</strong></span>
                                        <span>Class: <strong>${(booking.class || 'economy').toUpperCase()}</strong></span>
                                        <span>Passengers: <strong>${booking.number_of_passengers || (booking.passengers ? booking.passengers.length : 1)}</strong></span>
                                        <span>Amount: <strong style="color: #34d399;">$${parseFloat(booking.total_amount || 0).toFixed(2)}</strong></span>
                                    </div>
                                    <div class="booking-actions">
                                        <button class="btn btn-primary" onclick="viewBookingDetails(${booking.booking_id})">View Details</button>
                                        ${displayStatus === 'checked_in' ? `<button class="btn btn-success" style="background: linear-gradient(135deg, #0284c7, #0b63c5); color: white; border: 1px solid rgba(56,189,248,0.5); font-weight: 700;" onclick="viewBoardingPassModal(${booking.booking_id})">🎫 Boarding Pass</button>` : ''}
                                        ${displayStatus === 'pending' && !flightHasPassed ? `<button class="btn btn-success" style="background: linear-gradient(135deg, #059669, #10b981); color: white; border: none; font-weight: 700; padding: 6px 14px; border-radius: 8px;" onclick="triggerPayPendingBooking(${booking.booking_id})">💳 Complete Payment</button>` : ''}
                                        ${canCheckIn ? `<button class="btn btn-secondary" onclick="checkIn(${booking.booking_id})">Check-in</button>` : ''}
                                        ${canCancel ? `<button class="btn btn-danger" onclick="cancelBooking(${booking.booking_id})">Cancel</button>` : ''}
                                    </div>
                                </div>
                            </div>
                        `;
                        fragment.appendChild(bookingCard);
                    });
                    
                    bookingsList.innerHTML = '';
                    bookingsList.appendChild(fragment);
                }
            } else {
                throw new Error('Invalid response format');
            }
        } catch (error) {
            console.error('Error loading bookings:', error);
            bookingsList.innerHTML = `<div class="empty-state"><p style="color: red;">Failed to load bookings: ${error.message}</p><p><a href="javascript:location.reload()">Refresh page</a></p></div>`;
        }

        return;
    }

    if (context === 'admin') {
        applyAdminBookingFilters();
        return;
    }
}

// Function to handle user booking cancellation
async function cancelBooking(bookingId) {
    if (!bookingId) return;

    const confirmed = confirm('Are you sure you want to cancel this booking? Any allocated seats and reservations will be immediately released.');
    if (!confirmed) return;

    let reason = prompt('Please enter a cancellation reason (optional):', 'Customer voluntary cancellation');
    if (reason === null) return; // User cancelled prompt
    if (!reason.trim()) reason = 'Customer voluntary cancellation';

    try {
        const response = await apiRequest(`/bookings/${bookingId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason: reason.trim() })
        });

        if (response.success) {
            alert('✅ Booking cancelled successfully! Any assigned seats have been released.');
            
            // Refresh current user bookings view
            if (typeof filterBookings === 'function') {
                const activeTab = document.querySelector('.filter-tabs .tab-btn.active');
                const currentFilter = activeTab ? activeTab.dataset.filter || 'all' : 'all';
                filterBookings(currentFilter, 'user');
            }
            // Also refresh dashboard stats if on dashboard page
            if (typeof loadUserDashboardData === 'function') {
                loadUserDashboardData();
            }
        } else {
            alert(`⚠️ Cancellation Failed:\n\n${response.message || response.error?.message || 'Unable to cancel booking.'}`);
        }
    } catch (error) {
        console.error('Cancel booking error:', error);
        alert(`⚠️ Cancellation Error:\n\n${error.message || 'An error occurred while communicating with the server.'}`);
    }
}

// ========== MOCK PAYMENT SYSTEM ==========

let activeMockPaymentState = {
    type: 'card',
    bookingId: null,
    pnr: '',
    amount: 0,
    userName: 'VALUED PASSENGER',
    userEmail: 'passenger@skywings.com'
};

function closeMockPaymentModal() {
    const existing = document.getElementById('mockPaymentOverlay');
    if (existing) existing.remove();
}

function openMockPaymentModal(booking) {
    closeMockPaymentModal();

    const bookingId = booking.booking_id;
    const pnr = booking.booking_reference || `BKM#${bookingId}`;
    const flightNum = booking.flight_number || 'SkyWings Flight';
    const route = (booking.from_code && booking.to_code) 
        ? `${booking.from_code} → ${booking.to_code}` 
        : (booking.from_city && booking.to_city ? `${booking.from_city} → ${booking.to_city}` : 'Selected Flight');
    const amount = parseFloat(booking.total_amount || 0).toFixed(2);
    const flightClass = (booking.class || 'economy').toUpperCase();
    const numPass = booking.number_of_passengers || (booking.passengers ? booking.passengers.length : 1);
    
    let userName = 'VALUED PASSENGER';
    let userEmail = 'passenger@skywings.com';
    if (typeof authState !== 'undefined' && authState.user) {
        userName = authState.user.name || `${authState.user.first_name || ''} ${authState.user.last_name || ''}`.trim() || 'VALUED PASSENGER';
        userEmail = authState.user.email || 'passenger@skywings.com';
    }

    activeMockPaymentState = {
        type: 'card',
        bookingId,
        pnr,
        amount: parseFloat(amount),
        userName,
        userEmail
    };

    const overlay = document.createElement('div');
    overlay.id = 'mockPaymentOverlay';
    overlay.className = 'mock-payment-overlay';
    overlay.innerHTML = `
        <div class="mock-payment-card">
            <div class="mock-payment-header">
                <h3>🔒 SkyWings Secure Checkout</h3>
                <button type="button" onclick="closeMockPaymentModal()" style="background: none; border: none; color: #94a3b8; font-size: 1.5rem; cursor: pointer;">&times;</button>
            </div>

            <!-- Booking Summary Box -->
            <div class="mock-booking-summary">
                <div class="mock-summary-row">
                    <span>Booking Ref:</span>
                    <strong style="color: #f8fafc;">${pnr}</strong>
                </div>
                <div class="mock-summary-row">
                    <span>Flight:</span>
                    <span>✈️ ${flightNum} (${route})</span>
                </div>
                <div class="mock-summary-row">
                    <span>Class & Guests:</span>
                    <span>${flightClass} &bull; ${numPass} Passenger(s)</span>
                </div>
                <div class="mock-summary-row">
                    <span>Total Fare Due:</span>
                    <span style="color: #34d399; font-size: 1.15rem; font-weight: 800;">$${amount}</span>
                </div>
            </div>

            <!-- Payment Method Tabs -->
            <div class="payment-method-tabs">
                <div class="payment-method-tab active" id="tabPayCard" onclick="switchMockPaymentTab('card')">💳 Credit / Debit Card</div>
                <div class="payment-method-tab" id="tabPayPaypal" onclick="switchMockPaymentTab('paypal')">🅿️ PayPal Express</div>
                <div class="payment-method-tab" id="tabPaySkymiles" onclick="switchMockPaymentTab('skymiles')">✈️ SkyMiles Pay</div>
            </div>

            <!-- Dynamic Payment Content Area -->
            <div id="mockPaymentDynamicArea">
                <!-- Injected via renderMockPaymentContent() -->
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    renderMockPaymentContent('card');
}

function renderMockPaymentContent(type) {
    activeMockPaymentState.type = type;
    const dynamicArea = document.getElementById('mockPaymentDynamicArea');
    if (!dynamicArea) return;

    const amount = activeMockPaymentState.amount.toFixed(2);
    const milesNeeded = Math.round(activeMockPaymentState.amount * 100);
    const remainingMiles = Math.max(0, 75000 - milesNeeded);

    if (type === 'card') {
        dynamicArea.innerHTML = `
            <!-- Visual Credit Card Preview -->
            <div class="mock-card-visual">
                <div class="mock-card-chip"></div>
                <div class="mock-card-number-display" id="mockCardNumberPreview">4242 &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; 4242</div>
                <div class="mock-card-footer">
                    <div>
                        <div style="font-size: 0.65rem; color: rgba(255,255,255,0.7);">Cardholder</div>
                        <div class="mock-card-holder-name" id="mockCardNamePreview">${activeMockPaymentState.userName.toUpperCase()}</div>
                    </div>
                    <div>
                        <div style="font-size: 0.65rem; color: rgba(255,255,255,0.7);">Expires</div>
                        <div class="mock-card-holder-name">12/28</div>
                    </div>
                </div>
            </div>

            <!-- Card Inputs Form -->
            <form id="mockPaymentForm" onsubmit="executeMockPayment(event)">
                <div class="mock-form-group">
                    <label>Cardholder Name</label>
                    <input type="text" id="mockCardHolder" value="${activeMockPaymentState.userName}" required oninput="document.getElementById('mockCardNamePreview').textContent = this.value.toUpperCase() || 'CARDHOLDER'">
                </div>
                <div class="mock-form-group">
                    <label>Card Number</label>
                    <input type="text" id="mockCardNum" value="4242 4242 4242 4242" maxlength="19" required oninput="updateMockCardDisplay(this.value)">
                </div>
                <div style="display: flex; gap: 10px;">
                    <div class="mock-form-group" style="flex: 1;">
                        <label>Expiry Date</label>
                        <input type="text" id="mockCardExpiry" placeholder="MM/YY" value="12/28" maxlength="5" required>
                    </div>
                    <div class="mock-form-group" style="flex: 1;">
                        <label>CVV / CVC</label>
                        <input type="password" id="mockCardCvv" placeholder="CVV" value="888" maxlength="4" required>
                    </div>
                </div>

                <div style="font-size: 0.75rem; color: #94a3b8; display: flex; align-items: center; gap: 6px; margin: 10px 0;">
                    <span>🛡️ 256-Bit SSL Encrypted Mock Gateway</span>
                </div>

                <!-- Action Buttons -->
                <div class="mock-payment-actions">
                    <button type="submit" class="btn-pay-now" id="btnExecuteMockPayment">💳 Pay Now & Confirm ($${amount})</button>
                    <button type="button" class="btn-pay-later" onclick="deferPaymentAsPending()">⏳ Pay Later (Save Pending Reservation)</button>
                </div>
            </form>
        `;
    } else if (type === 'paypal') {
        dynamicArea.innerHTML = `
            <!-- Visual PayPal Wallet Preview -->
            <div class="mock-paypal-visual">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="font-size: 1.35rem; font-weight: 800; letter-spacing: -0.02em;">🅿️ PayPal <span style="font-size: 0.85rem; font-weight: 400; opacity: 0.85;">Express Checkout</span></div>
                    <span style="background: rgba(255,255,255,0.2); padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">Verified Sandbox</span>
                </div>
                <div style="font-size: 0.85rem; color: rgba(255,255,255,0.85); margin-bottom: 4px;">Connected Account:</div>
                <div style="font-size: 1.05rem; font-weight: 700; color: #ffffff;" id="mockPaypalEmailPreview">${activeMockPaymentState.userEmail}</div>
                <div style="margin-top: 10px; font-size: 0.75rem; color: rgba(255,255,255,0.75);">Instant 1-Click Authorization Enabled</div>
            </div>

            <!-- PayPal Inputs Form -->
            <form id="mockPaymentForm" onsubmit="executeMockPayment(event)">
                <div class="mock-form-group">
                    <label>PayPal Account Email</label>
                    <input type="email" id="mockPaypalEmail" value="${activeMockPaymentState.userEmail}" required oninput="document.getElementById('mockPaypalEmailPreview').textContent = this.value || 'account@paypal.com'">
                </div>
                <div class="mock-form-group">
                    <label>PayPal Password / Passkey</label>
                    <input type="password" id="mockPaypalPassword" value="SkyWingsPayPal#2026" placeholder="Enter PayPal password" required>
                </div>

                <div style="background: rgba(0, 121, 193, 0.12); border: 1px solid rgba(0, 121, 193, 0.3); border-radius: 8px; padding: 10px; margin: 12px 0; font-size: 0.8rem; color: #7dd3fc;">
                    ℹ️ You will be charged <strong>$${amount} USD</strong> directly from your verified PayPal wallet or linked checking account.
                </div>

                <!-- Action Buttons -->
                <div class="mock-payment-actions">
                    <button type="submit" class="btn-pay-now" id="btnExecuteMockPayment" style="background: linear-gradient(135deg, #0070ba, #003087);">🅿️ Pay with PayPal ($${amount})</button>
                    <button type="button" class="btn-pay-later" onclick="deferPaymentAsPending()">⏳ Pay Later (Save Pending Reservation)</button>
                </div>
            </form>
        `;
    } else if (type === 'skymiles') {
        dynamicArea.innerHTML = `
            <!-- Visual SkyMiles Medallion Preview -->
            <div class="mock-skymiles-visual">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="font-size: 1.25rem; font-weight: 800;">✈️ SkyMiles <span style="font-size: 0.82rem; font-weight: 400; opacity: 0.9;">Frequent Flyer</span></div>
                    <span style="background: rgba(251, 191, 36, 0.25); color: #fef08a; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; border: 1px solid rgba(251, 191, 36, 0.4);">Gold Medallion</span>
                </div>
                <div style="font-size: 0.85rem; color: rgba(255,255,255,0.85); margin-bottom: 4px;">Member Account:</div>
                <div style="font-size: 1.15rem; font-weight: 800; letter-spacing: 0.08em;" id="mockSkyMilesNumberPreview">SM-8492048</div>
                <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 0.78rem; color: rgba(255,255,255,0.85);">
                    <span>Available: <strong>75,000 Miles</strong></span>
                    <span>Status: <strong>Active Elite</strong></span>
                </div>
            </div>

            <!-- SkyMiles Inputs Form -->
            <form id="mockPaymentForm" onsubmit="executeMockPayment(event)">
                <div class="mock-form-group">
                    <label>SkyMiles / Frequent Flyer ID</label>
                    <input type="text" id="mockSkyMilesId" value="SM-8492048" required oninput="document.getElementById('mockSkyMilesNumberPreview').textContent = this.value.toUpperCase() || 'SM-0000000'">
                </div>
                <div class="mock-form-group">
                    <label>4-Digit Account PIN</label>
                    <input type="password" id="mockSkyMilesPin" value="7788" maxlength="4" required>
                </div>

                <!-- Points Breakdown Box -->
                <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 10px; padding: 12px; margin: 12px 0; font-size: 0.82rem; color: #fde68a;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span>Redemption Rate:</span>
                        <strong>100 Miles = $1.00 USD</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span>Miles Required:</span>
                        <strong style="color: #fbbf24; font-size: 0.95rem;">${milesNeeded.toLocaleString()} Miles</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; border-top: 1px dashed rgba(245, 158, 11, 0.3); padding-top: 4px; margin-top: 4px;">
                        <span>Balance Remaining:</span>
                        <strong style="color: #34d399;">${remainingMiles.toLocaleString()} Miles</strong>
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="mock-payment-actions">
                    <button type="submit" class="btn-pay-now" id="btnExecuteMockPayment" style="background: linear-gradient(135deg, #d97706, #b45309);">✈️ Redeem ${milesNeeded.toLocaleString()} Miles & Confirm</button>
                    <button type="button" class="btn-pay-later" onclick="deferPaymentAsPending()">⏳ Pay Later (Save Pending Reservation)</button>
                </div>
            </form>
        `;
    }
}

function updateMockCardDisplay(val) {
    const preview = document.getElementById('mockCardNumberPreview');
    if (!preview) return;
    const clean = val.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    if (clean.length === 0) {
        preview.textContent = '•••• •••• •••• ••••';
        return;
    }
    const parts = clean.match(/.{1,4}/g) || [];
    preview.textContent = parts.join(' ');
}

function switchMockPaymentTab(type) {
    document.querySelectorAll('.payment-method-tab').forEach(t => t.classList.remove('active'));
    if (type === 'card') document.getElementById('tabPayCard')?.classList.add('active');
    else if (type === 'paypal') document.getElementById('tabPayPaypal')?.classList.add('active');
    else if (type === 'skymiles') document.getElementById('tabPaySkymiles')?.classList.add('active');

    renderMockPaymentContent(type);
}

async function executeMockPayment(event) {
    if (event && event.preventDefault) event.preventDefault();
    const btn = document.getElementById('btnExecuteMockPayment');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '🔄 Processing Payment...';
    }

    const { bookingId, pnr, amount, type } = activeMockPaymentState;
    let paymentMethodName = 'Credit Card';
    if (type === 'paypal') paymentMethodName = 'PayPal';
    else if (type === 'skymiles') paymentMethodName = 'SkyMiles';

    try {
        const response = await apiRequest(`/bookings/${bookingId}/pay`, {
            method: 'POST',
            body: JSON.stringify({ 
                payment_method: paymentMethodName,
                payment_type: type
            })
        });

        if (response.success) {
            const cardEl = document.querySelector('.mock-payment-card');
            if (cardEl) {
                cardEl.innerHTML = `
                    <div style="text-align: center; padding: 20px 10px;">
                        <div style="font-size: 3rem; margin-bottom: 12px;">🎉</div>
                        <h2 style="color: #34d399; font-size: 1.5rem; margin-bottom: 8px;">Payment Confirmed!</h2>
                        <p style="color: #cbd5e1; font-size: 0.95rem; margin-bottom: 18px;">Your booking <strong>#${pnr}</strong> is now officially <span style="color: #34d399; font-weight: 800;">CONFIRMED</span> via <strong>${paymentMethodName}</strong> and E-Tickets have been issued.</p>
                        <div style="background: rgba(15, 23, 42, 0.7); padding: 14px; border-radius: 12px; margin-bottom: 20px; font-size: 0.88rem; color: #94a3b8;">
                            Amount Paid: <strong style="color: #f8fafc;">$${parseFloat(amount).toFixed(2)}</strong> &bull; Method: <strong style="color: #38bdf8;">${paymentMethodName}</strong> &bull; Status: <strong style="color: #34d399;">PAID</strong>
                        </div>
                        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                            <button class="btn btn-primary" onclick="window.location.href='my-bookings.html'" style="padding: 10px 20px; font-weight: 700;">View My Bookings</button>
                            <button class="btn btn-secondary" onclick="closeMockPaymentModal(); if (typeof filterBookings === 'function') filterBookings('all', 'user'); if (typeof loadUserDashboardData === 'function') loadUserDashboardData();">Close</button>
                        </div>
                    </div>
                `;
            }
        } else {
            throw new Error(response.message || 'Payment processing failed');
        }
    } catch (error) {
        alert('Payment failed: ' + error.message);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `💳 Pay Now & Confirm ($${parseFloat(amount).toFixed(2)})`;
        }
    }
}

function deferPaymentAsPending() {
    const { pnr } = activeMockPaymentState;
    closeMockPaymentModal();
    alert(`⏳ Reservation Saved as PENDING!\n\nBooking Reference: ${pnr}\n\nYour flight reservation is saved in PENDING hold status. You can complete payment at any time from the "My Bookings" page.`);
    if (window.location.pathname.includes('flight-search')) {
        window.location.href = 'my-bookings.html';
    } else if (typeof filterBookings === 'function') {
        filterBookings('all', 'user');
    }
}

async function triggerPayPendingBooking(bookingId) {
    try {
        const response = await apiRequest(`/bookings/${bookingId}`);
        if (response.success && response.data && response.data.booking) {
            openMockPaymentModal(response.data.booking);
        } else {
            throw new Error(response.message || 'Failed to retrieve booking details');
        }
    } catch (error) {
        console.error('Failed to initiate payment:', error);
        alert('Could not open payment window: ' + error.message);
    }
}

async function viewBooking(bookingId) {
    try {
        const response = await apiRequest(`/bookings/${bookingId}`);
        if (response.success && response.data.booking) {
            const booking = response.data.booking;
            const dep = new Date(booking.departure_datetime);
            const arr = new Date(booking.arrival_datetime);
            alert(`Booking Details:\n\nReference: ${booking.booking_reference}\nFlight: ${booking.flight_number}\nRoute: ${booking.from_city} → ${booking.to_city}\nDeparture: ${dep.toLocaleString()}\nArrival: ${arr.toLocaleString()}\nClass: ${booking.class}\nPassengers: ${booking.number_of_passengers}\nAmount: $${parseFloat(booking.total_amount).toFixed(2)}\nStatus: ${booking.status}`);
        }
    } catch (error) {
        alert('Failed to load booking details');
    }
}

// ========== CHECK-IN STATUS CARDS & MODALS ==========

function showCheckInStatusCard({ type = 'info', icon = 'ℹ️', title = 'Check-in Notice', subtitle = '', message = '', detailsHtml = '', primaryAction = null, secondaryAction = null }) {
    const container = document.getElementById('checkinStatusCardContainer');
    const formCard = document.getElementById('checkinFormCard') || document.querySelector('.checkin-form-card');
    const seatSelection = document.getElementById('seatSelection');
    
    // If not on check-in page (e.g. called from my-bookings.html or user dashboard), show rich modal card
    if (!container) {
        let badgeText = 'NOTICE';
        let badgeClass = 'confirmed';
        if (type === 'window-closed') { badgeText = '🕒 WINDOW CLOSED'; badgeClass = 'pending'; }
        else if (type === 'already-checked') { badgeText = '✅ CHECKED IN'; badgeClass = 'checked_in'; }
        else if (type === 'departed') { badgeText = '⚠️ DEPARTED'; badgeClass = 'missed'; }
        else if (type === 'error') { badgeText = '🚫 NOTICE'; badgeClass = 'cancelled'; }

        showDetailsModal({
            title: `${icon} ${title}`,
            subtitle: subtitle || 'SkyWings Online Check-in System',
            badgeText: badgeText,
            badgeClass: badgeClass,
            detailsGrid: [
                { label: 'Check-in Status', value: title },
                { label: 'Flight Details', value: subtitle || 'N/A' },
                { label: 'System Notice', value: message || 'Check-in rules apply.' }
            ]
        });
        return;
    }

    if (seatSelection) seatSelection.style.display = 'none';

    container.innerHTML = `
        <div class="checkin-status-card ${type}">
            <div class="checkin-status-header">
                <div class="checkin-status-icon">${icon}</div>
                <div class="checkin-status-title">
                    <h2>${title}</h2>
                    ${subtitle ? `<p>${subtitle}</p>` : ''}
                </div>
            </div>
            <div class="checkin-status-body">
                ${message ? `<p style="margin: 0 0 10px 0; font-size: 1rem; color: #f8fafc;">${message}</p>` : ''}
                ${detailsHtml || ''}
            </div>
            <div class="checkin-status-actions">
                ${primaryAction ? `<button class="btn btn-primary" onclick="${primaryAction.onClick}">${primaryAction.text}</button>` : ''}
                ${secondaryAction ? `<button class="btn btn-secondary" onclick="${secondaryAction.onClick}">${secondaryAction.text}</button>` : ''}
                <button class="btn btn-secondary" onclick="dismissCheckInStatusCard()">🔍 Search Another Booking</button>
            </div>
        </div>
    `;

    if (formCard) formCard.style.display = 'none';
}

function dismissCheckInStatusCard() {
    const container = document.getElementById('checkinStatusCardContainer');
    const formCard = document.getElementById('checkinFormCard') || document.querySelector('.checkin-form-card');
    if (container) container.innerHTML = '';
    if (formCard) formCard.style.display = 'block';
}

async function checkIn(bookingId) {
    const isLoggedIn = !!authState.isLoggedIn;
    const userRole = authState.userRole;

    if (!isLoggedIn || userRole !== 'user') {
        showCheckInStatusCard({
            type: 'error',
            icon: '🔒',
            title: 'Authentication Required',
            message: 'Please log in to your SkyWings passenger account to proceed with online check-in.',
            primaryAction: { text: '🔑 Login to Account', onClick: `sessionStorage.setItem('redirectAfterLogin', 'check-in.html?booking=${bookingId}'); window.location.href='login.html'` }
        });
        return;
    }
    
    try {
        const response = await apiRequest(`/bookings/${bookingId}`);
        if (response.success && response.data && response.data.booking) {
            const booking = response.data.booking;
            const dep = new Date(booking.departure_datetime);
            const now = new Date();
            const hoursUntilDeparture = (dep - now) / (1000 * 60 * 60);
            const formattedDep = !isNaN(dep) ? dep.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
            
            // Check if flight departed
            if (hoursUntilDeparture < 0) {
                showCheckInStatusCard({
                    type: 'departed',
                    icon: '⚠️',
                    title: 'Flight Has Already Departed',
                    subtitle: `Flight #${booking.flight_number} • Departed on ${formattedDep}`,
                    message: 'Online check-in closed prior to flight departure. If you completed travel, your boarding record is archived in My Bookings.',
                    primaryAction: { text: '📋 View My Bookings', onClick: "window.location.href='my-bookings.html'" }
                });
                return;
            }

            // Check if 24-hour window is not yet open (> 24 hours)
            if (hoursUntilDeparture > 24) {
                const hoursWait = Math.ceil(hoursUntilDeparture - 24);
                const opensDate = new Date(dep.getTime() - (24 * 60 * 60 * 1000));
                const formattedOpens = opensDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

                showCheckInStatusCard({
                    type: 'window-closed',
                    icon: '🕒',
                    title: 'Check-in Opens 24 Hours Before Departure',
                    subtitle: `Flight #${booking.flight_number} (${booking.from_code || ''} → ${booking.to_code || ''}) • Scheduled: ${formattedDep}`,
                    message: `Online check-in is not yet open for this flight. Check-in opens exactly 24 hours prior to departure on <strong>${formattedOpens}</strong> (approx. <strong>${hoursWait} hours from now</strong>).`,
                    detailsHtml: `
                        <div style="margin-top: 10px; padding: 10px 14px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 10px; font-size: 0.88rem; color: #7dd3fc;">
                            ✈️ <strong>Pro Tip:</strong> Your seats and reservation are safely confirmed. Return to this page once the 24-hour window opens to choose your preferred seat and generate your digital boarding pass.
                        </div>
                    `,
                    primaryAction: { text: '📋 View Booking Details', onClick: `viewBookingDetails(${booking.booking_id})` },
                    secondaryAction: { text: '✈️ Browse Other Flights', onClick: "window.location.href='flight-search.html'" }
                });
                return;
            }
            
            // Check if already checked in
            const hasSeats = booking.passengers && Array.isArray(booking.passengers) && 
                            booking.passengers.some(p => p.seat_number && p.seat_number.trim() !== '');
            
            if (hasSeats || (booking.status || '').toLowerCase() === 'checked_in' || (booking.status || '').toLowerCase() === 'boarded') {
                const seatList = (booking.passengers || []).map(p => `${p.first_name}: Seat ${p.seat_number || 'Assigned'}`).join(', ');
                showCheckInStatusCard({
                    type: 'already-checked',
                    icon: '✅',
                    title: 'Check-in Already Completed',
                    subtitle: `Booking #${booking.booking_reference} • Flight #${booking.flight_number}`,
                    message: `You are already checked in for this flight! Assigned seat(s): <strong>${seatList}</strong>.`,
                    primaryAction: { text: '🎫 View E-Ticket & Manifest', onClick: `viewBookingDetails(${booking.booking_id})` },
                    secondaryAction: { text: '📋 My Bookings', onClick: "window.location.href='my-bookings.html'" }
                });
                return;
            }
            
            // Proceed to check-in page with seat map
            isNavigating = true;
            window.location.href = `check-in.html?booking=${bookingId}`;
        } else {
            showCheckInStatusCard({
                type: 'error',
                icon: '⚠️',
                title: 'Unable to Load Booking',
                message: 'Failed to retrieve reservation details. Please verify your internet connection or try again shortly.'
            });
        }
    } catch (error) {
        console.error('Error in checkIn():', error);
        showCheckInStatusCard({
            type: 'error',
            icon: '⚠️',
            title: 'Check-in Notice',
            message: error.message || 'An unexpected error occurred while verifying check-in eligibility.'
        });
    }
}

async function handleCheckInSearch(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const bookingRef = formData.get('bookingRef').trim().toUpperCase();
    const lastName = formData.get('lastName').trim();

    if (!bookingRef || !lastName) {
        showCheckInStatusCard({
            type: 'error',
            icon: '⚠️',
            title: 'Missing Required Fields',
            message: 'Please enter both your Booking Reference (PNR) and the passenger\'s Last Name to search.'
        });
        return;
    }

    try {
        const response = await apiRequest('/checkin/search', {
            method: 'POST',
            body: JSON.stringify({
                booking_reference: bookingRef,
                last_name: lastName
            })
        });

        if (!response.success) {
            const msg = response.message || '';
            
            if (msg.includes('24 hours before departure') || msg.includes('Check-in opens 24 hours')) {
                showCheckInStatusCard({
                    type: 'window-closed',
                    icon: '🕒',
                    title: 'Check-in Opens 24 Hours Before Departure',
                    subtitle: `Booking #${bookingRef}`,
                    message: msg,
                    primaryAction: { text: '📋 Go to My Bookings', onClick: "window.location.href='my-bookings.html'" }
                });
                return;
            }

            if (msg.includes('Already checked in') || msg.includes('already checked in')) {
                showCheckInStatusCard({
                    type: 'already-checked',
                    icon: '✅',
                    title: 'Already Checked In',
                    subtitle: `Booking #${bookingRef}`,
                    message: 'You have already checked in for this flight. Your seat assignment and boarding passes are active.',
                    primaryAction: { text: '📋 View in My Bookings', onClick: "window.location.href='my-bookings.html'" }
                });
                return;
            }

            if (msg.includes('departed')) {
                showCheckInStatusCard({
                    type: 'departed',
                    icon: '⚠️',
                    title: 'Flight Has Departed',
                    subtitle: `Booking #${bookingRef}`,
                    message: 'This flight has already departed. Check-in is no longer open.',
                    primaryAction: { text: '🔍 Search Flights', onClick: "window.location.href='flight-search.html'" }
                });
                return;
            }

            showCheckInStatusCard({
                type: 'error',
                icon: '🔍',
                title: 'No Matching Reservation Found',
                subtitle: `Reference: ${bookingRef} • Last Name: ${lastName}`,
                message: msg || 'Please double-check your booking reference and ensure the passenger last name matches the ticket.',
                detailsHtml: `
                    <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 0.88rem; color: #94a3b8;">
                        <li>Verify the 6-14 character Booking Reference from your confirmation email.</li>
                        <li>Ensure passenger last name is spelled identically to the reservation.</li>
                        <li>Ensure reservation is in CONFIRMED paid status.</li>
                    </ul>
                `
            });
            return;
        }
        
        if (response.success && response.data) {
            if (response.data.alreadyCheckedIn) {
                showCheckInStatusCard({
                    type: 'already-checked',
                    icon: '✅',
                    title: 'Already Checked In',
                    subtitle: `Booking #${bookingRef}`,
                    message: 'You are already checked in for this flight. Your boarding pass is active in My Bookings.',
                    primaryAction: { text: '📋 Go to My Bookings', onClick: "window.location.href='my-bookings.html'" }
                });
                return;
            }
            
            if (response.data.booking) {
                currentBooking = response.data.booking;
                
                const hasSeats = currentBooking.passengers && currentBooking.passengers.some(p => p.seat_number && p.seat_number.trim() !== '');
                if (hasSeats) {
                    showCheckInStatusCard({
                        type: 'already-checked',
                        icon: '✅',
                        title: 'Seats Already Assigned',
                        subtitle: `Booking #${bookingRef}`,
                        message: 'Seats have already been selected and confirmed for this booking.',
                        primaryAction: { text: '📋 Go to My Bookings', onClick: "window.location.href='my-bookings.html'" }
                    });
                    return;
                }
                
                maxSeatsAllowed = currentBooking.number_of_passengers || (currentBooking.passengers ? currentBooking.passengers.length : 1);
                
                // Show seat selection
                document.getElementById('seatSelection').style.display = 'block';
                const formCard = document.getElementById('checkinFormCard') || document.querySelector('.checkin-form-card');
                if (formCard) formCard.style.display = 'none';
                
                await initializeSeatMap();
            }
        }
    } catch (error) {
        showCheckInStatusCard({
            type: 'error',
            icon: '⚠️',
            title: 'Lookup Error',
            message: error.message || 'An error occurred while connecting to the check-in server. Please try again.'
        });
    }
}

// Load booking directly if booking ID is in URL
async function loadBookingForCheckIn() {
    const urlParams = new URLSearchParams(window.location.search);
    const bookingId = urlParams.get('booking');
    
    if (bookingId) {
        try {
            const bookingResponse = await apiRequest(`/bookings/${bookingId}`);
            if (bookingResponse.success && bookingResponse.data && bookingResponse.data.booking) {
                const booking = bookingResponse.data.booking;
                const dep = new Date(booking.departure_datetime);
                const now = new Date();
                const hoursUntilDeparture = (dep - now) / (1000 * 60 * 60);
                const formattedDep = !isNaN(dep) ? dep.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';

                if (hoursUntilDeparture > 24) {
                    const hoursWait = Math.ceil(hoursUntilDeparture - 24);
                    const opensDate = new Date(dep.getTime() - (24 * 60 * 60 * 1000));
                    const formattedOpens = opensDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

                    showCheckInStatusCard({
                        type: 'window-closed',
                        icon: '🕒',
                        title: 'Check-in Opens 24 Hours Before Departure',
                        subtitle: `Flight #${booking.flight_number} • Departs: ${formattedDep}`,
                        message: `Online check-in is not yet open. It will open on <strong>${formattedOpens}</strong> (${hoursWait} hours from now).`,
                        detailsHtml: `
                            <div style="margin-top: 10px; padding: 10px 14px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 10px; font-size: 0.88rem; color: #7dd3fc;">
                                ✈️ <strong>Notice:</strong> Seat selection opens 24 hours prior to departure. Please return then to complete check-in.
                            </div>
                        `,
                        primaryAction: { text: '📋 View Booking Details', onClick: `viewBookingDetails(${booking.booking_id})` },
                        secondaryAction: { text: '📋 Back to My Bookings', onClick: "window.location.href='my-bookings.html'" }
                    });
                    return;
                }

                if (hoursUntilDeparture < 0) {
                    showCheckInStatusCard({
                        type: 'departed',
                        icon: '⚠️',
                        title: 'Flight Has Departed',
                        subtitle: `Flight #${booking.flight_number} • Departed: ${formattedDep}`,
                        message: 'This flight has already departed. Check-in is closed.',
                        primaryAction: { text: '📋 View My Bookings', onClick: "window.location.href='my-bookings.html'" }
                    });
                    return;
                }
                
                const hasSeats = booking.passengers && booking.passengers.some(p => p.seat_number && p.seat_number.trim() !== '');
                if (hasSeats || (booking.status || '').toLowerCase() === 'checked_in') {
                    showCheckInStatusCard({
                        type: 'already-checked',
                        icon: '✅',
                        title: 'Check-in Already Completed',
                        subtitle: `Booking #${booking.booking_reference}`,
                        message: 'You have already checked in for this flight. Your seats are assigned.',
                        primaryAction: { text: '🎫 View Details', onClick: `viewBookingDetails(${booking.booking_id})` },
                        secondaryAction: { text: '📋 My Bookings', onClick: "window.location.href='my-bookings.html'" }
                    });
                    return;
                }
                
                currentBooking = booking;
                maxSeatsAllowed = booking.number_of_passengers || (booking.passengers ? booking.passengers.length : 1);
                
                document.getElementById('seatSelection').style.display = 'block';
                const formCard = document.getElementById('checkinFormCard') || document.querySelector('.checkin-form-card');
                if (formCard) formCard.style.display = 'none';
                
                await initializeSeatMap();
            }
        } catch (error) {
            console.error('Error loading booking for check-in:', error);
            showCheckInStatusCard({
                type: 'error',
                icon: '⚠️',
                title: 'Unable to Load Booking',
                message: 'Failed to retrieve booking details for check-in.'
            });
        }
    }
}

let seatHoldTimerInterval = null;

async function initializeSeatMap() {
    const seatMap = document.getElementById('seatMap');
    if (!seatMap || !currentBooking) return;
    
    selectedSeats = [];

    if (seatHoldTimerInterval) {
        clearInterval(seatHoldTimerInterval);
        seatHoldTimerInterval = null;
    }

    try {
        const response = await apiRequest(`/flights/${currentBooking.flight_id}/seat-map`);
        const data = response.data || {};
        const seats = data.seats || [];
        const rows = Math.ceil((data.total_capacity || 30) / 6);
        
        const seatMapDict = new Map();
        seats.forEach(s => seatMapDict.set(s.seat_number.toUpperCase(), s));

        // Remove existing seat info if any
        const existingInfo = document.querySelector('.seat-info');
        if (existingInfo) existingInfo.remove();

        let html = '';
        let myHoldExpiresAt = null;

        for (let row = 1; row <= rows; row++) {
            html += '<div class="seat-row">';
            for (let seatCol = 1; seatCol <= 6; seatCol++) {
                if (seatCol === 4) {
                    html += `<span class="seat-aisle-gap">${row}</span>`;
                }
                const seatId = `${row}${String.fromCharCode(64 + seatCol)}`;
                const seatData = seatMapDict.get(seatId) || { status: 'AVAILABLE' };
                
                let cssClass = 'available';
                let title = `Seat ${seatId} - Available`;

                if (seatData.status === 'BOOKED') {
                    cssClass = 'occupied';
                    title = `Seat ${seatId} - Occupied`;
                } else if (seatData.status === 'HELD') {
                    if (seatData.mine) {
                        cssClass = 'my-hold';
                        title = `Seat ${seatId} - Your Hold`;
                        myHoldExpiresAt = seatData.expires_at;
                        if (!selectedSeats.includes(seatId)) selectedSeats.push(seatId);
                    } else {
                        cssClass = 'held';
                        title = `Seat ${seatId} - Held by another passenger`;
                    }
                }

                html += `<span class="seat ${cssClass}" 
                         onclick="selectSeat(this)" data-seat="${seatId}"
                         title="${title}">${seatId}</span>`;
            }
            html += '</div>';
        }
        seatMap.innerHTML = html;
        
        // Render seat info & dynamic countdown timer calculated from server expires_at
        const seatInfo = document.createElement('div');
        seatInfo.className = 'seat-info';
        seatInfo.style.cssText = 'text-align: center; margin: 1rem 0; color: white; font-weight: 600;';
        
        if (myHoldExpiresAt) {
            const updateTimer = () => {
                const remSec = Math.max(0, Math.floor((new Date(myHoldExpiresAt) - new Date()) / 1000));
                const mins = Math.floor(remSec / 60);
                const secs = remSec % 60;
                seatInfo.innerHTML = `⏱️ Seat Held! Remaining Time: <strong>${mins}:${secs < 10 ? '0' : ''}${secs}</strong> | Select up to ${maxSeatsAllowed} seat(s)`;
                if (remSec === 0) {
                    clearInterval(seatHoldTimerInterval);
                    initializeSeatMap();
                }
            };
            updateTimer();
            seatHoldTimerInterval = setInterval(updateTimer, 1000);
        } else {
            seatInfo.innerHTML = `Select up to ${maxSeatsAllowed} seat(s) for ${maxSeatsAllowed} passenger(s)`;
        }

        seatMap.parentNode.insertBefore(seatInfo, seatMap.nextSibling);
    } catch (error) {
        console.error('Error initializing seat map:', error);
        alert('Failed to load seat map. Please try again.');
    }
}

function selectSeat(element) {
    if (element.classList.contains('occupied')) {
        alert('This seat is already occupied');
        return;
    }

    const seatId = element.dataset.seat;

    if (element.classList.contains('selected')) {
        // Deselect seat
        element.classList.remove('selected');
        element.classList.add('available');
        selectedSeats = selectedSeats.filter(seat => seat !== seatId);
    } else {
        // Check if max seats reached
        if (selectedSeats.length >= maxSeatsAllowed) {
            alert(`You can only select ${maxSeatsAllowed} seat(s) for ${maxSeatsAllowed} passenger(s).`);
            return;
        }
        
        // Select seat
        element.classList.remove('available');
        element.classList.add('selected');
        if (!selectedSeats.includes(seatId)) {
            selectedSeats.push(seatId);
        }
    }
    
    // Update seat count display
    updateSeatCount();
}

function updateSeatCount() {
    const seatInfo = document.querySelector('.seat-info');
    if (seatInfo) {
        seatInfo.innerHTML = `Selected: ${selectedSeats.length} / ${maxSeatsAllowed} seat(s)`;
    }
}

async function confirmSeats() {
    if (selectedSeats.length === 0) {
        alert('Please select at least one seat');
        return;
    }
    
    if (selectedSeats.length !== maxSeatsAllowed) {
        alert(`Please select exactly ${maxSeatsAllowed} seat(s) for ${maxSeatsAllowed} passenger(s).`);
        return;
    }
    
    try {
        const response = await apiRequest('/checkin/confirm', {
            method: 'POST',
            body: JSON.stringify({
                booking_id: currentBooking.booking_id,
                seat_numbers: selectedSeats
            })
        });

        if (response.success) {
            // Update booking with check-in data
            currentBooking.gate_number = response.data.gate_number || 'TBA';
            currentBooking.boarding_time = response.data.boarding_time;
            currentBooking.seats = selectedSeats;
            
            document.getElementById('seatSelection').style.display = 'none';
            document.getElementById('checkinSuccess').style.display = 'block';
            generateBoardingPass();
        } else {
            // Check if already checked in
            if (response.message && (response.message.includes('Already checked in') || response.message.includes('already checked in'))) {
                // Verify user is still authenticated before redirecting
                const isLoggedIn = !!authState.isLoggedIn;
                if (!isLoggedIn) {
                    alert('Your session has expired. Please login again.');
                    window.location.href = 'login.html';
                    return;
                }
                
                alert('You have already checked in for this flight. Please check your bookings page for your boarding pass.');
                // Use setTimeout to ensure alert is fully dismissed before redirect
                setTimeout(() => {
                    window.location.href = 'my-bookings.html';
                }, 100);
                return;
            }
            alert(response.message || 'Failed to confirm check-in. Please try again.');
        }
    } catch (error) {
        let errorMsg = error.message || 'Failed to confirm check-in. Please try again.';
        
        // Check if error message indicates already checked in - don't redirect to login
        if (errorMsg.includes('Already checked in') || errorMsg.includes('already checked in')) {
            // Verify user is still authenticated before redirecting
            const isLoggedIn = !!authState.isLoggedIn;
            if (!isLoggedIn) {
                alert('Your session has expired. Please login again.');
                window.location.href = 'login.html';
                return;
            }
            
            alert('You have already checked in for this flight. Please check your bookings page for your boarding pass.');
            // Use setTimeout to ensure alert is fully dismissed before redirect
            setTimeout(() => {
                window.location.href = 'my-bookings.html';
            }, 100);
            return;
        }
        
        // Don't redirect to login for other errors - just show the error message
        alert(errorMsg);
    }
}

function resetSeats() {
    selectedSeats = [];
    initializeSeatMap();
}

// ========== PREMIUM AIRLINE BOARDING PASS SYSTEM ==========

// Generate high-density SVG Barcode (Code 128 / IATA BCBP style)
function generateBarcodeSVG(text) {
    const rawText = String(text || 'SKYWINGS2026').toUpperCase();
    let bars = '';
    let x = 12;
    const patterns = [2, 1, 3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 2, 3, 1, 2, 1, 3, 4, 2, 1, 2, 3, 1, 4, 1, 2, 3, 2, 1, 3];
    
    // Guard bars
    bars += `<rect x="4" y="2" width="2.5" height="44" fill="#0f172a" /><rect x="8" y="2" width="1.5" height="44" fill="#0f172a" />`;
    
    for (let i = 0; i < rawText.length * 3; i++) {
        const charCode = rawText.charCodeAt(i % rawText.length) || 65;
        const width = (charCode % 3) + 1.2;
        const isSpace = (i % 2 === 1);
        if (!isSpace) {
            bars += `<rect x="${x.toFixed(1)}" y="4" width="${width.toFixed(1)}" height="40" fill="#0f172a" />`;
        }
        x += width + (isSpace ? (patterns[i % patterns.length] * 0.8) : 0.8);
        if (x > 290) break;
    }
    
    // Trailing guard bars
    bars += `<rect x="295" y="2" width="1.5" height="44" fill="#0f172a" /><rect x="299" y="2" width="2.5" height="44" fill="#0f172a" />`;
    
    return `<svg class="bp-barcode-svg" viewBox="0 0 306 48" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; border-radius:6px; padding:3px 6px;">${bars}</svg>`;
}

// Generate realistic high-contrast vector QR Code SVG matrix
function generateQRCodeSVG(dataString) {
    const seed = String(dataString || 'SKYWINGS').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const size = 21; // 21x21 QR matrix
    const cellSize = 5;
    let cells = '';

    // Function to draw finder pattern
    function drawFinder(startX, startY) {
        cells += `<rect x="${startX * cellSize}" y="${startY * cellSize}" width="${7 * cellSize}" height="${7 * cellSize}" fill="#0f172a" />`;
        cells += `<rect x="${(startX + 1) * cellSize}" y="${(startY + 1) * cellSize}" width="${5 * cellSize}" height="${5 * cellSize}" fill="#ffffff" />`;
        cells += `<rect x="${(startX + 2) * cellSize}" y="${(startY + 2) * cellSize}" width="${3 * cellSize}" height="${3 * cellSize}" fill="#0f172a" />`;
    }

    // Draw 3 corner finder patterns
    drawFinder(0, 0); // Top-left
    drawFinder(size - 7, 0); // Top-right
    drawFinder(0, size - 7); // Bottom-left

    // Fill data cells
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            // Skip finder zones
            if ((r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8)) {
                continue;
            }
            // Timing lines
            if (r === 6 || c === 6) {
                if ((r + c) % 2 === 0) {
                    cells += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize}" height="${cellSize}" fill="#0f172a" />`;
                }
                continue;
            }
            // Deterministic pseudo-random pattern based on string data seed
            const val = Math.sin(seed * (r * size + c) + r * 13 + c * 37);
            if (val > -0.1) {
                cells += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize}" height="${cellSize}" fill="#0f172a" />`;
            }
        }
    }

    const totalDim = size * cellSize;
    return `<svg class="bp-qr-image" viewBox="0 0 ${totalDim} ${totalDim}" xmlns="http://www.w3.org/2000/svg" style="width:110px; height:110px; background:#ffffff; border-radius:8px;">${cells}</svg>`;
}

// Current active boarding pass state for multi-passenger bookings
let activeBoardingPassBooking = null;
let activeBoardingPassPaxIndex = 0;

// Render Boarding Pass Card HTML
function renderBoardingPassHTML(booking, activePaxIndex = 0, isModal = false) {
    if (!booking) return '<div class="empty-state"><p>No boarding pass data available.</p></div>';

    activeBoardingPassBooking = booking;
    activeBoardingPassPaxIndex = activePaxIndex;

    const dep = new Date(booking.departure_datetime || Date.now() + 12 * 3600 * 1000);
    const arr = new Date(booking.arrival_datetime || dep.getTime() + 6 * 3600 * 1000);
    const boardingTime = booking.boarding_time 
        ? new Date(booking.boarding_time) 
        : new Date(dep.getTime() - 40 * 60 * 1000);

    // Format dates & times
    const depDateStr = dep.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const depTimeStr = dep.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const arrDateStr = arr.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const arrTimeStr = arr.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const boardingTimeStr = boardingTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Resolve passengers list
    let paxList = [];
    if (booking.passengers && Array.isArray(booking.passengers) && booking.passengers.length > 0) {
        paxList = booking.passengers;
    } else {
        const defaultSeat = (selectedSeats && selectedSeats[0]) || (booking.seats && booking.seats[0]) || '10A';
        paxList = [{
            first_name: authState.user ? authState.user.first_name : 'Valued',
            last_name: authState.user ? authState.user.last_name : 'Passenger',
            seat_number: defaultSeat
        }];
    }

    const currentPax = paxList[activePaxIndex] || paxList[0];
    const paxName = `${(currentPax.first_name || 'VALUED').toUpperCase()} ${(currentPax.last_name || 'PASSENGER').toUpperCase()}`;
    const seatNum = currentPax.seat_number || (selectedSeats && selectedSeats[activePaxIndex]) || (selectedSeats && selectedSeats[0]) || '10A';
    const gateNum = booking.gate_number || 'A12';
    const cabinClass = (booking.class || 'economy').toLowerCase();
    const pnr = booking.booking_reference || 'BKMSWT900';
    const flightNum = booking.flight_number || 'SW-1496';
    const fromCode = (booking.from_code || booking.from_airport_code || 'NYC').toUpperCase();
    const toCode = (booking.to_code || booking.to_airport_code || 'LON').toUpperCase();
    const fromCity = booking.from_city || booking.from_name || 'New York';
    const toCity = booking.to_city || booking.to_name || 'London';
    const ticketNum = currentPax.ticket_number || `789-${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    const seqNum = String(activePaxIndex + 42).padStart(3, '0');
    const groupZone = cabinClass === 'first' ? 'PRIORITY' : cabinClass === 'business' ? 'ZONE 1' : 'ZONE 2';

    const mrtdString = `M1${paxName.replace(/ /g, '/')}  E${flightNum.replace('-', '')} ${fromCode}${toCode} ${cabinClass.charAt(0).toUpperCase()}${seatNum.padEnd(4, ' ')}${seqNum} 100`;

    // Multi-passenger tabs if more than 1 passenger
    let tabsHtml = '';
    if (paxList.length > 1) {
        tabsHtml = `
            <div class="bp-passenger-tabs">
                <span style="font-size: 0.85rem; font-weight: 700; color: #94a3b8; margin-right: 6px;">Passengers (${paxList.length}):</span>
                ${paxList.map((p, idx) => `
                    <button type="button" class="bp-passenger-tab ${idx === activePaxIndex ? 'active' : ''}" 
                            onclick="switchBoardingPassPassenger(${idx}, ${isModal})">
                        👤 ${p.first_name} ${p.last_name} (${p.seat_number || selectedSeats[idx] || `Seat ${idx + 1}`})
                    </button>
                `).join('')}
            </div>
        `;
    }

    return `
        <div class="boarding-pass-wrapper" id="boardingPassCardToExport">
            ${tabsHtml}
            
            <div class="premium-boarding-pass" id="printableBoardingPassCard">
                <!-- Main Flight Coupon (Left Side) -->
                <div class="bp-main-section">
                    <!-- Brand Header -->
                    <div class="bp-header">
                        <div class="bp-brand">
                            <img src="images/transparent_logo.PNG" alt="SkyWings Logo" class="bp-logo" onerror="this.style.display='none'">
                            <div class="bp-brand-text">
                                <h3>✈️ SKYWINGS AIRLINES</h3>
                                <span>Official Electronic Boarding Pass</span>
                            </div>
                        </div>
                        <div class="bp-badges">
                            <span class="bp-class-badge ${cabinClass}">${cabinClass.toUpperCase()} CLASS</span>
                            <span class="bp-status-badge">✅ CHECKED IN</span>
                        </div>
                    </div>

                    <!-- Route Section -->
                    <div class="bp-route-hero">
                        <div class="bp-endpoint origin">
                            <span class="bp-airport-code">${fromCode}</span>
                            <span class="bp-city-name">${fromCity}</span>
                            <span class="bp-time-label">🛫 ${depDateStr} • ${depTimeStr}</span>
                        </div>

                        <div class="bp-flight-path">
                            <span class="bp-flight-number-pill">FLIGHT ${flightNum}</span>
                            <div class="bp-path-line">
                                <span class="plane-icon">✈</span>
                            </div>
                            <span class="bp-flight-duration">Non-Stop Flight</span>
                        </div>

                        <div class="bp-endpoint destination">
                            <span class="bp-airport-code">${toCode}</span>
                            <span class="bp-city-name">${toCity}</span>
                            <span class="bp-time-label">🛬 ${arrDateStr} • ${arrTimeStr}</span>
                        </div>
                    </div>

                    <!-- Vital Passenger Specs Grid -->
                    <div class="bp-grid">
                        <div class="bp-grid-item">
                            <span class="bp-label">Passenger Name</span>
                            <span class="bp-value passenger-name">${paxName}</span>
                        </div>
                        <div class="bp-grid-item">
                            <span class="bp-label">Seat Assignment</span>
                            <span class="bp-value highlight-seat">💺 ${seatNum}</span>
                        </div>
                        <div class="bp-grid-item">
                            <span class="bp-label">Departure Gate</span>
                            <span class="bp-value highlight-gate">🚪 ${gateNum}</span>
                        </div>
                        <div class="bp-grid-item">
                            <span class="bp-label">Boarding Time</span>
                            <span class="bp-value highlight-time">⏰ ${boardingTimeStr}</span>
                        </div>
                        <div class="bp-grid-item">
                            <span class="bp-label">Booking Reference (PNR)</span>
                            <span class="bp-value" style="font-family: monospace; color: #38bdf8;">${pnr}</span>
                        </div>
                        <div class="bp-grid-item">
                            <span class="bp-label">E-Ticket Number</span>
                            <span class="bp-value" style="font-size: 0.95rem; font-family: monospace;">${ticketNum}</span>
                        </div>
                        <div class="bp-grid-item">
                            <span class="bp-label">Boarding Group</span>
                            <span class="bp-value" style="color: #fbbf24;">${groupZone}</span>
                        </div>
                        <div class="bp-grid-item">
                            <span class="bp-label">Sequence No</span>
                            <span class="bp-value">SEQ ${seqNum}</span>
                        </div>
                    </div>

                    <!-- Footer Barcode & Security -->
                    <div class="bp-footer">
                        <div class="bp-barcode-container">
                            ${generateBarcodeSVG(pnr + flightNum + seatNum)}
                            <span class="bp-mrtd-string">${mrtdString}</span>
                        </div>
                        <div class="bp-security-badge">
                            <span class="shield-icon">🛡️</span>
                            <div class="bp-security-text">
                                <strong>TSA PRE-CHECK / SKY SHIELD</strong>
                                <span>IATA COMPLIANT BCBP VERIFIED</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Stub Tear-off Section (Right Side) -->
                <div class="bp-stub-section">
                    <div>
                        <div class="bp-stub-header">
                            <h4>SKYWINGS</h4>
                            <span class="bp-stub-notice">PASSENGER STUB</span>
                        </div>
                        
                        <div class="bp-stub-details">
                            <div class="bp-stub-row">
                                <div>
                                    <span class="bp-label">Passenger</span>
                                    <div class="bp-value" style="font-size: 0.95rem;">${paxName}</div>
                                </div>
                            </div>
                            <div class="bp-stub-row">
                                <div>
                                    <span class="bp-label">Flight</span>
                                    <div class="bp-value" style="font-size: 1rem; color: #38bdf8;">${flightNum}</div>
                                </div>
                                <div style="text-align: right;">
                                    <span class="bp-label">Route</span>
                                    <div class="bp-value" style="font-size: 0.95rem;">${fromCode} ✈ ${toCode}</div>
                                </div>
                            </div>
                            <div class="bp-stub-row">
                                <div>
                                    <span class="bp-label">Gate</span>
                                    <div class="bp-value" style="color: #34d399; font-size: 1.15rem;">${gateNum}</div>
                                </div>
                                <div>
                                    <span class="bp-label">Seat</span>
                                    <div class="bp-value highlight-seat" style="font-size: 1.25rem;">${seatNum}</div>
                                </div>
                                <div style="text-align: right;">
                                    <span class="bp-label">Time</span>
                                    <div class="bp-value" style="color: #fbbf24; font-size: 1.05rem;">${boardingTimeStr}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- High Density 2D QR Code -->
                    <div class="bp-qr-wrapper">
                        ${generateQRCodeSVG(`SKYWINGS:${pnr}:${flightNum}:${paxName}:${seatNum}:${gateNum}`)}
                        <span class="bp-qr-caption">SCAN AT GATE FOR BOARDING</span>
                    </div>
                </div>
            </div>

            <!-- Interactive Actions Toolbar -->
            <div class="bp-actions-toolbar">
                <button type="button" class="bp-btn-action btn-download" onclick="downloadBoardingPassPDF()">
                    📥 Download Boarding Pass (PDF)
                </button>
                <button type="button" class="bp-btn-action btn-wallet" onclick="saveBoardingPassImage()">
                    📱 Save Pass Image (PNG / Mobile)
                </button>
            </div>
        </div>
    `;
}

function generateBoardingPass() {
    const boardingPass = document.getElementById('boardingPass');
    if (!currentBooking) return;
    
    boardingPass.innerHTML = renderBoardingPassHTML(currentBooking, 0, false);
}

function switchBoardingPassPassenger(paxIndex, isModal = false) {
    if (!activeBoardingPassBooking) return;
    if (isModal) {
        const modalContainer = document.getElementById('bpModalDynamicContent');
        if (modalContainer) {
            modalContainer.innerHTML = renderBoardingPassHTML(activeBoardingPassBooking, paxIndex, true);
        }
    } else {
        const bpContainer = document.getElementById('boardingPass');
        if (bpContainer) {
            bpContainer.innerHTML = renderBoardingPassHTML(activeBoardingPassBooking, paxIndex, false);
        }
    }
}

function downloadBoardingPass() {
    downloadBoardingPassPDF();
}

// Toast notification for pass downloads and saves
function showBoardingPassToast(message) {
    const existing = document.getElementById('bpToastNotice');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'bpToastNotice';
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #0b63c5, #0284c7);
        color: #ffffff;
        padding: 12px 24px;
        border-radius: 30px;
        font-size: 0.92rem;
        font-weight: 700;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(56, 189, 248, 0.5);
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 8px;
        animation: bpToastFade 0.3s ease;
    `;
    toast.innerHTML = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast && toast.parentNode) toast.remove();
    }, 4000);
}

// Actual functional Save to Device (High-Res PNG image download)
async function saveBoardingPassImage(customBooking = null, paxIndex = null) {
    const booking = customBooking || activeBoardingPassBooking || currentBooking;
    if (!booking) {
        alert('⚠️ No boarding pass data available to save.');
        return;
    }

    const pnr = booking.booking_reference || 'BKMSWT';
    const targetCard = document.getElementById('printableBoardingPassCard');

    // Ensure html2canvas is loaded
    if (typeof window.html2canvas === 'undefined') {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        await new Promise((res, rej) => { s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    }

    if (targetCard && window.html2canvas) {
        try {
            const canvas = await window.html2canvas(targetCard, {
                scale: 3, // 3x ultra-sharp retina resolution
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#091322',
                logging: false
            });

            // Convert canvas to downloadable PNG
            const imageURL = canvas.toDataURL('image/png');
            const downloadLink = document.createElement('a');
            downloadLink.href = imageURL;
            downloadLink.download = `SkyWings_Pass_${pnr}.png`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            downloadLink.remove();

            showBoardingPassToast('📱 Boarding Pass image saved to your device!');
        } catch (err) {
            console.error('Save to device image error:', err);
            alert('⚠️ Failed to save image to device. Please try the PDF download.');
        }
    } else {
        alert('⚠️ Unable to capture boarding pass image.');
    }
}

// High-Resolution Official Boarding Pass PDF Generation with Guaranteed Zero Overflow
async function downloadBoardingPassPDF(customBooking = null, paxIndex = null) {
    const booking = customBooking || activeBoardingPassBooking || currentBooking;
    if (!booking) {
        alert('⚠️ No boarding pass data available for download.');
        return;
    }

    const pnr = booking.booking_reference || 'BKMSWT';

    // Ensure html2canvas and jsPDF are loaded
    const loadScript = (src) => {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) return resolve();
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    };

    try {
        if (typeof window.html2canvas === 'undefined') {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
        }
        if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }

        const jsPDFConstructor = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
        if (!jsPDFConstructor) {
            throw new Error('PDF generator library could not be initialized.');
        }

        const targetCard = document.getElementById('printableBoardingPassCard');

        if (targetCard && window.html2canvas) {
            // Render high-DPI canvas
            const canvas = await window.html2canvas(targetCard, {
                scale: 2.5, // 2.5x crisp retina DPI
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#091322',
                logging: false
            });

            // Decide orientation based on aspect ratio
            const isPortraitCard = canvas.height > canvas.width;
            const orientation = isPortraitCard ? 'portrait' : 'landscape';

            const doc = new jsPDFConstructor({
                orientation: orientation,
                unit: 'mm',
                format: 'a4'
            });

            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();

            // Calculate precise bounds with safe margins to GUARANTEE zero overflow
            const margin = 10; // 10mm margin
            const maxW = pageWidth - (margin * 2);
            const maxH = pageHeight - (margin * 2) - 12; // 12mm reserved for footer

            let imgWidth = maxW;
            let imgHeight = (canvas.height * imgWidth) / canvas.width;

            // Constrain by height if needed
            if (imgHeight > maxH) {
                imgHeight = maxH;
                imgWidth = (canvas.width * imgHeight) / canvas.height;
            }

            // Exact centering on page
            const xPos = (pageWidth - imgWidth) / 2;
            const yPos = Math.max(margin, (pageHeight - imgHeight - 8) / 2);

            // Elegant deep airline background
            doc.setFillColor(9, 19, 34);
            doc.rect(0, 0, pageWidth, pageHeight, 'F');

            // Draw crisp rasterized pass
            const imgData = canvas.toDataURL('image/png');
            doc.addImage(imgData, 'PNG', xPos, yPos, imgWidth, imgHeight);

            // Official security notice footer
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184);
            doc.text(
                'SkyWings Airlines • Official Electronic Boarding Pass • Please present this document along with government photo ID at security and departure gate.',
                pageWidth / 2,
                pageHeight - 6,
                { align: 'center' }
            );

            doc.save(`SkyWings_BoardingPass_${pnr}.pdf`);
            showBoardingPassToast('📥 Boarding Pass PDF downloaded successfully!');
        } else {
            generateDirectVectorPDF(booking, pnr);
        }
    } catch (error) {
        console.error('PDF Generation Error:', error);
        generateDirectVectorPDF(booking, pnr);
    }
}

// Fallback Direct Vector PDF Generator
function generateDirectVectorPDF(booking, pnr) {
    const jsPDFConstructor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDFConstructor) return;

    const doc = new jsPDFConstructor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const dep = new Date(booking.departure_datetime || Date.now());
    const arr = new Date(booking.arrival_datetime || Date.now());
    const boarding = booking.boarding_time ? new Date(booking.boarding_time) : new Date(dep.getTime() - 40 * 60 * 1000);
    const fromCode = (booking.from_code || 'NYC').toUpperCase();
    const toCode = (booking.to_code || 'LON').toUpperCase();
    const flightNum = booking.flight_number || 'SW-1496';
    const seat = (selectedSeats && selectedSeats[0]) || (booking.seats && booking.seats[0]) || '10A';
    const gate = booking.gate_number || 'A12';
    const paxName = authState.user ? `${authState.user.first_name} ${authState.user.last_name}` : 'VALUED PASSENGER';

    doc.setFillColor(9, 19, 34);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // Header bar
    doc.setFillColor(11, 99, 197);
    doc.rect(12, 12, pageWidth - 24, 20, 'F');

    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text('✈️ SKYWINGS AIRLINES — OFFICIAL ELECTRONIC BOARDING PASS', 18, 25);

    // Card Body
    doc.setFillColor(19, 34, 56);
    doc.rect(12, 32, pageWidth - 24, 140, 'F');

    doc.setFontSize(12);
    doc.setTextColor(248, 250, 252);
    doc.text(`PASSENGER: ${paxName.toUpperCase()}`, 20, 50);
    doc.text(`FLIGHT: ${flightNum}`, 20, 62);
    doc.text(`ROUTE: ${fromCode} (${booking.from_city || 'Origin'}) → ${toCode} (${booking.to_city || 'Destination'})`, 20, 74);
    doc.text(`DATE: ${dep.toLocaleDateString()}`, 20, 86);
    doc.text(`DEPARTURE: ${dep.toLocaleTimeString()}`, 20, 98);
    doc.text(`BOARDING TIME: ${boarding.toLocaleTimeString()}`, 20, 110);

    doc.setFontSize(16);
    doc.setTextColor(56, 189, 248);
    doc.text(`SEAT: ${seat}`, 150, 50);
    doc.text(`GATE: ${gate}`, 150, 65);
    doc.text(`CLASS: ${(booking.class || 'Economy').toUpperCase()}`, 150, 80);
    doc.text(`PNR: ${pnr}`, 150, 95);

    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('SkyWings Airlines • Gate closes 15 minutes prior to departure • IATA Compliant BCBP', pageWidth / 2, pageHeight - 8, { align: 'center' });

    doc.save(`SkyWings_BoardingPass_${pnr}.pdf`);
    showBoardingPassToast('📥 Boarding Pass PDF downloaded successfully!');
}

async function viewBoardingPassModal(bookingId) {
    // Remove any existing modal
    const existing = document.getElementById('boardingPassModalOverlay');
    if (existing) existing.remove();

    try {
        const response = await apiRequest(`/bookings/${bookingId}`);
        if (!response.success || !response.data.booking) {
            alert('⚠️ Unable to load boarding pass for this booking.');
            return;
        }

        const booking = response.data.booking;
        const overlay = document.createElement('div');
        overlay.id = 'boardingPassModalOverlay';
        overlay.className = 'bp-modal-overlay';
        overlay.innerHTML = `
            <div class="bp-modal-content">
                <button type="button" class="bp-modal-close-btn" onclick="document.getElementById('boardingPassModalOverlay').remove()" title="Close">✕</button>
                <div id="bpModalDynamicContent">
                    ${renderBoardingPassHTML(booking, 0, true)}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
    } catch (err) {
        console.error('View Boarding Pass Modal Error:', err);
        alert(err.message || 'Failed to display boarding pass.');
    }
}

// ========== PROFILE ==========

let userProfileData = null;

// Load user profile on page load
async function loadUserProfile() {
    if (!window.location.pathname.includes('user-profile')) return;
    
    try {
        const response = await apiRequest('/users/profile');
        if (response.success && response.data.user) {
            userProfileData = response.data.user;
            populateProfileForm(userProfileData);
            updateProfileAvatar(userProfileData);
        }
        
        // Also prefetch companion & booking count for quick stats
        updateProfileQuickStats();
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

async function updateProfileQuickStats() {
    try {
        const [bookingsRes, passengersRes] = await Promise.all([
            apiRequest('/bookings/list').catch(() => null),
            apiRequest('/users/passengers').catch(() => null)
        ]);
        
        let bookings = [];
        if (bookingsRes && bookingsRes.success && Array.isArray(bookingsRes.data.bookings)) {
            bookings = bookingsRes.data.bookings;
        }

        const bookingCountEl = document.getElementById('profileTotalBookings');
        if (bookingCountEl) {
            bookingCountEl.textContent = bookings.length;
        }
        
        const paxCountEl = document.getElementById('profileSavedPax');
        if (paxCountEl && passengersRes && passengersRes.success && Array.isArray(passengersRes.data.passengers)) {
            paxCountEl.textContent = passengersRes.data.passengers.length;
        }

        // Dynamically compute user SkyMiles & Tier from flight bookings
        const totalMiles = bookings.reduce((sum, b) => {
            const fare = parseFloat(b.total_price || b.total_amount || 450);
            return sum + Math.round(fare * 10);
        }, 0);

        const milesEl = document.getElementById('profileSkyMiles');
        if (milesEl) {
            milesEl.textContent = totalMiles.toLocaleString();
        }

        const loyaltyMilesBalanceEl = document.getElementById('loyaltyMilesBalance');
        if (loyaltyMilesBalanceEl) {
            loyaltyMilesBalanceEl.textContent = totalMiles.toLocaleString();
        }

        // Dynamic Frequent Flyer Tier Calculation
        let tierName = 'SkyClub Blue Member';
        let currentTierLabel = 'Blue Tier (0)';
        let nextTierLabel = 'Silver (5,000)';
        let milesToNext = `${Math.max(0, 5000 - totalMiles).toLocaleString()} miles to Silver`;
        let progressPercent = Math.min(100, Math.max(10, Math.round((totalMiles / 5000) * 100)));

        if (totalMiles >= 30000) {
            tierName = 'SkyClub Platinum Elite';
            currentTierLabel = 'Platinum (30,000+)';
            nextTierLabel = 'VIP Diamond Status';
            milesToNext = 'Top Elite Tier Reached';
            progressPercent = 100;
        } else if (totalMiles >= 15000) {
            tierName = 'SkyClub Gold Member';
            currentTierLabel = 'Gold Tier (15,000)';
            nextTierLabel = 'Platinum (30,000)';
            milesToNext = `${Math.max(0, 30000 - totalMiles).toLocaleString()} miles to Platinum`;
            progressPercent = Math.min(100, Math.max(10, Math.round(((totalMiles - 15000) / 15000) * 100)));
        } else if (totalMiles >= 5000) {
            tierName = 'SkyClub Silver Member';
            currentTierLabel = 'Silver Tier (5,000)';
            nextTierLabel = 'Gold (15,000)';
            milesToNext = `${Math.max(0, 15000 - totalMiles).toLocaleString()} miles to Gold`;
            progressPercent = Math.min(100, Math.max(10, Math.round(((totalMiles - 5000) / 10000) * 100)));
        }

        const tierNameEl = document.getElementById('profileTierName');
        if (tierNameEl) tierNameEl.textContent = tierName;

        const loyaltyTierNameEl = document.getElementById('loyaltyTierName');
        if (loyaltyTierNameEl) loyaltyTierNameEl.textContent = tierName;

        const currentLabelEl = document.getElementById('loyaltyCurrentTierLabel');
        if (currentLabelEl) currentLabelEl.textContent = currentTierLabel;

        const nextLabelEl = document.getElementById('loyaltyNextTierLabel');
        if (nextLabelEl) nextLabelEl.textContent = nextTierLabel;

        const milesToNextEl = document.getElementById('loyaltyMilesToNext');
        if (milesToNextEl) milesToNextEl.textContent = milesToNext;

        const progressBarFillEl = document.getElementById('loyaltyProgressBarFill');
        if (progressBarFillEl) progressBarFillEl.style.width = `${progressPercent}%`;

    } catch (err) {
        console.error('Error updating profile quick stats:', err);
    }
}

function populateProfileForm(user) {
    const form = document.querySelector('#personal form');
    if (!form) return;
    
    if (form.querySelector('[name="firstName"]')) form.querySelector('[name="firstName"]').value = user.firstName || '';
    if (form.querySelector('[name="lastName"]')) form.querySelector('[name="lastName"]').value = user.lastName || '';
    if (form.querySelector('[name="email"]')) form.querySelector('[name="email"]').value = user.email || '';
    if (form.querySelector('[name="phone"]')) form.querySelector('[name="phone"]').value = user.phone || '';
    if (form.querySelector('[name="dob"]')) form.querySelector('[name="dob"]').value = user.dateOfBirth ? user.dateOfBirth.split('T')[0] : '';
    if (form.querySelector('[name="passportNumber"]')) form.querySelector('[name="passportNumber"]').value = user.passportNumber || '';
    if (form.querySelector('[name="nationality"]')) form.querySelector('[name="nationality"]').value = user.nationality || '';
    if (form.querySelector('[name="address"]')) form.querySelector('[name="address"]').value = user.address || '';
}

function updateProfileAvatar(user) {
    const avatarCircles = document.querySelectorAll('.avatar-circle');
    const heroNameElement = document.getElementById('profileHeroName');
    const heroEmailElement = document.getElementById('profileHeroEmail');
    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserEmail = document.getElementById('sidebarUserEmail');
    
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Valued Flyer';
    const initials = ((user.firstName?.[0] || '') + (user.lastName?.[0] || '')).toUpperCase() || 'U';

    avatarCircles.forEach(circle => {
        circle.textContent = initials;
    });

    if (heroNameElement) heroNameElement.textContent = fullName;
    if (heroEmailElement) heroEmailElement.textContent = user.email || 'user@skywings.com';
    if (sidebarUserName) sidebarUserName.textContent = fullName;
    if (sidebarUserEmail) sidebarUserEmail.textContent = user.email || '';
}

function showProfileSection(event, section) {
    if (event) {
        event.preventDefault();
    }

    const targetSection = document.getElementById(section);
    if (!targetSection) return;

    const navContainer = targetSection.closest('.profile-container');
    const navLinks = navContainer ? navContainer.querySelectorAll('.profile-nav .nav-link') : document.querySelectorAll('.profile-nav .nav-link');

    document.querySelectorAll('.profile-section').forEach(sec => {
        sec.classList.remove('active');
    });
    navLinks.forEach(link => link.classList.remove('active'));

    targetSection.classList.add('active');

    const trigger = event && event.currentTarget ? event.currentTarget : Array.from(navLinks).find(link => link.getAttribute('href') === `#${section}`);
    if (trigger) {
        trigger.classList.add('active');
    }
    
    // Load section-specific data
    if (section === 'bookings') {
        loadBookingHistory();
    } else if (section === 'passengers') {
        loadSavedPassengers();
    } else if (section === 'preferences') {
        loadPreferences();
    }
}

async function handleProfileUpdate(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const submitBtn = event.target.querySelector('button[type="submit"]');
    
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving Changes...';
    }
    
    const updateData = {
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        dateOfBirth: formData.get('dob'),
        passportNumber: formData.get('passportNumber'),
        nationality: formData.get('nationality'),
        address: formData.get('address')
    };
    
    try {
        const response = await apiRequest('/users/profile', {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });
        
        if (response.success) {
            alert('Profile updated successfully!');
            // Reload profile data
            await loadUserProfile();
            // Update client auth state user name
            authState.userName = `${updateData.firstName} ${updateData.lastName}`;
            const userNameEl = document.getElementById('userName');
            if (userNameEl) userNameEl.textContent = authState.userName;
        } else {
            alert(response.message || 'Failed to update profile');
        }
    } catch (error) {
        alert(error.message || 'Failed to update profile');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Changes';
        }
    }
}

async function handlePasswordChange(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const currentPassword = formData.get('currentPassword');
    const newPassword = formData.get('newPassword');
    const confirmPassword = formData.get('confirmPassword');
    const submitBtn = event.target.querySelector('button[type="submit"]');
    
    if (newPassword !== confirmPassword) {
        alert('New password and confirm password do not match!');
        return;
    }
    
    if (newPassword.length < 6) {
        alert('Password must be at least 6 characters long');
        return;
    }
    
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating Password...';
    }
    
    try {
        const response = await apiRequest('/users/password', {
            method: 'PUT',
            body: JSON.stringify({
                currentPassword,
                newPassword,
                confirmPassword
            })
        });
        
        if (response.success) {
            alert('Password changed successfully! Please use your new password next time you log in.');
            event.target.reset();
        } else {
            alert(response.message || 'Failed to change password');
        }
    } catch (error) {
        alert(error.message || 'Failed to change password');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Change Password';
        }
    }
}

async function loadBookingHistory() {
    const historyList = document.querySelector('#bookings .history-list');
    if (!historyList) return;
    
    try {
        historyList.innerHTML = '<div class="empty-state"><p>Loading your flight history from database...</p></div>';
        const response = await apiRequest('/bookings/list');
        if (response.success && response.data.bookings) {
            const bookings = response.data.bookings;
            
            if (bookings.length === 0) {
                historyList.innerHTML = `
                    <div class="empty-state" style="text-align: center; padding: 2.5rem 1rem;">
                        <span style="font-size: 2.5rem; display: block; margin-bottom: 0.75rem;">🛫</span>
                        <p style="font-size: 1.1rem; font-weight: 700; color: #ffffff; margin-bottom: 0.5rem;">No Bookings Found</p>
                        <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.25rem;">You haven't booked any flights yet.</p>
                        <a href="flight-search.html" class="btn btn-primary">Search & Book Flight →</a>
                    </div>
                `;
            } else {
                historyList.innerHTML = bookings.map(booking => {
                    const depDate = new Date(booking.departure_datetime);
                    const formattedDate = !isNaN(depDate.getTime()) ? depDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
                    const formattedTime = !isNaN(depDate.getTime()) ? depDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
                    
                    const statusClass = (booking.status || 'confirmed').toLowerCase().replace(/\s+/g, '-');
                    const isCheckedIn = booking.status === 'CHECKED_IN' || booking.status === 'checked_in';
                    const isConfirmed = booking.status === 'CONFIRMED' || booking.status === 'confirmed';
                    
                    return `
                        <div class="booking-history-card">
                            <div class="booking-history-header">
                                <div class="route-badge-box">
                                    <span class="route-flight-num">${booking.flight_number || 'SW-Flight'}</span>
                                    <h4>${booking.from_city || booking.from_airport_code} → ${booking.to_city || booking.to_airport_code}</h4>
                                </div>
                                <div class="booking-status-tag status-${statusClass}">
                                    ${(booking.status || 'CONFIRMED').toUpperCase()}
                                </div>
                            </div>
                            
                            <div class="booking-history-body">
                                <div class="bh-item">
                                    <span class="bh-label">Departure</span>
                                    <span class="bh-value">${formattedDate} ${formattedTime}</span>
                                </div>
                                <div class="bh-item">
                                    <span class="bh-label">Booking Reference</span>
                                    <span class="bh-value" style="color: #38bdf8; font-family: monospace;">${booking.booking_reference || 'N/A'}</span>
                                </div>
                                <div class="bh-item">
                                    <span class="bh-label">Total Amount</span>
                                    <span class="bh-value" style="color: #34d399;">$${parseFloat(booking.total_price || booking.total_amount || 0).toFixed(2)}</span>
                                </div>
                            </div>
                            
                            <div class="booking-history-actions">
                                ${isCheckedIn ? `
                                    <button type="button" class="btn btn-sm btn-primary" onclick="viewBoardingPassFromBooking('${booking.booking_reference}')">
                                        🎫 View Boarding Pass
                                    </button>
                                ` : isConfirmed ? `
                                    <a href="check-in.html?ref=${booking.booking_reference}" class="btn btn-sm btn-primary">
                                        ✈️ Online Check-in
                                    </a>
                                ` : ''}
                                <a href="my-bookings.html" class="btn btn-sm btn-secondary">Manage Booking</a>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    } catch (error) {
        console.error('Error loading booking history:', error);
        historyList.innerHTML = '<div class="empty-state"><p>Failed to load booking history</p></div>';
    }
}

async function loadSavedPassengers() {
    const passengersList = document.getElementById('passengersList');
    if (!passengersList) return;
    
    try {
        passengersList.innerHTML = '<div class="empty-state"><p>Loading companions...</p></div>';
        const response = await apiRequest('/users/passengers');
        if (response.success && response.data.passengers) {
            const passengers = response.data.passengers;
            
            if (passengers.length === 0) {
                passengersList.innerHTML = `
                    <div class="empty-state" style="text-align: center; padding: 2.5rem 1rem;">
                        <span style="font-size: 2.5rem; display: block; margin-bottom: 0.75rem;">👥</span>
                        <p style="font-size: 1.1rem; font-weight: 700; color: #ffffff; margin-bottom: 0.5rem;">No Saved Companions</p>
                        <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.25rem;">Add frequent travel companions for faster 1-click booking checkout.</p>
                        <button type="button" class="btn btn-primary" onclick="showAddPassengerModal()">+ Add Travel Companion</button>
                    </div>
                `;
            } else {
                passengersList.innerHTML = `
                    <div class="companion-grid">
                        ${passengers.map(p => {
                            const initials = ((p.first_name?.[0] || '') + (p.last_name?.[0] || '')).toUpperCase() || 'P';
                            const dob = p.date_of_birth ? new Date(p.date_of_birth).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not provided';
                            return `
                                <div class="companion-card">
                                    <div class="companion-top">
                                        <div class="companion-avatar">${initials}</div>
                                        <div class="companion-meta">
                                            <h4>${p.first_name} ${p.last_name}</h4>
                                            <span>${p.nationality || 'Verified Flyer'}</span>
                                        </div>
                                        <button type="button" class="btn-delete-companion" title="Delete Companion" onclick="deleteSavedPassenger(${p.passenger_id})">
                                            ✕
                                        </button>
                                    </div>
                                    <div class="companion-details">
                                        <div class="cd-row">
                                            <span class="cd-label">DOB:</span>
                                            <span class="cd-val">${dob}</span>
                                        </div>
                                        ${p.passport_number ? `
                                            <div class="cd-row">
                                                <span class="cd-label">Passport:</span>
                                                <span class="cd-val" style="font-family: monospace; color: #38bdf8;">${p.passport_number}</span>
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Error loading passengers:', error);
        passengersList.innerHTML = '<div class="empty-state"><p>Failed to load saved passengers</p></div>';
    }
}

function showAddPassengerModal() {
    let modal = document.getElementById('addPassengerModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'addPassengerModal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 520px;">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h2 style="font-size: 1.4rem; font-weight: 800; color: #ffffff; margin: 0;">Add Travel Companion</h2>
                    <button type="button" class="close-btn" onclick="closeAddPassengerModal()" style="background: none; border: none; font-size: 1.5rem; color: #94a3b8; cursor: pointer;">&times;</button>
                </div>
                <form id="addPassengerModalForm" onsubmit="handleModalAddPassenger(event)">
                    <div class="form-row">
                        <div class="form-group">
                            <label>First Name *</label>
                            <input type="text" name="firstName" required placeholder="John">
                        </div>
                        <div class="form-group">
                            <label>Last Name *</label>
                            <input type="text" name="lastName" required placeholder="Doe">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Date of Birth</label>
                        <input type="date" name="dateOfBirth">
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Passport Number</label>
                            <input type="text" name="passportNumber" placeholder="A12345678">
                        </div>
                        <div class="form-group">
                            <label>Nationality</label>
                            <input type="text" name="nationality" placeholder="United States">
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px; margin-top: 1.5rem;">
                        <button type="button" class="btn btn-secondary flex-1" onclick="closeAddPassengerModal()">Cancel</button>
                        <button type="submit" class="btn btn-primary flex-1">Save Companion</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    const form = document.getElementById('addPassengerModalForm');
    if (form) form.reset();
    modal.style.display = 'flex';
}

function closeAddPassengerModal() {
    const modal = document.getElementById('addPassengerModal');
    if (modal) modal.style.display = 'none';
}

async function handleModalAddPassenger(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    
    const payload = {
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        dateOfBirth: formData.get('dateOfBirth') || null,
        passportNumber: formData.get('passportNumber') || null,
        nationality: formData.get('nationality') || null
    };
    
    try {
        const response = await apiRequest('/users/passengers', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        if (response.success) {
            alert('Companion added successfully!');
            closeAddPassengerModal();
            loadSavedPassengers();
            updateProfileQuickStats();
        } else {
            alert(response.message || 'Failed to add companion');
        }
    } catch (error) {
        alert(error.message || 'Failed to add companion');
    }
}

async function deleteSavedPassenger(passengerId) {
    if (!confirm('Are you sure you want to remove this travel companion?')) return;
    
    try {
        const response = await apiRequest(`/users/passengers/${passengerId}`, {
            method: 'DELETE'
        });
        
        if (response.success) {
            loadSavedPassengers();
            updateProfileQuickStats();
        } else {
            alert(response.message || 'Failed to remove companion');
        }
    } catch (error) {
        alert(error.message || 'Failed to remove companion');
    }
}

async function loadPreferences() {
    const form = document.querySelector('#preferences form');
    if (!form) return;

    try {
        const response = await apiRequest('/users/preferences');
        if (response.success && response.data) {
            if (form.querySelector('[name="preferredSeat"]')) {
                form.querySelector('[name="preferredSeat"]').value = response.data.preferredSeat || 'window';
            }
            if (form.querySelector('[name="mealPreference"]')) {
                form.querySelector('[name="mealPreference"]').value = response.data.mealPreference || 'non-vegetarian';
            }
            if (form.querySelector('[name="newsletter"]')) {
                form.querySelector('[name="newsletter"]').checked = !!response.data.newsletter;
            }
            return;
        }
    } catch (err) {
        // ignore
    }
}

async function handlePreferencesSave(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const submitBtn = event.target.querySelector('button[type="submit"]');

    const payload = {
        preferredSeat: formData.get('preferredSeat'),
        mealPreference: formData.get('mealPreference'),
        newsletter: !!formData.get('newsletter')
    };

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving Preferences...';
    }

    try {
        const response = await apiRequest('/users/preferences', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (response.success) {
            alert('Flight preferences saved successfully!');
            return;
        } else {
            alert(response.message || 'Failed to save preferences');
        }
    } catch (err) {
        alert(err.message || 'Failed to save preferences');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Preferences';
        }
    }
}

// ========== ADMIN FUNCTIONS ==========

async function populateFlightAircraftDropdown(selectElement, selectedAircraftId = null) {
    if (!selectElement) return;
    try {
        const res = await apiRequest('/admin/aircraft');
        if (res && res.success && res.data && res.data.aircraft && res.data.aircraft.length > 0) {
            selectElement.innerHTML = '';
            res.data.aircraft.forEach(ac => {
                const opt = document.createElement('option');
                opt.value = ac.aircraft_id;
                opt.textContent = `${ac.model} (${ac.registration}) - ${ac.capacity} seats`;
                if (selectedAircraftId && String(ac.aircraft_id) === String(selectedAircraftId)) {
                    opt.selected = true;
                }
                selectElement.appendChild(opt);
            });
        }
    } catch (err) {
        console.warn('Could not populate aircraft dropdown:', err.message);
    }
}

async function showAddFlightModal() {
    const form = document.querySelector('#flightModal form');
    if (form) {
        form.reset();
        delete form.dataset.flightId;
        
        await fetchDatabaseAirports();
        const fromSelect = form.querySelector('[name="from"]');
        const toSelect = form.querySelector('[name="to"]');
        if (fromSelect && toSelect) {
            renderAirportSelectOptions(fromSelect, '', 'Select Departure Airport');
            renderAirportSelectOptions(toSelect, '', 'Select Arrival Airport');
        }
        const aircraftSelect = form.querySelector('[name="aircraftId"]');
        if (aircraftSelect) {
            await populateFlightAircraftDropdown(aircraftSelect);
        }
    }
    document.getElementById('modalTitle').textContent = 'Add New Flight';
    document.getElementById('flightModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('flightModal').style.display = 'none';
}

async function handleFlightSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const form = event.target;
    const flightId = form.dataset.flightId;
    
    const flightNumber = formData.get('flightNumber');
    const from = formData.get('from');
    const to = formData.get('to');
    const departure = formData.get('departure');
    const arrival = formData.get('arrival');
    const basePrice = formData.get('basePrice');
    const businessPrice = formData.get('businessPrice');
    const firstClassPrice = formData.get('firstClassPrice');
    const aircraftId = formData.get('aircraftId');
    const status = formData.get('status') || 'scheduled';
    
    // Validate required fields
    if (!flightNumber || !from || !to || !departure || !basePrice || !aircraftId) {
        alert('Please fill in all required fields: Flight Number, From, To, Departure, Base Price, and Aircraft');
        return;
    }
    
    // Convert datetime-local to MySQL datetime format (YYYY-MM-DD HH:mm:ss)
    let departureDateTime = null;
    if (departure) {
        if (departure.includes('T')) {
            departureDateTime = departure.replace('T', ' ') + ':00';
        } else {
            const depDate = new Date(departure);
            if (!isNaN(depDate.getTime())) {
                const year = depDate.getFullYear();
                const month = String(depDate.getMonth() + 1).padStart(2, '0');
                const day = String(depDate.getDate()).padStart(2, '0');
                const hours = String(depDate.getHours()).padStart(2, '0');
                const minutes = String(depDate.getMinutes()).padStart(2, '0');
                departureDateTime = `${year}-${month}-${day} ${hours}:${minutes}:00`;
            } else {
                alert('Invalid departure date format');
                return;
            }
        }
    }
    
    let arrivalDateTime = null;
    if (!arrival && departure) {
        const depDate = new Date(departure);
        depDate.setHours(depDate.getHours() + 6);
        const year = depDate.getFullYear();
        const month = String(depDate.getMonth() + 1).padStart(2, '0');
        const day = String(depDate.getDate()).padStart(2, '0');
        const hours = String(depDate.getHours()).padStart(2, '0');
        const minutes = String(depDate.getMinutes()).padStart(2, '0');
        arrivalDateTime = `${year}-${month}-${day} ${hours}:${minutes}:00`;
    } else if (arrival) {
        if (arrival.includes('T')) {
            arrivalDateTime = arrival.replace('T', ' ') + ':00';
        } else {
            const arrDate = new Date(arrival);
            if (!isNaN(arrDate.getTime())) {
                const year = arrDate.getFullYear();
                const month = String(arrDate.getMonth() + 1).padStart(2, '0');
                const day = String(arrDate.getDate()).padStart(2, '0');
                const hours = String(arrDate.getHours()).padStart(2, '0');
                const minutes = String(arrDate.getMinutes()).padStart(2, '0');
                arrivalDateTime = `${year}-${month}-${day} ${hours}:${minutes}:00`;
            } else {
                alert('Invalid arrival date format');
                return;
            }
        }
    }
    
    // Prepare payload
    const payload = {
        flight_number: flightNumber,
        from_airport_code: from,
        to_airport_code: to,
        departure_datetime: departureDateTime,
        arrival_datetime: arrivalDateTime,
        base_price: parseFloat(basePrice),
        business_price: businessPrice ? parseFloat(businessPrice) : parseFloat(basePrice) * 1.5,
        first_class_price: firstClassPrice ? parseFloat(firstClassPrice) : parseFloat(basePrice) * 2.0,
        aircraft_id: parseInt(aircraftId),
        status: status
    };
    
    try {
        let response;
        if (flightId) {
            response = await apiRequest(`/admin/flights/${flightId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } else {
            response = await apiRequest('/admin/flights', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }
        
        if (response && response.success) {
            alert(flightId ? 'Flight updated successfully!' : 'Flight added successfully!');
            closeModal();
            form.reset();
            delete form.dataset.flightId;
            // Reload flights immediately
            await loadAdminFlights();
        } else {
            throw new Error(response?.message || 'Failed to save flight');
        }
    } catch (error) {
        alert(error.message || 'Failed to save flight');
    }
}

async function editFlight(flightId) {
    try {
        await fetchDatabaseAirports();
        const response = await apiRequest(`/flights/${flightId}`);
        if (response.success && response.data.flight) {
            const flight = response.data.flight;
            const form = document.querySelector('#flightModal form');
            form.dataset.flightId = flightId;
            
            const fromSelect = form.querySelector('[name="from"]');
            const toSelect = form.querySelector('[name="to"]');
            if (fromSelect && toSelect) {
                renderAirportSelectOptions(fromSelect, flight.to_airport_code, 'Select Departure Airport');
                fromSelect.value = flight.from_airport_code;
                renderAirportSelectOptions(toSelect, flight.from_airport_code, 'Select Arrival Airport');
                toSelect.value = flight.to_airport_code;
            }

            const aircraftSelect = form.querySelector('[name="aircraftId"]');
            if (aircraftSelect) {
                await populateFlightAircraftDropdown(aircraftSelect, flight.aircraft_id);
            }
            
            form.querySelector('[name="flightNumber"]').value = flight.flight_number;
            form.querySelector('[name="departure"]').value = new Date(flight.departure_datetime).toISOString().slice(0, 16);
            form.querySelector('[name="arrival"]').value = new Date(flight.arrival_datetime).toISOString().slice(0, 16);
            form.querySelector('[name="basePrice"]').value = flight.base_price;
            form.querySelector('[name="businessPrice"]').value = flight.business_price;
            form.querySelector('[name="firstClassPrice"]').value = flight.first_class_price;
            form.querySelector('[name="status"]').value = flight.status;
            
            document.getElementById('modalTitle').textContent = 'Edit Flight';
            document.getElementById('flightModal').style.display = 'flex';
        }
    } catch (error) {
        alert('Failed to load flight details: ' + error.message);
    }
}

async function deleteFlight(flightId) {
    if (!confirm(`Are you sure you want to delete or cancel flight ${flightId}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await apiRequest(`/admin/flights/${flightId}`, {
            method: 'DELETE'
        });
        
        if (response && response.success) {
            alert('✅ Flight deleted successfully!');
            await loadAdminFlights(adminFlightsState?.currentPage || 1, '');
        } else {
            throw new Error(response?.message || 'Failed to delete flight');
        }
    } catch (error) {
        console.error('Delete flight error:', error);
        
        // Handle policy rule restriction if flight has active bookings
        if (error.message && error.message.includes('active booking')) {
            const executeDisruption = confirm(
                `⚠️ Policy Rule Restriction:\n\n${error.message}\n\nWould you like to execute an Enterprise Flight Disruption Cancellation to safely cancel all active bookings, release seats, and queue passenger notifications?`
            );
            
            if (executeDisruption) {
                const reason = prompt('Enter operational reason for flight cancellation:', 'Severe operational cancellation');
                if (reason && reason.trim()) {
                    try {
                        const disruptRes = await apiRequest('/admin/disruptions/execute', {
                            method: 'POST',
                            body: JSON.stringify({
                                flight_id: flightId,
                                disruption_type: 'CANCELLATION',
                                reason: reason.trim()
                            })
                        });
                        if (disruptRes.success) {
                            alert('✅ Flight Disruption Cancellation executed successfully! All active bookings have been safely cancelled and queued for notification.');
                            await loadAdminFlights(adminFlightsState?.currentPage || 1, '');
                        } else {
                            alert(`⚠️ Disruption Execution Failed:\n\n${disruptRes.message}`);
                        }
                    } catch (dErr) {
                        alert(`⚠️ Disruption Error:\n\n${dErr.message}`);
                    }
                }
            }
        } else {
            alert(`⚠️ Policy Violation / Delete Error:\n\n${error.message || 'Failed to delete flight.'}`);
        }
    }
}

let adminFlightsState = {
    upcomingPage: 1,
    pastPage: 1,
    pageSize: 20,
    upcomingList: [],
    pastList: []
};

async function loadAdminFlights(page = 1, searchQuery = '') {
    const upcomingTbody = document.querySelector('#adminUpcomingFlightsTable tbody');
    const pastTbody = document.querySelector('#adminPastFlightsTable tbody');
    
    if (!upcomingTbody && !pastTbody) return;
    
    if (upcomingTbody) upcomingTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">🔄 Syncing upcoming flights...</td></tr>';
    if (pastTbody) pastTbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">🔄 Syncing past flights...</td></tr>';
    
    try {
        const params = new URLSearchParams({
            page: '1',
            limit: '500'
        });
        
        if (searchQuery) {
            params.append('search', searchQuery);
        }
        
        const response = await apiRequest(`/admin/flights?${params}`);
        
        if (!response || !response.success || !response.data) {
            throw new Error(response?.message || 'Failed to load flights');
        }
        
        const flights = response.data.flights || [];
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        adminFlightsState.upcomingList = [];
        adminFlightsState.pastList = [];

        flights.forEach(flight => {
            const depTime = flight.departure_datetime ? new Date(flight.departure_datetime) : null;
            const status = (flight.status || '').toLowerCase();
            const isCancelled = status === 'cancelled';
            const isCompleted = status === 'completed';

            if (depTime && !isNaN(depTime) && depTime >= startOfToday && !isCancelled && !isCompleted) {
                adminFlightsState.upcomingList.push(flight);
            } else {
                adminFlightsState.pastList.push(flight);
            }
        });

        // Sort upcoming flights chronologically from earliest to latest
        adminFlightsState.upcomingList.sort((a, b) => new Date(a.departure_datetime) - new Date(b.departure_datetime));
        // Sort past flights descending from most recent to oldest
        adminFlightsState.pastList.sort((a, b) => new Date(b.departure_datetime) - new Date(a.departure_datetime));

        const upcomingBadge = document.getElementById('upcomingFlightsCountBadge');
        const pastBadge = document.getElementById('pastFlightsCountBadge');
        if (upcomingBadge) upcomingBadge.textContent = adminFlightsState.upcomingList.length;
        if (pastBadge) pastBadge.textContent = adminFlightsState.pastList.length;

        renderAdminFlightsUpcomingPage(1);
        renderAdminFlightsPastPage(1);

    } catch (error) {
        console.error('Error loading flights:', error);
        const errHtml = `<tr><td colspan="6" style="text-align: center; color: red; padding: 20px;">⚠️ Error loading flights: ${error.message}</td></tr>`;
        if (upcomingTbody) upcomingTbody.innerHTML = errHtml;
        if (pastTbody) pastTbody.innerHTML = errHtml;
    }
}

function renderAdminFlightsUpcomingPage(page) {
    adminFlightsState.upcomingPage = page;
    const tbody = document.querySelector('#adminUpcomingFlightsTable tbody');
    const paginationContainer = document.getElementById('upcomingFlightsPagination');
    if (!tbody) return;

    const list = adminFlightsState.upcomingList || [];
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 25px;">No upcoming scheduled flights found in database.</td></tr>';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(list.length / adminFlightsState.pageSize);
    const startIdx = (page - 1) * adminFlightsState.pageSize;
    const pageItems = list.slice(startIdx, startIdx + adminFlightsState.pageSize);

    renderFlightRowsHelper(pageItems, tbody);

    if (paginationContainer) {
        if (totalPages <= 1) {
            paginationContainer.innerHTML = '';
        } else {
            paginationContainer.innerHTML = `
                <span style="color: #94a3b8; font-size: 0.85rem; margin-right: 8px;">Page ${page} of ${totalPages} (${list.length} total)</span>
                <button class="btn btn-sm btn-secondary" ${page <= 1 ? 'disabled' : ''} onclick="renderAdminFlightsUpcomingPage(${page - 1})">Previous</button>
                <button class="btn btn-sm btn-secondary" ${page >= totalPages ? 'disabled' : ''} onclick="renderAdminFlightsUpcomingPage(${page + 1})">Next</button>
            `;
        }
    }
}

function renderAdminFlightsPastPage(page) {
    adminFlightsState.pastPage = page;
    const tbody = document.querySelector('#adminPastFlightsTable tbody');
    const paginationContainer = document.getElementById('pastFlightsPagination');
    if (!tbody) return;

    const list = adminFlightsState.pastList || [];
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 25px;">No past flight records found in database.</td></tr>';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(list.length / adminFlightsState.pageSize);
    const startIdx = (page - 1) * adminFlightsState.pageSize;
    const pageItems = list.slice(startIdx, startIdx + adminFlightsState.pageSize);

    renderFlightRowsHelper(pageItems, tbody);

    if (paginationContainer) {
        if (totalPages <= 1) {
            paginationContainer.innerHTML = '';
        } else {
            paginationContainer.innerHTML = `
                <span style="color: #94a3b8; font-size: 0.85rem; margin-right: 8px;">Page ${page} of ${totalPages} (${list.length} total)</span>
                <button class="btn btn-sm btn-secondary" ${page <= 1 ? 'disabled' : ''} onclick="renderAdminFlightsPastPage(${page - 1})">Previous</button>
                <button class="btn btn-sm btn-secondary" ${page >= totalPages ? 'disabled' : ''} onclick="renderAdminFlightsPastPage(${page + 1})">Next</button>
            `;
        }
    }
}

function renderFlightRowsHelper(flights, tbodyElement) {
    const fragment = document.createDocumentFragment();
    flights.forEach(flight => {
        const dep = new Date(flight.departure_datetime);
        const arr = new Date(flight.arrival_datetime);
        const fromCity = flight.from_city || flight.from_name || flight.from_airport_code || 'N/A';
        const toCity = flight.to_city || flight.to_name || flight.to_airport_code || 'N/A';
        const status = (flight.status || 'scheduled').toLowerCase();
        
        const tr = document.createElement('tr');
        tr.setAttribute('data-status', status);
        tr.innerHTML = `
            <td><strong style="color: #cbd5e1;">${flight.flight_id}</strong></td>
            <td><strong style="color: #38bdf8; font-weight: 700;">${flight.flight_number}</strong><br><small style="color: #cbd5e1; font-size: 0.82rem;">${fromCity} → ${toCity}</small></td>
            <td><span style="color: #e2e8f0; font-size: 0.88rem;">${!isNaN(dep) ? dep.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}</span></td>
            <td><span style="color: #e2e8f0; font-size: 0.88rem;">${!isNaN(arr) ? arr.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}</span></td>
            <td><span class="status-badge status-${status}">${status.toUpperCase()}</span></td>
            <td>
                <div class="action-btn-group" style="display: flex; gap: 6px; align-items: center;">
                    <button class="btn btn-sm btn-secondary" onclick="editFlight(${flight.flight_id})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteFlight(${flight.flight_id})">Delete</button>
                </div>
            </td>
        `;
        fragment.appendChild(tr);
    });
    tbodyElement.innerHTML = '';
    tbodyElement.appendChild(fragment);
}

function updatePaginationControls() {
    let paginationContainer = document.getElementById('flightsPagination');
    
    if (!paginationContainer) {
        // Create pagination container if it doesn't exist
        const toolbar = document.querySelector('#flightsTab .admin-toolbar');
        if (toolbar) {
            paginationContainer = document.createElement('div');
            paginationContainer.id = 'flightsPagination';
            paginationContainer.className = 'pagination-controls';
            toolbar.appendChild(paginationContainer);
        }
    }
    
    if (paginationContainer && adminFlightsState.totalPages > 1) {
        let paginationHTML = '<div style="display: flex; gap: 10px; align-items: center; margin-top: 10px;">';
        paginationHTML += `<span>Page ${adminFlightsState.currentPage} of ${adminFlightsState.totalPages}</span>`;
        
        if (adminFlightsState.currentPage > 1) {
            paginationHTML += `<button class="btn btn-sm" onclick="loadAdminFlights(${adminFlightsState.currentPage - 1})">Previous</button>`;
        }
        
        if (adminFlightsState.currentPage < adminFlightsState.totalPages) {
            paginationHTML += `<button class="btn btn-sm" onclick="loadAdminFlights(${adminFlightsState.currentPage + 1})">Next</button>`;
        }
        
        paginationHTML += '</div>';
        paginationContainer.innerHTML = paginationHTML;
    } else if (paginationContainer) {
        paginationContainer.innerHTML = '';
    }
}

let adminBookingsState = {
    upcomingPage: 1,
    pastPage: 1,
    pageSize: 20,
    upcomingList: [],
    pastList: []
};

async function loadAdminBookings() {
    const upcomingTbody = document.querySelector('#adminUpcomingBookingsTable tbody');
    const pastTbody = document.querySelector('#adminPastBookingsTable tbody');
    if (!upcomingTbody && !pastTbody) return;
    
    if (upcomingTbody) upcomingTbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 20px;">🔄 Syncing upcoming bookings from database...</td></tr>';
    if (pastTbody) pastTbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 20px;">🔄 Syncing past bookings from database...</td></tr>';
    
    try {
        const response = await apiRequest('/admin/bookings');
        if (response.success && response.data && response.data.bookings) {
            const allBookings = response.data.bookings || [];
            
            let totalCount = allBookings.length;
            let upcomingCount = 0;
            let confirmedCount = 0;
            let pendingCount = 0;
            let cancelledCount = 0;
            
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);

            adminBookingsState.allUpcoming = [];
            adminBookingsState.allPast = [];

            allBookings.forEach(booking => {
                let status = (booking.status || 'pending').toLowerCase();
                if (status === 'completed' || status === 'boarded' || status === 'checked_in') {
                    status = 'confirmed';
                }

                if (status === 'confirmed') confirmedCount++;
                else if (status === 'pending') pendingCount++;
                else if (status === 'cancelled') cancelledCount++;
                else if (status === 'expired') {}

                const depTime = booking.departure_datetime ? new Date(booking.departure_datetime) : new Date(booking.booking_date);
                if (!isNaN(depTime) && depTime >= startOfToday) {
                    adminBookingsState.allUpcoming.push(booking);
                    upcomingCount++;
                } else {
                    adminBookingsState.allPast.push(booking);
                }
            });

            // Sort upcoming bookings chronologically from earliest to latest
            adminBookingsState.allUpcoming.sort((a, b) => {
                const timeA = new Date(a.departure_datetime || a.booking_date).getTime();
                const timeB = new Date(b.departure_datetime || b.booking_date).getTime();
                return timeA - timeB;
            });
            // Sort past bookings descending
            adminBookingsState.allPast.sort((a, b) => {
                const timeA = new Date(a.departure_datetime || a.booking_date).getTime();
                const timeB = new Date(b.departure_datetime || b.booking_date).getTime();
                return timeB - timeA;
            });

            // Update stats grid values dynamically without hardcoding
            const statTotal = document.getElementById('statTotalBookings');
            const statUpcoming = document.getElementById('statUpcomingBookings');
            const statConfirmed = document.getElementById('statConfirmedBookings');
            const statPending = document.getElementById('statPendingBookings');
            const statCancelled = document.getElementById('statCancelledBookings');

            if (statTotal) statTotal.textContent = totalCount;
            if (statUpcoming) statUpcoming.textContent = upcomingCount;
            if (statConfirmed) statConfirmed.textContent = confirmedCount;
            if (statPending) statPending.textContent = pendingCount;
            if (statCancelled) statCancelled.textContent = cancelledCount;

            applyAdminBookingFilters();
        } else {
            throw new Error(response.message || 'Failed to load bookings dataset.');
        }
    } catch (error) {
        console.error('Error loading admin bookings:', error);
        const errHtml = `<tr><td colspan="7" style="text-align: center; color: #f87171; padding: 25px;">⚠️ Database error: ${error.message}</td></tr>`;
        if (upcomingTbody) upcomingTbody.innerHTML = errHtml;
        if (pastTbody) pastTbody.innerHTML = errHtml;
    }
}

function applyAdminBookingFilters() {
    const statusSelect = document.getElementById('adminBookingStatusFilter');
    const searchInput = document.getElementById('adminBookingSearchInput');
    
    const targetStatus = statusSelect ? statusSelect.value.toLowerCase().trim() : 'all';
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filterFn = (b) => {
        let bStatus = (b.status || 'pending').toLowerCase();
        if (bStatus === 'completed') {
            bStatus = 'boarded';
        }

        let matchesStatus = true;
        if (targetStatus !== 'all') {
            matchesStatus = bStatus === targetStatus;
        }

        let matchesSearch = true;
        if (query) {
            const ref = (b.booking_reference || '').toLowerCase();
            const fn = (b.user_first_name || '').toLowerCase();
            const ln = (b.user_last_name || '').toLowerCase();
            const email = (b.user_email || '').toLowerCase();
            const flt = (b.flight_number || '').toLowerCase();
            const fCode = (b.from_code || '').toLowerCase();
            const tCode = (b.to_code || '').toLowerCase();
            const fCity = (b.from_city || b.from_name || '').toLowerCase();
            const tCity = (b.to_city || b.to_name || '').toLowerCase();
            matchesSearch = ref.includes(query) || fn.includes(query) || ln.includes(query) || email.includes(query) || flt.includes(query) || fCode.includes(query) || tCode.includes(query) || fCity.includes(query) || tCity.includes(query);
        }

        return matchesStatus && matchesSearch;
    };

    adminBookingsState.upcomingList = (adminBookingsState.allUpcoming || []).filter(filterFn);
    adminBookingsState.pastList = (adminBookingsState.allPast || []).filter(filterFn);

    const upcomingBadge = document.getElementById('upcomingBookingsCountBadge');
    const pastBadge = document.getElementById('pastBookingsCountBadge');
    if (upcomingBadge) upcomingBadge.textContent = adminBookingsState.upcomingList.length;
    if (pastBadge) pastBadge.textContent = adminBookingsState.pastList.length;

    renderAdminBookingsUpcomingPage(1);
    renderAdminBookingsPastPage(1);
}

function renderAdminBookingsUpcomingPage(page) {
    adminBookingsState.upcomingPage = page;
    const tbody = document.querySelector('#adminUpcomingBookingsTable tbody');
    const paginationContainer = document.getElementById('upcomingBookingsPagination');
    if (!tbody) return;

    const list = adminBookingsState.upcomingList || [];
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 25px; font-weight: 500;">No upcoming bookings found in database.</td></tr>';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(list.length / adminBookingsState.pageSize);
    const startIdx = (page - 1) * adminBookingsState.pageSize;
    const pageItems = list.slice(startIdx, startIdx + adminBookingsState.pageSize);

    renderBookingRowsHelper(pageItems, tbody);

    if (paginationContainer) {
        if (totalPages <= 1) {
            paginationContainer.innerHTML = '';
        } else {
            paginationContainer.innerHTML = `
                <span style="color: #94a3b8; font-size: 0.85rem; margin-right: 8px;">Page ${page} of ${totalPages} (${list.length} total)</span>
                <button class="btn btn-sm btn-secondary" ${page <= 1 ? 'disabled' : ''} onclick="renderAdminBookingsUpcomingPage(${page - 1})">Previous</button>
                <button class="btn btn-sm btn-secondary" ${page >= totalPages ? 'disabled' : ''} onclick="renderAdminBookingsUpcomingPage(${page + 1})">Next</button>
            `;
        }
    }
}

function renderAdminBookingsPastPage(page) {
    adminBookingsState.pastPage = page;
    const tbody = document.querySelector('#adminPastBookingsTable tbody');
    const paginationContainer = document.getElementById('pastBookingsPagination');
    if (!tbody) return;

    const list = adminBookingsState.pastList || [];
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 25px; font-weight: 500;">No past booking records found in database.</td></tr>';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(list.length / adminBookingsState.pageSize);
    const startIdx = (page - 1) * adminBookingsState.pageSize;
    const pageItems = list.slice(startIdx, startIdx + adminBookingsState.pageSize);

    renderBookingRowsHelper(pageItems, tbody);

    if (paginationContainer) {
        if (totalPages <= 1) {
            paginationContainer.innerHTML = '';
        } else {
            paginationContainer.innerHTML = `
                <span style="color: #94a3b8; font-size: 0.85rem; margin-right: 8px;">Page ${page} of ${totalPages} (${list.length} total)</span>
                <button class="btn btn-sm btn-secondary" ${page <= 1 ? 'disabled' : ''} onclick="renderAdminBookingsPastPage(${page - 1})">Previous</button>
                <button class="btn btn-sm btn-secondary" ${page >= totalPages ? 'disabled' : ''} onclick="renderAdminBookingsPastPage(${page + 1})">Next</button>
            `;
        }
    }
}

let adminBookingsGroupByFlight = true;

function setBookingGrouping(isGrouped) {
    adminBookingsGroupByFlight = isGrouped;
    const btnGroup = document.getElementById('btnGroupBookings');
    const btnFlat = document.getElementById('btnFlatBookings');
    if (btnGroup && btnFlat) {
        if (isGrouped) {
            btnGroup.className = 'btn btn-sm btn-primary';
            btnFlat.className = 'btn btn-sm btn-secondary';
        } else {
            btnGroup.className = 'btn btn-sm btn-secondary';
            btnFlat.className = 'btn btn-sm btn-primary';
        }
    }
    renderAdminBookingsUpcomingPage(adminBookingsState.upcomingPage || 1);
    renderAdminBookingsPastPage(adminBookingsState.pastPage || 1);
}

function createSingleBookingRow(booking) {
    const depDate = booking.departure_datetime ? new Date(booking.departure_datetime) : (booking.booking_date ? new Date(booking.booking_date) : null);
    const formattedDep = depDate && !isNaN(depDate) 
        ? depDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'N/A';
    
    const isFutureFlight = depDate && !isNaN(depDate) && depDate.getTime() > Date.now();

    let status = (booking.status || 'pending').toLowerCase();
    if (status === 'completed') {
        status = 'boarded';
    }

    let badgeLabel = status.toUpperCase();
    if (status === 'boarded') badgeLabel = '✈️ BOARDED';
    else if (status === 'missed') badgeLabel = '⚠️ MISSED';
    else if (status === 'checked_in') badgeLabel = '✅ CHECKED IN';
    else if (status === 'pending') badgeLabel = '⏳ PENDING';
    else if (status === 'cancelled') badgeLabel = '🚫 CANCELLED';

    // Action Rules:
    // - Rebook & Confirm: Allowed ONLY on future cancelled/pending reservations (Strictly disabled for past flights and expired holds)
    // - Cancel: Allowed ONLY on future active confirmed/pending reservations
    // - Expired/Past/Missed/Boarded bookings: Render View only
    const canCancel = (status === 'confirmed' || status === 'pending' || status === 'checked_in') && isFutureFlight;
    const canConfirm = (status === 'cancelled' || status === 'pending') && isFutureFlight;
    const reasonTag = booking.state_change_reason ? `<br><small style="color: #94a3b8; font-size: 0.75rem;">(${booking.state_change_reason})</small>` : '';
    
    const tr = document.createElement('tr');
    tr.setAttribute('data-status', status);
    tr.innerHTML = `
        <td data-label="Booking Ref" style="text-align: left;"><strong style="color: #f8fafc; font-weight: 700; letter-spacing: 0.02em;">${booking.booking_reference || 'N/A'}</strong></td>
        <td data-label="User" style="text-align: left;"><span style="color: #f1f5f9; font-weight: 600;">${(booking.user_first_name || '')} ${(booking.user_last_name || '')}</span><br><small style="color: #94a3b8; font-size: 0.82rem;">${booking.user_email || 'No email'}</small></td>
        <td data-label="Flight" style="text-align: left;"><strong style="color: #38bdf8; font-weight: 600;">${booking.flight_number || 'N/A'}</strong><br><small style="color: #cbd5e1; font-size: 0.82rem;">${booking.from_code || ''} → ${booking.to_code || ''}</small></td>
        <td data-label="Departure Date" style="text-align: left;"><span style="color: #e2e8f0; font-size: 0.9rem;">${formattedDep}</span></td>
        <td data-label="Amount" style="text-align: right;"><strong style="color: #34d399; font-size: 0.95rem;">$${parseFloat(booking.total_amount || 0).toFixed(2)}</strong></td>
        <td data-label="Status" style="text-align: center;"><span class="status-badge status-${status}">${badgeLabel}</span>${reasonTag}</td>
        <td data-label="Actions" style="text-align: right;">
            <div class="action-btn-group" style="display: flex; gap: 6px; align-items: center; justify-content: flex-end;">
                <button class="btn btn-sm btn-secondary" onclick="viewBookingDetails(${booking.booking_id})">View</button>
                ${canConfirm ? `<button class="btn btn-sm btn-success" style="background: #059669; color: #fff; border: none; font-size: 0.78rem; padding: 4px 8px; border-radius: 6px;" onclick="adminConfirmBooking(${booking.booking_id})">Rebook & Confirm</button>` : ''}
                ${canCancel ? `<button class="btn btn-sm btn-danger" onclick="adminCancelBooking(${booking.booking_id})">Cancel</button>` : ''}
            </div>
        </td>
    `;
    return tr;
}

function renderBookingRowsHelper(bookings, tbodyElement) {
    if (!tbodyElement) return;
    const fragment = document.createDocumentFragment();

    if (!adminBookingsGroupByFlight) {
        bookings.forEach(b => fragment.appendChild(createSingleBookingRow(b)));
    } else {
        const flightMap = new Map();
        bookings.forEach(b => {
            const key = `${b.flight_number || 'FLIGHT'}_${b.departure_datetime || ''}`;
            if (!flightMap.has(key)) {
                flightMap.set(key, {
                    flight_number: b.flight_number || 'N/A',
                    from_code: b.from_code || '',
                    to_code: b.to_code || '',
                    departure_datetime: b.departure_datetime || b.booking_date,
                    bookings: [],
                    totalRevenue: 0
                });
            }
            const group = flightMap.get(key);
            group.bookings.push(b);
            if ((b.status || '').toLowerCase() === 'confirmed') {
                group.totalRevenue += parseFloat(b.total_amount || 0);
            }
        });

        flightMap.forEach(group => {
            const depDate = group.departure_datetime ? new Date(group.departure_datetime) : null;
            const formattedDep = depDate && !isNaN(depDate) 
                ? depDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'N/A';
            const routeText = group.from_code && group.to_code ? `${group.from_code} → ${group.to_code}` : 'Route';

            const headerTr = document.createElement('tr');
            headerTr.className = 'flight-group-header-row';
            headerTr.innerHTML = `
                <td colspan="7" style="padding: 9px 14px; background: linear-gradient(90deg, rgba(2, 132, 199, 0.28), rgba(15, 23, 42, 0.9)); border-top: 2px solid rgba(56, 189, 248, 0.45); border-bottom: 1px solid rgba(56, 189, 248, 0.18);">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                            <span style="background: rgba(56, 189, 248, 0.22); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.45); font-size: 0.88rem; font-weight: 800; padding: 3px 10px; border-radius: 8px; letter-spacing: 0.04em;">✈️ Flight ${group.flight_number}</span>
                            <strong style="color: #f8fafc; font-size: 0.92rem; font-weight: 700;">${routeText}</strong>
                            <span style="color: #94a3b8; font-size: 0.82rem;">📅 ${formattedDep}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="background: rgba(255, 255, 255, 0.08); color: #e2e8f0; font-size: 0.78rem; font-weight: 700; padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.12);">👥 ${group.bookings.length} Booking${group.bookings.length === 1 ? '' : 's'}</span>
                            <span style="background: rgba(16, 185, 129, 0.16); color: #34d399; font-size: 0.82rem; font-weight: 800; padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.32);">💰 Confirmed: $${group.totalRevenue.toFixed(2)}</span>
                        </div>
                    </div>
                </td>
            `;
            fragment.appendChild(headerTr);

            group.bookings.forEach(b => fragment.appendChild(createSingleBookingRow(b)));
        });
    }

    tbodyElement.innerHTML = '';
    tbodyElement.appendChild(fragment);
}

async function adminConfirmBooking(bookingId) {
    const confirmAction = confirm(`Are you sure you want to Rebook & Confirm Booking #${bookingId}?`);
    if (!confirmAction) return;

    try {
        const response = await apiRequest(`/admin/bookings/${bookingId}/status`, {
            method: 'PUT',
            body: JSON.stringify({
                status: 'confirmed',
                payment_status: 'paid'
            })
        });

        if (response && response.success) {
            await viewBookingDetails(bookingId);
            loadAdminBookings();
            if (typeof loadAdminStats === 'function') loadAdminStats();
        } else {
            throw new Error(response?.message || 'Failed to confirm booking');
        }
    } catch (error) {
        console.error('Admin confirm booking error:', error);
        alert(`⚠️ Confirm Booking Error:\n\n${error.message}`);
    }
}

async function loadAdminUsers() {
    const tbody = document.querySelector('#usersTab .admin-table tbody');
    if (!tbody) return;
    
    // Show loading state
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Loading users...</td></tr>';
    
    try {
        const response = await apiRequest('/admin/users');
        
        if (response.success && response.data && response.data.users) {
            const users = response.data.users || [];
            
            if (users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">No users found</td></tr>';
            } else {
                // Use document fragment for smoother rendering
                const fragment = document.createDocumentFragment();
                
                users.forEach(user => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${user.user_id || 'N/A'}</td>
                        <td>${(user.first_name || '')} ${(user.last_name || '')}</td>
                        <td>${user.email || 'N/A'}</td>
                        <td>${user.phone || 'N/A'}</td>
                        <td><span class="status-badge status-${user.role || 'user'}">${(user.role || 'user').charAt(0).toUpperCase() + (user.role || 'user').slice(1)}</span></td>
                        <td><span class="status-badge status-${user.status || 'active'}">${(user.status || 'active').charAt(0).toUpperCase() + (user.status || 'active').slice(1)}</span></td>
                        <td>
                            <button class="btn btn-sm" onclick="viewUser(${user.user_id})">View</button>
                            <button class="btn btn-sm" onclick="editUserStatus(${user.user_id}, '${user.status || 'active'}')">Status</button>
                        </td>
                    `;
                    fragment.appendChild(tr);
                });
                
                tbody.innerHTML = '';
                tbody.appendChild(fragment);
            }
        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        console.error('Error loading users:', error);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red; padding: 20px;">Error loading users: ${error.message}</td></tr>`;
    }
}

// Debounce function for search
let searchFlightsTimeout;
function searchFlights(query) {
    // Clear previous timeout
    clearTimeout(searchFlightsTimeout);
    
    // Debounce: wait 300ms after user stops typing
    searchFlightsTimeout = setTimeout(() => {
        if (query.trim() === '') {
            // If search is empty, reload first page
            loadAdminFlights(1, '');
        } else {
            // Search on server side
            loadAdminFlights(1, query.trim());
        }
    }, 300);
}

function searchBookings(query) {
    applyAdminBookingFilters();
}

function searchUsers(query) {
    const tbody = document.querySelector('#usersTab .admin-table tbody');
    if (!tbody) return;
    
    const rows = tbody.querySelectorAll('tr');
    if (rows.length === 0) return;
    
    const queryLower = query.toLowerCase().trim();
    
    rows.forEach(row => {
        // Skip empty/loading rows
        if (row.hasAttribute('data-empty-row') || row.textContent.includes('Loading') || row.textContent.includes('Error')) {
            return;
        }
        
        const text = row.textContent.toLowerCase();
        row.style.display = queryLower === '' || text.includes(queryLower) ? '' : 'none';
    });
}

function showDetailsModal({ title, subtitle, badgeText, badgeClass, detailsGrid, passengers, onClose }) {
    let modalEl = document.getElementById('skywingsDetailsModal');
    if (modalEl) modalEl.remove();

    modalEl = document.createElement('div');
    modalEl.id = 'skywingsDetailsModal';
    modalEl.className = 'skywings-details-modal-overlay';
    modalEl.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: rgba(4, 13, 27, 0.8);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
    `;

    let gridHtml = '';
    if (detailsGrid && Array.isArray(detailsGrid)) {
        gridHtml = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 20px;">`;
        detailsGrid.forEach(item => {
            gridHtml += `
                <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; padding: 12px 14px;">
                    <div style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">${item.label}</div>
                    <div style="font-size: 0.98rem; color: #f8fafc; font-weight: 600; margin-top: 4px; word-break: break-word;">${item.value}</div>
                </div>
            `;
        });
        gridHtml += `</div>`;
    }

    let passengersHtml = '';
    if (passengers && Array.isArray(passengers) && passengers.length > 0) {
        passengersHtml = `
            <div style="margin-top: 16px; margin-bottom: 20px;">
                <h4 style="color: #cbd5e1; font-size: 0.85rem; font-weight: 700; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.04em;">Passenger Manifest (${passengers.length})</h4>
                <div style="display: flex; flex-direction: column; gap: 8px;">
        `;
        passengers.forEach((p, idx) => {
            passengersHtml += `
                <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between;">
                    <span style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">👤 Passenger ${idx + 1}: ${p.first_name || ''} ${p.last_name || ''}</span>
                    <span style="color: #38bdf8; font-size: 0.85rem; font-weight: 600;">${p.seat_number ? 'Seat ' + p.seat_number : 'Unassigned Seat'}</span>
                </div>
            `;
        });
        passengersHtml += `</div></div>`;
    }

    modalEl.innerHTML = `
        <div style="background: linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.96)); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 24px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 35px rgba(56, 189, 248, 0.18); width: 100%; max-width: 650px; max-height: 90vh; overflow-y: auto; padding: 28px; position: relative;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid rgba(255, 255, 255, 0.12); padding-bottom: 16px; margin-bottom: 20px;">
                <div>
                    <h3 style="color: #f8fafc; font-size: 1.35rem; font-weight: 800; margin: 0; letter-spacing: -0.01em;">${title || 'Details'}</h3>
                    ${subtitle ? `<p style="color: #94a3b8; font-size: 0.88rem; margin: 4px 0 0 0;">${subtitle}</p>` : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    ${badgeText ? `<span class="status-badge status-${(badgeClass || 'confirmed').toLowerCase()}">${badgeText}</span>` : ''}
                    <button id="closeSkywingsModalBtn" style="background: rgba(255, 255, 255, 0.1); border: none; color: #f8fafc; font-size: 1.5rem; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s;">&times;</button>
                </div>
            </div>
            ${gridHtml}
            ${passengersHtml}
            <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid rgba(255, 255, 255, 0.12); padding-top: 16px; margin-top: 10px;">
                <button id="closeSkywingsModalBottomBtn" class="btn btn-secondary" style="padding: 8px 22px; font-weight: 600;">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(modalEl);

    const closeHandler = () => {
        modalEl.remove();
        if (typeof onClose === 'function') onClose();
    };

    document.getElementById('closeSkywingsModalBtn')?.addEventListener('click', closeHandler);
    document.getElementById('closeSkywingsModalBottomBtn')?.addEventListener('click', closeHandler);
    modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) closeHandler();
    });
}

async function viewBookingDetails(bookingId) {
    try {
        console.log('Loading booking details for ID:', bookingId);
        
        const isAdminContext = window.location.pathname.includes('admin') || (typeof authState !== 'undefined' && authState.userRole === 'admin');
        const endpoint = isAdminContext ? `/admin/bookings/${bookingId}` : `/bookings/${bookingId}`;
        
        const response = await apiRequest(endpoint);
        
        if (response.success && response.data && response.data.booking) {
            const booking = response.data.booking;
            const dep = new Date(booking.departure_datetime);
            const arr = new Date(booking.arrival_datetime);
            const formattedDep = !isNaN(dep) ? dep.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
            const formattedArr = !isNaN(arr) ? arr.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
            
            let status = (booking.status || 'CONFIRMED').toUpperCase();
            if (status === 'COMPLETED') {
                status = 'BOARDED';
            }

            let badgeText = status;
            if (status === 'BOARDED') badgeText = '✈️ BOARDED';
            else if (status === 'MISSED') badgeText = '⚠️ MISSED';
            else if (status === 'CHECKED_IN') badgeText = '✅ CHECKED IN';
            else if (status === 'CONFIRMED') badgeText = 'CONFIRMED';
            else if (status === 'PENDING') badgeText = '⏳ PENDING';
            else if (status === 'CANCELLED') badgeText = '🚫 CANCELLED';
            else if (status === 'EXPIRED') badgeText = 'EXPIRED';

            const detailsGrid = [
                { label: 'Booking Reference', value: booking.booking_reference || 'N/A' },
                { label: 'Flight Number', value: booking.flight_number || 'N/A' },
                { label: 'Route', value: `${booking.from_city || booking.from_name || 'N/A'} → ${booking.to_city || booking.to_name || 'N/A'}` },
                { label: 'Departure Datetime', value: formattedDep },
                { label: 'Arrival Datetime', value: formattedArr },
                { label: 'Cabin Class', value: (booking.class || 'economy').toUpperCase() },
                { label: 'Passenger Count', value: `${booking.number_of_passengers || 1} Person(s)` },
                { label: 'Total Amount', value: `$${parseFloat(booking.total_amount || 0).toFixed(2)}` },
                { label: 'Payment Status', value: (booking.payment_status || 'N/A').toUpperCase() },
                { label: 'Payment Method', value: (booking.payment_method || 'CARD').toUpperCase() }
            ];

            if (booking.state_change_reason) {
                detailsGrid.push({ label: 'Audit / Rebook Note', value: booking.state_change_reason });
            }

            if (booking.cancelled_at) {
                const cDate = new Date(booking.cancelled_at);
                detailsGrid.push({ label: 'Cancelled At', value: !isNaN(cDate) ? cDate.toLocaleString() : booking.cancelled_at });
            }

            if (isAdminContext && booking.user_first_name) {
                detailsGrid.push({ label: 'Customer Name', value: `${booking.user_first_name} ${booking.user_last_name || ''}` });
                detailsGrid.push({ label: 'Customer Email', value: booking.user_email || 'N/A' });
            }

            showDetailsModal({
                title: `Booking #${booking.booking_reference || booking.booking_id}`,
                subtitle: `Flight ${booking.flight_number || ''} details & manifest`,
                badgeText: badgeText,
                badgeClass: status.toLowerCase(),
                detailsGrid,
                passengers: booking.passengers || []
            });
        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        console.error('Error loading booking details:', error);
        showDetailsModal({
            title: 'Error Loading Details',
            subtitle: 'Failed to retrieve booking information',
            badgeText: 'ERROR',
            badgeClass: 'cancelled',
            detailsGrid: [
                { label: 'Error Message', value: error.message || 'Unable to fetch booking details.' }
            ]
        });
    }
}

async function adminCancelBooking(bookingId) {
    const reason = prompt('Enter cancellation reason (required by Booking State Machine policy rules):', 'Admin operational cancellation');
    if (reason === null) return; // User cancelled prompt
    
    if (!reason.trim()) {
        alert('⚠️ Cancellation aborted: A reason is required by system policy rules for admin cancellations.');
        return;
    }

    try {
        // Route through Booking State Machine Admin Endpoint for full policy enforcement
        const response = await apiRequest(`/admin/bookings/${bookingId}/state`, {
            method: 'PATCH',
            body: JSON.stringify({
                status: 'CANCELLED',
                reason: reason.trim(),
                allow_override: true
            })
        });

        if (response.success) {
            alert('✅ Booking cancelled successfully!');
            loadAdminBookings();
        } else {
            alert(`⚠️ Cancellation Blocked by Policy Rules:\n\n${response.message || 'Operation forbidden by state machine policy.'}`);
        }
    } catch (error) {
        console.error('Admin cancel booking error:', error);
        alert(`⚠️ Policy Violation / Cancellation Error:\n\n${error.message || 'Failed to cancel booking.'}`);
    }
}

async function viewUser(userId) {
    try {
        const response = await apiRequest('/admin/users');
        if (response.success && response.data.users) {
            const user = response.data.users.find(u => u.user_id === userId);
            if (user) {
                const createdDate = user.created_at ? new Date(user.created_at) : new Date();
                const detailsGrid = [
                    { label: 'User ID', value: user.user_id },
                    { label: 'Full Name', value: `${user.first_name || ''} ${user.last_name || ''}` },
                    { label: 'Email Address', value: user.email || 'N/A' },
                    { label: 'Phone Number', value: user.phone || 'N/A' },
                    { label: 'Date of Birth', value: user.date_of_birth || 'N/A' },
                    { label: 'Address', value: user.address || 'N/A' },
                    { label: 'System Role', value: (user.role || 'user').toUpperCase() },
                    { label: 'Account Status', value: (user.status || 'active').toUpperCase() },
                    { label: 'Account Created', value: createdDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
                ];

                showDetailsModal({
                    title: `User Profile #${user.user_id}`,
                    subtitle: `${user.first_name || ''} ${user.last_name || ''} (${user.email || ''})`,
                    badgeText: (user.status || 'ACTIVE').toUpperCase(),
                    badgeClass: (user.status || 'active').toLowerCase(),
                    detailsGrid
                });
            } else {
                showDetailsModal({
                    title: 'User Not Found',
                    subtitle: 'No profile matching ID',
                    badgeText: 'NOT FOUND',
                    badgeClass: 'cancelled',
                    detailsGrid: [{ label: 'Error', value: `User ID ${userId} does not exist.` }]
                });
            }
        }
    } catch (error) {
        console.error('Error viewing user:', error);
        showDetailsModal({
            title: 'Error Viewing User',
            subtitle: 'Failed to retrieve user profile',
            badgeText: 'ERROR',
            badgeClass: 'cancelled',
            detailsGrid: [{ label: 'Error Message', value: error.message || 'Failed to load user profile.' }]
        });
    }
}

async function editUserStatus(userId, currentStatus) {
    const statuses = ['active', 'inactive', 'suspended'];
    const currentIndex = statuses.indexOf(currentStatus);
    const nextIndex = (currentIndex + 1) % statuses.length;
    const newStatus = statuses[nextIndex];
    
    if (!confirm(`Change user ${userId} status from ${currentStatus} to ${newStatus}?`)) {
        return;
    }
    
    try {
        const response = await apiRequest(`/admin/users/${userId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: newStatus })
        });
        
        if (response.success) {
            alert('User status updated successfully!');
            loadAdminUsers();
        } else {
            throw new Error(response.message || 'Failed to update status');
        }
    } catch (error) {
        console.error('Error updating user status:', error);
        alert('Failed to update user status: ' + error.message);
    }
}

// ========== AIRCRAFT MANAGEMENT ==========

async function loadAdminAircraft() {
    const tbody = document.querySelector('#aircraftTab .admin-table tbody');
    if (!tbody) return;
    
    // Show loading state
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Loading aircraft...</td></tr>';
    
    try {
        const response = await apiRequest('/admin/aircraft');
        
        if (response.success && response.data && response.data.aircraft) {
            const aircraft = response.data.aircraft || [];
            
            if (aircraft.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No aircraft found. Click "Add Aircraft" to create one!</td></tr>';
            } else {
                // Use document fragment for smoother rendering
                const fragment = document.createDocumentFragment();
                
                aircraft.forEach(ac => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${ac.aircraft_id || 'N/A'}</td>
                        <td><strong>${ac.model || 'N/A'}</strong></td>
                        <td><code>${ac.registration || 'N/A'}</code></td>
                        <td>${ac.capacity || 0} <span style="color: rgba(255, 255, 255, 0.7); font-size: 0.9em;">seats</span></td>
                        <td><span class="status-badge status-${ac.status || 'active'}">${(ac.status || 'active').charAt(0).toUpperCase() + (ac.status || 'active').slice(1)}</span></td>
                        <td>
                            <button class="btn btn-sm" onclick="editAircraft(${ac.aircraft_id})" title="Edit aircraft">Edit</button>
                            <button class="btn btn-sm btn-danger" onclick="deleteAircraft(${ac.aircraft_id})" title="Delete aircraft">Delete</button>
                        </td>
                    `;
                    fragment.appendChild(tr);
                });
                
                tbody.innerHTML = '';
                tbody.appendChild(fragment);
            }
        } else {
            throw new Error('Failed to load aircraft');
        }
    } catch (error) {
        console.error('Error loading aircraft:', error);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: red; padding: 20px;">Error loading aircraft: ${error.message}</td></tr>`;
    }
}

function showAddAircraftModal() {
    const modal = document.getElementById('aircraftModal');
    if (modal) {
        const form = modal.querySelector('form');
        if (form) {
            form.reset();
            delete form.dataset.aircraftId;
        }
        document.getElementById('aircraftModalTitle').textContent = 'Add New Aircraft';
        modal.style.display = 'flex';
    }
}

function closeAircraftModal() {
    const modal = document.getElementById('aircraftModal');
    if (modal) {
        modal.style.display = 'none';
        const form = modal.querySelector('form');
        if (form) {
            form.reset();
            delete form.dataset.aircraftId;
        }
    }
}

async function handleAircraftSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const aircraftId = form.dataset.aircraftId;
    
    const model = formData.get('model');
    const registration = formData.get('registration').toUpperCase();
    const capacity = formData.get('capacity');
    const status = formData.get('status');
    
    try {
        let response;
        if (aircraftId) {
            // Update existing aircraft
            response = await apiRequest(`/admin/aircraft/${aircraftId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    model,
                    registration,
                    capacity: parseInt(capacity),
                    status
                })
            });
        } else {
            // Create new aircraft
            response = await apiRequest('/admin/aircraft', {
                method: 'POST',
                body: JSON.stringify({
                    model,
                    registration,
                    capacity: parseInt(capacity),
                    status
                })
            });
        }
        
        if (response.success) {
            alert(aircraftId ? 'Aircraft updated successfully!' : 'Aircraft added successfully!');
            closeAircraftModal();
            loadAdminAircraft();
        } else {
            throw new Error(response.message || 'Failed to save aircraft');
        }
    } catch (error) {
        alert(error.message || 'Failed to save aircraft');
    }
}

async function editAircraft(aircraftId) {
    try {
        const response = await apiRequest('/admin/aircraft');
        if (response.success && response.data.aircraft) {
            const aircraft = response.data.aircraft.find(a => a.aircraft_id === aircraftId);
            if (aircraft) {
                const modal = document.getElementById('aircraftModal');
                const form = modal.querySelector('form');
                
                form.dataset.aircraftId = aircraftId;
                form.querySelector('[name="model"]').value = aircraft.model;
                form.querySelector('[name="registration"]').value = aircraft.registration;
                form.querySelector('[name="capacity"]').value = aircraft.capacity;
                form.querySelector('[name="status"]').value = aircraft.status;
                
                document.getElementById('aircraftModalTitle').textContent = 'Edit Aircraft';
                modal.style.display = 'flex';
            } else {
                throw new Error('Aircraft not found');
            }
        }
    } catch (error) {
        alert('Failed to load aircraft details: ' + error.message);
    }
}

async function deleteAircraft(aircraftId) {
    if (!confirm(`Are you sure you want to delete aircraft ${aircraftId}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await apiRequest(`/admin/aircraft/${aircraftId}`, {
            method: 'DELETE'
        });
        
        if (response.success) {
            alert('Aircraft deleted successfully!');
            loadAdminAircraft();
        } else {
            throw new Error(response.message || 'Failed to delete aircraft');
        }
    } catch (error) {
        alert('Failed to delete aircraft: ' + error.message);
    }
}

// ========== AIRPORTS MANAGEMENT (ADMIN) ==========

let adminAirportsList = [];

async function loadAdminAirports(searchQuery = '') {
    const tbody = document.querySelector('#adminAirportsTable tbody') || document.querySelector('#airportsTab .admin-table tbody');
    if (!tbody) return;

    // Show loading indicator
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">Loading airports...</td></tr>';

    try {
        const response = await apiRequest('/admin/airports');
        if (response && response.success && response.data && response.data.airports) {
            adminAirportsList = response.data.airports || [];

            let filtered = adminAirportsList;
            if (searchQuery && searchQuery.trim()) {
                const queryLower = searchQuery.trim().toLowerCase();
                filtered = adminAirportsList.filter(a => 
                    (a.airport_code && a.airport_code.toLowerCase().includes(queryLower)) ||
                    (a.airport_name && a.airport_name.toLowerCase().includes(queryLower)) ||
                    (a.city && a.city.toLowerCase().includes(queryLower)) ||
                    (a.country && a.country.toLowerCase().includes(queryLower))
                );
            }

            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 25px;">No airports found matching criteria. Click "+ Add Airport" to create one.</td></tr>';
                return;
            }

            const fragment = document.createDocumentFragment();
            filtered.forEach(airport => {
                const tr = document.createElement('tr');
                const flightCount = parseInt(airport.linked_flights_count) || 0;
                
                tr.innerHTML = `
                    <td>
                        <span style="display: inline-block; padding: 4px 10px; border-radius: 8px; font-weight: 800; font-family: monospace; font-size: 0.95rem; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">
                            ${airport.airport_code}
                        </span>
                    </td>
                    <td><strong style="color: #ffffff;">${airport.airport_name}</strong></td>
                    <td style="color: #cbd5e1;">${airport.city}</td>
                    <td style="color: #94a3b8;">${airport.country}</td>
                    <td style="text-align: center;">
                        <span style="display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.82rem; font-weight: 600; background: ${flightCount > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.1)'}; color: ${flightCount > 0 ? '#34d399' : '#94a3b8'};">
                            ${flightCount} ${flightCount === 1 ? 'flight' : 'flights'}
                        </span>
                    </td>
                    <td style="text-align: right;">
                        <button class="btn btn-sm btn-danger" onclick="deleteAirport('${airport.airport_code}', ${flightCount})" title="${flightCount > 0 ? 'Cannot delete airport linked to active flights' : 'Delete airport'}" style="padding: 5px 12px; font-size: 0.82rem;">
                            🗑️ Delete
                        </button>
                    </td>
                `;
                fragment.appendChild(tr);
            });

            tbody.innerHTML = '';
            tbody.appendChild(fragment);
        } else {
            throw new Error(response?.message || 'Failed to load airports');
        }
    } catch (error) {
        console.error('Error loading admin airports:', error);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 20px;">Error loading airports: ${error.message}</td></tr>`;
    }
}

function searchAirports(query) {
    loadAdminAirports(query);
}

function showAddAirportModal() {
    const modal = document.getElementById('airportModal');
    if (modal) {
        const form = modal.querySelector('form');
        if (form) {
            form.reset();
        }
        document.getElementById('airportModalTitle').textContent = 'Add New Airport';
        modal.style.display = 'flex';
    }
}

function closeAirportModal() {
    const modal = document.getElementById('airportModal');
    if (modal) {
        modal.style.display = 'none';
        const form = modal.querySelector('form');
        if (form) {
            form.reset();
        }
    }
}

async function handleAirportSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    
    const airportCode = (formData.get('airportCode') || '').trim().toUpperCase();
    const airportName = (formData.get('airportName') || '').trim();
    const city = (formData.get('city') || '').trim();
    const country = (formData.get('country') || '').trim();

    if (!airportCode || airportCode.length !== 3 || !/^[A-Z]{3}$/.test(airportCode)) {
        alert('Airport code must be exactly 3 uppercase letters (e.g. DXB, JFK, LHE)');
        return;
    }

    if (!airportName || !city || !country) {
        alert('Please fill in all airport details: Code, Name, City, and Country');
        return;
    }

    const payload = {
        airport_code: airportCode,
        airport_name: airportName,
        city: city,
        country: country
    };

    try {
        const response = await apiRequest('/admin/airports', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (response && response.success) {
            alert(`✅ Airport ${airportCode} (${airportName}) added successfully!`);
            closeAirportModal();
            // Refresh airports table in admin
            await loadAdminAirports();
            // Refresh global airport caches and dropdowns everywhere
            cachedAirportsList = null;
            await initializeAllAirportDropdowns();
        } else {
            throw new Error(response?.message || 'Failed to add airport');
        }
    } catch (error) {
        alert('⚠️ ' + (error.message || 'Failed to add airport'));
    }
}

async function deleteAirport(airportCode, linkedFlightsCount) {
    if (linkedFlightsCount > 0) {
        alert(`⚠️ Cannot delete airport ${airportCode}:\n\nThis airport is currently referenced in ${linkedFlightsCount} flight route(s). Remove or update those flights before deleting this airport.`);
        return;
    }

    if (!confirm(`Are you sure you want to delete airport ${airportCode}? This action cannot be undone.`)) {
        return;
    }

    try {
        const response = await apiRequest(`/admin/airports/${encodeURIComponent(airportCode)}`, {
            method: 'DELETE'
        });

        if (response && response.success) {
            alert(`✅ Airport ${airportCode} deleted successfully!`);
            // Refresh airports table in admin
            await loadAdminAirports();
            // Refresh global airport caches and dropdowns everywhere
            cachedAirportsList = null;
            await initializeAllAirportDropdowns();
        } else {
            throw new Error(response?.message || 'Failed to delete airport');
        }
    } catch (error) {
        alert('⚠️ ' + (error.message || 'Failed to delete airport'));
    }
}

async function exportReport(type) {
    try {
        let endpoint = '';
        let filename = '';
        
        switch(type) {
            case 'overview':
                endpoint = '/reports/overview';
                filename = 'overview-report';
                break;
            case 'revenue':
                endpoint = '/reports/revenue';
                filename = 'revenue-report';
                break;
            case 'bookings':
                endpoint = '/reports/bookings';
                filename = 'bookings-report';
                break;
            case 'routes':
                endpoint = '/reports/routes';
                filename = 'routes-report';
                break;
            case 'performance':
                endpoint = '/reports/performance';
                filename = 'performance-report';
                break;
            default:
                alert('Invalid report type');
                return;
        }
        
        const response = await apiRequest(endpoint);
        
        if (response.success && response.data) {
            // Convert data to CSV format with clear structure
            let csv = '';
            const data = response.data;
            const timestamp = new Date().toLocaleString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            
            switch(type) {
                case 'overview':
                    csv = `SKYWINGS AIRLINES - OVERVIEW REPORT\n`;
                    csv += `=====================================\n`;
                    csv += `Generated: ${timestamp}\n`;
                    csv += `Report Type: Overview Statistics\n\n`;
                    
                    csv += `REVENUE SUMMARY\n`;
                    csv += `---------------\n`;
                    const totalRev = data.revenue?.total || data.totalRevenue || 0;
                    const monthlyRev = data.revenue?.monthly || data.monthlyRevenue || 0;
                    csv += `Total Revenue (All Time),$${totalRev.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
                    csv += `Monthly Revenue (Current Month),$${monthlyRev.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n`;
                    
                    csv += `BOOKING SUMMARY\n`;
                    csv += `---------------\n`;
                    const totalBk = data.bookings?.total || data.totalBookings || 0;
                    const monthlyBk = data.bookings?.monthly || data.monthlyBookings || 0;
                    csv += `Total Bookings (All Time),${totalBk.toLocaleString()}\n`;
                    csv += `Monthly Bookings (Current Month),${monthlyBk.toLocaleString()}\n\n`;
                    
                    csv += `PERFORMANCE METRICS\n`;
                    csv += `-------------------\n`;
                    csv += `On-Time Rate,${data.performance?.onTimeRate || data.onTimeRate || 0}%\n`;
                    csv += `Occupancy Rate,${data.performance?.occupancyRate || 0}%\n`;
                    csv += `Customer Satisfaction,${data.performance?.customerSatisfaction || 0}/5\n\n`;
                    
                    if (data.popularRoutes && data.popularRoutes.length > 0) {
                        csv += `POPULAR ROUTES (Top ${data.popularRoutes.length})\n`;
                        csv += `-----------------------------------\n`;
                        csv += `Rank,Route,Number of Bookings\n`;
                        data.popularRoutes.forEach((route, index) => {
                            csv += `${index + 1},${route.route},${route.booking_count}\n`;
                        });
                    }
                    break;
                    
                case 'revenue':
                    csv = `SKYWINGS AIRLINES - REVENUE REPORT\n`;
                    csv += `==================================\n`;
                    csv += `Generated: ${timestamp}\n`;
                    csv += `Report Type: Revenue Analysis\n\n`;
                    
                    csv += `REVENUE SUMMARY\n`;
                    csv += `---------------\n`;
                    csv += `Total Revenue (All Time),$${(data.totalRevenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
                    csv += `Monthly Revenue (Current Month),$${(data.monthlyRevenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
                    csv += `Growth Rate,${data.growth || 0}%\n\n`;
                    
                    if (data.revenueByRoute && data.revenueByRoute.length > 0) {
                        csv += `REVENUE BY ROUTE\n`;
                        csv += `----------------\n`;
                        csv += `Rank,Route,Revenue (USD)\n`;
                        data.revenueByRoute.forEach((route, index) => {
                            csv += `${index + 1},${route.route},$${parseFloat(route.revenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
                        });
                    }
                    break;
                    
                case 'bookings':
                    csv = `SKYWINGS AIRLINES - BOOKINGS REPORT\n`;
                    csv += `===================================\n`;
                    csv += `Generated: ${timestamp}\n`;
                    csv += `Report Type: Booking Analysis\n\n`;
                    
                    csv += `BOOKING SUMMARY\n`;
                    csv += `---------------\n`;
                    csv += `Total Bookings (All Time),${(data.totalBookings || 0).toLocaleString()}\n`;
                    csv += `Monthly Bookings (Current Month),${(data.monthlyBookings || 0).toLocaleString()}\n`;
                    csv += `Growth Rate,${data.growth || 0}%\n\n`;
                    
                    if (data.bookingStatus && data.bookingStatus.length > 0) {
                        csv += `BOOKING STATUS BREAKDOWN\n`;
                        csv += `------------------------\n`;
                        csv += `Status,Count,Percentage\n`;
                        const total = data.totalBookings || 0;
                        data.bookingStatus.forEach(status => {
                            const percentage = total > 0 ? ((status.count / total) * 100).toFixed(2) : 0;
                            csv += `${status.status.charAt(0).toUpperCase() + status.status.slice(1)},${status.count},${percentage}%\n`;
                        });
                    }
                    break;
                    
                case 'routes':
                    csv = `SKYWINGS AIRLINES - ROUTES REPORT\n`;
                    csv += `=================================\n`;
                    csv += `Generated: ${timestamp}\n`;
                    csv += `Report Type: Route Analysis\n\n`;
                    
                    if (data.popularRoutes && data.popularRoutes.length > 0) {
                        csv += `POPULAR ROUTES\n`;
                        csv += `--------------\n`;
                        csv += `Rank,Route,Number of Bookings,Total Revenue (USD)\n`;
                        data.popularRoutes.forEach((route, index) => {
                            csv += `${index + 1},${route.route},${route.booking_count || 0},$${parseFloat(route.revenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
                        });
                    } else {
                        csv += `No route data available.\n`;
                    }
                    break;
                    
                case 'performance':
                    csv = `SKYWINGS AIRLINES - PERFORMANCE REPORT\n`;
                    csv += `======================================\n`;
                    csv += `Generated: ${timestamp}\n`;
                    csv += `Report Type: Performance Metrics\n\n`;
                    
                    csv += `PERFORMANCE METRICS\n`;
                    csv += `-------------------\n`;
                    csv += `On-Time Rate,${data.onTimeRate || 0}%\n`;
                    csv += `Occupancy Rate,${data.occupancyRate || 0}%\n`;
                    csv += `Customer Satisfaction,${data.customerSatisfaction || 0}/5\n`;
                    csv += `Average Flight Efficiency,${data.flightEfficiency || 'N/A'}\n`;
                    break;
            }
            
            // Create and download CSV file
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${filename}-${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            alert(`${type.charAt(0).toUpperCase() + type.slice(1)} report exported successfully!`);
        } else {
            throw new Error('Failed to fetch report data');
        }
    } catch (error) {
        console.error('Export error:', error);
        alert('Failed to export report: ' + error.message);
    }
}

// ========== CHART RENDERING FUNCTIONS ==========

function renderBarChart(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error('Chart container not found:', containerId);
        return;
    }
    
    if (!data || data.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.6); padding: 2rem;">No data available</div>';
        return;
    }
    
    const maxValue = Math.max(...data.map(d => d.max || d.value || 0));
    if (maxValue === 0) {
        container.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.6); padding: 2rem;">No data available</div>';
        return;
    }
    
    container.innerHTML = data.map((item, index) => {
        const value = item.value || 0;
        const height = maxValue > 0 ? Math.max((value / maxValue) * 100, 5) : 5; // Minimum 5% height
        const displayValue = typeof value === 'number' ? value.toLocaleString() : value;
        return `
            <div class="chart-bar" style="height: ${height}%;" 
                 data-value="${item.label}: ${displayValue}" 
                 title="${item.label}: ${displayValue}">
            </div>
        `;
    }).join('');
}

function renderLineChart(containerId, data) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error('Chart container not found:', containerId);
        return;
    }
    
    if (!data || data.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.6); padding: 2rem;">No data available</div>';
        return;
    }
    
    const maxValue = Math.max(...data.map(d => d.value || 0));
    if (maxValue === 0) {
        container.innerHTML = '<div style="text-align: center; color: rgba(255,255,255,0.6); padding: 2rem;">No data available</div>';
        return;
    }
    
    const points = data.map((item, index) => {
        const x = data.length > 1 ? (index / (data.length - 1)) * 100 : 50;
        const y = 100 - ((item.value || 0) / maxValue) * 100;
        return { x, y, value: item.value || 0, label: item.month || item.label || `Point ${index + 1}` };
    });
    
    // Create SVG path for line
    let pathD = `M ${points[0].x}% ${points[0].y}%`;
    for (let i = 1; i < points.length; i++) {
        pathD += ` L ${points[i].x}% ${points[i].y}%`;
    }
    
    container.innerHTML = `
        <svg class="chart-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
            <path d="${pathD}" class="chart-line-path" fill="none"/>
        </svg>
        <div class="chart-line-points">
            ${points.map((point, index) => `
                <div class="chart-line-point" style="left: ${point.x}%; bottom: ${point.y}%;" 
                     title="${point.label}: ${point.value.toLocaleString()}">
                </div>
            `).join('')}
        </div>
    `;
}

// ========== REPORT LOADING FUNCTIONS ==========

async function loadOverviewReport() {
    try {
        console.log('Loading overview report...');
        const response = await apiRequest('/reports/overview');
        console.log('Overview response:', response);
        
        if (response.success && response.data) {
            const data = response.data;
            
            // Update revenue summary and chart
            const revenueSummary = document.getElementById('overviewRevenueSummary');
            if (revenueSummary) {
                const totalRev = data.revenue?.total || data.totalRevenue || 0;
                const monthlyRev = data.revenue?.monthly || data.monthlyRevenue || 0;
                revenueSummary.innerHTML = `
                    <p>Total Revenue: $${totalRev.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p>This Month: $${monthlyRev.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                `;
                
                // Render revenue chart
                const maxRevenue = Math.max(totalRev, monthlyRev, 1);
                renderBarChart('revenueBars', [
                    { label: 'Total', value: totalRev, max: maxRevenue },
                    { label: 'Month', value: monthlyRev, max: maxRevenue }
                ]);
            }

            // Update bookings summary and chart
            const bookingSummary = document.getElementById('overviewBookingSummary');
            if (bookingSummary) {
                const totalBk = data.bookings?.total || data.totalBookings || 0;
                const monthlyBk = data.bookings?.monthly || data.monthlyBookings || 0;
                bookingSummary.innerHTML = `
                    <p>Total Bookings: ${totalBk.toLocaleString()}</p>
                    <p>This Month: ${monthlyBk.toLocaleString()}</p>
                `;
                
                // Render booking chart
                const maxBookings = Math.max(totalBk, monthlyBk, 1);
                renderBarChart('bookingBars', [
                    { label: 'Total', value: totalBk, max: maxBookings },
                    { label: 'Month', value: monthlyBk, max: maxBookings }
                ]);
            }

            // Update popular routes
            const routesList = document.querySelector('#overviewTab .report-card:nth-child(3) .routes-list');
            if (routesList) {
                if (data.popularRoutes && data.popularRoutes.length > 0) {
                    routesList.innerHTML = data.popularRoutes.map(route => `
                        <div class="route-item">
                            <span>${route.route}</span>
                            <span class="route-count">${route.booking_count} bookings</span>
                        </div>
                    `).join('');
                } else {
                    routesList.innerHTML = '<div class="route-item"><span>No routes data available</span></div>';
                }
            }

            // Update performance
            const performanceList = document.querySelector('#overviewTab .report-card:nth-child(4) .performance-list');
            if (performanceList && data.performance) {
                performanceList.innerHTML = `
                    <div class="performance-item">
                        <span>On-Time Rate</span>
                        <span class="performance-value">${data.performance.onTimeRate}%</span>
                    </div>
                    <div class="performance-item">
                        <span>Occupancy Rate</span>
                        <span class="performance-value">${data.performance.occupancyRate}%</span>
                    </div>
                    <div class="performance-item">
                        <span>Customer Satisfaction</span>
                        <span class="performance-value">${data.performance.customerSatisfaction}/5</span>
                    </div>
                `;
            }
        } else {
            console.error('Invalid response:', response);
        }
    } catch (error) {
        console.error('Error loading overview report:', error);
        const revenueSummary = document.querySelector('#overviewTab .report-card:nth-child(1) .report-summary');
        if (revenueSummary) {
            revenueSummary.innerHTML = '<p style="color: red;">Error loading data</p>';
        }
    }
}

async function loadRevenueReport() {
    try {
        console.log('Loading revenue report...');
        const response = await apiRequest('/reports/revenue');
        console.log('Revenue response:', response);
        
        if (response.success && response.data) {
            const data = response.data;
            
            // Update total revenue
            const totalRevenueEl = document.querySelector('#revenueTab .report-card:nth-child(1) .report-summary p');
            if (totalRevenueEl) {
                totalRevenueEl.textContent = `$${data.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }

            // Update monthly revenue
            const monthlyRevenueEl = document.querySelector('#revenueTab .report-card:nth-child(2) .report-summary p');
            if (monthlyRevenueEl) {
                monthlyRevenueEl.textContent = `$${data.monthlyRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }

            // Update revenue by route
            const routesList = document.querySelector('#revenueTab .report-card:nth-child(3) .routes-list');
            if (routesList) {
                if (data.revenueByRoute && data.revenueByRoute.length > 0) {
                    routesList.innerHTML = data.revenueByRoute.map(route => `
                        <div class="route-item">
                            <span>${route.route}</span>
                            <span class="route-count">$${parseFloat(route.revenue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                    `).join('');
                } else {
                    routesList.innerHTML = '<div class="route-item"><span>No revenue data available</span></div>';
                }
            }

            // Update growth and render trend chart
            const growthEl = document.getElementById('revenueTrendSummary');
            if (growthEl) {
                const sign = data.growth >= 0 ? '+' : '';
                growthEl.innerHTML = `<p>Growth: ${sign}${data.growth || 0}% this month</p>`;
            }
            
            // Render revenue trend line chart (simulated 6 months)
            renderLineChart('revenueTrendLine', [
                { month: 'Jan', value: data.monthlyRevenue * 0.8 },
                { month: 'Feb', value: data.monthlyRevenue * 0.85 },
                { month: 'Mar', value: data.monthlyRevenue * 0.9 },
                { month: 'Apr', value: data.monthlyRevenue * 0.95 },
                { month: 'May', value: data.monthlyRevenue * 1.0 },
                { month: 'Jun', value: data.monthlyRevenue * 1.05 }
            ]);
        }
    } catch (error) {
        console.error('Error loading revenue report:', error);
    }
}

async function loadBookingsReport() {
    try {
        console.log('Loading bookings report...');
        const response = await apiRequest('/reports/bookings');
        console.log('Bookings response:', response);
        
        if (response.success && response.data) {
            const data = response.data;
            
            // Update total bookings
            const totalBookingsEl = document.querySelector('#bookingsReportTab .report-card:nth-child(1) .report-summary p');
            if (totalBookingsEl) {
                totalBookingsEl.textContent = data.totalBookings.toLocaleString();
            }

            // Update monthly bookings
            const monthlyBookingsEl = document.querySelector('#bookingsReportTab .report-card:nth-child(2) .report-summary p');
            if (monthlyBookingsEl) {
                monthlyBookingsEl.textContent = data.monthlyBookings.toLocaleString();
            }

            // Update booking status
            const statusList = document.querySelector('#bookingsReportTab .report-card:nth-child(3) .performance-list');
            if (statusList && data.bookingStatus) {
                const total = data.totalBookings;
                if (data.bookingStatus.length > 0) {
                    statusList.innerHTML = data.bookingStatus.map(status => {
                        const percentage = total > 0 ? ((status.count / total) * 100).toFixed(0) : 0;
                        return `
                            <div class="performance-item">
                                <span>${status.status.charAt(0).toUpperCase() + status.status.slice(1)}</span>
                                <span class="performance-value">${status.count} (${percentage}%)</span>
                            </div>
                        `;
                    }).join('');
                } else {
                    statusList.innerHTML = '<div class="performance-item"><span>No status data available</span></div>';
                }
            }

            // Update growth and render trend chart
            const growthEl = document.getElementById('bookingTrendSummary');
            if (growthEl) {
                const sign = data.growth >= 0 ? '+' : '';
                growthEl.innerHTML = `<p>Growth: ${sign}${data.growth || 0}% this month</p>`;
            }
            
            // Render booking trend line chart (simulated 6 months)
            renderLineChart('bookingTrendLine', [
                { month: 'Jan', value: data.monthlyBookings * 0.8 },
                { month: 'Feb', value: data.monthlyBookings * 0.85 },
                { month: 'Mar', value: data.monthlyBookings * 0.9 },
                { month: 'Apr', value: data.monthlyBookings * 0.95 },
                { month: 'May', value: data.monthlyBookings * 1.0 },
                { month: 'Jun', value: data.monthlyBookings * 1.05 }
            ]);

            // Update Bookings Grouped by Flight Table
            const flightBookingsTbody = document.querySelector('#reportBookingsByFlightTable tbody');
            if (flightBookingsTbody) {
                if (data.bookingsByFlight && data.bookingsByFlight.length > 0) {
                    flightBookingsTbody.innerHTML = data.bookingsByFlight.map(bf => {
                        const dep = bf.departure_datetime ? new Date(bf.departure_datetime) : null;
                        const formattedDep = dep && !isNaN(dep) ? dep.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A';
                        return `
                            <tr>
                                <td><span style="font-weight: 800; color: #38bdf8;">✈️ ${bf.flight_number}</span></td>
                                <td><strong>${bf.from_city} → ${bf.to_city}</strong></td>
                                <td><span style="color: #cbd5e1; font-size: 0.85rem;">${formattedDep}</span></td>
                                <td style="text-align: center;"><span style="background: rgba(255, 255, 255, 0.1); padding: 2px 8px; border-radius: 4px; font-weight: 700;">${bf.total_bookings}</span></td>
                                <td style="text-align: center;"><span style="color: #34d399; font-weight: 700;">${bf.confirmed_bookings || 0}</span></td>
                                <td style="text-align: center;"><span style="color: #f87171; font-weight: 700;">${bf.cancelled_bookings || 0}</span></td>
                                <td style="text-align: right;"><strong style="color: #34d399;">$${parseFloat(bf.total_revenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                            </tr>
                        `;
                    }).join('');
                } else {
                    flightBookingsTbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 20px;">No flight bookings found</td></tr>';
                }
            }
        }
    } catch (error) {
        console.error('Error loading bookings report:', error);
    }
}

async function loadRoutesReport() {
    try {
        console.log('Loading routes report...');
        const response = await apiRequest('/reports/routes');
        console.log('Routes response:', response);
        
        if (response.success && response.data) {
            const data = response.data;
            
            // Update popular routes
            const popularRoutesList = document.querySelector('#routesTab .report-card:nth-child(1) .routes-list');
            if (popularRoutesList) {
                if (data.popularRoutes && data.popularRoutes.length > 0) {
                    popularRoutesList.innerHTML = data.popularRoutes.map(route => `
                        <div class="route-item">
                            <span>${route.route}</span>
                            <span class="route-count">${route.booking_count} bookings</span>
                        </div>
                    `).join('');
                } else {
                    popularRoutesList.innerHTML = '<div class="route-item"><span>No routes data available</span></div>';
                }
            }

            // Update route performance
            const performanceList = document.querySelector('#routesTab .report-card:nth-child(2) .performance-list');
            if (performanceList) {
                if (data.routePerformance && data.routePerformance.length > 0) {
                    performanceList.innerHTML = data.routePerformance.map(route => `
                        <div class="performance-item">
                            <span>${route.route}</span>
                            <span class="performance-value">Avg: $${parseFloat(route.avg_price).toFixed(2)}</span>
                        </div>
                    `).join('');
                } else {
                    performanceList.innerHTML = '<div class="performance-item"><span>No performance data available</span></div>';
                }
            }

            // Update route revenue
            const revenueList = document.querySelector('#routesTab .report-card:nth-child(3) .routes-list');
            if (revenueList) {
                if (data.routeRevenue && data.routeRevenue.length > 0) {
                    revenueList.innerHTML = data.routeRevenue.map(route => `
                        <div class="route-item">
                            <span>${route.route}</span>
                            <span class="route-count">$${parseFloat(route.revenue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                    `).join('');
                } else {
                    revenueList.innerHTML = '<div class="route-item"><span>No revenue data available</span></div>';
                }
            }
        }
    } catch (error) {
        console.error('Error loading routes report:', error);
    }
}

async function loadPerformanceReport() {
    try {
        console.log('Loading performance report...');
        const response = await apiRequest('/reports/performance');
        console.log('Performance response:', response);
        
        if (response.success && response.data) {
            const data = response.data;
            
            // Update on-time performance
            const onTimeEl = document.querySelector('#performanceTab .report-card:nth-child(1) .report-summary p');
            if (onTimeEl) {
                onTimeEl.textContent = `${data.onTimePerformance.rate}%`;
            }
            const onTimeList = document.querySelector('#performanceTab .report-card:nth-child(1) .performance-list');
            if (onTimeList) {
                onTimeList.innerHTML = `
                    <div class="performance-item">
                        <span>On-Time</span>
                        <span class="performance-value">${data.onTimePerformance.onTime} flights</span>
                    </div>
                    <div class="performance-item">
                        <span>Delayed</span>
                        <span class="performance-value">${data.onTimePerformance.delayed} flights</span>
                    </div>
                `;
            }

            // Update occupancy rate
            const occupancyEl = document.querySelector('#performanceTab .report-card:nth-child(2) .report-summary p');
            if (occupancyEl) {
                occupancyEl.textContent = `${data.occupancy.rate}%`;
            }
            const occupancyList = document.querySelector('#performanceTab .report-card:nth-child(2) .performance-list');
            if (occupancyList) {
                occupancyList.innerHTML = `
                    <div class="performance-item">
                        <span>Booked Seats</span>
                        <span class="performance-value">${data.occupancy.booked.toLocaleString()}</span>
                    </div>
                    <div class="performance-item">
                        <span>Total Seats</span>
                        <span class="performance-value">${data.occupancy.total.toLocaleString()}</span>
                    </div>
                `;
            }

            // Update customer satisfaction
            const satisfactionEl = document.querySelector('#performanceTab .report-card:nth-child(3) .report-summary p');
            if (satisfactionEl) {
                satisfactionEl.textContent = `${data.customerSatisfaction.average}/5`;
            }
            const satisfactionList = document.querySelector('#performanceTab .report-card:nth-child(3) .performance-list');
            if (satisfactionList) {
                const total = data.customerSatisfaction.breakdown.fiveStars + 
                             data.customerSatisfaction.breakdown.fourStars + 
                             data.customerSatisfaction.breakdown.threeStars;
                satisfactionList.innerHTML = `
                    <div class="performance-item">
                        <span>5 Stars</span>
                        <span class="performance-value">${data.customerSatisfaction.breakdown.fiveStars} (${total > 0 ? Math.round((data.customerSatisfaction.breakdown.fiveStars / total) * 100) : 0}%)</span>
                    </div>
                    <div class="performance-item">
                        <span>4 Stars</span>
                        <span class="performance-value">${data.customerSatisfaction.breakdown.fourStars} (${total > 0 ? Math.round((data.customerSatisfaction.breakdown.fourStars / total) * 100) : 0}%)</span>
                    </div>
                    <div class="performance-item">
                        <span>3 Stars</span>
                        <span class="performance-value">${data.customerSatisfaction.breakdown.threeStars} (${total > 0 ? Math.round((data.customerSatisfaction.breakdown.threeStars / total) * 100) : 0}%)</span>
                    </div>
                `;
            }

            // Update efficiency
            const efficiencyList = document.querySelector('#performanceTab .report-card:nth-child(4) .performance-list');
            if (efficiencyList) {
                efficiencyList.innerHTML = `
                    <div class="performance-item">
                        <span>Average Flight Time</span>
                        <span class="performance-value">${data.efficiency.avgFlightTime}</span>
                    </div>
                    <div class="performance-item">
                        <span>Fuel Efficiency</span>
                        <span class="performance-value">${data.efficiency.fuelEfficiency}%</span>
                    </div>
                    <div class="performance-item">
                        <span>Maintenance Score</span>
                        <span class="performance-value">${data.efficiency.maintenanceScore}%</span>
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Error loading performance report:', error);
    }
}

// ========== TAB FUNCTIONS ==========

function showTab(event, tabName) {
    if (event) {
        event.preventDefault();
    }

    const tabId = `${tabName}Tab`;
    const tabs = ['searchTab', 'statusTab'];

    tabs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = id === tabId ? 'block' : 'none';
        }
    });

    const tabsContainer = event && event.currentTarget ? event.currentTarget.closest('.filter-tabs') : document.querySelector('.filter-tabs');
    const tabButtons = tabsContainer ? tabsContainer.querySelectorAll('.tab-btn') : document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => btn.classList.remove('active'));

    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    } else {
        const fallback = Array.from(tabButtons).find(btn => btn.textContent.toLowerCase().includes(tabName));
        if (fallback) fallback.classList.add('active');
    }

    // Load data for the selected tab
    if (tabName === 'overview') {
        loadOverviewReport();
    } else if (tabName === 'revenue') {
        loadRevenueReport();
    } else if (tabName === 'bookings') {
        loadBookingsReport();
    } else if (tabName === 'routes') {
        loadRoutesReport();
    } else if (tabName === 'performance') {
        loadPerformanceReport();
    }
}

function showAdminTab(event, tabName) {
    if (event) {
        event.preventDefault();
    }

    const tabId = `${tabName}Tab`;
    const adminTabs = ['flightsTab', 'bookingsTab', 'usersTab', 'aircraftTab', 'airportsTab'];

    adminTabs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = id === tabId ? 'block' : 'none';
        }
    });

    const tabsContainer = event && event.currentTarget ? event.currentTarget.closest('.filter-tabs') : document.querySelector('.filter-tabs');
    const tabButtons = tabsContainer ? tabsContainer.querySelectorAll('.tab-btn') : document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => btn.classList.remove('active'));

    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    } else {
        const fallback = Array.from(tabButtons).find(btn => btn.textContent.toLowerCase().includes(tabName));
        if (fallback) fallback.classList.add('active');
    }
    
    // Load data when tab is shown (with pagination support)
    if (tabName === 'flights') {
        loadAdminFlights(1, ''); // Load first page, no search
    } else if (tabName === 'bookings') {
        loadAdminBookings();
    } else if (tabName === 'users') {
        loadAdminUsers();
    } else if (tabName === 'aircraft') {
        loadAdminAircraft();
    } else if (tabName === 'airports') {
        loadAdminAirports();
    }
}

function showReportTab(event, tabName) {
    if (event) {
        event.preventDefault();
    }

    // Map tab names to their actual IDs
    const tabIdMap = {
        'overview': 'overviewTab',
        'revenue': 'revenueTab',
        'bookings': 'bookingsReportTab',
        'routes': 'routesTab',
        'performance': 'performanceTab'
    };

    const tabId = tabIdMap[tabName] || `${tabName}Tab`;
    const reportTabs = ['overviewTab', 'revenueTab', 'bookingsReportTab', 'routesTab', 'performanceTab'];

    reportTabs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = id === tabId ? 'block' : 'none';
        }
    });

    const tabsContainer = event && event.currentTarget ? event.currentTarget.closest('.filter-tabs') : document.querySelector('.filter-tabs');
    const tabButtons = tabsContainer ? tabsContainer.querySelectorAll('.tab-btn') : document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => btn.classList.remove('active'));

    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    } else {
        const fallback = Array.from(tabButtons).find(btn => btn.textContent.toLowerCase().includes(tabName));
        if (fallback) fallback.classList.add('active');
    }

    // Load data for the selected tab
    if (tabName === 'overview') {
        loadOverviewReport();
    } else if (tabName === 'revenue') {
        loadRevenueReport();
    } else if (tabName === 'bookings') {
        loadBookingsReport();
    } else if (tabName === 'routes') {
        loadRoutesReport();
    } else if (tabName === 'performance') {
        loadPerformanceReport();
    }
}

// ========== FLIGHT STATUS ==========

async function handleStatusSearch(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const flightNumber = formData.get('flightNumber').trim().toUpperCase();
    
    const statusResult = document.getElementById('statusResult');
    if (!statusResult) return;
    
    statusResult.style.display = 'block';
    statusResult.innerHTML = `
        <div class="live-tracker-card" style="text-align: center; padding: 2rem;">
            <div style="font-size: 2rem; animation: spin 1s infinite linear; display: inline-block; margin-bottom: 0.75rem;">📡</div>
            <p style="color: #94a3b8; margin: 0;">Querying SkyWings Air Traffic Control Radar for <strong>${flightNumber}</strong>...</p>
        </div>
    `;
    
    try {
        const response = await apiRequest(`/flights/status/${flightNumber}`);
        
        if (response.success && response.data && response.data.flight) {
            const flight = response.data.flight;
            const departure = new Date(flight.departure_datetime);
            const arrival = new Date(flight.arrival_datetime);
            const now = new Date();
            
            let statusBadge = '🟢 ON TIME';
            let badgeClass = 'on-time';
            
            if (flight.status === 'cancelled') {
                statusBadge = '🔴 CANCELLED';
                badgeClass = 'cancelled';
            } else if (flight.status === 'completed' || arrival < now) {
                statusBadge = '🏁 ARRIVED / COMPLETED';
                badgeClass = 'completed';
            } else if (flight.status === 'boarding') {
                statusBadge = '🟡 BOARDING NOW';
                badgeClass = 'pending';
            } else if (departure < now && arrival > now) {
                statusBadge = '🔵 EN ROUTE (IN FLIGHT)';
                badgeClass = 'checked_in';
            }
            
            const fromCode = flight.from_code || flight.from_airport_code || flight.from_city?.substring(0, 3)?.toUpperCase() || 'ORG';
            const toCode = flight.to_code || flight.to_airport_code || flight.to_city?.substring(0, 3)?.toUpperCase() || 'DST';
            const aircraft = flight.aircraft_model || 'Boeing 787-9 Dreamliner';
            const gate = flight.gate || 'Gate B14';
            const terminal = flight.terminal || 'Terminal 2';
            
            statusResult.innerHTML = `
                <div class="live-tracker-card">
                    <div class="tracker-header">
                        <div>
                            <span style="font-size: 1.35rem; font-weight: 800; color: #f8fafc; margin-right: 10px;">
                                ✈️ Flight ${flight.flight_number}
                            </span>
                            <span style="color: #94a3b8; font-size: 0.88rem;">${aircraft}</span>
                        </div>
                        <span class="tracker-badge ${badgeClass}">${statusBadge}</span>
                    </div>

                    <!-- Route Timeline -->
                    <div class="flight-timeline" style="margin: 1.5rem 0;">
                        <div class="flight-endpoint">
                            <div class="time">${departure.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                            <div class="city"><strong>${fromCode}</strong> • ${flight.from_city}</div>
                            <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">${departure.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        </div>
                        
                        <div class="flight-path-visual">
                            <span class="flight-path-duration">${flight.duration || 'Direct Flight'}</span>
                            <div class="flight-path-line"></div>
                            <span class="flight-path-stops">${statusBadge}</span>
                        </div>
                        
                        <div class="flight-endpoint dest">
                            <div class="time">${arrival.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                            <div class="city"><strong>${toCode}</strong> • ${flight.to_city}</div>
                            <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">${arrival.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        </div>
                    </div>

                    <!-- Radar Info Grid -->
                    <div class="tracker-grid">
                        <div class="tracker-grid-item">
                            <div class="label">Terminal</div>
                            <div class="val">${terminal}</div>
                        </div>
                        <div class="tracker-grid-item">
                            <div class="label">Departure Gate</div>
                            <div class="val" style="color: #38bdf8;">${gate}</div>
                        </div>
                        <div class="tracker-grid-item">
                            <div class="label">Baggage Belt</div>
                            <div class="val">Belt 4</div>
                        </div>
                        <div class="tracker-grid-item">
                            <div class="label">Aircraft Status</div>
                            <div class="val" style="color: #34d399;">Operational</div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            statusResult.innerHTML = `
                <div class="live-tracker-card" style="border-color: rgba(239, 68, 68, 0.4);">
                    <h3 style="color: #f87171; margin-bottom: 0.5rem;">🔍 No Flight Found for "${flightNumber}"</h3>
                    <p style="color: #94a3b8; margin: 0; font-size: 0.9rem;">Please check the flight number (e.g. FL101, SW202) and verify scheduled departure date.</p>
                </div>
            `;
        }
    } catch (error) {
        statusResult.innerHTML = `
            <div class="live-tracker-card" style="border-color: rgba(239, 68, 68, 0.4);">
                <h3 style="color: #f87171; margin-bottom: 0.5rem;">⚠️ Radar Connection Error</h3>
                <p style="color: #cbd5e1; margin: 0;">${error.message || 'Failed to fetch flight radar telemetry.'}</p>
            </div>
        `;
    }
}

// ========== CONTACT & FAQ INTERACTIVITY ==========

function handleContactSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = form.querySelector('.contact-submit-btn');
    const successBanner = form.querySelector('.contact-success-banner') || document.getElementById('contactSuccessBanner');

    const originalText = submitBtn ? submitBtn.innerHTML : 'Send Message';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '⏳ Transmitting message...';
    }

    setTimeout(() => {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }

        if (successBanner) {
            successBanner.style.display = 'block';
            successBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        form.reset();

        setTimeout(() => {
            if (successBanner) {
                successBanner.style.display = 'none';
            }
        }, 8000);
    }, 600);
}

function toggleFaq(headerElement) {
    const item = headerElement.closest('.faq-accordion-item');
    if (!item) return;

    const isOpen = item.classList.contains('open');

    const parentList = item.closest('.faq-accordion-list');
    if (parentList) {
        parentList.querySelectorAll('.faq-accordion-item.open').forEach(openItem => {
            if (openItem !== item) openItem.classList.remove('open');
        });
    }

    if (isOpen) {
        item.classList.remove('open');
    } else {
        item.classList.add('open');
    }
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('flightModal');
    if (event.target === modal) {
        closeModal();
    }
}
