/**
 * Utility functions
 */

/**
 * Format Ethereum address to shortened form (0x1234...5678)
 */
export function formatAddress(address: string, chars = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
