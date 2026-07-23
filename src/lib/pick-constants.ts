// Shared between pick-actions.ts (a "use server" module, which can only
// export async functions — not plain constants) and client components that
// need the same vocabulary.
export const PICK_METHODS = ["KO/TKO", "Submission", "Decision"] as const;
export type PickMethod = (typeof PICK_METHODS)[number];
