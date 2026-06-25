import {
  PAGE_SIZE,
  DELETE_CONCURRENCY,
  MOVE_CONCURRENCY,
  fetchConversations,
  fetchConversationDetail,
  fetchProjects,
  createProject,
  deleteConversation,
  moveConversationToProject,
  renameConversation,
  getAccessToken,
  summarizeConversation,
  getAllMessages,
  groupIntoExchanges,
} from './chatgpt-api.js';
import { runWithQueue } from './task-queue.js';
import { openConversationInBackgroundTab } from './tab-navigation.js';
import { sendPromptToNewChat } from './inject-prompt.js';
import {
  appendConversationItems,
  els,
  getSearchQuery,
  hideDeleteConfirmation,
  getMemoryScope,
  hidePreviewModal,
  hideProjectModal,
  hideContextModal,
  hideStatus,
  isInProject,
  renderList,
  renderContextConvList,
  renderProjectList,
  setContextOptActive,
  setExpandedPreview,
  setLoadingMessage,
  setNewProjectFormVisible,
  setProjectListMessage,
  setProjectNameMap,
  showContextFullView,
  showContextExchangeFullView,
  showContextStatus,
  showDeleteConfirmation,
  showPreviewModal,
  showProjectModal,
  showContextModal,
  showStatus,
  updateModeSwitch,
  updatePreviewStyleSwitch,
  updateProjectConfirm,
  updateToolbar,
  updateTotalInfo,
} from './popup-view.js';

const SCROLL_LOAD_THRESHOLD_PX = 100;
const LOAD_ALL_PAGE_DELAY_MS = 700;

const state = {
  conversations: [],
  filteredConversations: [],
  selectedIds: new Set(),
  isLoading: false,
  isLoadingAll: false,
  isDeleting: false,
  isMoving: false,
  deleteAbortController: null,
  moveAbortController: null,
  offset: 0,
  hasMore: true,
  mode: 'delete',
  projects: [],
  projectsLoaded: false,
  pickerChoice: null,
  hideInProject: false,
  previewStyle: 'inline',
  expandedId: null,
  previewModalId: null,
  previewCache: new Map(),
  // Context builder
  contextConvDetails: new Map(), // id -> { status, title, exchanges, error }
  contextExpanded: new Set(),
  contextChecked: new Map(),     // id -> Set<number> of checked exchange indices
  contextFormat: 'markdown',
  contextTemplate: 'none',
};

function isBusy() {
  return state.isDeleting || state.isMoving;
}

function matchesSearch(conversation, query) {
  return !query || (conversation.title || 'Untitled').toLowerCase().includes(query);
}

function refreshFilteredConversations() {
  const query = getSearchQuery();
  state.filteredConversations = state.conversations.filter(
    (conversation) =>
      matchesSearch(conversation, query) &&
      (!state.hideInProject || !isInProject(conversation))
  );
}

function updateViewState() {
  updateModeSwitch({ mode: state.mode, isBusy: isBusy() });
  updatePreviewStyleSwitch({ style: state.previewStyle, isBusy: isBusy() });
  updateToolbar({
    conversations: state.filteredConversations,
    selectedIds: state.selectedIds,
    hasMore: state.hasMore,
    isLoading: state.isLoading,
    isLoadingAll: state.isLoadingAll,
    isDeleting: state.isDeleting,
    isMoving: state.isMoving,
    mode: state.mode,
  });
  updateTotalInfo({
    visibleCount: state.filteredConversations.length,
    loadedCount: state.conversations.length,
    hasMore: state.hasMore,
    hasQuery: Boolean(getSearchQuery()),
  });
}

function addConversations(items, append) {
  state.conversations = append ? [...state.conversations, ...items] : items;
  state.offset = append ? state.offset + items.length : items.length;
  state.hasMore = items.length === PAGE_SIZE;
  refreshFilteredConversations();
}

