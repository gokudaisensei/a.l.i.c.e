import webpush from "web-push";
import type { PushPayload, PushProvider, PushResult, PushSubscription } from "./provider";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** A mailto: or https: contact the push services can use. */
  subject: string;
}

type Send = (sub: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;

/** Standard Web Push (VAPID): browsers, installed web apps and any client that gives a push-service endpoint. */
export class WebPushProvider implements PushProvider {
  readonly platform = "webpush" as const;

  /** The public key browsers need when they subscribe. */
  get publicKey() { return this.vapid.publicKey; }

  constructor(private readonly vapid: VapidConfig, private readonly sendFn: Send = webpush.sendNotification.bind(webpush) as Send) {}

  async send(sub: PushSubscription, payload: PushPayload): Promise<PushResult> {
    if (!sub.keys) return "gone"; // a Web Push subscription without keys can never be delivered
    try {
      await this.sendFn(
        { endpoint: sub.token, keys: sub.keys },
        JSON.stringify(payload),
        { vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey }, TTL: 3600, urgency: "normal" },
      );
      return "sent";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? "gone" : "failed";
    }
  }
}
