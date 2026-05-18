export const PAGE_SIZE = 28;
export const DELETE_CONCURRENCY = 5;

const API_BASE = 'https://chatgpt.com/backend-api';
const SESSION_URL = 'https://chatgpt.com/api/auth/session';
const DEBUG_API = false;

async function fetchJson(url, options = {}) {
  const { errorMessage, ...fetchOptions } = options;
  const res = await fetch(url, {
    credentials: 'include',
    ...fetchOptions,
  });

  if (!res.ok) {
    const message = errorMessage
      ? `${errorMessage} (HTTP ${res.status})`
      : `Request failed (HTTP ${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  return res.json();
}

export async function getAccessToken() {
  const data = await fetchJson(SESSION_URL, {
    errorMessage: 'Failed to get session. Please log in to ChatGPT first.',
  });

  if (!data.accessToken) {
    throw new Error('No access token found. Please log in to ChatGPT.');
  }

  return data.accessToken;
}

export async function fetchConversations(token, offset) {
  const url = new URL(`${API_BASE}/conversations`);
  url.searchParams.set('offset', offset);
  url.searchParams.set('limit', PAGE_SIZE);
  url.searchParams.set('order', 'updated');

  if (DEBUG_API) {
    console.log('[ChatGPT Batch Delete] fetch conversations request', {
      url: url.toString(),
      offset,
      limit: PAGE_SIZE,
    });
  }

  const data = await fetchJson(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    errorMessage: 'Failed to fetch conversations.',
  });

  if (DEBUG_API) {
    console.log('[ChatGPT Batch Delete] fetch conversations raw data', data);
  }

  return data;
}

export async function deleteConversation(token, conversationId, { signal } = {}) {
  return fetchJson(`${API_BASE}/conversation/${conversationId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ is_visible: false }),
    signal,
    errorMessage: `Failed to delete conversation ${conversationId}.`,
  });
}