function removeConversations(ids) {
  const idSet = new Set(ids);

  state.conversations = state.conversations.filter(
    (conversation) => !idSet.has(conversation.id)
  );
  state.offset = state.conversations.length;
  ids.forEach((id) => state.selectedIds.delete(id));
  if (state.expandedId && idSet.has(state.expandedId)) {
    state.expandedId = null;
    setExpandedPreview(null, null);
  }
  refreshFilteredConversations();
}

async function loadConversations({ append = false, preserveStatus = false } = {}) {
  if (state.isLoading || (append && !state.hasMore)) return [];

  state.isLoading = true;

  if (!append) {
    setLoadingMessage('Loading conversations...');
    if (!preserveStatus) {
      hideStatus();
    }
  }

  try {
    const token = await getAccessToken();
    const previousFilteredCount = state.filteredConversations.length;
    const data = await fetchConversations(token, state.offset);
    const items = data.items || [];

    addConversations(items, append);

    if (append) {
      const newVisibleItems = state.filteredConversations.slice(previousFilteredCount);
      if (state.filteredConversations.length === 0) {
        renderList(state.filteredConversations, state.selectedIds);
      } else {
        appendConversationItems(newVisibleItems, state.selectedIds);
      }
    } else {
      renderList(state.filteredConversations, state.selectedIds);
    }

    updateViewState();
    return items;
  } catch (err) {
    if (!append) {
      setLoadingMessage(err.message);
    }
    showStatus(err.message, 'error');
    return null;
  } finally {
    state.isLoading = false;
    updateViewState();
  }
}

async function loadAllConversations() {
  if (!state.hasMore || state.isLoadingAll) return;

  state.isLoadingAll = true;
  showStatus(`Loading all... ${state.conversations.length} loaded`, 'info', {
    autoHide: false,
  });
  updateViewState();

  try {
    while (state.hasMore) {
      const items = await loadConversations({ append: true });
      updateViewState();

      if (items === null) {
        break;
      }

      showStatus(`Loading all... ${state.conversations.length} loaded`, 'info', {
        autoHide: false,
      });

      if (items.length === 0) {
        break;
      }

      if (state.hasMore) {
        await delay(LOAD_ALL_PAGE_DELAY_MS);
      }
    }

    if (!state.hasMore) {
      showStatus(`Loaded ${pluralizeConversation(state.conversations.length)}.`, 'success');
    }
  } finally {
    state.isLoadingAll = false;
    updateViewState();
  }
}

function handleConversationListClick(event) {
  if (isBusy()) return;

  // "Open full chat" button lives inside the inline preview (a sibling of the row).
  const openBtn = event.target.closest('.preview-open');
  if (openBtn) {
    openInTab(openBtn.dataset.id);
    return;
  }

  // Rename button (✎) on hover.
  const renameBtn = event.target.closest('[data-action="rename"]');
  if (renameBtn) {
    const item = renameBtn.closest('.conversation-item');
    const titleEl = item?.querySelector('.conv-title');
    const conv = state.conversations.find((c) => c.id === renameBtn.dataset.id);
    if (titleEl && conv) startInlineRename(conv, titleEl);
    return;
  }

  const item = event.target.closest('.conversation-item');
  if (!item) return; // clicks inside the inline preview text land here and do nothing

  const checkbox = item.querySelector('input[type="checkbox"]');
  if (event.target === checkbox) {
    setSelection(item.dataset.id, checkbox.checked);
    return;
  }

  activatePreview(item.dataset.id);
}

