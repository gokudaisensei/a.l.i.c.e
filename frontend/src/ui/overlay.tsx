import type { ReactNode } from "react";
import { Icon } from "./icon";
import { Button, IconButton } from "./button";
import { cn } from "./cn";

export type OverlayMode = "top" | "center" | "bottom";

/** Full-screen scrim. Click on the scrim itself calls `onDismiss`. */
export function Scrim({ open, mode = "top", onDismiss, children }: { open: boolean; mode?: OverlayMode; onDismiss: () => void; children?: ReactNode }) {
  return (
    <div id="ov" hidden={!open} className={mode === "top" ? "" : mode} onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}>{children}</div>
  );
}

/** Dialog surface. `bottom` renders as a phone-style sheet with a grab handle. */
export function Sheet({ label, bottom, children }: { label: string; bottom?: boolean; children: ReactNode }) {
  return <div className={cn("sheet", bottom && "b")} role="dialog" aria-label={label}>{bottom ? <div className="grab" /> : null}{children}</div>;
}

export function Toast({ message, show, onUndo }: { message: string; show: boolean; onUndo?: () => void }) {
  return (
    <div id="toast" role="status" aria-live="polite" className={show ? "show" : ""}>
      <span>{message}</span>
      {onUndo ? <button type="button" onClick={onUndo}>Undo</button> : null}
    </div>
  );
}

/** Passkey-style confirmation dialog body. */
export function ConfirmDialog({ title, description, state, onConfirm, onCancel, confirmLabel = "Use passkey", confirmRef }: {
  title: string; description: string; state: "idle" | "go" | "ok"; onConfirm: () => void; onCancel: () => void; confirmLabel?: string;
  confirmRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Sheet label="Confirm with passkey">
      <div className="pk">
        <div className={cn("pk-ic", state === "go" && "go", state === "ok" && "ok")}><Icon n={state === "ok" ? "check" : "finger"} /></div>
        <h3 className="tt" style={{ fontSize: 24 }}>{title}</h3>
        <p className="muted" style={{ maxWidth: "36ch" }}>{state === "go" ? "Waiting for your phone or laptop…" : state === "ok" ? "Confirmed." : description}</p>
        <div className="btns" style={{ justifyContent: "center" }}>
          <Button ref={confirmRef} variant="primary" onClick={onConfirm} disabled={state !== "idle"}><Icon n="key" c="sm" />{confirmLabel}</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Sheet>
  );
}
export { IconButton };
