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
