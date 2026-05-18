// Only enable the extension icon on chatgpt.com tabs
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.disable();

  chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
    chrome.declarativeContent.onPageChanged.addRules([
      {
        conditions: [
          new chrome.declarativeContent.PageStateMatcher({
            pageUrl: { hostSuffix: 'chatgpt.com' },
          }),
        ],
        actions: [new chrome.declarativeContent.ShowAction()],
      },
    ]);
  });
});
