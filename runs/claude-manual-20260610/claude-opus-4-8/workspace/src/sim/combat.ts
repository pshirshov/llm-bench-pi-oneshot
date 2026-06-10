/**
 * Combat damage model. Kept pure and dependency-free so it can be unit-tested
 * in isolation.
 *
 * Effective damage = attacker damage minus defender armor, with a floor of 1
 * so every hit chips at least 1 HP (genre convention).
 */
export const MIN_DAMAGE = 1;

export function computeDamage(attackerDamage: number, defenderArmor: number): number {
  return Math.max(MIN_DAMAGE, attackerDamage - defenderArmor);
}
