export const els = {
  list: document.getElementById('conversation-list'),
  selectAll: document.getElementById('select-all'),
  loadAllButton: document.getElementById('btn-load-all'),
  primaryButton: document.getElementById('btn-primary'),
  searchInput: document.getElementById('search-input'),
  hideInProject: document.getElementById('hide-in-project'),
  statusBar: document.getElementById('status-bar'),
  totalInfo: document.getElementById('total-info'),
  modeDelete: document.getElementById('mode-delete'),
  modeMove: document.getElementById('mode-move'),
  modeContext: document.getElementById('mode-context'),
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
  previewInlineBtn: document.getElementById('preview-inline'),
  previewModalBtn: document.getElementById('preview-modal-btn'),
  previewModal: document.getElementById('preview-modal'),
  previewModalTitle: document.getElementById('preview-modal-title'),
  previewModalBody: document.getElementById('preview-modal-body'),
  previewOpen: document.getElementById('btn-preview-open'),
  previewClose: document.getElementById('btn-preview-close'),
  contextModal: document.getElementById('context-modal'),
  contextModalTitle: document.getElementById('context-modal-title'),
  contextConvList: document.getElementById('context-conv-list'),
  contextFormatGroup: document.getElementById('context-format-group'),
  contextTemplateGroup: document.getElementById('context-template-group'),
  contextSend: document.getElementById('btn-context-send'),
  contextCopy: document.getElementById('btn-context-copy'),
  contextClose: document.getElementById('btn-context-close'),
  contextSelectAll: document.getElementById('btn-context-select-all'),
  contextDeselectAll: document.getElementById('btn-context-deselect-all'),
};

const STATUS_AUTO_HIDE_MS = 3500;
let statusTimer = null;

// gizmo_id -> project name, used to tag conversations that live in a project.
let projectNameMap = new Map();

export function setProjectNameMap(map) {
  projectNameMap = map || new Map();
}

// A conversation belongs to a project when its gizmo_id is a snorlax project id (g-p-...).
// Custom-GPT chats use g-<hex> ids and are not treated as "in a project".
export function isInProject(conversation) {
  const gid = conversation.gizmo_id;
  return typeof gid === 'string' && gid.startsWith('g-p-');
}

function getProjectTagName(conversation) {
  if (!isInProject(conversation)) return null;
  return projectNameMap.get(conversation.gizmo_id) || 'Project';
}

// Inline preview state: which row is expanded and its summary (null = loading,
// { error } = failed, otherwise a summary from summarizeConversation()).
let expandedPreviewId = null;
let expandedPreviewState = null;

export function setExpandedPreview(id, summaryState) {
  expandedPreviewId = id;
  expandedPreviewState = summaryState;
}

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
    if (conversation.id === expandedPreviewId) {
      fragment.append(buildInlinePreview(conversation.id, expandedPreviewState));
    }
  });

  els.list.append(fragment);
}

function buildInlinePreview(id, summaryState) {
  const box = document.createElement('div');
  box.className = 'conv-preview';
  box.append(...buildPreviewContent(id, summaryState));
  return box;
}

// Shared by inline preview and the preview modal. Returns an array of nodes.
function buildPreviewContent(id, summaryState) {
  if (summaryState === null) {
    const loading = document.createElement('div');
    loading.className = 'preview-loading';
    loading.textContent = 'Loading preview...';
    return [loading];
  }

  if (summaryState.error) {
    const err = document.createElement('div');
    err.className = 'preview-error';
    err.textContent = summaryState.error;
    return [err];
  }

  const nodes = [];
  const addSection = (label, text) => {
    if (!text) return;
    const section = document.createElement('div');
    section.className = 'preview-section';
    const head = document.createElement('div');
    head.className = 'preview-role';
    head.textContent = label;
    const body = document.createElement('div');
    body.className = 'preview-text';
    body.textContent = text;
    section.append(head, body);
    nodes.push(section);
  };

  addSection('First message', summaryState.firstUser);
  addSection('Latest reply', summaryState.lastAssistant);

  if (nodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'preview-loading';
    empty.textContent = 'No text preview available.';
    nodes.push(empty);
  }

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'preview-open';
  open.dataset.id = id;
  open.textContent = 'Open full chat ↗';
  nodes.push(open);

  return nodes;
}

export function updatePreviewStyleSwitch({ style, isBusy }) {
  const inline = style === 'inline';
  els.previewInlineBtn.classList.toggle('active', inline);
  els.previewModalBtn.classList.toggle('active', !inline);
  els.previewInlineBtn.disabled = isBusy;
  els.previewModalBtn.disabled = isBusy;
}

