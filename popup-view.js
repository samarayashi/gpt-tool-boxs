export const els = {
  list: document.getElementById('conversation-list'),
  selectAll: document.getElementById('select-all'),
  loadAllButton: document.getElementById('btn-load-all'),
  primaryButton: document.getElementById('btn-primary'),
  searchInput: document.getElementById('search-input'),
  statusBar: document.getElementById('status-bar'),
  totalInfo: document.getElementById('total-info'),
  modeDelete: document.getElementById('mode-delete'),
  modeMove: document.getElementById('mode-move'),
  confirmModal: document.getElementById('confirm-modal'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmYes: document.getElementById('btn-confirm-yes'),
  confirmNo: document.getElementById('btn-confirm-no'),
  projectModal: document.getElementById('project-modal'),
  projectModalTitle: document.getElementById('project-modal-title'),
  projectSearch: document.getElementById('project-search'),
  projectList: document.getElementById('project-list'),
  newProjectToggle: document.getElementById('btn-new-project'),
  newProjectForm: document.getElementById('new-project-form'),
  newProjectName: document.getElementById('new-project-name'),
  projectConfirm: document.getElementById('btn-project-confirm'),
  projectCancel: document.getElementById('btn-project-cancel'),
};

const STATUS_AUTO_HIDE_MS = 3500;
let statusTimer = null;

export function getSearchQuery() {
  return els.searchInput.value.toLowerCase().trim();
}

export function showStatus(message, type = 'info', { autoHide = true } = {}) {
  clearStatusTimer();
  els.statusBar.textContent = message;
  els.statusBar.className = `status-bar ${type}`;
  els.statusBar.classList.remove('hidden');

  if (autoHide) {
    statusTimer = setTimeout(hideStatus, STATUS_AUTO_HIDE_MS);
  }
}

export function hideStatus() {
  clearStatusTimer();
  els.statusBar.classList.add('hidden');
}

function clearStatusTimer() {
  if (!statusTimer) return;

  clearTimeout(statusTimer);
  statusTimer = null;
}

export function setLoadingMessage(message) {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = message;
  els.list.replaceChildren(loading);
}

export function renderList(conversations, selectedIds) {
  if (conversations.length === 0) {
    setLoadingMessage('No conversations found.');
    return;
  }

  els.list.replaceChildren();
  appendConversationItems(conversations, selectedIds);
}

export function appendConversationItems(conversations, selectedIds) {
  const loading = els.list.querySelector('.loading');
  if (loading) {
    loading.remove();
  }

  const fragment = document.createDocumentFragment();
  conversations.forEach((conversation) => {
    fragment.append(createConversationItem(conversation, selectedIds));
  });

  els.list.append(fragment);
}

export function updateModeSwitch({ mode, isBusy }) {
  const isDelete = mode === 'delete';
  els.modeDelete.classList.toggle('active', isDelete);
  els.modeMove.classList.toggle('active', !isDelete);
  els.modeDelete.setAttribute('aria-selected', String(isDelete));
  els.modeMove.setAttribute('aria-selected', String(!isDelete));
  els.modeDelete.disabled = isBusy;
  els.modeMove.disabled = isBusy;
}

export function updateToolbar({
  conversations,
  selectedIds,
  hasMore,
  isLoading,
  isLoadingAll,
  isDeleting,
  isMoving,
  mode,
}) {
  const isBusy = isDeleting || isMoving;
  const visibleIds = conversations.map((conversation) => conversation.id);
  const selectedVisibleIds = visibleIds.filter((id) => selectedIds.has(id));
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length;
  const count = selectedIds.size;

  els.loadAllButton.disabled = !hasMore || isLoading || isLoadingAll || isBusy;
  els.loadAllButton.textContent = isLoadingAll ? 'Loading...' : 'Load All';

  const btn = els.primaryButton;
  btn.classList.remove('btn-danger', 'btn-move', 'btn-cancel-action');

  if (isDeleting) {
    btn.disabled = false;
    btn.textContent = 'Cancel Delete';
    btn.classList.add('btn-cancel-action');
  } else if (isMoving) {
    btn.disabled = false;
    btn.textContent = 'Cancel Move';
    btn.classList.add('btn-cancel-action');
  } else if (mode === 'delete') {
    btn.disabled = count === 0;
    btn.textContent = count ? `Delete Selected (${count})` : 'Delete Selected';
    btn.classList.add('btn-danger');
  } else {
    btn.disabled = count === 0;
    btn.textContent = count ? `Move to Project (${count})` : 'Move to Project';
    btn.classList.add('btn-move');
  }

  els.selectAll.disabled = isBusy;
  els.selectAll.checked = allVisibleSelected;
  els.selectAll.indeterminate = !allVisibleSelected && selectedVisibleIds.length > 0;
}

export function updateTotalInfo({ visibleCount, loadedCount, hasMore, hasQuery }) {
  if (hasMore) {
    els.totalInfo.textContent = hasQuery
      ? `${visibleCount} matching loaded`
      : `${loadedCount} loaded`;
    return;
  }

  els.totalInfo.textContent = hasQuery
    ? `${visibleCount} match${visibleCount === 1 ? '' : 'es'}`
    : `${loadedCount} conversation${loadedCount === 1 ? '' : 's'}`;
}

export function showDeleteConfirmation(count) {
  const label = `${count} conversation${count === 1 ? '' : 's'}`;
  els.confirmMessage.textContent =
    `Are you sure you want to delete ${label}? This cannot be undone.`;
  els.confirmModal.classList.remove('hidden');
}

export function hideDeleteConfirmation() {
  els.confirmModal.classList.add('hidden');
}

// --- Project picker ---

export function showProjectModal(count) {
  const label = `${count} conversation${count === 1 ? '' : 's'}`;
  els.projectModalTitle.textContent = `Move ${label} to...`;
  els.projectSearch.value = '';
  els.newProjectName.value = '';
  els.newProjectForm.classList.add('hidden');
  resetMemoryScope();
  setProjectListMessage('Loading projects...');
  els.projectModal.classList.remove('hidden');
}

export function hideProjectModal() {
  els.projectModal.classList.add('hidden');
}

// 'global' = shared global memory, 'project_v2' = project-only context.
export function getMemoryScope() {
  const checked = document.querySelector('input[name="memory-scope"]:checked');
  return checked ? checked.value : 'global';
}

export function resetMemoryScope() {
  const def = document.querySelector('input[name="memory-scope"][value="global"]');
  if (def) def.checked = true;
}

export function setProjectListMessage(message) {
  const node = document.createElement('div');
  node.className = 'loading';
  node.textContent = message;
  els.projectList.replaceChildren(node);
}

export function renderProjectList(projects, { selectedId, query }) {
  const normalized = (query || '').toLowerCase().trim();
  const filtered = normalized
    ? projects.filter((p) => p.name.toLowerCase().includes(normalized))
    : projects;

  if (projects.length === 0) {
    setProjectListMessage('No projects yet. Create one below.');
    return;
  }

  if (filtered.length === 0) {
    setProjectListMessage('No matching projects.');
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((project) => {
    const row = document.createElement('div');
    row.className = 'project-item';
    row.dataset.id = project.id;
    if (project.id === selectedId) {
      row.classList.add('selected');
    }
    row.textContent = project.name;
    row.title = project.name;
    fragment.append(row);
  });
  els.projectList.replaceChildren(fragment);
}

export function updateProjectConfirm(choice) {
  const btn = els.projectConfirm;
  if (choice?.type === 'new') {
    btn.textContent = 'Create & Move';
    btn.disabled = choice.name.trim().length === 0;
  } else if (choice?.type === 'existing') {
    btn.textContent = 'Move';
    btn.disabled = !choice.id;
  } else {
    btn.textContent = 'Move';
    btn.disabled = true;
  }
}

export function setNewProjectFormVisible(visible) {
  els.newProjectForm.classList.toggle('hidden', !visible);
  if (visible) {
    els.newProjectName.focus();
  }
}

function createConversationItem(conversation, selectedIds) {
  const item = document.createElement('div');
  item.className = 'conversation-item';
  item.dataset.id = conversation.id;
  item.title = 'Open conversation';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selectedIds.has(conversation.id);

  const title = document.createElement('span');
  title.className = 'conv-title';
  title.title = getConversationTitle(conversation);
  title.textContent = getConversationTitle(conversation);

  const date = document.createElement('span');
  date.className = 'conv-date';
  date.textContent = formatDate(conversation.update_time || conversation.create_time);

  item.append(checkbox, title, date);
  return item;
}

function getConversationTitle(conversation) {
  return conversation.title || 'Untitled';
}

function formatDate(isoString) {
  if (!isoString) return '';

  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
