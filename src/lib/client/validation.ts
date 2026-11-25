export function attachValidationSync(form: HTMLFormElement): () => void {
  const dirtyState = new WeakMap<
    HTMLElement,
    { hasInteracted: boolean; hasBlurred: boolean }
  >();
  const supportsUserInvalid =
    typeof CSS !== "undefined" && CSS.supports("selector(:user-invalid)");

  const linkError = (el: HTMLElement, shown: boolean) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const ids = (el.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (shown) ids.push(errorId);
    if (ids.length > 0) {
      el.setAttribute("aria-describedby", ids.join(" "));
    } else {
      el.removeAttribute("aria-describedby");
    }
  };

  const syncField = (el: EventTarget | null) => {
    if (
      !(
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      )
    ) {
      return;
    }

    let isUserInvalid = false;
    if (supportsUserInvalid) {
      isUserInvalid = el.matches(":user-invalid");
    } else {
      const st = dirtyState.get(el);
      if (st?.hasInteracted && st?.hasBlurred) {
        isUserInvalid = !el.validity.valid;
        el.classList.toggle("user-invalid-fallback", isUserInvalid);
      }
    }

    el.setAttribute("aria-invalid", isUserInvalid ? "true" : "false");
    linkError(el, isUserInvalid);
  };

  form
    .querySelectorAll<HTMLElement>("input, select, textarea")
    .forEach((el) => {
      if (!el.hasAttribute("aria-invalid")) {
        el.setAttribute("aria-invalid", "false");
      }
    });

  const onInput = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLElement) {
      const cur = dirtyState.get(t) ?? { hasInteracted: false, hasBlurred: false };
      cur.hasInteracted = true;
      dirtyState.set(t, cur);
    }
    syncField(t);
  };

  const onBlur = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLElement) {
      const cur = dirtyState.get(t) ?? { hasInteracted: false, hasBlurred: false };
      cur.hasBlurred = true;
      dirtyState.set(t, cur);
    }
    syncField(t);
  };

  const onInvalid = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLElement) {
      dirtyState.set(t, { hasInteracted: true, hasBlurred: true });
      t.classList.toggle("user-invalid-fallback", true);
      t.setAttribute("aria-invalid", "true");
      linkError(t, true);
    }
  };

  form.addEventListener("input", onInput);
  form.addEventListener("change", onInput);
  form.addEventListener("blur", onBlur, true);
  form.addEventListener("invalid", onInvalid, true);

  return () => {
    form.removeEventListener("input", onInput);
    form.removeEventListener("change", onInput);
    form.removeEventListener("blur", onBlur, true);
    form.removeEventListener("invalid", onInvalid, true);
  };
}
