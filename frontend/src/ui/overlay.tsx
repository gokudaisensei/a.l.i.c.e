"use client";
import type { ReactNode, RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Drawer } from "@base-ui/react/drawer";
import { Icon } from "./icon";
import { Button, IconButton } from "./button";
import { cn } from "./cn";

interface SurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
}

/**
 * Centred or top-anchored dialog. Focus is trapped while open and returns to the trigger on close;
 * Escape and a tap on the scrim dismiss it. It animates out as well as in.
 */
export function Modal({ open, onOpenChange, label, placement = "top", initialFocus, children }: SurfaceProps & { placement?: "top" | "center"; initialFocus?: RefObject<HTMLElement | null> }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="scrim" data-slot="scrim" />
        <Dialog.Viewport className="vp" data-placement={placement}>
          <Dialog.Popup className="sheet" data-slot="modal" aria-label={label} initialFocus={initialFocus}>{children}</Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Bottom sheet. Drag it down to dismiss: it follows the finger, and a flick closes it faster.
 * Put `data-base-ui-swipe-ignore` on any child that needs its own drag (the Slider already does).
 */
export function BottomSheet({ open, onOpenChange, label, children }: SurfaceProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="down">
      <Drawer.Portal>
        <Drawer.Backdrop className="scrim" data-slot="scrim" />
        <Drawer.Viewport className="vp bottom">
          <Drawer.Popup className="sheet b" data-slot="bottom-sheet" aria-label={label}>
            <div className="grab" />
            <Drawer.Content className="sheet-c">{children}</Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function Toast({ message, show, onUndo }: { message: string; show: boolean; onUndo?: () => void }) {
  return (
    <div id="toast" data-slot="toast" role="status" aria-live="polite" className={cn(show && "show")} inert={!show}>
      <span>{message}</span>
      {onUndo ? <button type="button" onClick={onUndo}>Undo</button> : null}
    </div>
  );
}

/** Passkey-style confirmation dialog. */
export function ConfirmDialog({ open, title, description, state, onConfirm, onCancel, confirmLabel = "Use passkey", confirmRef }: {
  open: boolean; title: string; description: string; state: "idle" | "go" | "ok"; onConfirm: () => void; onCancel: () => void; confirmLabel?: string;
  confirmRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onCancel(); }} label="Confirm with passkey" placement="center" initialFocus={confirmRef}>
      <div className="pk">
        <div className={cn("pk-ic", state === "go" && "go", state === "ok" && "ok")}><Icon n={state === "ok" ? "check" : "finger"} /></div>
        <h3 className="tt" style={{ fontSize: 24 }}>{title}</h3>
        <p className="muted" style={{ maxWidth: "36ch" }}>{state === "go" ? "Waiting for your phone or laptop…" : state === "ok" ? "Confirmed." : description}</p>
        <div className="btns" style={{ justifyContent: "center" }}>
          <Button ref={confirmRef} variant="primary" onClick={onConfirm} disabled={state !== "idle"}><Icon n="key" c="sm" />{confirmLabel}</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
export { IconButton };
