/**
 * Suppress browser extension errors that are harmless
 * Some browser extensions (wallet extensions, etc.) inject code that causes
 * console errors but doesn't affect functionality.
 */

if (typeof window !== "undefined") {
  // Store original console.error
  const originalError = console.error;

  // Override console.error to filter out extension-related errors
  console.error = (...args: unknown[]) => {
    const errorString = args.join(" ");
    
    // Filter out known browser extension errors
    if (
      errorString.includes("chrome-extension://") ||
      errorString.includes("moz-extension://") ||
      errorString.includes("Invalid property descriptor") ||
      errorString.includes("Cannot both specify accessors")
    ) {
      // Silently ignore extension errors
      return;
    }

    // Call original console.error for other errors
    originalError.apply(console, args);
  };
}
