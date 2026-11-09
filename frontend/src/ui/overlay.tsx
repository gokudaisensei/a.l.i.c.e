"use client";
import { useEffect, type ReactNode, type RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Drawer } from "@base-ui/react/drawer";
import { Icon } from "./icon";
import { Button, IconButton } from "./button";
import { cn } from "./cn";
import { haptic } from "./haptics";

interface SurfaceProps {
  /** Whether it is showing. */
  open: boolean;
  /** Called with `false` when the person dismisses it (Escape, a tap outside, a swipe down). */
  onOpenChange: (open: boolean) => void;
  /** Accessible name for the dialog. */
  label: string;
  children: ReactNode;
}

/**
 * Centred or top-anchored dialog. Focus is trapped while open and returns to the trigger on close;
 * Escape and a tap on the scrim dismiss it. It animates out as well as in.
 */
export function Modal({ open, onOpenChange, label, placement = "top", initialFocus, children }: SurfaceProps & {
  /** `top` sits near the top (good with a keyboard); `center` is for short confirmations. */
  placement?: "top" | "center";
  /** The element to focus when it opens. Defaults to the first focusable one. */
  initialFocus?: RefObject<HTMLElement | null>;
}) {
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

/** Passkey-style confirmation dialog. */
export function ConfirmDialog({ open, title, description, state, onConfirm, onCancel, confirmLabel = "Use passkey", cancelLabel = "Cancel", destructive, confirmRef }: {
  /** Whether it is showing. */
  open: boolean;
  /** What is being confirmed, as a short sentence. */
  title: string;
  /** Why it needs a passkey, in a line or two. */
  description: string;
  /** `idle` waits for a tap; `go` shows that the passkey prompt is open; `ok` shows it worked. */
  state: "idle" | "go" | "ok";
  /** Called when the confirm button is pressed. */
  onConfirm: () => void;
  /** Called by the Cancel button, Escape, or a tap outside. */
  onCancel: () => void;
  /** The confirm button's text. */
  confirmLabel?: string;
  /** The cancel button's text. Keep it "Cancel": it is the word people look for. */
  cancelLabel?: string;
  /** Styles the confirm button as dangerous (red). Only for things that cannot be undone, and that the person did not choose with that in mind. */
  destructive?: boolean;
  /** A ref to the confirm button, so it can take focus when the dialog opens. */
  confirmRef?: RefObject<HTMLButtonElement | null>;
}) {
  useEffect(() => { if (open && state === "ok") haptic("success"); else if (open && state === "go") haptic("light"); }, [open, state]); // the passkey prompt opening, and it working, are both felt
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onCancel(); }} label="Confirm with passkey" placement="center" initialFocus={confirmRef}>
      <div className="pk">
        <div className={cn("pk-ic", state === "go" && "go", state === "ok" && "ok")}><Icon n={state === "ok" ? "check" : "finger"} /></div>
        <h3 className="tt" style={{ fontSize: "1.5rem" }}>{title}</h3>
        <p className="muted" style={{ maxWidth: "36ch" }}>{state === "go" ? "Waiting for your phone or laptop…" : state === "ok" ? "Confirmed." : description}</p>
        <div className="btns" style={{ justifyContent: "center" }}>
          <Button ref={confirmRef} variant={destructive ? "danger" : "primary"} onClick={onConfirm} disabled={state !== "idle"}><Icon n="key" c="sm" />{confirmLabel}</Button>
          <Button onClick={onCancel}>{cancelLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}
export { IconButton };
