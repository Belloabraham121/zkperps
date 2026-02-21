/**
 * Auth utilities and context for managing authentication state
 */

import { usePrivy, useWallets, useSigners, useCreateWallet } from "@privy-io/react-auth";
import { useEffect, useState, useRef, useMemo } from "react";
import * as api from "./api";

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  user: {
    userId?: string;
    email?: string;
    walletAddress?: string;
  } | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to manage authentication state and sync with backend
 */
/**
 * Helper function to check if a wallet is an external browser wallet (MetaMask, etc.)
 * We only want to use Privy embedded wallets, not external wallets
 */
function isExternalWallet(wallet: { walletClientType?: string; connectorType?: unknown }): boolean {
  if ('connectorType' in wallet) {
    const connectorType = String(wallet.connectorType).toLowerCase();
    // External connectors that we want to exclude
    const externalConnectors = ['metamask', 'coinbase_wallet', 'wallet_connect', 'injected', 'eip6963'];
    return externalConnectors.some(ext => connectorType.includes(ext));
  }
  return false;
}

export function useAuth() {
  const { ready, authenticated, user, getAccessToken, login: privyLogin, logout: privyLogout } = usePrivy();
  const { wallets } = useWallets();
  const { addSigners } = useSigners();
  const { createWallet } = useCreateWallet();
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    token: null,
    user: null,
    isLoading: true,
    error: null,
  });
  const signerSetupDone = useRef<Set<string>>(new Set()); // Track which wallets have had signers added
  const syncInProgress = useRef(false); // Prevent concurrent syncs
  const lastUserId = useRef<string | null>(null); // Track user changes
  const cachedAccessToken = useRef<string | null>(null); // Cache access token to avoid repeated calls
  const tokenCacheTime = useRef<number>(0); // When token was cached
  const lastLinkedWalletId = useRef<string | null>(null); // Wallet ID we last sent to backend (so we can re-link when id appears)
  const TOKEN_CACHE_TTL = 5 * 60 * 1000; // Cache for 5 minutes

  // Get embedded wallet - use stable references
  // IMPORTANT: Only use Privy embedded wallets, NOT external browser wallets (MetaMask, etc.)
  const embeddedWallet = useMemo(() => {
    // Filter to only Privy embedded wallets (exclude external wallets)
    const privyWallets = wallets.filter((w) => {
      // Must be Privy embedded wallet type
      const isPrivyType = w.walletClientType === "privy" || w.walletClientType === "embedded";
      // Must NOT be an external wallet connector
      const isNotExternal = !isExternalWallet(w);
      return isPrivyType && isNotExternal;
    });
    
    if (privyWallets.length > 0) {
      return privyWallets[0];
    }
    
    return undefined;
  }, [wallets]);
  const walletAddress = embeddedWallet?.address;
  // Server wallet ID is on the User's linked accounts (or user.wallet), not on the connector wallet from useWallets()
  const walletId = useMemo(() => {
    if (!user || !walletAddress) return undefined;
    // Prefer user.wallet.id when it matches our embedded wallet address
    if (user.wallet?.address?.toLowerCase() === walletAddress.toLowerCase() && user.wallet.id) {
      return String(user.wallet.id);
    }
    // Otherwise find the embedded wallet in linkedAccounts (type 'wallet' with matching address)
    const walletAccount = user.linkedAccounts?.find(
      (acc): acc is { type: "wallet"; address: string; id?: string | null } =>
        acc && typeof acc === "object" && "type" in acc && acc.type === "wallet" && "address" in acc &&
        String(acc.address).toLowerCase() === walletAddress.toLowerCase()
    );
    if (walletAccount && "id" in walletAccount && walletAccount.id != null) {
      return String(walletAccount.id);
    }
    return undefined;
  }, [user, walletAddress]);

  // Track user ID changes
  const currentUserId = user?.id || null;
  const userIdChanged = lastUserId.current !== currentUserId;
  if (userIdChanged) {
    lastUserId.current = currentUserId;
    // Clear access token cache when user changes
    cachedAccessToken.current = null;
    tokenCacheTime.current = 0;
  }

  useEffect(() => {
    // Prevent concurrent syncs
    if (syncInProgress.current) {
      return;
    }

    async function syncAuth() {
      if (!ready) {
        setAuthState((prev) => {
          if (prev.isLoading) return prev;
          return { ...prev, isLoading: true };
        });
        return;
      }

      if (!authenticated || !user) {
        // Only update if state actually changed
        setAuthState((prev) => {
          if (!prev.isAuthenticated && !prev.token && !prev.user && !prev.isLoading && !prev.error) {
            return prev;
          }
          return {
            isAuthenticated: false,
            token: null,
            user: null,
            isLoading: false,
            error: null,
          };
        });
        return;
      }

      syncInProgress.current = true;

      try {
        // Get Privy access token (with caching)
        let accessToken: string | null = null;
        const now = Date.now();
        const isTokenCacheValid = cachedAccessToken.current && (now - tokenCacheTime.current) < TOKEN_CACHE_TTL;
        
        if (isTokenCacheValid) {
          accessToken = cachedAccessToken.current;
        } else {
          try {
            accessToken = await getAccessToken();
            if (accessToken) {
              cachedAccessToken.current = accessToken;
              tokenCacheTime.current = now;
            }
          } catch (tokenError) {
            console.error("Failed to get access token from Privy:", tokenError);
            cachedAccessToken.current = null;
            setAuthState({
              isAuthenticated: false,
              token: null,
              user: null,
              isLoading: false,
              error: `Failed to get access token: ${tokenError instanceof Error ? tokenError.message : String(tokenError)}`,
            });
            syncInProgress.current = false;
            return;
          }
        }
        
        if (!accessToken || accessToken.trim() === "") {
          cachedAccessToken.current = null;
          setAuthState({
            isAuthenticated: false,
            token: null,
            user: null,
            isLoading: false,
            error: "Access token is empty or invalid",
          });
          syncInProgress.current = false;
          return;
        }

        // Try to login/verify with backend
        let authResponse: api.AuthResponse;
        try {
          console.log("Attempting login with access token (length:", accessToken.length, ")");
          authResponse = await api.login(accessToken);
        } catch (loginError) {
          // If login fails, try signup (first time user)
          console.log("Login failed, trying signup:", loginError instanceof Error ? loginError.message : String(loginError));
          try {
            authResponse = await api.signup(accessToken);
          } catch (signupError) {
            console.error("Both login and signup failed:", signupError);
            throw signupError;
          }
        }

        // If wallet is not linked yet, create embedded wallet and link it
        // Backend returns token: null with a message when wallet needs to be linked
        if (!authResponse.token && authResponse.message?.includes("link")) {
          let currentWallet = embeddedWallet;
          
          // Step 1: Check if wallet already exists
          if (!currentWallet) {
            currentWallet = wallets.find((w) => {
              const isPrivyType = w.walletClientType === "privy" || w.walletClientType === "embedded";
              const isNotExternal = !isExternalWallet(w);
              return isPrivyType && isNotExternal;
            });
          }
          
          // Step 2: If no wallet exists, create one
          if (!currentWallet) {
            try {
              const createdWallet = await createWallet();
              
              // Wait briefly for wallet to appear in wallets array
              await new Promise((resolve) => setTimeout(resolve, 300));
              
              // Find the newly created wallet in wallets array
              const foundWallet = wallets.find((w) => {
                const isPrivyType = w.walletClientType === "privy" || w.walletClientType === "embedded";
                const isNotExternal = !isExternalWallet(w);
                return isPrivyType && isNotExternal && w.address === createdWallet.address;
              });
              
              if (foundWallet) {
                currentWallet = foundWallet;
              }
            } catch (createError) {
              throw new Error(`Failed to create embedded wallet: ${createError instanceof Error ? createError.message : String(createError)}`);
            }
          }

          if (currentWallet?.address) {
            const currentWalletAddress = currentWallet.address;
            // Server wallet ID comes from User (user.wallet.id or linkedAccounts), not from connector wallet
            let currentWalletId: string | undefined;
            if (user.wallet?.address?.toLowerCase() === currentWalletAddress.toLowerCase() && user.wallet.id) {
              currentWalletId = String(user.wallet.id);
            } else {
              const walletAccount = user.linkedAccounts?.find(
                (acc): acc is { type: "wallet"; address: string; id?: string | null } =>
                  acc && typeof acc === "object" && "type" in acc && acc.type === "wallet" && "address" in acc &&
                  String(acc.address).toLowerCase() === currentWalletAddress.toLowerCase()
              );
              if (walletAccount && "id" in walletAccount && walletAccount.id != null) {
                currentWalletId = String(walletAccount.id);
              }
            }
            try {
              // Step 1: Add backend signer to wallet (if server-side signing is enabled)
              // Only attempt if signerId is provided and valid
              const signerId = authResponse.signerId;
              const hasValidSignerId = signerId && 
                                      signerId.trim() !== "" && 
                                      signerId.length > 10; // Basic validation
              
              if (!signerSetupDone.current.has(currentWalletAddress) && hasValidSignerId && signerId) {
                try {
                  console.log("Adding backend signer to wallet:", { address: currentWalletAddress, signerId });
                  await addSigners({
                    address: currentWalletAddress,
                    signers: [{ signerId }],
                  });
                  signerSetupDone.current.add(currentWalletAddress);
                  console.log("Successfully added backend signer to wallet");
                } catch (signerError) {
                  const msg = signerError instanceof Error ? signerError.message : String(signerError);
                  const isDuplicateSigner = msg.includes("Duplicate signer") || msg.includes("already been added");
                  if (isDuplicateSigner) {
                    signerSetupDone.current.add(currentWalletAddress);
                    console.log("Backend signer already added to wallet");
                  } else {
                    console.error("Failed to add signer - this will prevent server-side transactions:", signerError);
                  }
                }
              } else if (!hasValidSignerId) {
                console.log("Skipping addSigners - signerId not provided or invalid");
                // Mark as done to prevent retries when signerId is not available
                signerSetupDone.current.add(currentWalletAddress);
              }

              // Step 2: Link wallet to backend (saves to database)
              const linkResponse = await api.linkWallet(
                accessToken,
                currentWalletAddress,
                currentWalletId
              );
              
              if (!linkResponse.token) {
                throw new Error("Failed to link wallet - no token received");
              }
              
              if (currentWalletId) lastLinkedWalletId.current = currentWalletId;
              authResponse = linkResponse;
            } catch (linkError) {
              setAuthState({
                isAuthenticated: false,
                token: null,
                user: {
                  userId: user.id,
                  email: user.email?.address,
                },
                isLoading: false,
                error: linkError instanceof Error ? linkError.message : "Failed to link wallet. Please refresh the page and try again.",
              });
              syncInProgress.current = false;
              return;
            }
          } else {
            // Wallet not available - this shouldn't happen with createOnLogin: "all-users"
            // But if it does, the effect will re-run when wallet becomes available
            setAuthState({
              isAuthenticated: false,
              token: null,
              user: {
                userId: user.id,
                email: user.email?.address,
              },
              isLoading: true, // Keep loading state - wallet should appear soon
              error: null, // Don't show error - wallet creation is in progress
            });
            syncInProgress.current = false;
            return;
          }
        }

        // Ensure signer is added if we have wallet and signerId
        const signerId = authResponse.signerId;
        const hasValidSignerId = signerId && 
                                signerId.trim() !== "" && 
                                signerId.length > 10; // Basic validation
        
        if (authResponse.token && walletAddress && hasValidSignerId && signerId) {
          if (!signerSetupDone.current.has(walletAddress)) {
            try {
              console.log("Adding backend signer to wallet:", { address: walletAddress, signerId });
              await addSigners({
                address: walletAddress,
                signers: [{ signerId }],
              });
              signerSetupDone.current.add(walletAddress);
              console.log("Successfully added backend signer to wallet");
            } catch (signerError) {
              const msg = signerError instanceof Error ? signerError.message : String(signerError);
              const isDuplicateSigner = msg.includes("Duplicate signer") || msg.includes("already been added");
              if (isDuplicateSigner) {
                signerSetupDone.current.add(walletAddress);
                console.log("Backend signer already added to wallet");
              } else {
                console.error("Failed to add signer - transactions will fail until this is fixed:", signerError);
              }
            }
          }
        } else if (!hasValidSignerId && walletAddress) {
          console.log("Skipping addSigners - signerId not provided or invalid");
          // Mark as done to prevent retries when signerId is not available
          signerSetupDone.current.add(walletAddress);
        }

        // If we have a token, get user info
        if (authResponse.token) {
          try {
            const userInfo = await api.getMe(authResponse.token);
            setAuthState((prev) => {
              // Only update if something changed
              if (
                prev.isAuthenticated &&
                prev.token === authResponse.token &&
                prev.user?.userId === userInfo.userId &&
                prev.user?.walletAddress === (userInfo.walletAddress || authResponse.walletAddress)
              ) {
                return prev;
              }
              return {
                isAuthenticated: true,
                token: authResponse.token,
                user: {
                  userId: userInfo.userId,
                  email: userInfo.email,
                  walletAddress: userInfo.walletAddress || authResponse.walletAddress || undefined,
                },
                isLoading: false,
                error: null,
              };
            });
          } catch {
            setAuthState({
              isAuthenticated: true,
              token: authResponse.token,
              user: {
                userId: user.id,
                email: user.email?.address,
                walletAddress: authResponse.walletAddress || undefined,
              },
              isLoading: false,
              error: null,
            });
          }
        } else {
          // No token yet, but user is authenticated with Privy
          setAuthState((prev) => {
            if (
              !prev.isAuthenticated &&
              !prev.token &&
              prev.user?.userId === user.id &&
              prev.error === (authResponse.message || "Wallet not linked")
            ) {
              return prev;
            }
            return {
              isAuthenticated: false,
              token: null,
              user: {
                userId: user.id,
                email: user.email?.address,
              },
              isLoading: false,
              error: authResponse.message || "Wallet not linked",
            };
          });
        }
      } catch (error) {
        setAuthState({
          isAuthenticated: false,
          token: null,
          user: null,
          isLoading: false,
          error: error instanceof Error ? error.message : "Authentication failed",
        });
      } finally {
        syncInProgress.current = false;
      }
    }

    syncAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, currentUserId, walletAddress, walletId, getAccessToken, addSigners, createWallet]);

  // When walletId appears after we're already linked (e.g. after addSigners / delegation), push it to the backend
  useEffect(() => {
    if (!authState.token || !walletAddress || !walletId || walletId === lastLinkedWalletId.current) return;
    let cancelled = false;
    getAccessToken()
      .then((accessToken) => {
        if (!cancelled && accessToken) {
          return api.linkWallet(accessToken, walletAddress, walletId);
        }
      })
      .then((res) => {
        if (!cancelled && res?.token) {
          lastLinkedWalletId.current = walletId;
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authState.token, walletAddress, walletId, getAccessToken]);

  const login = async () => {
    await privyLogin();
  };

  const logout = async () => {
    await privyLogout();
    signerSetupDone.current.clear();
    lastUserId.current = null;
    syncInProgress.current = false;
    cachedAccessToken.current = null; // Clear cached access token
    tokenCacheTime.current = 0;
    setAuthState({
      isAuthenticated: false,
      token: null,
      user: null,
      isLoading: false,
      error: null,
    });
  };

  /**
   * Manually retry adding the backend signer to the wallet.
   * Call this if you get authorization errors when trying to send transactions.
   */
  const retrySignerSetup = async (): Promise<boolean> => {
    if (!walletAddress || !authState.token) {
      console.error("Cannot retry signer setup: wallet not available or not authenticated");
      return false;
    }

    try {
      // Get fresh access token
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Failed to get access token");
      }

      // Get signerId from backend
      const authResponse = await api.login(accessToken);
      const signerId = authResponse.signerId;
      
      if (!signerId || signerId.trim() === "" || signerId.length <= 10) {
        console.error("No valid signerId returned from backend");
        return false;
      }

      // Clear the done flag to allow retry
      signerSetupDone.current.delete(walletAddress);

      // Try to add signer
      console.log("Retrying signer setup:", { address: walletAddress, signerId });
      await addSigners({
        address: walletAddress,
        signers: [{ signerId }],
      });
      
      signerSetupDone.current.add(walletAddress);
      console.log("Successfully added backend signer to wallet");
      return true;
    } catch (error) {
      console.error("Failed to retry signer setup:", error);
      return false;
    }
  };

  return {
    ...authState,
    login,
    logout,
    retrySignerSetup,
    ready,
    privyUser: user,
    embeddedWallet,
  };
}
