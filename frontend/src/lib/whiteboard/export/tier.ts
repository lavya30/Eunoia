import type { RoomTier } from '../rooms-api';

export function isProTier(tier: RoomTier | null | undefined): boolean {
  return tier === 'PRO' || tier === 'ENTERPRISE';
}

/** Display label for the export menu Pro badge. */
export function proTierLabel(tier: RoomTier | null | undefined): string {
  if (tier === 'ENTERPRISE') return 'Enterprise';
  if (tier === 'PRO') return 'Pro';
  return 'Pro';
}
