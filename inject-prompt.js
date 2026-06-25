// Opens a fresh ChatGPT tab and types the prompt into the page's own composer,
// then triggers the page's own send button. Because the actual send is performed
// by ChatGPT's page JS, it computes the sentinel / proof-of-work tokens itself —
// which a popup fetch cannot do (that path returns 403).

const NEW_CHAT_URL = 'https://chatgpt.com/';

// Runs INSIDE the ChatGPT tab. Polls for the composer, inserts text, optionally
// clicks send. Returns a status string. Must be self-contained (no closures).
function fillAndSend(prompt, autoSubmit) {
  return new Promise((resolve) => {
    const deadline = Date.now() + 15000; // wait up to 15s for the composer to mount

    const findComposer = () =>
      document.querySelector('#prompt-textarea') ||
      document.querySelector('div[contenteditable="true"].ProseMirror') ||
      document.querySelector('textarea[data-testid="prompt-textarea"]') ||
      document.querySelector('textarea');

    const findSendButton = () =>
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[data-testid="composer-send-button"]') ||
      document.querySelector('button[aria-label*="Send" i]');

    const tick = () => {
      const composer = findComposer();
      if (!composer) {
        if (Date.now() > deadline) {
          resolve('error: composer not found');
          return;
        }
        setTimeout(tick, 250);
        return;
      }

      composer.focus();

      if (composer.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        ).set;
        setter.call(composer, prompt);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // contenteditable (ProseMirror): execCommand triggers its input handling.
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, prompt);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (!autoSubmit) {
        resolve('filled');
        return;
      }

      // Give ProseMirror a moment to register the value before clicking send.
      const trySend = (attempt) => {
        const btn = findSendButton();
        if (btn && !btn.disabled) {
          btn.click();
          resolve('sent');
          return;
        }
        if (attempt > 20) {
          resolve('filled'); // could not auto-send; leave it for the user
          return;
        }
        setTimeout(() => trySend(attempt + 1), 150);
      };
      trySend(0);
    };

    tick();
  });
}

// Opens the tab, waits for it to finish loading, injects fillAndSend.
export async function sendPromptToNewChat(prompt, { autoSubmit = true } = {}) {
  const tab = await chrome.tabs.create({ url: NEW_CHAT_URL, active: true });

  await waitForTabComplete(tab.id);

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillAndSend,
    args: [prompt, autoSubmit],
  });

  return result?.result || 'unknown';
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}
