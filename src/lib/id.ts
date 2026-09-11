let counter = 0;

// Short, readable, collision-safe-enough ids for client + demo data.
// (No uuid dependency needed — keeps the install lightweight.)
export function makeId(prefix: string): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}${counter}`;
}
