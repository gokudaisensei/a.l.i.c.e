import type { Page } from "@playwright/test";
export function fitProblems(page: Page, name: string, expectedTier?: string): Promise<string[]>;