export function showPreviewModal(id, summaryState) {
  els.previewModal.classList.remove('context-full-view');
  els.previewModalTitle.textContent =
    summaryState && !summaryState.error ? summaryState.title : 'Preview';
  // The modal has its own footer "Open full chat" button; drop the inline one.
  const content = buildPreviewContent(id, summaryState).filter(
    (node) => !node.classList?.contains('preview-open')
  );
  els.previewModalBody.replaceChildren(...content);
  els.previewOpen.dataset.id = id || '';
  els.previewOpen.classList.toggle('hidden', !summaryState || !!summaryState.error);
  els.previewModal.classList.remove('hidden');
}

export function hidePreviewModal() {
  els.previewModal.classList.add('hidden');
  els.previewModal.classList.remove('context-full-view');
}

export function updateModeSwitch({ mode, isBusy }) {
  [
    { el: els.modeDelete, key: 'delete' },
    { el: els.modeMove, key: 'move' },
    { el: els.modeContext, key: 'context' },
  ].forEach(({ el, key }) => {
    const active = mode === key;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', String(active));
    el.disabled = isBusy;
  });
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
  btn.classList.remove('btn-danger', 'btn-move', 'btn-cancel-action', 'btn-context');

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
  } else if (mode === 'move') {
    btn.disabled = count === 0;
    btn.textContent = count ? `Move to Project (${count})` : 'Move to Project';
    btn.classList.add('btn-move');
  } else {
    btn.disabled = count === 0;
    btn.textContent = count ? `Build Context (${count})` : 'Build Context';
    btn.classList.add('btn-context');
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

  const main = document.createElement('div');
  main.className = 'conv-main';

  const title = document.createElement('span');
  title.className = 'conv-title';
  title.title = getConversationTitle(conversation);
  title.textContent = getConversationTitle(conversation);
  main.append(title);

  const tagName = getProjectTagName(conversation);
  if (tagName) {
    const tag = document.createElement('span');
    tag.className = 'conv-tag';
    tag.textContent = `📁 ${tagName}`;
    tag.title = `In project: ${tagName}`;
    main.append(tag);
  }

  const date = document.createElement('span');
  date.className = 'conv-date';
  date.textContent = formatDate(conversation.update_time || conversation.create_time);

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'conv-rename';
  renameBtn.dataset.action = 'rename';
  renameBtn.dataset.id = conversation.id;
  renameBtn.title = 'Rename';
  renameBtn.textContent = '✎';

  item.append(checkbox, main, date, renameBtn);
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

// --- Context Builder ---

export function showContextModal(count) {
  const label = `${count} conversation${count === 1 ? '' : 's'}`;
  els.contextModalTitle.textContent = `Build Context — ${label}`;
  els.contextModal.classList.remove('hidden');
}

export function hideContextModal() {
  els.contextModal.classList.add('hidden');
}

// items: [{ id, title, status:'loading'|'ready'|'error', exchanges, error, expanded, checked:Set<number> }]
export function renderContextConvList(items) {
  if (items.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'context-placeholder';
    msg.textContent = 'No conversations selected.';
    els.contextConvList.replaceChildren(msg);
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach(({ id, title, status, exchanges, error, expanded, checked }) => {
    const section = document.createElement('div');
    section.className = 'context-conv-section';
    section.dataset.id = id;

    // Header row
    const header = document.createElement('div');
    header.className = 'context-conv-header';
    header.dataset.action = 'toggle';
    header.dataset.id = id;

    const arrow = document.createElement('span');
    arrow.className = 'context-conv-toggle';
    arrow.textContent = expanded ? '▾' : '▸';

    const titleEl = document.createElement('span');
    titleEl.className = 'context-conv-title';
    titleEl.textContent = title;
    titleEl.title = title;

    header.append(arrow, titleEl);

    if (status === 'ready') {
      const checkedCount = exchanges.filter((_, i) => checked.has(i)).length;
      const allChecked = exchanges.length > 0 && checkedCount === exchanges.length;

      const countLabel = document.createElement('span');
      countLabel.className = 'context-count-label';
      countLabel.textContent = `${checkedCount}/${exchanges.length}`;

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'context-toggle-all';
      viewBtn.dataset.action = 'view';
      viewBtn.dataset.id = id;
      viewBtn.textContent = 'View';

      const toggleAll = document.createElement('button');
      toggleAll.type = 'button';
      toggleAll.className = 'context-toggle-all';
      toggleAll.dataset.action = 'toggle-all';
      toggleAll.dataset.id = id;
      toggleAll.textContent = allChecked ? 'None' : 'All';

      header.append(countLabel, viewBtn, toggleAll);
    } else {
      const statusLabel = document.createElement('span');
      statusLabel.className = 'context-status-label';
      statusLabel.textContent = status === 'loading' ? 'Loading…' : 'Error';
      header.append(statusLabel);
    }

    section.append(header);

    // Body (shown when expanded)
    if (expanded) {
      const body = document.createElement('div');
      body.className = 'context-conv-body';

      if (status === 'loading') {
        const ph = document.createElement('div');
        ph.className = 'context-placeholder';
        ph.textContent = 'Loading conversation…';
        body.append(ph);
      } else if (status === 'error') {
        const ph = document.createElement('div');
        ph.className = 'context-placeholder error';
        ph.textContent = error || 'Failed to load.';
        body.append(ph);
      } else if (exchanges.length === 0) {
        const ph = document.createElement('div');
        ph.className = 'context-placeholder';
        ph.textContent = 'No messages found.';
        body.append(ph);
      } else {
        exchanges.forEach(({ user, assistant }, idx) => {
          const row = document.createElement('label');
          row.className = 'context-exchange';

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = checked.has(idx);
          cb.dataset.action = 'check-exchange';
          cb.dataset.id = id;
          cb.dataset.idx = String(idx);

          const content = document.createElement('div');
          content.className = 'context-exchange-content';

          if (user) {
            const u = document.createElement('div');
            u.className = 'context-msg context-msg-user';
            u.textContent = clipText(user.text, 180);
            content.append(u);
          }
          if (assistant) {
            const a = document.createElement('div');
            a.className = 'context-msg context-msg-assistant';
            a.textContent = clipText(assistant.text, 180);
            content.append(a);
          }

          // Per-exchange "view full" button (pops up this single exchange).
          const expandBtn = document.createElement('button');
          expandBtn.type = 'button';
          expandBtn.className = 'context-exchange-expand';
          expandBtn.dataset.action = 'view-exchange';
          expandBtn.dataset.id = id;
          expandBtn.dataset.idx = String(idx);
          expandBtn.title = 'View full message';
          expandBtn.textContent = '⤢';

          row.append(cb, content, expandBtn);
          body.append(row);
        });
      }

      section.append(body);
    }

    fragment.append(section);
  });

  els.contextConvList.replaceChildren(fragment);
}

export function setContextOptActive(groupEl, value) {
  groupEl.querySelectorAll('.context-opt-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

// Opens the preview modal with all exchanges shown in full (no clipping).
export function showContextFullView(title, exchanges) {
  const nodes = [];

  if (exchanges.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'preview-loading';
    empty.textContent = 'No messages found.';
    nodes.push(empty);
  } else {
    exchanges.forEach(({ user, assistant }, idx) => {
      if (user) nodes.push(buildFullViewSection(`You (${idx + 1})`, user.text));
      if (assistant) nodes.push(buildFullViewSection('ChatGPT', assistant.text));
    });
  }

  openFullViewModal(title, nodes);
}

// Opens the preview modal showing a single exchange (one Q&A pair) in full.
export function showContextExchangeFullView(title, exchange, idx) {
  const nodes = [];
  if (exchange.user) nodes.push(buildFullViewSection(`You (${idx + 1})`, exchange.user.text));
  if (exchange.assistant) nodes.push(buildFullViewSection('ChatGPT', exchange.assistant.text));
  if (nodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'preview-loading';
    empty.textContent = 'No text in this message.';
    nodes.push(empty);
  }
  openFullViewModal(title, nodes);
}

function openFullViewModal(title, nodes) {
  els.previewModalTitle.textContent = title;
  els.previewModalBody.replaceChildren(...nodes);
  els.previewOpen.dataset.id = '';
  els.previewOpen.classList.add('hidden');
  // Mark modal so CSS removes per-message max-height caps (single outer scroll).
  els.previewModal.classList.add('context-full-view');
  els.previewModal.classList.remove('hidden');
}

function buildFullViewSection(label, text) {
  const section = document.createElement('div');
  section.className = 'preview-section';
  const head = document.createElement('div');
  head.className = 'preview-role';
  head.textContent = label;
  const body = document.createElement('div');
  body.className = 'preview-text';
  body.textContent = text;
  section.append(head, body);
  return section;
}

function clipText(text, maxLen) {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}
