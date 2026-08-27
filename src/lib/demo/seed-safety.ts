export type ExistingDemoConnection = { id: string; is_demo: boolean };

export function validateDemoSeedTarget<T extends ExistingDemoConnection>(rows: T[]): T | null {
  if (rows.length > 1) {
    throw new Error(`Refusing to guess: ${rows.length} connections already exist for this user.`);
  }
  const existing = rows[0] ?? null;
  if (existing && !existing.is_demo) {
    throw new Error(`Refusing to overwrite connection ${existing.id}: it is not marked is_demo.`);
  }
  return existing;
}
