import type { Page } from "@playwright/test";
export function seedRich(page: Page, ha: { url: string; token: string }): Promise<{ renamed: number; covers: number; automation: number; automationError: string | null }>;
