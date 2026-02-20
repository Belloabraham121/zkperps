/**
 * API client for backend endpoints
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const MAX_RETRIES = 5;
const RETRY_DELAY = 1000; // 1 second between retries

/**
 * Retry a fetch request up to MAX_RETRIES times
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    // Only retry on network errors (Failed to fetch)
    if (
      retries > 0 &&
      error instanceof TypeError &&
      error.message === "Failed to fetch"
    ) {
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

export interface AuthResponse {
  token: string | null;
  walletAddress: string | null;
  signerId?: string; // Optional - only present if server-side wallet access is configured
  email?: string;
  message?: string;
}

export interface UserInfo {
  userId: string;
  email?: string;
  walletAddress?: string;
}

/**
 * Sign up with Privy access token
 */
export async function signup(accessToken: string): Promise<AuthResponse> {
  try {
    const res = await fetchWithRetry(`${API_URL}/api/auth/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accessToken }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "Signup failed" }));
      throw new Error(error.error || "Signup failed");
    }

    return res.json();
  } catch (error) {
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(
        `Cannot connect to backend at ${API_URL} after ${MAX_RETRIES} attempts. Make sure the backend server is running.`
      );
    }
    throw error;
  }
}

/**
 * Login with Privy access token
 */
export async function login(accessToken: string): Promise<AuthResponse> {
  try {
    const res = await fetchWithRetry(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accessToken }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "Login failed" }));
      throw new Error(error.error || "Login failed");
    }

    return res.json();
  } catch (error) {
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(
        `Cannot connect to backend at ${API_URL} after ${MAX_RETRIES} attempts. Make sure the backend server is running.`
      );
    }
    throw error;
  }
}

/**
 * Link wallet to user account
 */
export async function linkWallet(
  accessToken: string,
  walletAddress: string,
  walletId?: string
): Promise<AuthResponse> {
  try {
    const res = await fetchWithRetry(`${API_URL}/api/auth/link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accessToken, walletAddress, walletId }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "Link wallet failed" }));
      throw new Error(error.error || "Link wallet failed");
    }

    return res.json();
  } catch (error) {
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(
        `Cannot connect to backend at ${API_URL} after ${MAX_RETRIES} attempts. Make sure the backend server is running.`
      );
    }
    throw error;
  }
}

/**
 * Get current user info (requires JWT token)
 */
export async function getMe(token: string): Promise<UserInfo> {
  try {
    const res = await fetchWithRetry(`${API_URL}/api/auth/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "Failed to get user info" }));
      throw new Error(error.error || "Failed to get user info");
    }

    return res.json();
  } catch (error) {
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(
        `Cannot connect to backend at ${API_URL} after ${MAX_RETRIES} attempts. Make sure the backend server is running.`
      );
    }
    throw error;
  }
}
