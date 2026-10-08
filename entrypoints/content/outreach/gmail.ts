import { randomDelay, simulateClick, setNativeValue } from '@/src/lib/dom-utils';

export interface GmailComposeParams {
  to: string;
  subject: string;
  body: string;
  action?: 'draft' | 'send';
}

export interface GmailOutreachResult {
  success: boolean;
  message: string;
  details?: any;
}

/**
 * Executes cold email composition and optional sending directly inside an authenticated Gmail web tab.
 */
export async function executeGmailOutreach(params: GmailComposeParams): Promise<GmailOutreachResult> {
  const { to, subject, body, action = 'draft' } = params;

  if (!to || !to.includes('@')) {
    return { success: false, message: 'Valid recipient email address is required.' };
  }

  // 1. Locate Gmail Compose button
  const composeSelectors = [
    'div[role="button"][gh="cm"]',
    '.T-I.T-I-KE.L3',
    '[data-tooltip*="Compose"]',
    'div[aria-label="Compose"]',
    '.T-I.J-J5-Ji.T-I-KE.L3',
  ];

  let composeBtn: HTMLElement | null = null;
  for (const sel of composeSelectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
      composeBtn = el;
      break;
    }
  }

  if (!composeBtn) {
    // Attempt keyboard shortcut 'c' as fallback
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
  } else {
    await simulateClick(composeBtn);
  }

  await randomDelay(1200, 2000);

  // 2. Locate active Compose dialog window
  const composeDialog =
    document.querySelector<HTMLElement>('div[role="dialog"][aria-label*="Message"]') ||
    document.querySelector<HTMLElement>('div[role="dialog"][aria-label*="Compose"]') ||
    document.querySelector<HTMLElement>('div[role="dialog"]');

  if (!composeDialog) {
    return {
      success: false,
      message: 'Could not open Gmail Compose dialog. Ensure you are signed in to Gmail.',
    };
  }

  // 3. Fill "To" recipient
  const toSelectors = [
    'input[peoplekit-id]',
    'input[aria-label*="To recipients"]',
    'input[name="to"]',
    'textarea[name="to"]',
    'div[name="to"] input',
    'input[aria-label*="To"]',
  ];

  let toInput: HTMLElement | null = null;
  for (const sel of toSelectors) {
    const el = composeDialog.querySelector<HTMLElement>(sel);
    if (el) {
      toInput = el;
      break;
    }
  }

  if (toInput) {
    toInput.focus();
    if (toInput instanceof HTMLInputElement || toInput instanceof HTMLTextAreaElement) {
      setNativeValue(toInput, to);
    } else {
      toInput.textContent = to;
    }
    toInput.dispatchEvent(new Event('input', { bubbles: true }));
    toInput.dispatchEvent(new Event('change', { bubbles: true }));
    // Commit the recipient chip with Enter
    toInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await randomDelay(400, 800);
  } else {
    return { success: false, message: 'Could not locate recipient "To" input in Gmail compose window.' };
  }

  // 4. Fill Subject line
  const subjectSelectors = [
    'input[name="subjectbox"]',
    'input[placeholder*="Subject"]',
    'input[aria-label*="Subject"]',
  ];

  let subjectInput: HTMLInputElement | null = null;
  for (const sel of subjectSelectors) {
    const el = composeDialog.querySelector<HTMLInputElement>(sel);
    if (el) {
      subjectInput = el;
      break;
    }
  }

  if (subjectInput && subject) {
    subjectInput.focus();
    setNativeValue(subjectInput, subject);
    subjectInput.dispatchEvent(new Event('input', { bubbles: true }));
    subjectInput.dispatchEvent(new Event('change', { bubbles: true }));
    await randomDelay(300, 600);
  }

  // 5. Fill Message Body
  const bodySelectors = [
    'div[role="textbox"][aria-label*="Message Body"]',
    'div[contenteditable="true"][aria-label*="Message Body"]',
    'div.Am.Al.editable',
    'div[role="textbox"]',
  ];

  let bodyElement: HTMLElement | null = null;
  for (const sel of bodySelectors) {
    const el = composeDialog.querySelector<HTMLElement>(sel);
    if (el) {
      bodyElement = el;
      break;
    }
  }

  if (bodyElement && body) {
    bodyElement.focus();
    // Convert linebreaks to paragraphs/breaks for Gmail rich text editor
    const formattedHtml = body
      .split('\n\n')
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    bodyElement.innerHTML = formattedHtml;
    bodyElement.dispatchEvent(new Event('input', { bubbles: true }));
    bodyElement.dispatchEvent(new Event('change', { bubbles: true }));
    await randomDelay(500, 900);
  } else {
    return { success: false, message: 'Could not locate message body container in Gmail compose window.' };
  }

  // 6. Execute Send or retain Draft
  if (action === 'send') {
    const sendSelectors = [
      'div[role="button"][data-tooltip*="Send"]',
      '.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3',
      'div[aria-label*="Send"]',
      'div[role="button"]:has(span:contains("Send"))',
    ];

    let sendBtn: HTMLElement | null = null;
    for (const sel of sendSelectors) {
      const el = composeDialog.querySelector<HTMLElement>(sel);
      if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
        sendBtn = el;
        break;
      }
    }

    if (sendBtn) {
      await simulateClick(sendBtn);
      await randomDelay(1500, 2500);
      return {
        success: true,
        message: `Cold email successfully sent to ${to}.`,
        details: { to, subject, action: 'send' },
      };
    } else {
      // Shortcut Ctrl+Enter fallback
      bodyElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, ctrlKey: true, bubbles: true })
      );
      await randomDelay(1500, 2500);
      return {
        success: true,
        message: `Send command dispatched for ${to}.`,
        details: { to, subject, action: 'send' },
      };
    }
  }

  // Draft mode: Gmail automatically auto-saves. Optionally close dialog to dock in drafts.
  return {
    success: true,
    message: `Cold outreach email composed and saved as draft in Gmail for ${to}.`,
    details: { to, subject, action: 'draft' },
  };
}
