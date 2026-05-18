const CHATGPT_CONVERSATION_URL = 'https://chatgpt.com/c/';

export async function openConversationInBackgroundTab(conversationId) {
  await chrome.tabs.create({
    url: `${CHATGPT_CONVERSATION_URL}${conversationId}`,
    active: false,
  });
}