async function openInTab(id) {
  try {
    await openConversationInBackgroundTab(id);
    showStatus('Opened in a background tab.', 'success');
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

// --- Conversation preview ---

function activatePreview(id) {
  if (state.previewStyle === 'modal') {
    openPreviewModal(id);
  } else {
    toggleInlinePreview(id);
  }
}

async function loadSummary(id) {
  if (state.previewCache.has(id)) return state.previewCache.get(id);
  const token = await getAccessToken();
  const detail = await fetchConversationDetail(token, id);
  const summary = summarizeConversation(detail);
  state.previewCache.set(id, summary);
  return summary;
}

async function toggleInlinePreview(id) {
  if (state.expandedId === id) {
    state.expandedId = null;
    setExpandedPreview(null, null);
    renderList(state.filteredConversations, state.selectedIds);
    return;
  }

  state.expandedId = id;
  const cached = state.previewCache.get(id) || null;
  setExpandedPreview(id, cached);
  renderList(state.filteredConversations, state.selectedIds);
  if (cached) return;

  try {
    const summary = await loadSummary(id);
    if (state.expandedId === id) {
      setExpandedPreview(id, summary);
      renderList(state.filteredConversations, state.selectedIds);
    }
  } catch (err) {
    if (state.expandedId === id) {
      setExpandedPreview(id, { error: err.message });
      renderList(state.filteredConversations, state.selectedIds);
    }
  }
}

async function openPreviewModal(id) {
  state.previewModalId = id;
  const cached = state.previewCache.get(id) || null;
  showPreviewModal(id, cached);
  if (cached) return;

  try {
    const summary = await loadSummary(id);
    if (state.previewModalId === id) showPreviewModal(id, summary);
  } catch (err) {
    if (state.previewModalId === id) showPreviewModal(id, { error: err.message });
  }
}

function setPreviewStyle(style) {
  if (isBusy() || state.previewStyle === style) return;

  state.previewStyle = style;
  // Reset any open preview so switching styles starts clean.
  state.expandedId = null;
  setExpandedPreview(null, null);
  hidePreviewModal();
  renderList(state.filteredConversations, state.selectedIds);
  updateViewState();
}

function setSelection(id, selected) {
  if (selected) {
    state.selectedIds.add(id);
  } else {
    state.selectedIds.delete(id);
  }

  updateViewState();
}

function handleSelectAllChange() {
  if (isBusy()) return;

  state.filteredConversations.forEach((conversation) => {
    if (els.selectAll.checked) {
      state.selectedIds.add(conversation.id);
    } else {
      state.selectedIds.delete(conversation.id);
    }
  });

  renderList(state.filteredConversations, state.selectedIds);
  updateViewState();
}

function handleSearchInput() {
  if (isBusy()) return;

  refreshFilteredConversations();
  renderList(state.filteredConversations, state.selectedIds);
  updateViewState();
}

function handleListScroll() {
  if (isBusy()) return;

  const distanceFromBottom =
    els.list.scrollHeight - els.list.scrollTop - els.list.clientHeight;

  if (distanceFromBottom < SCROLL_LOAD_THRESHOLD_PX) {
    loadConversations({ append: true });
  }
}

function setMode(mode) {
  if (isBusy() || state.mode === mode) return;
  state.mode = mode;
  updateViewState();
}

// --- Context Builder ---

async function openContextBuilder() {
  const ids = [...state.selectedIds];
  if (ids.length === 0) return;

  // Seed state for any newly selected conversation.
  ids.forEach((id) => {
    if (!state.contextConvDetails.has(id)) {
      const conv = state.conversations.find((c) => c.id === id);
      state.contextConvDetails.set(id, {
        status: 'loading',
        title: conv?.title || 'Untitled',
        exchanges: [],
        error: null,
      });
    }
  });

  // Default: all collapsed — user already knows the content when selecting.

  showContextModal(ids.length);
  renderContextBuilder();

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    showStatus(err.message, 'error');
    hideContextModal();
    return;
  }

  // Fetch all selected conversations in parallel; re-render as each arrives.
  await Promise.all(
    ids.map(async (id) => {
      const existing = state.contextConvDetails.get(id);
      if (existing?.status === 'ready') return;

      try {
        const detail = await fetchConversationDetail(token, id);
        const messages = getAllMessages(detail);
        const exchanges = groupIntoExchanges(messages);

        state.contextConvDetails.set(id, {
          status: 'ready',
          title: detail.title || existing?.title || 'Untitled',
          exchanges,
          error: null,
        });

        // Default: all exchanges checked on first load.
        if (!state.contextChecked.has(id)) {
          state.contextChecked.set(id, new Set(exchanges.map((_, i) => i)));
        }
      } catch (err) {
        state.contextConvDetails.set(id, {
          status: 'error',
          title: existing?.title || 'Untitled',
          exchanges: [],
          error: err.message,
        });
      }

      if (!els.contextModal.classList.contains('hidden')) {
        renderContextBuilder();
      }
    })
  );
}

function renderContextBuilder() {
  const ids = [...state.selectedIds];
  const items = ids.map((id) => {
    const detail = state.contextConvDetails.get(id) || {
      status: 'loading',
      title: 'Untitled',
      exchanges: [],
      error: null,
    };
    return {
      id,
      title: detail.title,
      status: detail.status,
      exchanges: detail.exchanges,
      error: detail.error,
      expanded: state.contextExpanded.has(id),
      checked: state.contextChecked.get(id) || new Set(),
    };
  });
  renderContextConvList(items);
}

function handleContextConvListClick(event) {
  // Per-exchange "view full" — pops up just this Q&A pair.
  const exBtn = event.target.closest('[data-action="view-exchange"]');
  if (exBtn) {
    // Prevent the wrapping <label> from toggling its checkbox.
    event.preventDefault();
    const { id, idx } = exBtn.dataset;
    const detail = state.contextConvDetails.get(id);
    const exchange = detail?.exchanges?.[Number(idx)];
    if (exchange) showContextExchangeFullView(detail.title, exchange, Number(idx));
    return;
  }

  // "View" — open full conversation in preview modal.
  const viewBtn = event.target.closest('[data-action="view"]');
  if (viewBtn) {
    openConversationFullView(viewBtn.dataset.id);
    return;
  }

  // "All / None" toggle per conversation.
  const toggleAll = event.target.closest('[data-action="toggle-all"]');
  if (toggleAll) {
    const { id } = toggleAll.dataset;
    const detail = state.contextConvDetails.get(id);
    if (!detail || detail.status !== 'ready') return;

    const checked = state.contextChecked.get(id) || new Set();
    const allChecked = detail.exchanges.length > 0 && checked.size === detail.exchanges.length;

    state.contextChecked.set(
      id,
      allChecked ? new Set() : new Set(detail.exchanges.map((_, i) => i))
    );
    renderContextBuilder();
    return;
  }

  // Toggle expand/collapse on header click.
  const header = event.target.closest('[data-action="toggle"]');
  if (header) {
    const { id } = header.dataset;
    if (state.contextExpanded.has(id)) {
      state.contextExpanded.delete(id);
    } else {
      state.contextExpanded.add(id);
    }
    renderContextBuilder();
  }
}

function handleContextExchangeChange(event) {
  const cb = event.target.closest('[data-action="check-exchange"]');
  if (!cb) return;

  const { id, idx } = cb.dataset;
  const checked = state.contextChecked.get(id) || new Set();

  if (cb.checked) {
    checked.add(Number(idx));
  } else {
    checked.delete(Number(idx));
  }
  state.contextChecked.set(id, checked);
  renderContextBuilder();
}

function handleContextSelectAll() {
  for (const id of state.selectedIds) {
    const detail = state.contextConvDetails.get(id);
    if (detail?.status === 'ready') {
      state.contextChecked.set(id, new Set(detail.exchanges.map((_, i) => i)));
    }
  }
  renderContextBuilder();
}

function handleContextDeselectAll() {
  for (const id of state.selectedIds) {
    state.contextChecked.set(id, new Set());
  }
  renderContextBuilder();
}

function openConversationFullView(id) {
  const detail = state.contextConvDetails.get(id);
  if (!detail || detail.status !== 'ready') return;
  showContextFullView(detail.title, detail.exchanges);
}

async function sendToNewChat() {
  const output = assembleContext(state.contextFormat, state.contextTemplate);
  if (!output) {
    showStatus('No content selected. Expand conversations and check exchanges.', 'info');
    return;
  }

  const btn = els.contextSend;
  const originalText = btn.textContent;
  btn.textContent = 'Opening…';
  btn.disabled = true;
  showContextStatus('Opening a new chat…', 'info', { autoHide: false });

  try {
    // Send is performed by ChatGPT's own page JS (handles sentinel / proof-of-work),
    // which a popup fetch cannot do — that path returns 403.
    const result = await sendPromptToNewChat(output, { autoSubmit: true });

    if (result === 'sent') {
      showContextStatus('Sent to a new chat (opened in a background tab).', 'success');
    } else if (result === 'filled') {
      showContextStatus('Prompt filled in a new background tab — switch to it and press Enter.', 'info');
    } else {
      showContextStatus('Opened a new chat, but could not fill the prompt. Paste it manually.', 'error');
    }
  } catch (err) {
    showContextStatus(`Failed to open new chat: ${err.message}`, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function handleContextFormatClick(event) {
  const btn = event.target.closest('.context-opt-btn');
  if (!btn || !btn.dataset.value) return;
  state.contextFormat = btn.dataset.value;
  setContextOptActive(els.contextFormatGroup, state.contextFormat);
}

function handleContextTemplateClick(event) {
  const btn = event.target.closest('.context-opt-btn');
  if (!btn || !btn.dataset.value) return;
  state.contextTemplate = btn.dataset.value;
  setContextOptActive(els.contextTemplateGroup, state.contextTemplate);
}

async function copyContextToClipboard() {
  const output = assembleContext(state.contextFormat, state.contextTemplate);
  if (!output) {
    showContextStatus('No content selected. Expand conversations and check exchanges.', 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(output);
    showContextStatus('Copied to clipboard!', 'success');
  } catch {
    showContextStatus('Clipboard write failed. Try again.', 'error');
  }
}

function assembleContext(format, template) {
  const ids = [...state.selectedIds];
  const sections = [];

  for (const id of ids) {
    const detail = state.contextConvDetails.get(id);
    if (!detail || detail.status !== 'ready') continue;

    const checked = state.contextChecked.get(id) || new Set();
    const selected = detail.exchanges.filter((_, i) => checked.has(i));
    if (selected.length === 0) continue;

    sections.push({ title: detail.title, exchanges: selected });
  }

  if (sections.length === 0) return '';

  let contextBlock;

  if (format === 'xml') {
    const escX = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = sections
      .map(({ title, exchanges }) => {
        const exXml = exchanges
          .map(({ user, assistant }) => {
            const parts = [];
            if (user) parts.push(`      <user>${escX(user.text)}</user>`);
            if (assistant) parts.push(`      <assistant>${escX(assistant.text)}</assistant>`);
            return `    <exchange>\n${parts.join('\n')}\n    </exchange>`;
          })
          .join('\n');
        return `  <conversation title="${escX(title)}">\n${exXml}\n  </conversation>`;
      })
      .join('\n');
    contextBlock = `<context>\n${body}\n</context>`;
  } else if (format === 'plain') {
    contextBlock = sections
      .map(({ title, exchanges }) => {
        const lines = [`=== From: "${title}" ===\n`];
        exchanges.forEach(({ user, assistant }) => {
          if (user) lines.push(`[You] ${user.text}`);
          if (assistant) lines.push(`[ChatGPT] ${assistant.text}`);
          lines.push('');
        });
        return lines.join('\n');
      })
      .join('\n---\n\n');
  } else {
    // markdown (default)
    contextBlock = sections
      .map(({ title, exchanges }) => {
        const lines = [`## From: "${title}"\n`];
        exchanges.forEach(({ user, assistant }) => {
          if (user) lines.push(`**You:** ${user.text}`);
          if (assistant) lines.push(`**ChatGPT:** ${assistant.text}`);
          lines.push('');
        });
        return lines.join('\n');
      })
      .join('\n---\n\n');
    contextBlock = `<!-- Context from previous conversations -->\n\n${contextBlock}`;
  }

  const templates = {
    summarize: 'Please summarize the key points and insights from the above conversations.',
    outline:
      'Based on the above conversations, please create a structured outline of the main topics and ideas discussed.',
    reorganize:
      'Please synthesize and reorganize the information from the above conversations into a clear, coherent summary.',
  };

  const instruction = templates[template];
  return instruction ? `${contextBlock}\n\n---\n\n${instruction}` : contextBlock;
}

function handlePrimaryClick() {
  if (state.isDeleting) {
    cancelDelete();
    return;
  }
  if (state.isMoving) {
    cancelMove();
    return;
  }

  if (state.selectedIds.size === 0) return;

  if (state.mode === 'delete') {
    showDeleteConfirmation(state.selectedIds.size);
  } else if (state.mode === 'move') {
    openProjectPicker();
  } else {
    openContextBuilder();
  }
}

// --- Delete flow ---

async function performDelete() {
  hideDeleteConfirmation();

  const ids = [...state.selectedIds];
  const total = ids.length;
  const abortController = new AbortController();

  state.isDeleting = true;
  state.deleteAbortController = abortController;
  showStatus(`Deleting ${pluralizeConversation(total)}...`, 'info', { autoHide: false });
  updateViewState();

  try {
    const token = await getAccessToken();
    const result = await runWithQueue({
      ids,
      worker: (id, { signal }) => deleteConversation(token, id, { signal }),
      concurrency: DELETE_CONCURRENCY,
      signal: abortController.signal,
      onProgress: ({ processed }) => {
        showStatus(`Deleting... ${processed}/${total}`, 'info', { autoHide: false });
      },
    });

    showStatus(getDeleteResultMessage(result), getResultType(result));

    if (result.succeeded > 0) {
      removeConversations(result.succeededIds);
    }
    renderList(state.filteredConversations, state.selectedIds);
  } catch (err) {
    if (!isAbortError(err)) {
      showStatus(`Error: ${err.message}`, 'error');
    }
  } finally {
    state.isDeleting = false;
    state.deleteAbortController = null;
    updateViewState();
  }
}

function cancelDelete() {
  if (!state.isDeleting) return;

  state.deleteAbortController?.abort();
  showStatus('Canceling delete...', 'info', { autoHide: false });
  updateViewState();
}

// --- Move-to-project flow ---

function openProjectPicker() {
  state.pickerChoice = null;
  showProjectModal(state.selectedIds.size);
  updateProjectConfirm(null);
  loadProjects();
}

// Fetches projects into state and refreshes the gizmo_id -> name map used for row tags.
async function ensureProjects({ force = false } = {}) {
  if (state.projectsLoaded && !force) return state.projects;

  const token = await getAccessToken();
  state.projects = await fetchProjects(token);
  state.projectsLoaded = true;
  setProjectNameMap(new Map(state.projects.map((p) => [p.id, p.name])));
  return state.projects;
}

async function loadProjects({ force = false } = {}) {
  if (state.projectsLoaded && !force) {
    renderProjectList(state.projects, { selectedId: getSelectedProjectId(), query: getProjectQuery() });
    return;
  }

  setProjectListMessage('Loading projects...');

  try {
    await ensureProjects({ force });
    renderProjectList(state.projects, { selectedId: getSelectedProjectId(), query: getProjectQuery() });
  } catch (err) {
    setProjectListMessage(`${err.message} (click to retry)`);
    els.projectList.querySelector('.loading')?.addEventListener('click', () => loadProjects({ force: true }), { once: true });
  }
}

// Load projects in the background on startup so rows can show their project tag,
// then re-render the list. Failure is non-fatal (tags fall back to a generic label).
async function loadProjectTags() {
  try {
    await ensureProjects();
    if (state.conversations.length > 0) {
      renderList(state.filteredConversations, state.selectedIds);
    }
  } catch {
    // Ignore: tags simply won't show project names.
  }
}

function handleHideInProjectChange() {
  if (isBusy()) return;

  state.hideInProject = els.hideInProject.checked;
  refreshFilteredConversations();
  renderList(state.filteredConversations, state.selectedIds);
  updateViewState();
}

function getSelectedProjectId() {
  return state.pickerChoice?.type === 'existing' ? state.pickerChoice.id : null;
}

function getProjectQuery() {
  return els.projectSearch.value;
}

function handleProjectListClick(event) {
  const row = event.target.closest('.project-item');
  if (!row) return;

  const project = state.projects.find((p) => p.id === row.dataset.id);
  if (!project) return;

  state.pickerChoice = { type: 'existing', id: project.id, name: project.name };
  setNewProjectFormVisible(false);
  els.newProjectName.value = '';
  renderProjectList(state.projects, { selectedId: project.id, query: getProjectQuery() });
  updateProjectConfirm(state.pickerChoice);
}

function handleProjectSearchInput() {
  renderProjectList(state.projects, {
    selectedId: getSelectedProjectId(),
    query: getProjectQuery(),
  });
}

function handleNewProjectToggle() {
  state.pickerChoice = { type: 'new', name: els.newProjectName.value };
  setNewProjectFormVisible(true);
  renderProjectList(state.projects, { selectedId: null, query: getProjectQuery() });
  updateProjectConfirm(state.pickerChoice);
}

function handleNewProjectInput() {
  state.pickerChoice = { type: 'new', name: els.newProjectName.value };
  updateProjectConfirm(state.pickerChoice);
}

async function handleProjectConfirm() {
  const choice = state.pickerChoice;
  if (!choice) return;

  if (choice.type === 'existing') {
    hideProjectModal();
    await performMove(choice.id, choice.name);
  } else if (choice.type === 'new') {
    const name = choice.name.trim();
    if (!name) return;
    const memoryScope = getMemoryScope();
    hideProjectModal();
    await createProjectThenMove(name, memoryScope);
  }
}

async function createProjectThenMove(name, memoryScope) {
  const ids = [...state.selectedIds];
  const total = ids.length;
  const abortController = new AbortController();

  state.isMoving = true;
  state.moveAbortController = abortController;
  showStatus(`Creating project "${name}"...`, 'info', { autoHide: false });
  updateViewState();

  try {
    const token = await getAccessToken();
    const project = await createProject(token, name, memoryScope);

    // Refresh cache so the new project appears next time the picker opens.
    state.projectsLoaded = false;

    await runMoveQueue({ token, ids, total, gizmoId: project.id, projectName: project.name, abortController, created: true });
  } catch (err) {
    if (!isAbortError(err)) {
      showStatus(`Error: ${err.message}`, 'error');
    }
  } finally {
    state.isMoving = false;
    state.moveAbortController = null;
    updateViewState();
  }
}

async function performMove(gizmoId, projectName) {
  const ids = [...state.selectedIds];
  const total = ids.length;
  const abortController = new AbortController();

  state.isMoving = true;
  state.moveAbortController = abortController;
  showStatus(`Moving ${pluralizeConversation(total)}...`, 'info', { autoHide: false });
  updateViewState();

  try {
    const token = await getAccessToken();
    await runMoveQueue({ token, ids, total, gizmoId, projectName, abortController, created: false });
  } catch (err) {
    if (!isAbortError(err)) {
      showStatus(`Error: ${err.message}`, 'error');
    }
  } finally {
    state.isMoving = false;
    state.moveAbortController = null;
    updateViewState();
  }
}

async function runMoveQueue({ token, ids, total, gizmoId, projectName, abortController, created }) {
  const result = await runWithQueue({
    ids,
    worker: (id, { signal }) => moveConversationToProject(token, id, gizmoId, { signal }),
    concurrency: MOVE_CONCURRENCY,
    signal: abortController.signal,
    onProgress: ({ processed }) => {
      showStatus(`Moving... ${processed}/${total}`, 'info', { autoHide: false });
    },
  });

  showStatus(getMoveResultMessage(result, projectName, created), getResultType(result));

  if (result.succeeded > 0) {
    removeConversations(result.succeededIds);
  }
  renderList(state.filteredConversations, state.selectedIds);
}

function cancelMove() {
  if (!state.isMoving) return;

  state.moveAbortController?.abort();
  showStatus('Canceling move...', 'info', { autoHide: false });
  updateViewState();
}

// --- Inline rename ---

function startInlineRename(conv, titleEl) {
  const originalTitle = conv.title || 'Untitled';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = originalTitle;
  input.className = 'rename-input';
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;

  const finish = async (save) => {
    if (committed) return;
    committed = true;

    const newTitle = input.value.trim();
    titleEl.textContent = save && newTitle ? newTitle : originalTitle;
    input.replaceWith(titleEl);

    if (!save || !newTitle || newTitle === originalTitle) return;

    try {
      const token = await getAccessToken();
      await renameConversation(token, conv.id, newTitle);
      conv.title = newTitle;
      refreshFilteredConversations();
      showStatus(`Renamed to "${newTitle}".`, 'success');
    } catch (err) {
      titleEl.textContent = originalTitle;
      conv.title = originalTitle;
      showStatus(`Rename failed: ${err.message}`, 'error');
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

// --- Result messages ---

function getDeleteResultMessage({ succeeded, failed, canceled }) {
  if (canceled) {
    return `Canceled. Deleted ${succeeded}, failed ${failed}.`;
  }
  if (failed === 0) {
    return `Successfully deleted ${pluralizeConversation(succeeded)}.`;
  }
  return `Deleted ${succeeded}, failed ${failed}.`;
}

function getMoveResultMessage({ succeeded, failed, canceled }, projectName, created) {
  const prefix = created ? `Created "${projectName}". ` : '';
  if (canceled) {
    return `${prefix}Canceled. Moved ${succeeded}, failed ${failed}.`;
  }
  if (failed === 0) {
    return `${prefix}Moved ${pluralizeConversation(succeeded)} to "${projectName}".`;
  }
  return `${prefix}Moved ${succeeded}, failed ${failed}.`;
}

function getResultType({ failed, canceled }) {
  if (canceled) return 'info';
  return failed ? 'error' : 'success';
}

function pluralizeConversation(count) {
  return `${count} conversation${count === 1 ? '' : 's'}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}

els.list.addEventListener('click', handleConversationListClick);
els.list.addEventListener('scroll', handleListScroll);
els.selectAll.addEventListener('change', handleSelectAllChange);
els.loadAllButton.addEventListener('click', loadAllConversations);
els.primaryButton.addEventListener('click', handlePrimaryClick);
els.searchInput.addEventListener('input', handleSearchInput);

els.modeDelete.addEventListener('click', () => setMode('delete'));
els.modeMove.addEventListener('click', () => setMode('move'));
els.modeContext.addEventListener('click', () => setMode('context'));

els.confirmYes.addEventListener('click', performDelete);
els.confirmNo.addEventListener('click', hideDeleteConfirmation);

els.projectList.addEventListener('click', handleProjectListClick);
els.projectSearch.addEventListener('input', handleProjectSearchInput);
els.newProjectToggle.addEventListener('click', handleNewProjectToggle);
els.newProjectName.addEventListener('input', handleNewProjectInput);
els.projectConfirm.addEventListener('click', handleProjectConfirm);
els.projectCancel.addEventListener('click', hideProjectModal);
els.hideInProject.addEventListener('change', handleHideInProjectChange);

els.previewInlineBtn.addEventListener('click', () => setPreviewStyle('inline'));
els.previewModalBtn.addEventListener('click', () => setPreviewStyle('modal'));
els.previewClose.addEventListener('click', hidePreviewModal);
els.previewOpen.addEventListener('click', () => {
  if (els.previewOpen.dataset.id) openInTab(els.previewOpen.dataset.id);
});

// Context builder event wiring
els.contextConvList.addEventListener('click', handleContextConvListClick);
els.contextConvList.addEventListener('change', handleContextExchangeChange);
els.contextSelectAll.addEventListener('click', handleContextSelectAll);
els.contextDeselectAll.addEventListener('click', handleContextDeselectAll);
els.contextFormatGroup.addEventListener('click', handleContextFormatClick);
els.contextTemplateGroup.addEventListener('click', handleContextTemplateClick);
els.contextSend.addEventListener('click', sendToNewChat);
els.contextCopy.addEventListener('click', copyContextToClipboard);
els.contextClose.addEventListener('click', hideContextModal);

loadConversations();
loadProjectTags();
