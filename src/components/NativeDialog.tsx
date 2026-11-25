"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";

let supportsDisplayTransitionCache: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (supportsDisplayTransitionCache !== undefined) {
    return supportsDisplayTransitionCache;
  }
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText =
    "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  void getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransitionCache = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransitionCache;
}

function supportsTopLayerExit(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.CSS?.supports?.("overlay", "auto")) &&
    canTransitionDisplay()
  );
}

export async function closeDialogSmoothly(dialog: HTMLDialogElement): Promise<void> {
  if (!dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => window.setTimeout(r, 400)),
      ]);
    }
    if (!dialog.hasAttribute("data-closing")) return;
    dialog.removeAttribute("data-closing");
  }
  if (dialog.open) {
    dialog.close();
  }
}

interface NativeDialogProps {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}

export function NativeDialog({
  open,
  onClose,
  titleId,
  title,
  wide = false,
  children,
}: NativeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog) {
      void closeDialogSmoothly(dialog);
    } else {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.removeAttribute("data-closing");
      dialog.showModal();
    } else if (!open && dialog.open) {
      void closeDialogSmoothly(dialog);
    }
  }, [open]);

  // Route Esc / cancel through smooth top-layer exit helper
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      void closeDialogSmoothly(dialog);
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, []);

  // iOS WebKit fallback for closedby="any" light-dismiss
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;

    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };

    let pressedOutside = false;
    const onDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        void closeDialogSmoothly(dialog);
      }
    };

    dialog.addEventListener("pointerdown", onDown);
    dialog.addEventListener("pointerup", onUp);
    return () => {
      dialog.removeEventListener("pointerdown", onDown);
      dialog.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={`sheet-dialog${wide ? " sheet-dialog-wide" : ""}`}
      aria-labelledby={titleId}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = "";
          dialogRef.current.removeAttribute("data-closing");
        }
        onClose();
      }}
      {...({ closedby: "any" } as Record<string, string>)}
    >
      <div className="dialog-surface scroller">
        <div className="dialog-header">
          <h2 id={titleId} className="section-title">
            {title}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label={`Close ${title}`}
            onClick={requestClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
