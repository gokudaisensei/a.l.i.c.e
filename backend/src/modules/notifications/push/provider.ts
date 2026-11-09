import type { pushSubscriptions } from "../../../core/database/schema";

export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export interface PushPayload {
  title: string;
  body: string;
  /** Small string-only extras the app can use to open the right screen. */
  data: Record<string, string>;
}

/** `gone` means the phone or browser no longer wants this subscription, so it should be forgotten. */
export type PushResult = "sent" | "gone" | "failed";

export interface PushProvider {
  readonly platform: PushSubscription["platform"];
  send(sub: PushSubscription, payload: PushPayload): Promise<PushResult>;
}
