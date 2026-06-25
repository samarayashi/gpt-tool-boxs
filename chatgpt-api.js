export const PAGE_SIZE = 28;
export const DELETE_CONCURRENCY = 5;
export const MOVE_CONCURRENCY = 5;

const API_BASE = 'https://chatgpt.com/backend-api';
const SESSION_URL = 'https://chatgpt.com/api/auth/session';
// limit must be <= 50 (server returns HTTP 422 otherwise); conversations_per_gizmo=0
// skips the per-project conversation previews we don't need.
const PROJECTS_PAGE_LIMIT = 50;
const PROJECTS_CONVERSATIONS_PER_GIZMO = 0;
const PROJECTS_MAX_PAGES = 20;
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
    console.log('[ChatGPT Batch] fetch conversations request', {
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
    console.log('[ChatGPT Batch] fetch conversations raw data', data);
  }

  return data;
}

// Fetches a single conversation (full message tree) for previewing.
export async function fetchConversationDetail(token, conversationId, { signal } = {}) {
  return fetchJson(`${API_BASE}/conversation/${conversationId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
    errorMessage: 'Failed to load conversation preview.',
  });
}

// Reduces a conversation detail into a light preview: first user question and
// latest assistant reply. Skips system/tool/non-text nodes; clips long text.
export function summarizeConversation(detail, { maxChars = 400 } = {}) {
  const messages = Object.values(detail?.mapping || {})
    .filter(
      (node) =>
        node.message &&
        (node.message.author?.role === 'user' || node.message.author?.role === 'assistant') &&
        node.message.content?.content_type === 'text'
    )
    .map((node) => ({
      role: node.message.author.role,
      time: node.message.create_time || 0,
      text: (node.message.content.parts || [])
        .filter((part) => typeof part === 'string')
        .join('\n')
        .trim(),
    }))
    .filter((m) => m.text.length > 0)
    .sort((a, b) => a.time - b.time);

  const clip = (s) => (s.length > maxChars ? `${s.slice(0, maxChars)}…` : s);
  const firstUser = messages.find((m) => m.role === 'user');
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  return {
    title: detail?.title || 'Untitled',
    messageCount: messages.length,
    firstUser: firstUser ? clip(firstUser.text) : '',
    lastAssistant: lastAssistant ? clip(lastAssistant.text) : '',
  };
}

// Both delete and move-to-project are PATCHes to the same conversation endpoint;
// they differ only in the body field.
async function patchConversation(token, conversationId, patch, { signal, errorMessage } = {}) {
  return fetchJson(`${API_BASE}/conversation/${conversationId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
    signal,
    errorMessage,
  });
}

export async function deleteConversation(token, conversationId, { signal } = {}) {
  return patchConversation(token, conversationId, { is_visible: false }, {
    signal,
    errorMessage: `Failed to delete conversation ${conversationId}.`,
  });
}

export async function renameConversation(token, conversationId, title) {
  return patchConversation(token, conversationId, { title }, {
    errorMessage: `Failed to rename conversation ${conversationId}.`,
  });
}

export async function moveConversationToProject(token, conversationId, gizmoId, { signal } = {}) {
  return patchConversation(token, conversationId, { gizmo_id: gizmoId }, {
    signal,
    errorMessage: `Failed to move conversation ${conversationId}.`,
  });
}

// Lists the user's projects (snorlax gizmos) from the sidebar endpoint.
// Each item is double-nested: items[].gizmo.gizmo holds the real gizmo.
export async function fetchProjects(token) {
  const projects = [];
  let cursor = null;
  let page = 0;

  do {
    const url = new URL(`${API_BASE}/gizmos/snorlax/sidebar`);
    url.searchParams.set('owned_only', 'true');
    url.searchParams.set('conversations_per_gizmo', PROJECTS_CONVERSATIONS_PER_GIZMO);
    url.searchParams.set('limit', PROJECTS_PAGE_LIMIT);
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }

    const data = await fetchJson(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      errorMessage: 'Failed to fetch projects.',
    });

    for (const item of data.items || []) {
      const gizmo = item?.gizmo?.gizmo;
      if (gizmo?.id && gizmo.gizmo_type === 'snorlax') {
        projects.push({
          id: gizmo.id,
          name: gizmo.display?.name || 'Untitled project',
        });
      }
    }

    cursor = data.cursor || null;
    page += 1;
  } while (cursor && page < PROJECTS_MAX_PAGES);

  return projects;
}

// Returns all user+assistant text messages in chronological order.
export function getAllMessages(detail) {
  return Object.values(detail?.mapping || {})
    .filter(
      (node) =>
        node.message &&
        (node.message.author?.role === 'user' || node.message.author?.role === 'assistant') &&
        node.message.content?.content_type === 'text'
    )
    .map((node) => ({
      role: node.message.author.role,
      time: node.message.create_time || 0,
      text: (node.message.content.parts || [])
        .filter((part) => typeof part === 'string')
        .join('\n')
        .trim(),
    }))
    .filter((m) => m.text.length > 0)
    .sort((a, b) => a.time - b.time);
}

// NOTE: Creating a new conversation via POST /conversation is intentionally NOT
// done here. That endpoint requires a sentinel chat-requirements token plus a
// proof-of-work token that only ChatGPT's own page JS can produce; a popup fetch
// returns 403. "Send to New Chat" instead injects the prompt into a real ChatGPT
// tab and lets the page send it (see inject-prompt.js).

// Groups a flat message array into { user, assistant } exchange pairs.
export function groupIntoExchanges(messages) {
  const exchanges = [];
  let i = 0;
  while (i < messages.length) {
    if (messages[i].role === 'user') {
      const next = messages[i + 1];
      const assistant = next?.role === 'assistant' ? next : null;
      exchanges.push({ user: messages[i], assistant });
      i += assistant ? 2 : 1;
    } else {
      exchanges.push({ user: null, assistant: messages[i] });
      i++;
    }
  }
  return exchanges;
}

// memoryScope: 'global' (shared global memory) or 'project_v2' (project-only context).
export async function createProject(token, name, memoryScope = 'global') {
  const data = await fetchJson(`${API_BASE}/projects`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ instructions: '', name, memory_scope: memoryScope }),
    errorMessage: 'Failed to create project.',
  });

  const gizmo = data?.resource?.gizmo;
  if (!gizmo?.id) {
    throw new Error('Project created but no id was returned.');
  }

  return { id: gizmo.id, name: gizmo.display?.name || name };
}
