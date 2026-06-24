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
  getAccessToken,
  summarizeConversation,
} from './chatgpt-api.js';
import { runWithQueue } from './task-queue.js';
import { openConversationInBackgroundTab } from './tab-navigation.js';
import {
  appendConversationItems,
  els,
  getSearchQuery,
  hideDeleteConfirmation,
  getMemoryScope,
  hidePreviewModal,
  hideProjectModal,
  hideStatus,
  isInProject,
  renderList,
  renderProjectList,
  setExpandedPreview,
  setLoadingMessage,
  setNewProjectFormVisible,
  setProjectListMessage,
  setProjectNameMap,
  showDeleteConfirmation,
  showPreviewModal,
  showProjectModal,
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
  } else {
    openProjectPicker();
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

loadConversations();
loadProjectTags();
