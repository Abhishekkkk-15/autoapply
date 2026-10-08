/**
 * Production-grade DOM automation utilities designed specifically for
 * React, Angular, and Vue controlled input elements, human simulation,
 * and robust MutationObserver element waiting.
 */

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Robust native value setter for controlled React/Angular/Vue input/textarea components.
 * Bypasses virtual DOM overrides by invoking prototype setters directly.
 */
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const isTextarea = element.tagName.toLowerCase() === 'textarea';
  const prototype = isTextarea
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  // Dispatch both 'input' and 'change' events with bubbling
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  // Blur event helps trigger validation in many modern frameworks
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

/**
 * Set value for HTMLSelectElement, triggering react change events.
 */
export function setNativeSelectValue(
  element: HTMLSelectElement,
  value: string
): boolean {
  let matchedOption = false;
  const normalizedTarget = value.toLowerCase().trim();

  // Try exact value match, then option text match
  for (let i = 0; i < element.options.length; i++) {
    const opt = element.options[i];
    const optVal = opt.value.toLowerCase().trim();
    const optText = opt.text.toLowerCase().trim();

    if (optVal === normalizedTarget || optText === normalizedTarget || optText.includes(normalizedTarget)) {
      element.selectedIndex = i;
      matchedOption = true;
      break;
    }
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value'
  );
  if (descriptor && descriptor.set && matchedOption) {
    descriptor.set.call(element, element.options[element.selectedIndex].value);
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
  return matchedOption;
}

/**
 * Simulates human click with full pointer and mouse event cascade,
 * randomized hit coordinates, and human-like micro delays (50-120ms).
 */
export async function simulateClick(element: HTMLElement): Promise<void> {
  if (!element) return;

  // Scroll into view if needed
  try {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(120, 250);
  } catch {
    // Ignore scrolling errors on detached elements
  }

  const rect = element.getBoundingClientRect();
  // Jitter coordinates within element bounding box
  const clientX = Math.round(rect.left + rect.width * (0.3 + Math.random() * 0.4));
  const clientY = Math.round(rect.top + rect.height * (0.3 + Math.random() * 0.4));

  const mouseEventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    screenX: clientX + (window.screenLeft || window.screenX || 0),
    screenY: clientY + (window.screenTop || window.screenY || 0),
    buttons: 1,
  };

  element.focus();

  // Pointer down
  element.dispatchEvent(new PointerEvent('pointerdown', mouseEventInit));
  // Mouse down
  element.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));

  // Natural human click duration (50ms - 120ms)
  await randomDelay(50, 120);

  // Pointer up
  element.dispatchEvent(new PointerEvent('pointerup', mouseEventInit));
  // Mouse up
  element.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));

  // Native click
  element.dispatchEvent(new MouseEvent('click', mouseEventInit));

  // If standard dispatch didn't trigger native behavior, execute HTMLElement.click()
  try {
    element.click();
  } catch {
    // Fallback ignore
  }

  await randomDelay(100, 200);
}

/**
 * Simulates human typing by character with realistic keystroke jitter.
 */
export async function simulateTyping(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  minCharDelay = 20,
  maxCharDelay = 70
): Promise<void> {
  element.focus();
  element.value = '';

  let current = '';
  for (const char of text) {
    current += char;
    setNativeValue(element, current);
    const keyEventInit: KeyboardEventInit = {
      key: char,
      bubbles: true,
      cancelable: true,
    };
    element.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
    element.dispatchEvent(new KeyboardEvent('keypress', keyEventInit));
    element.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));

    await randomDelay(minCharDelay, maxCharDelay);
  }
}

/**
 * MutationObserver-based DOM watcher with timeout.
 * Searches either document or a container element.
 */
export function waitForSelector<T extends HTMLElement = HTMLElement>(
  selector: string,
  timeoutMs = 10000,
  root: Document | HTMLElement = document
): Promise<T | null> {
  return new Promise((resolve) => {
    // Check if already in DOM
    const initial = root.querySelector<T>(selector);
    if (initial) {
      resolve(initial);
      return;
    }

    let observer: MutationObserver | null = null;
    let timer: any = null;

    const cleanup = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    observer = new MutationObserver(() => {
      const match = root.querySelector<T>(selector);
      if (match) {
        cleanup();
        resolve(match);
      }
    });

    observer.observe(root === document ? document.body || document.documentElement : root, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    timer = setTimeout(() => {
      cleanup();
      // Final check
      const lastCheck = root.querySelector<T>(selector);
      resolve(lastCheck || null);
    }, timeoutMs);
  });
}

/**
 * Wait for a custom condition predicate to become true
 */
export function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 10000,
  intervalMs = 200
): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const check = () => {
      try {
        if (predicate()) {
          resolve(true);
          return;
        }
      } catch {
        // Continue polling
      }

      if (Date.now() - startTime >= timeoutMs) {
        resolve(false);
        return;
      }

      setTimeout(check, intervalMs);
    };

    check();
  });
}

/**
 * Check element visibility
 */
export function isElementVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
