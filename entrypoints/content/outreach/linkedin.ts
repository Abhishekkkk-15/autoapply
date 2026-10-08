import { randomDelay, simulateClick, setNativeValue } from '@/src/lib/dom-utils';

export interface LinkedInOutreachParams {
  profileUrl?: string;
  note: string;
  action?: 'connect' | 'message';
}

export interface LinkedInOutreachResult {
  success: boolean;
  message: string;
  details?: any;
}

/**
 * Executes automated connection request or direct follow-up message on a LinkedIn profile.
 */
export async function executeLinkedInOutreach(
  params: LinkedInOutreachParams
): Promise<LinkedInOutreachResult> {
  const { note, action = 'connect' } = params;

  if (!note || note.trim().length === 0) {
    return { success: false, message: 'Outreach note content is required.' };
  }

  // Enforce LinkedIn 300-character constraint for connection notes
  let cleanNote = note.trim();
  if (cleanNote.length > 295) {
    cleanNote = cleanNote.slice(0, 290) + '...';
  }

  // 1. If action is 'message' or if candidate is already a 1st degree connection
  if (action === 'message') {
    return await executeDirectMessage(cleanNote);
  }

  // 2. Connect Flow
  // A. Check for direct "Connect" button in the profile action bar
  const actionButtons = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.pvs-profile-actions button, .ph5 button, section button, button[aria-label*="to connect"]'
    )
  );

  let connectBtn: HTMLElement | null = null;
  for (const b of actionButtons) {
    if (b.offsetWidth === 0 && b.offsetHeight === 0) continue;
    const txt = b.textContent?.trim().toLowerCase() || '';
    const aria = b.getAttribute('aria-label')?.toLowerCase() || '';

    if (txt === 'connect' || aria.includes('invite') && aria.includes('connect')) {
      connectBtn = b;
      break;
    }
  }

  // B. If not found directly, look inside the "More" dropdown
  if (!connectBtn) {
    const moreBtn = actionButtons.find((b) => {
      const txt = b.textContent?.trim().toLowerCase() || '';
      const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
      return txt === 'more' || aria.includes('more actions');
    });

    if (moreBtn) {
      await simulateClick(moreBtn);
      await randomDelay(600, 1000);

      const dropdownItems = Array.from(
        document.querySelectorAll<HTMLElement>(
          'div[role="menu"] div[role="button"], .artdeco-dropdown__content div[role="button"], [role="menuitem"]'
        )
      );

      for (const item of dropdownItems) {
        const itemTxt = item.textContent?.trim().toLowerCase() || '';
        const aria = item.getAttribute('aria-label')?.toLowerCase() || '';
        if (itemTxt.includes('connect') || aria.includes('connect')) {
          connectBtn = item;
          break;
        }
      }
    }
  }

  // If still not found, check if only "Message" or "Pending" exists
  if (!connectBtn) {
    const isPending = actionButtons.some((b) => b.textContent?.trim().toLowerCase().includes('pending'));
    if (isPending) {
      return {
        success: true,
        message: 'Connection request is already pending for this profile.',
        details: { status: 'PENDING' },
      };
    }

    // Attempt direct message if already connected
    return await executeDirectMessage(cleanNote);
  }

  // C. Click Connect button
  await simulateClick(connectBtn);
  await randomDelay(1000, 1800);

  // D. Find "Add a note" button in the connection invitation modal
  const modal =
    document.querySelector<HTMLElement>('div[role="dialog"]') ||
    document.querySelector<HTMLElement>('.artdeco-modal');

  if (modal) {
    const addNoteBtn = Array.from(modal.querySelectorAll<HTMLElement>('button')).find((b) => {
      const txt = b.textContent?.trim().toLowerCase() || '';
      const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
      return txt.includes('add a note') || aria.includes('add a note');
    });

    if (addNoteBtn) {
      await simulateClick(addNoteBtn);
      await randomDelay(600, 1000);
    }

    // E. Fill note textarea
    const textarea =
      modal.querySelector<HTMLTextAreaElement>('textarea[name="message"]') ||
      modal.querySelector<HTMLTextAreaElement>('textarea#custom-message') ||
      modal.querySelector<HTMLTextAreaElement>('textarea');

    if (textarea) {
      textarea.focus();
      setNativeValue(textarea, cleanNote);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      await randomDelay(500, 1000);
    }

    // F. Click "Send" button in modal
    const sendBtn = Array.from(modal.querySelectorAll<HTMLElement>('button')).find((b) => {
      const txt = b.textContent?.trim().toLowerCase() || '';
      const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
      return (
        (txt === 'send' || txt === 'send now' || txt === 'send invitation' || aria.includes('send invitation')) &&
        !txt.includes('dismiss') &&
        !aria.includes('dismiss')
      );
    });

    if (sendBtn) {
      await simulateClick(sendBtn);
      await randomDelay(1500, 2500);
      return {
        success: true,
        message: 'Connection request with custom note dispatched successfully.',
        details: { note: cleanNote, action: 'connect' },
      };
    }
  }

  return {
    success: false,
    message: 'Could not complete LinkedIn connection flow modal.',
  };
}

async function executeDirectMessage(messageText: string): Promise<LinkedInOutreachResult> {
  const messageButtons = Array.from(
    document.querySelectorAll<HTMLElement>('.pvs-profile-actions button, button[aria-label*="Message"]')
  );

  const msgBtn = messageButtons.find((b) => {
    const txt = b.textContent?.trim().toLowerCase() || '';
    const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
    return txt === 'message' || aria.includes('message');
  });

  if (!msgBtn) {
    return {
      success: false,
      message: 'Could not locate Connect or Message button on this LinkedIn profile.',
    };
  }

  await simulateClick(msgBtn);
  await randomDelay(1200, 2000);

  // Look for chat compose box
  const chatBox =
    document.querySelector<HTMLElement>('div[role="textbox"][aria-label*="Write a message"]') ||
    document.querySelector<HTMLElement>('div.msg-form__contenteditable') ||
    document.querySelector<HTMLElement>('div[contenteditable="true"]');

  if (chatBox) {
    chatBox.focus();
    chatBox.textContent = messageText;
    chatBox.dispatchEvent(new Event('input', { bubbles: true }));
    chatBox.dispatchEvent(new Event('change', { bubbles: true }));
    await randomDelay(800, 1500);

    const sendMsgBtn = document.querySelector<HTMLElement>(
      'button.msg-form__send-button, button[type="submit"].msg-form__send-btn'
    );
    if (sendMsgBtn && !sendMsgBtn.hasAttribute('disabled')) {
      await simulateClick(sendMsgBtn);
      await randomDelay(1500, 2500);
      return {
        success: true,
        message: 'Direct follow-up message sent successfully on LinkedIn.',
        details: { action: 'message' },
      };
    }
  }

  return {
    success: false,
    message: 'Message dialog opened, but could not locate chat input or send button.',
  };
}
