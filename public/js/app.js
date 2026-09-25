(function () {
  const COLORS = ['#DA5427', '#F26B42', '#B04315', '#4ADE80', '#2FA85A', '#FFB295', '#C74A1F', '#64C98C'];
  const PRIORITY_COLORS = { low: '#2E9E58', medium: '#B0703A', high: '#D6453D' };

  var state = { user: null, projects: [], tasks: [], team: [], events: [] };

  function setState(key, val) { state[key] = val; }

  function loadAllData() {
    if (!API.isLoggedIn()) return Promise.resolve();
    return Promise.all([
      API.get('/user').then(function (u) { state.user = u; if (u.photo_url && !u.photo) u.photo = u.photo_url; if (u.photoUrl && !u.photo) u.photo = u.photoUrl; }).catch(function () {}),
      API.get('/projects').then(function (d) { state.projects = d; }).catch(function () {}),
      API.get('/projects?archived=true').then(function (d) { state.archivedProjects = d; }).catch(function () {}),
      API.get('/tasks').then(function (d) { state.tasks = d; }).catch(function () {}),
      API.get('/team').then(function (d) { d.forEach(function(m) { if ((m.photo_url || m.photoUrl) && !m.photo) m.photo = m.photo_url || m.photoUrl; }); state.team = d; }).catch(function () {}),
      API.get('/events').then(function (d) { state.events = d; }).catch(function () {}),
    ]);
  }

  function getInitials(name) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function memberAvatarHtml(m, extraStyle) {
    var style = extraStyle || '';
    if (m && m.photo) {
      return `<div class="avatar avatar-xs" style="overflow:hidden;${style}" title="${m.name}"><img src="${m.photo}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`;
    }
    return `<div class="avatar avatar-xs" style="background:${(m && m.color) || 'var(--primary)'};${style}" title="${m ? m.name : ''}">${m ? getInitials(m.name) : ''}</div>`;
  }

  function formatDueDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    var opts = { month: 'short', day: 'numeric' };
    if (dateStr.includes('T')) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
    return d.toLocaleDateString('en-US', opts);
  }

  function formatActivityTime(d) {
    var date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    var time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date + ', ' + time;
  }

  function dueDatePart(dateStr) {
    return dateStr ? dateStr.slice(0, 10) : '';
  }

  function formatTime(seconds) {
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  function renderTaskTags(tagsStr) {
    if (!tagsStr) return '';
    return tagsStr.split(',').map(function (t) {
      t = t.trim();
      if (!t) return '';
      return '<span class="badge badge-info" style="font-size:10px;padding:1px 8px;margin-left:4px;">' + t + '</span>';
    }).join('');
  }

  function autoPrioritizeTasks() {
    var data = getData();
    var now = new Date();
    var scored = data.tasks.filter(function (t) { return t.status !== 'done'; }).map(function (t) {
      var score = 0;
      if (t.priority === 'high') score += 100;
      else if (t.priority === 'medium') score += 50;
      if (t.dueDate) {
        var diff = Math.ceil((new Date(t.dueDate) - now) / 86400000);
        if (diff < 0) score += 200;
        else if (diff === 0) score += 150;
        else if (diff <= 2) score += 100;
        else if (diff <= 7) score += 50;
      }
      return { task: t, score: score };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var msg = scored.map(function (s, i) { return (i + 1) + '. ' + s.task.name + ' (' + s.score + 'pts)'; }).slice(0, 10).join('\n');
    showToast('Top priority: ' + scored[0]?.task.name || 'No tasks', 'info');
  }

  function autoScheduleTasks() {
    var data = getData();
    var unscheduled = data.tasks.filter(function (t) { return !t.dueDate && t.status !== 'done'; });
    if (!unscheduled.length) { showToast('No unscheduled tasks', 'info'); return; }
    var today = new Date();
    unscheduled.forEach(function (t, i) {
      var d = new Date(today);
      d.setDate(d.getDate() + i);
      var dateStr = d.toISOString().split('T')[0];
      API.patch('/tasks/' + t.id, { due_date: dateStr }).catch(function () {});
    });
    showToast('Scheduled ' + unscheduled.length + ' tasks starting today', 'success');
    setTimeout(refreshCurrentView, 1000);
  }

  function openGanttView(projectId) {
    var data = getData();
    var tasks = data.tasks.filter(function (t) { return t.projectId === projectId && t.dueDate; });
    if (!tasks.length) { showToast('No tasks with due dates', 'warning'); return; }
    tasks.sort(function (a, b) { return (a.dueDate || '').localeCompare(b.dueDate || ''); });
    var minDate = new Date(tasks[0].dueDate);
    var maxDate = new Date(tasks[tasks.length - 1].dueDate);
    var totalDays = Math.max(1, Math.ceil((maxDate - minDate) / 86400000) + 1);
    var today = new Date();
    var badges = document.getElementById('drawer-badges');
    var content = document.getElementById('drawer-content');
    if (!content) return;
    badges.innerHTML = '<span class="badge badge-info">Gantt</span>';
    var html = '<div style="overflow-x:auto;padding:var(--space-4) 0;position:relative;min-height:400px;">';
    tasks.forEach(function (t) {
      var start = new Date(t.dueDate);
      start.setDate(start.getDate() - 2);
      if (start < minDate) start = minDate;
      var leftPct = ((start - minDate) / 86400000 / totalDays) * 100;
      var widthPct = Math.max(5, (3 / totalDays) * 100);
      var isOverdue = t.status !== 'done' && new Date(t.dueDate) < today;
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;height:28px;"><span style="width:150px;font-size:var(--text-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary);">' + t.name + '</span><div style="flex:1;position:relative;height:20px;background:var(--bg-secondary);border-radius:4px;overflow:hidden;"><div style="position:absolute;left:' + leftPct + '%;width:' + widthPct + '%;height:100%;background:' + (isOverdue ? 'var(--danger)' : t.status === 'done' ? 'var(--success)' : 'var(--primary)') + ';border-radius:4px;opacity:0.8;"></div></div><span style="width:80px;font-size:var(--text-xs);color:var(--text-tertiary);text-align:right;">' + (t.dueDate || '').slice(0, 10) + '</span></div>';
    });
    html += '</div>';
    content.innerHTML = html;
    openDrawer();
  }

  function renderGoals(container) {
    if (!container) return;
    API.get('/goals').then(function (goals) {
      if (!goals || !goals.length) {
        container.innerHTML = '<div class="widget" style="text-align:center;padding:var(--space-6);"><p style="font-size:var(--text-sm);color:var(--text-tertiary);">Set goals to track your progress</p><button class="btn btn-primary btn-sm" id="add-goal-btn-dash" style="margin-top:12px;">+ Add Goal</button></div>';
        document.getElementById('add-goal-btn-dash')?.addEventListener('click', function () { openGoalDrawer(); });
        return;
      }
      container.innerHTML = '<div class="widget"><div class="widget-header"><h3 class="widget-title">Goals</h3><button class="btn btn-sm btn-ghost" id="add-goal-btn-dash2">+ Add</button></div><div style="display:flex;flex-direction:column;gap:var(--space-3);">' + goals.map(function (g) {
        return '<div style="display:flex;align-items:center;gap:10px;"><div style="flex:1;"><div style="display:flex;justify-content:space-between;font-size:var(--text-sm);"><span style="color:var(--text-primary);font-weight:var(--weight-medium);">' + g.name + '</span><span style="color:var(--text-tertiary);">' + g.progress + '%</span></div><div class="progress-bar" style="height:6px;margin-top:4px;"><div class="progress-bar-fill" style="width:' + g.progress + '%;background:var(--primary);"></div></div></div></div>';
      }).join('') + '</div></div>';
      document.getElementById('add-goal-btn-dash2')?.addEventListener('click', function () { openGoalDrawer(); });
    }).catch(function () {});
  }

  function openGoalDrawer(editGoal) {
    var badges = document.getElementById('drawer-badges');
    var content = document.getElementById('drawer-content');
    if (!content) return;
    badges.innerHTML = '<span class="badge badge-info">Goal</span>';
    var isEdit = !!editGoal;
    content.innerHTML = '<div class="task-drawer-title-area"><input type="text" class="task-drawer-title" id="goal-name" placeholder="Goal name" value="' + (editGoal ? editGoal.name : '') + '" autocomplete="off"></div><div class="task-drawer-meta"><div class="task-drawer-meta-row"><span class="task-drawer-meta-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg>Target</span><input type="date" class="task-drawer-meta-value" id="goal-date" value="' + (editGoal ? editGoal.target_date || '' : '') + '"></div><div class="task-drawer-meta-row"><span class="task-drawer-meta-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Progress</span><input type="range" id="goal-progress" min="0" max="100" value="' + (editGoal ? editGoal.progress : 0) + '" style="width:120px;"><span id="goal-progress-label" style="font-size:var(--text-sm);min-width:30px;text-align:right;">' + (editGoal ? editGoal.progress : 0) + '%</span></div></div><div class="task-drawer-actions"><button class="btn btn-ghost" id="goal-cancel">Cancel</button><button class="btn btn-primary" id="goal-save">' + (isEdit ? 'Save' : 'Create') + '</button></div>';
    openDrawer();
    document.getElementById('goal-progress')?.addEventListener('input', function () {
      document.getElementById('goal-progress-label').textContent = this.value + '%';
    });
    document.getElementById('goal-cancel')?.addEventListener('click', closeDrawer);
    document.getElementById('goal-save')?.addEventListener('click', function () {
      var name = document.getElementById('goal-name')?.value?.trim();
      if (!name) { showToast('Enter a goal name', 'warning'); return; }
      var target_date = document.getElementById('goal-date')?.value || null;
      var progress = parseInt(document.getElementById('goal-progress')?.value || '0', 10);
      var req = isEdit ? API.patch('/goals/' + editGoal.id, { name: name, target_date: target_date, progress: progress }) : API.post('/goals', { name: name, target_date: target_date, progress: progress });
      req.then(function () {
        showToast(isEdit ? 'Goal updated' : 'Goal created', 'success');
        closeDrawer();
        refreshCurrentView();
      }).catch(function (err) { showToast(err.message || 'Failed', 'error'); });
    });
  }

  function renderMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/@(\w+)/g, '<span class="mention">@$1</span>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)/g, '<ul>$1</ul>')
      .replace(/<\/ul>\n?<ul>/g, '')
      .replace(/\n/g, '<br>');
  }

  function debounce(fn, delay) {
    let timer;
    return function () {
      const context = this;
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(context, args); }, delay);
    };
  }

  function getProjectTaskStats(data) {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const stats = {};
    data.tasks.forEach(function (t) {
      if (!stats[t.projectId]) stats[t.projectId] = { total: 0, done: 0, overdue: 0 };
      stats[t.projectId].total++;
      if (t.status === 'done') stats[t.projectId].done++;
      if (t.dueDate && new Date(t.dueDate) < now && t.status !== 'done') stats[t.projectId].overdue++;
    });
    return stats;
  }

  function getData() { return state; }

  function getTaskViewPreferences() {
    if (window.UiState) return window.UiState.readTaskViewPreferences(window.localStorage);
    return { filter: 'all', sort: 'due-asc' };
  }

  function saveTaskViewPreferences(filter, sort) {
    if (window.UiState) window.UiState.writeTaskViewPreferences(window.localStorage, { filter: filter, sort: sort });
  }

  function restoreTaskViewPreferences() {
    const preferences = getTaskViewPreferences();
    const sort = document.getElementById('tasks-sort');
    const filter = document.querySelector('#tasks-filter-bar .filter-chip[data-filter="' + preferences.filter + '"]');
    if (sort) sort.value = preferences.sort;
    if (filter) {
      document.querySelectorAll('#tasks-filter-bar .filter-chip').forEach(function (chip) { chip.classList.remove('active'); });
      filter.classList.add('active');
    }
  }

  function updateTaskFilterReset() {
    const button = document.getElementById('tasks-reset-filters');
    if (!button) return;
    const filter = document.querySelector('#tasks-filter-bar .filter-chip.active')?.dataset.filter || 'all';
    const sort = document.getElementById('tasks-sort')?.value || 'due-asc';
    const search = document.getElementById('tasks-search')?.value.trim();
    button.hidden = !search && filter === 'all' && sort === 'due-asc';
  }

  function updateProjectsFilterReset() {
    const button = document.getElementById('projects-reset-search');
    const search = document.getElementById('projects-search')?.value.trim();
    if (button) button.hidden = !search;
  }

  function saveData() {
    var indicator = document.getElementById('save-indicator');
    if (indicator) {
      indicator.textContent = 'Saved';
      indicator.classList.add('visible');
      setTimeout(function () { indicator.classList.remove('visible'); }, 2000);
    }
    showDockCheck('Saved to cloud');
  }

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function updateUserInfo() {
    const data = getData();
    if (!data.user) return;
    const initials = getInitials(data.user.name);
    const color = COLORS[0];
    const hasPhoto = data.user.photo && data.user.photo.length > 0;
    const sb = document.getElementById('sidebar-user-avatar');
    const sn = document.getElementById('sidebar-user-name');
    const tn = document.getElementById('top-nav-avatar');
    const g = document.getElementById('dashboard-greeting');
    const sa = document.getElementById('settings-avatar');
    const saImg = document.getElementById('settings-avatar-img');
    const si = document.getElementById('settings-name');
    if (sb) { 
      sb.textContent = hasPhoto ? '' : initials;
      sb.style.backgroundImage = hasPhoto ? `url(${data.user.photo})` : '';
      sb.style.backgroundSize = hasPhoto ? 'cover' : '';
      sb.style.backgroundPosition = hasPhoto ? 'center' : '';
    }
    if (sn) sn.textContent = data.user.name;
    if (tn) { 
      tn.textContent = hasPhoto ? '' : initials;
      tn.style.backgroundImage = hasPhoto ? `url(${data.user.photo})` : '';
      tn.style.backgroundSize = hasPhoto ? 'cover' : '';
      tn.style.backgroundPosition = hasPhoto ? 'center' : '';
    }
    if (g) g.textContent = getGreeting() + ', ' + data.user.name.split(' ')[0];
    if (sa) { sa.textContent = initials; if (!hasPhoto) sa.style.display = ''; }
    if (saImg) {
      if (hasPhoto) { saImg.style.backgroundImage = `url(${data.user.photo})`; saImg.classList.add('visible'); }
      else { saImg.style.backgroundImage = ''; saImg.classList.remove('visible'); }
    }
    if (si) si.value = data.user.name;
    updateRemovePhotoVisibility(hasPhoto);
    document.getElementById('ws-dropdown-name') && (document.getElementById('ws-dropdown-name').textContent = data.user.name);
    document.getElementById('ws-dropdown-email') && (document.getElementById('ws-dropdown-email').textContent = data.user.email || (data.user.username ? '@' + data.user.username : ''));
    var wda = document.getElementById('ws-dropdown-avatar');
    if (wda) { wda.textContent = hasPhoto ? '' : initials; wda.style.backgroundImage = hasPhoto ? 'url(' + data.user.photo + ')' : ''; wda.style.backgroundSize = hasPhoto ? 'cover' : ''; wda.style.backgroundPosition = hasPhoto ? 'center' : ''; }
    document.getElementById('user-dropdown-name') && (document.getElementById('user-dropdown-name').textContent = data.user.name);
    document.getElementById('user-dropdown-email') && (document.getElementById('user-dropdown-email').textContent = data.user.email || (data.user.username ? '@' + data.user.username : ''));
    var uda = document.getElementById('user-dropdown-avatar');
    if (uda) { uda.textContent = hasPhoto ? '' : initials; uda.style.backgroundImage = hasPhoto ? 'url(' + data.user.photo + ')' : ''; uda.style.backgroundSize = hasPhoto ? 'cover' : ''; uda.style.backgroundPosition = hasPhoto ? 'center' : ''; }
  }

  function updateRemovePhotoVisibility(hasPhoto) {
    const removeBtn = document.getElementById('remove-photo-btn');
    if (removeBtn) removeBtn.style.display = hasPhoto ? '' : 'none';
  }

  function saveProfilePhoto(base64) {
    const data = getData();
    if (!data.user) return;
    data.user.photo = base64;
    saveData(data);
    updateUserInfo();
    API.patch('/user', { photo_url: base64 }).catch(function () {});
  }

  function removeProfilePhoto() {
    const data = getData();
    if (!data.user) return;
    delete data.user.photo;
    saveData(data);
    updateUserInfo();
    showToast('Profile photo removed');
    API.patch('/user', { photo_url: null }).catch(function () {});
  }

  function setPhotoFromFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please select an image file', 'warning');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image must be under 5MB', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
      saveProfilePhoto(e.target.result);
      showToast('Profile photo updated', 'success');
    };
    reader.onerror = function() {
      showToast('Failed to read file', 'error');
    };
    reader.readAsDataURL(file);
  }

  function setPhotoFromURL(url) {
    if (!url || !url.trim()) {
      showToast('Please enter a URL', 'warning');
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const maxSize = 400;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
      else { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      saveProfilePhoto(canvas.toDataURL('image/jpeg', 0.85));
      showToast('Profile photo imported', 'success');
    };
    img.onerror = function() {
      showToast('Could not load image from URL', 'error');
    };
    img.src = url.trim();
  }

  function initProfilePicture() {
    const zone = document.getElementById('profile-picture-zone');
    const display = document.getElementById('profile-picture-display');
    const fileInput = document.getElementById('profile-picture-input');
    const uploadPCBtn = document.getElementById('upload-pc-btn');
    const uploadURLBtn = document.getElementById('upload-url-btn');
    const removeBtn = document.getElementById('remove-photo-btn');
    const urlRow = document.getElementById('profile-url-row');
    const urlInput = document.getElementById('profile-url-input');
    const urlSubmit = document.getElementById('profile-url-submit');
    const urlCancel = document.getElementById('profile-url-cancel');

    uploadPCBtn?.addEventListener('click', () => fileInput?.click());
    display?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        setPhotoFromFile(e.target.files[0]);
        fileInput.value = '';
      }
    });

    uploadURLBtn?.addEventListener('click', () => {
      if (urlRow) urlRow.style.display = 'flex';
      setTimeout(() => urlInput?.focus(), 50);
    });

    urlCancel?.addEventListener('click', () => {
      if (urlRow) urlRow.style.display = 'none';
      if (urlInput) urlInput.value = '';
    });

    urlSubmit?.addEventListener('click', () => {
      if (urlInput) {
        setPhotoFromURL(urlInput.value);
        if (urlRow) urlRow.style.display = 'none';
        urlInput.value = '';
      }
    });

    urlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') urlSubmit?.click();
    });

    removeBtn?.addEventListener('click', () => {
      removeProfilePhoto();
    });

    if (zone && display) {
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        zone.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      });

      ['dragenter', 'dragover'].forEach(evt => {
        zone.addEventListener(evt, () => zone.classList.add('drag-over'));
      });

      ['dragleave', 'drop'].forEach(evt => {
        zone.addEventListener(evt, () => zone.classList.remove('drag-over'));
      });

      zone.addEventListener('drop', (e) => {
        zone.classList.remove('drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          setPhotoFromFile(e.dataTransfer.files[0]);
        }
      });
    }
  }

  function updateProjectCount() {
    const data = getData();
    const badge = document.getElementById('sidebar-project-count');
    if (badge) badge.textContent = data.projects.length;
    const taskBadge = document.getElementById('sidebar-task-count');
    if (taskBadge) taskBadge.textContent = data.tasks.length;
    const teamBadge = document.getElementById('sidebar-team-count');
    if (teamBadge) teamBadge.textContent = data.team.length;
  }

  function updateCommandPaletteProjects() {
    const data = getData();
    const container = document.getElementById('command-palette-projects');
    if (!container) return;
    let html = '';
    if (data.projects.length > 0) {
      html += '<div class="command-group-title">Projects</div>';
      data.projects.forEach(p => {
        const name = escapeHtml(p.name);
        html += `<div class="command-item" data-project-id="${escapeHtml(p.id)}" data-search="${name}"><div class="sidebar-dot" style="background:${p.color};width:12px;height:12px;"></div><span>${name}</span></div>`;
      });
    }
    if (data.tasks.length > 0) {
      html += '<div class="command-group-title">Tasks</div>';
      data.tasks.forEach(task => {
        const project = data.projects.find(p => p.id === task.projectId);
        const taskName = escapeHtml(task.name);
        const projectName = escapeHtml(project?.name || 'Unassigned');
        html += `<div class="command-item command-task-item" data-task-id="${escapeHtml(task.id)}" data-search="${taskName} ${projectName}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg><span class="command-item-label">${taskName}</span><span class="command-item-meta">${projectName}</span></div>`;
      });
    }
    container.innerHTML = html;
  }

  var EMPTY_ICONS = {
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    task: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    rocket: '<path d="M17.42 10.28A7.5 7.5 0 0 1 22 14.5v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a7.5 7.5 0 0 1 4.58-4.22"/><circle cx="12" cy="10" r="3"/><path d="M12 2v4"/><path d="M12 16v2"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  };

  function renderEmptyState(title, desc, btnText, btnId, iconType, secondaryBtn) {
    var icon = EMPTY_ICONS[iconType] || EMPTY_ICONS.folder;
    var secondaryHtml = secondaryBtn ? `<button class="empty-state-btn-secondary" id="${secondaryBtn.id}">${secondaryBtn.text}</button>` : '';
    var btnHtml = btnText ? `<button class="empty-state-btn" id="${btnId}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>${btnText}</button>` : '';
    var actionsHtml = (btnHtml || secondaryHtml) ? `<div class="empty-state-actions">${btnHtml}${secondaryHtml}</div>` : '';
    return `<div class="empty-state"><div class="empty-state-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></div><h3 class="empty-state-title">${title}</h3><p class="empty-state-desc">${desc}</p>${actionsHtml}</div>`;
  }

  function renderDashboard() {
    const data = getData();
    const container = document.getElementById('dashboard-content');
    if (!container) return;
    if (data.projects.length === 0) {
      container.innerHTML = renderEmptyState('Welcome to Project Manager', 'Create your first project to start organizing your work. Track tasks, collaborate with your team, and meet deadlines.', 'Create Project', 'empty-create-project', 'rocket');
      document.getElementById('empty-create-project')?.addEventListener('click', () => openProjectDrawerCreate());
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    var urgentTasks = [];
    var completedTasks = 0;
    var overdueCount = 0;
    var dueToday = 0;
    var openTasks = 0;
    var upcoming = [];
    data.tasks.forEach(function(t) {
      if (t.status === 'done') { completedTasks++; return; }
      openTasks++;
      if (!t.dueDate) return;
      var d = dueDatePart(t.dueDate);
      if (d <= today) urgentTasks.push(t);
      if (d < today) overdueCount++;
      if (d === today) dueToday++;
      if (d <= weekEnd) upcoming.push(t);
    });
    const totalTasks = data.tasks.length;
    const rate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    upcoming.sort(function (a, b) {
      var da = dueDatePart(a.dueDate), db = dueDatePart(b.dueDate);
      var oa = da < today ? 0 : 1, ob = db < today ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return da < db ? -1 : da > db ? 1 : 0;
    });
    const upcomingShown = upcoming.slice(0, 6);

    var bannerHtml = '';
    if (urgentTasks.length > 0) {
      var task = urgentTasks[0];
      var isOverdue = dueDatePart(task.dueDate) < today;
      bannerHtml = '<div class="dashboard-banner ' + (isOverdue ? 'overdue' : 'due-today') + '"><div class="dashboard-banner-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div><div class="dashboard-banner-content"><span class="dashboard-banner-title">' + (isOverdue ? 'Task Overdue' : 'Due Today') + '</span><span class="dashboard-banner-desc">' + task.name + '</span></div><button class="btn btn-sm btn-primary dashboard-banner-btn" data-task-id="' + task.id + '">View Task</button></div>';
    }

    var metricDefs = [
      { cls: 'metric-danger', icon: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>', label: 'Overdue', value: overdueCount, caption: overdueCount > 0 ? 'needs attention' : 'all caught up', go: 'tasks' },
      { cls: 'metric-warning', icon: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>', label: 'Due today', value: dueToday, caption: dueToday > 0 ? 'scheduled for today' : 'nothing due today', go: 'tasks' },
      { cls: 'metric-neutral', icon: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>', label: 'Open tasks', value: openTasks, caption: 'not yet done', go: 'tasks' },
      { cls: 'metric-success', icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>', label: 'Completion', value: rate + '%', caption: 'of all tasks done', go: 'tasks' },
      { cls: 'metric-primary', icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>', label: 'Projects', value: data.projects.length, caption: 'active', go: 'projects' },
      { cls: 'metric-info', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>', label: 'Team', value: data.team.length, caption: 'members', go: 'team' }
    ];
    var stripHtml = '<section class="overview-strip anim-fade-up" aria-label="Overview">';
    metricDefs.forEach(function(m) {
      stripHtml += '<button class="overview-metric ' + m.cls + '" type="button" data-go="' + m.go + '" aria-label="' + m.label + ': ' + m.value + '"><span class="overview-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + m.icon + '</svg></span><span class="overview-body"><span class="overview-label">' + m.label + '</span><span class="overview-value">' + m.value + '</span><span class="overview-caption">' + m.caption + '</span></span></button>';
    });
    stripHtml += '</section>';
    var html = bannerHtml + stripHtml;

    if (data.projects.length === 1 && totalTasks === 0 && data.team.length === 0) {
      html += '<div class="welcome-guide"><div class="welcome-guide-content"><div class="welcome-guide-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div><div><h3 class="welcome-guide-title">Your project is ready</h3><p class="welcome-guide-desc">Add tasks, invite team members, and set deadlines to bring your project to life.</p></div></div><div class="welcome-guide-steps"><div class="welcome-guide-step" id="wg-add-task"><div class="welcome-guide-step-number">1</div><div><strong>Add a task</strong><p>Create your first task with a due date and priority.</p></div></div><div class="welcome-guide-step" id="wg-invite"><div class="welcome-guide-step-number">2</div><div><strong>Invite your team</strong><p>Add team members and assign them tasks.</p></div></div></div></div>';
    }

    var upcomingHtml = '<div class="section"><div class="section-header"><h2 class="section-title">Upcoming tasks</h2><button class="section-link" id="upcoming-view-all" type="button">View all<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button></div>';
    if (upcomingShown.length === 0) {
      upcomingHtml += '<p class="upcoming-empty">No tasks due in the next 7 days.</p>';
    } else {
      upcomingHtml += '<div class="upcoming-list">';
      upcomingShown.forEach(function(t) {
        var proj = data.projects.find(function(pr) { return pr.id === t.projectId; });
        var assignee = t.assigneeId ? data.team.find(function(m) { return m.id === t.assigneeId; }) : null;
        var ud = dueDatePart(t.dueDate);
        var chip = ud < today ? '<span class="badge badge-danger upcoming-chip">Overdue</span>' : ud === today ? '<span class="badge badge-warning upcoming-chip">Today</span>' : '<span class="badge badge-neutral upcoming-chip">' + formatDueDate(t.dueDate) + '</span>';
        upcomingHtml += '<button class="upcoming-item" data-task-id="' + t.id + '" type="button"><span class="upcoming-dot" style="background:' + (proj ? proj.color : 'var(--primary)') + ';"></span><span class="upcoming-name">' + escapeHtml(t.name) + '</span>' + (assignee ? memberAvatarHtml(assignee) : '') + chip + '</button>';
      });
      upcomingHtml += '</div>';
    }
    upcomingHtml += '</div>';
    html += '<div class="dashboard-grid"><div class="dashboard-main">' + upcomingHtml + '<div class="section"><div class="section-header"><h2 class="section-title">Your Projects</h2><button class="section-link" id="dash-projects-all" type="button">View all<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button></div><div class="project-cards-grid">';
    var dashStats = getProjectTaskStats(data);
    var tier = function (s) { return s.overdue > 0 ? 0 : (s.total > 0 && s.done < s.total ? 1 : 2); };
    var sortedProjects = data.projects.slice().sort(function (a, b) {
      var sa = dashStats[a.id] || { total: 0, done: 0, overdue: 0 };
      var sb = dashStats[b.id] || { total: 0, done: 0, overdue: 0 };
      var ta = tier(sa), tb = tier(sb);
      if (ta !== tb) return ta - tb;
      if (sa.overdue !== sb.overdue) return sb.overdue - sa.overdue;
      var pa = sa.total > 0 ? sa.done / sa.total : 0, pb = sb.total > 0 ? sb.done / sb.total : 0;
      if (pa !== pb) return pb - pa;
      return a.name.localeCompare(b.name);
    });
    sortedProjects.forEach(function(p, i) {
      var stats = dashStats[p.id] || { total: 0, done: 0, overdue: 0 };
      var prog = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
      var sLabel = stats.overdue > 0 ? stats.overdue + ' overdue' : (stats.total === 0 ? 'Empty' : prog + '% complete');
      var sClass = stats.overdue > 0 ? 'badge-danger' : (prog === 100 ? 'badge-success' : 'badge-info');
      var sIcon = stats.overdue > 0 ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>' : (prog === 100 ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>' : '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>');
      html += '<article class="project-card' + (stats.overdue > 0 ? ' needs-attention' : '') + '" data-project-id="' + p.id + '" style="animation-delay:' + (i * 50) + 'ms;"><div class="project-card-color" style="background:' + p.color + ';"></div><div class="project-card-body"><div class="project-card-header"><h3 class="project-card-title">' + p.name + '</h3><span class="badge ' + sClass + ' project-status-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;">' + sIcon + '</svg>' + sLabel + '</span></div>' + (stats.total > 0 ? '<div class="progress-bar" role="progressbar" aria-valuenow="' + prog + '" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar-fill" style="width:' + prog + '%;background:' + p.color + ';" aria-hidden="true"></div></div>' : '') + '<div class="project-card-meta"><span class="project-card-task-count"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>' + stats.total + ' task' + (stats.total !== 1 ? 's' : '') + '</span>' + (data.team.length > 0 && stats.total > 0 ? '<span class="project-card-members"><div class="avatar-stack" style="display:inline-flex;vertical-align:middle;">' + data.team.slice(0, 3).map(function(m, j) { var inline = 'margin-left:' + (j === 0 ? 0 : '-8px') + ';border:' + (j === 0 ? 'none' : '2px solid var(--bg-primary)') + ';'; if (m.photo) { return '<div class="avatar avatar-xs" style="overflow:hidden;' + inline + '" title="' + m.name + '"><img src="' + m.photo + '" alt="" style="width:100%;height:100%;object-fit:cover;"></div>'; } return '<div class="avatar avatar-xs" style="background:' + (m.color || 'var(--primary)') + ';' + inline + '" title="' + m.name + '">' + m.name.split(' ').map(function(w2) { return w2[0]; }).join('').toUpperCase().slice(0, 2) + '</div>'; }).join('') + (data.team.length > 3 ? '<div class="avatar avatar-xs" style="background:var(--bg-tertiary);color:var(--text-secondary);margin-left:-8px;border:2px solid var(--bg-primary);font-size:9px;">+' + (data.team.length - 3) + '</div>' : '') + '</div></span>' : '') + '</div></div></article>';
    });
        html += '</div></div></div><div class="dashboard-side"><div class="widget"><div class="widget-header"><h3 class="widget-title">Recent Activity <span class="live-dot"></span></h3></div><div id="dashboard-activity"></div></div><div id="dashboard-goals"></div></div></div>';
    container.innerHTML = html;
    renderActivityFeed(document.getElementById('dashboard-activity'));
    renderGoals(document.getElementById('dashboard-goals'));
    container.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', () => navigateTo('project-detail', card.dataset.projectId));
    });
    container.querySelector('.dashboard-banner-btn')?.addEventListener('click', (e) => {
      openTaskDrawerEdit(e.target.dataset.taskId);
    });
    document.getElementById('wg-add-task')?.addEventListener('click', function () {
      if (data.projects.length > 0) openTaskDrawerCreate(data.projects[0].id);
    });
    document.getElementById('wg-invite')?.addEventListener('click', function () {
      navigateTo('team'); openTeamDrawerCreate();
    });
    container.querySelectorAll('.overview-metric').forEach(function (el) {
      el.addEventListener('click', function () { navigateTo(el.dataset.go); });
    });
    container.querySelectorAll('.upcoming-item').forEach(function (el) {
      el.addEventListener('click', function () { openTaskDrawerEdit(el.dataset.taskId); });
    });
    document.getElementById('upcoming-view-all')?.addEventListener('click', function () { navigateTo('tasks'); });
    document.getElementById('dash-projects-all')?.addEventListener('click', function () { navigateTo('projects'); });
  }

  function renderProjects() {
    var data = getData();
    var container = document.getElementById('projects-content');
    if (!container) return;
    var projects = data.projects;
    if (projects.length === 0) {
      container.innerHTML = renderEmptyState('No projects yet', 'Projects help you organize tasks, set deadlines, and track progress.', 'Create Project', 'empty-create-project-2', 'folder');
      document.getElementById('empty-create-project-2') && document.getElementById('empty-create-project-2').addEventListener('click', function () { openProjectDrawerCreate(); });
      return;
    }
    var taskStats = getProjectTaskStats(data);
    var html = '<div class="projects-grid">';
    projects.forEach(function(p, i) {
      var stats = taskStats[p.id] || { total: 0, done: 0, overdue: 0 };
      var prog = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
      var sLabel = stats.overdue > 0 ? stats.overdue + ' overdue' : (stats.total === 0 ? 'Empty' : prog + '% complete');
      var sClass = stats.overdue > 0 ? 'badge-danger' : (prog === 100 ? 'badge-success' : 'badge-info');
      var sIcon = stats.overdue > 0 ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>' : (prog === 100 ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>' : '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>');
      html += `<article class="project-card-large" data-project-id="${p.id}" style="animation-delay:${i * 50}ms;"><div class="project-card-color" style="background:${p.color};"></div><div class="project-card-body"><div class="project-card-large-header"><h3 class="project-card-title">${p.name}</h3><div class="project-card-actions"><button class="btn-icon-small edit-project-btn" data-project-id="${p.id}" title="Edit project"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="btn-icon-small archive-project-btn" data-project-id="${p.id}" title="Archive project"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg></button><button class="btn-icon-small delete-project-btn" data-project-id="${p.id}" title="Delete project" style="color:var(--danger);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div><span class="badge ${sClass} project-status-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;">${sIcon}</svg>${sLabel}</span></div>${stats.total > 0 ? `<div class="progress-bar" role="progressbar" aria-valuenow="${prog}" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar-fill" style="width:${prog}%;background:${p.color};" aria-hidden="true"></div></div>` : ''}<div class="project-card-meta"><span class="project-card-task-count"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>${stats.total} task${stats.total !== 1 ? 's' : ''}</span>${data.team.length > 0 && stats.total > 0 ? `<span class="project-card-members"><div class="avatar-stack" style="display:inline-flex;vertical-align:middle;">${data.team.slice(0, 3).map((m, j) => { const inline = `margin-left:${j === 0 ? 0 : '-8px'};border:${j === 0 ? 'none' : '2px solid var(--bg-primary)'};`; return m.photo ? `<div class="avatar avatar-xs" style="overflow:hidden;${inline}" title="${m.name}"><img src="${m.photo}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>` : `<div class="avatar avatar-xs" style="background:${m.color || 'var(--primary)'};${inline}" title="${m.name}">${m.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}</div>`; }).join('')}${data.team.length > 3 ? `<div class="avatar avatar-xs" style="background:var(--bg-tertiary);color:var(--text-secondary);margin-left:-8px;border:2px solid var(--bg-primary);font-size:9px;">+${data.team.length - 3}</div>` : ''}</div></span>` : ''}</div></div></article>`;
    });
    html += '</div>';
    container.innerHTML = html;
    container.querySelectorAll('.project-card-large').forEach(card => {
      card.addEventListener('click', () => navigateTo('project-detail', card.dataset.projectId));
    });
    container.querySelectorAll('.edit-project-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openProjectDrawerEdit(btn.dataset.projectId); });
    });
    container.querySelectorAll('.archive-project-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); archiveProject(btn.dataset.projectId); });
    });
    container.querySelectorAll('.delete-project-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showConfirmDialog({ title: 'Delete project?', message: 'This deletes the project and all of its tasks. This can\'t be undone.', confirmLabel: 'Delete', danger: true })
          .then(function (ok) { if (ok) deleteProject(btn.dataset.projectId); });
      });
    });
    renderArchivedProjects(container);
  }

  function renderProjectDetail(projectId) {
    const data = getData();
    const project = data.projects.find(p => p.id === projectId);
    const container = document.getElementById('project-detail-content');
    const titleEl = document.getElementById('project-detail-title');
    const subtitleEl = document.getElementById('project-detail-subtitle');
    if (!project) {
      if (titleEl) titleEl.textContent = 'Project not found';
      if (subtitleEl) subtitleEl.textContent = '';
      if (container) container.innerHTML = renderEmptyState('Project not found', "This project doesn't exist or was deleted.", 'Back to Projects', 'empty-back-projects', 'search');
      document.getElementById('empty-back-projects')?.addEventListener('click', () => navigateTo('projects'));
      return;
    }
    const projectTasks = data.tasks.filter(t => t.projectId === projectId);
    if (titleEl) titleEl.textContent = project.name;
    if (subtitleEl) subtitleEl.textContent = `${projectTasks.length} tasks`;
    var phActions = document.querySelector('#page-project-detail .page-header-actions');
    if (phActions && !document.getElementById('gantt-btn')) {
      var ganttBtn = document.createElement('button');
      ganttBtn.className = 'btn btn-ghost';
      ganttBtn.id = 'gantt-btn';
      ganttBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg> Gantt';
      ganttBtn.addEventListener('click', function () { openGanttView(projectId); });
      phActions.prepend(ganttBtn);
    }
    if (!container) return;
    if (projectTasks.length === 0) {
      container.innerHTML = renderEmptyState('No tasks yet', 'This project is empty. Add your first task to get started.', 'Add Task', 'empty-add-task', 'task');
      document.getElementById('empty-add-task')?.addEventListener('click', () => openTaskDrawerCreate(projectId));
      return;
    }
    const statuses = ['backlog', 'todo', 'inprogress', 'review', 'done'];
    const sLabels = { backlog: 'Backlog', todo: 'To Do', inprogress: 'In Progress', review: 'In Review', done: 'Done' };
    const sColors = { backlog: 'var(--text-tertiary)', todo: 'var(--text-secondary)', inprogress: 'var(--primary)', review: 'var(--warning)', done: 'var(--success)' };
    let html = '<div class="kanban-board">';
    statuses.forEach(status => {
      const tasks = projectTasks.filter(t => t.status === status);
      html += `<div class="kanban-column"><div class="kanban-column-header"><div class="flex items-center gap-2"><div class="kanban-dot" style="background:${sColors[status]};"></div><span class="kanban-column-title">${sLabels[status]}</span></div><span class="kanban-count">${tasks.length}</span></div><div class="kanban-cards" data-status="${status}">`;
      tasks.forEach(task => {
        const assignee = task.assigneeId ? data.team.find(m => m.id === task.assigneeId) : null;
        const tags = task.tags ? renderRichTags(task.tags) : '';
        const subProgress = renderSubtaskProgress(task.subtasks);
        const attCount = renderAttachmentCount(task.attachments);
        const hasMeta = task.dueDate || assignee;
        html += `<div class="kanban-card" draggable="true" data-task-id="${task.id}">`;
        html += `<div class="kanban-card-title">${task.name}</div>`;
        if (task.description) html += `<p class="kanban-card-desc">${task.description}</p>`;
        if (tags) html += `<div class="kanban-card-tags">${tags}</div>`;
        if (subProgress || attCount) html += `<div class="kanban-card-meta-row">${subProgress}${attCount ? '<span style="flex:1"></span>' + attCount : ''}</div>`;
        if (hasMeta || tags || subProgress || attCount) {
          html += `<div class="kanban-card-footer">`;
          html += `<div class="kanban-card-footer-left">`;
          if (task.dueDate) html += `<span class="kanban-card-due">${formatDueDate(task.dueDate)}</span>`;
          html += `</div>`;
          if (assignee) {
            html += memberAvatarHtml(assignee);
          }
          html += `</div>`;
        }
        html += `</div>`;
      });
      html += `</div><button class="kanban-add-btn" data-status="${status}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Add task</button></div>`;
    });
    html += '</div>';
    html += '<div class="section" style="margin-top:var(--space-8);"><div class="section-header"><h2 class="section-title">Project Activity</h2></div><div id="project-activity-feed"></div></div>';
    container.innerHTML = html;
    container.querySelectorAll('.kanban-add-btn').forEach(btn => {
      btn.addEventListener('click', () => openTaskDrawerCreate(projectId, btn.dataset.status));
    });
    initKanbanDrag();
    initTaskItemListeners();
    API.get('/activity?project_id=' + projectId + '&limit=10').then(function (logs) {
      var feed = document.getElementById('project-activity-feed');
      if (!feed) return;
      if (!logs || logs.length === 0) { feed.innerHTML = '<p style="font-size:var(--text-sm);color:var(--text-tertiary);padding:var(--space-3) 0;text-align:center;">No activity yet</p>'; return; }
      feed.innerHTML = '<div class="activity-feed">' + logs.map(function (a) {
        var d = new Date(a.createdAt);
        return '<div class="activity-item"><div class="activity-icon" style="background:var(--bg-tertiary);color:var(--text-secondary);font-size:12px;">' + (a.type === 'task-completed' ? '✓' : a.type === 'task-created' ? '+' : a.type === 'task-deleted' ? '✕' : '•') + '</div><div class="activity-content"><div class="activity-text">' + a.description + '</div><div class="activity-time">' + formatActivityTime(d) + '</div></div></div>';
      }).join('') + '</div>';
    }).catch(function () {});
  }

  function filterTasksUI(query) {
    var container = document.getElementById('tasks-content');
    var subtitle = document.getElementById('tasks-subtitle');
    if (!container) return;
    var items = container.querySelectorAll('.task-item');
    var visible = 0;
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var text = (el.querySelector('.task-item-title')?.textContent || '') + ' ' + (el.querySelector('.task-item-desc')?.textContent || '');
      var match = !query || text.toLowerCase().includes(query);
      el.style.display = match ? '' : 'none';
      if (match) visible++;
    }
    var total = items.length;
    if (subtitle) subtitle.textContent = visible + ' of ' + total + ' tasks';
    var groups = container.querySelectorAll('.task-group');
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var visItems = group.querySelectorAll('.task-item:not([style*="display: none"])');
      group.style.display = visItems.length === 0 && query ? 'none' : '';
    }
    var emptyMsg = container.querySelector('.empty-state');
    if (!emptyMsg && visible === 0 && total > 0) {
      var es = document.createElement('div');
      es.innerHTML = renderEmptyState('No matches', 'Try adjusting your search or filters.', '', '', 'search');
      es.firstChild.classList.add('search-empty-state');
      container.appendChild(es.firstChild);
    } else if (emptyMsg && emptyMsg.classList.contains('search-empty-state')) {
      emptyMsg.style.display = visible === 0 && total > 0 ? '' : 'none';
    }
  }

  function filterProjectsUI(query) {
    var container = document.getElementById('projects-content');
    if (!container) return;
    var items = container.querySelectorAll('.project-card-large');
    var visible = 0;
    items.forEach(function (el) {
      var text = el.querySelector('.project-card-title')?.textContent || '';
      var match = !query || text.toLowerCase().includes(query);
      el.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    var emptyMsg = container.querySelector('.empty-state');
    if (!emptyMsg && visible === 0 && items.length > 0) {
      var es = document.createElement('div');
      es.innerHTML = renderEmptyState('No matches', 'Try a different search term.', '', '', 'search');
      es.firstChild.classList.add('search-empty-state');
      container.appendChild(es.firstChild);
    } else if (emptyMsg && emptyMsg.classList.contains('search-empty-state')) {
      emptyMsg.style.display = visible === 0 && items.length > 0 ? '' : 'none';
    }
  }

  function renderTasks() {
    const data = getData();
    const container = document.getElementById('tasks-content');
    const subtitle = document.getElementById('tasks-subtitle');
    if (!container) return;

    const activeFilter = document.querySelector('#tasks-filter-bar .filter-chip.active')?.dataset.filter || 'all';
    const sortBy = document.getElementById('tasks-sort')?.value || 'due-asc';

    let filteredTasks = [...data.tasks];
    if (activeFilter !== 'all') {
      filteredTasks = filteredTasks.filter(t => t.status === activeFilter);
    }

    const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
    if (sortBy === 'due-asc') filteredTasks.sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1);
    else if (sortBy === 'due-desc') filteredTasks.sort((a, b) => (a.dueDate || '0000') > (b.dueDate || '0000') ? -1 : 1);
    else if (sortBy === 'priority') filteredTasks.sort((a, b) => (PRIORITY_ORDER[a.priority] || 2) - (PRIORITY_ORDER[b.priority] || 2));
    else if (sortBy === 'created') filteredTasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sortBy === 'name') filteredTasks.sort((a, b) => a.name.localeCompare(b.name));

    if (data.tasks.length === 0) {
      if (subtitle) subtitle.textContent = 'No tasks yet';
      container.innerHTML = renderEmptyState('No tasks yet', 'Create tasks to track your work across projects. Assign due dates, set priorities, and never miss a deadline.', 'New Task', 'empty-new-task', 'task');
      document.getElementById('empty-new-task')?.addEventListener('click', () => {
        if (data.projects.length > 0) openTaskDrawerCreate(data.projects[0].id);
        else { navigateTo('projects'); }
      });
      return;
    }
    if (subtitle) subtitle.textContent = `${filteredTasks.length} of ${data.tasks.length} tasks`;
    if (filteredTasks.length === 0 && data.tasks.length > 0) {
      container.innerHTML = renderEmptyState('No matches', 'Try adjusting your search or filters.', '', '', 'search');
      return;
    }

    let html = '<div id="tasks-bulk-actions" style="display:none;margin-bottom:var(--space-3);display:none;align-items:center;gap:var(--space-2);"><span id="tasks-selected-count" style="font-size:var(--text-sm);color:var(--text-secondary);"></span><button class="btn btn-sm btn-danger" id="bulk-delete-tasks">Delete Selected</button><button class="btn btn-sm btn-outline" id="bulk-clear-tasks">Clear Selection</button></div><div class="task-groups">';
    const groupedByProject = {};
    filteredTasks.forEach(t => {
      if (!groupedByProject[t.projectId]) groupedByProject[t.projectId] = [];
      groupedByProject[t.projectId].push(t);
    });
    let selectedTaskIds = [];
    function updateBulkUI() {
      const bar = document.getElementById('tasks-bulk-actions');
      const countEl = document.getElementById('tasks-selected-count');
      if (!bar || !countEl) return;
      if (selectedTaskIds.length > 0) {
        bar.style.display = 'flex';
        countEl.textContent = `${selectedTaskIds.length} selected`;
      } else {
        bar.style.display = 'none';
      }
    }

    for (const [projectId, tasks] of Object.entries(groupedByProject)) {
      const p = data.projects.find(pr => pr.id === projectId);
      if (!p) continue;
      html += `<div class="task-group"><div class="task-group-header"><div class="flex items-center gap-3"><div class="sidebar-dot" style="background:${p.color};"></div><span class="task-group-title">${p.name}</span><span class="badge badge-neutral">${tasks.length} tasks</span></div></div><div class="task-list">`;
      tasks.forEach(task => {
        const isDone = task.status === 'done';
        const assignee = task.assigneeId ? data.team.find(m => m.id === task.assigneeId) : null;
        var richTags = task.tags ? renderRichTags(task.tags) : '';
        var subProgress = renderSubtaskProgress(task.subtasks);
        var attCount = renderAttachmentCount(task.attachments);
        html += `<div class="task-item ${isDone ? 'completed' : ''}" data-task-id="${task.id}"><div class="task-select-checkbox" style="margin-right:var(--space-2);" title="Select task">
          <input type="checkbox" class="task-select-input" data-task-id="${task.id}" style="display:none;">
          <div class="task-select-box"></div>
        </div><button class="task-checkbox ${isDone ? 'checked' : ''}" id="cb-${task.id}"><svg class="checkmark-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></button><div class="task-item-content"><span class="task-item-title">${task.name}</span>${richTags ? `<div class="task-item-tags">${richTags}</div>` : ''}${task.description ? `<p class="task-item-desc">${renderMarkdown(task.description).replace(/<br>/g, ' ').replace(/<[^>]+>/g, '')}</p>` : ''}</div><div class="task-item-right">${subProgress ? subProgress + ' ' : ''}${attCount ? attCount + ' ' : ''}${task.time_spent > 0 ? `<span style="font-size:var(--text-xs);color:var(--text-tertiary);margin-right:8px;">${formatTime(task.time_spent)}</span>` : ''}${assignee ? memberAvatarHtml(assignee, 'margin-right:8px;') : ''}${task.dueDate ? `<span class="task-item-due ${new Date(task.dueDate) < new Date() && !isDone ? 'overdue' : ''}">${formatDueDate(task.dueDate)}</span>` : ''}</div></div>`;
      });
      html += '</div></div>';
    }
    html += '</div>';
    container.innerHTML = html;
    initTaskItemListeners();

    document.querySelectorAll('.task-select-checkbox').forEach(box => {
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = box.querySelector('.task-select-input');
        const taskId = input.dataset.taskId;
        if (input.checked) {
          input.checked = false;
          selectedTaskIds = selectedTaskIds.filter(id => id !== taskId);
          box.classList.remove('selected');
        } else {
          input.checked = true;
          selectedTaskIds.push(taskId);
          box.classList.add('selected');
        }
        updateBulkUI();
      });
    });
    document.getElementById('bulk-delete-tasks')?.addEventListener('click', () => {
      if (selectedTaskIds.length === 0) return;
      showConfirmDialog({ title: 'Delete tasks?', message: `Delete ${selectedTaskIds.length} selected task(s)? This can't be undone.`, confirmLabel: 'Delete', danger: true }).then(function (ok) {
      if (ok) {
        var ids = selectedTaskIds.slice();
        Promise.all(ids.map(function (id) { return API.del('/tasks/' + id); })).then(function () {
          var d = getData();
          d.tasks = d.tasks.filter(function (t) { return !ids.includes(t.id); });
          showToast(ids.length + ' task(s) deleted');
          selectedTaskIds = [];
          refreshCurrentView();
        }).catch(function () { showToast('Failed to delete tasks', 'error'); });
      }
      });
    });
    document.getElementById('bulk-clear-tasks')?.addEventListener('click', () => {
      selectedTaskIds = [];
      document.querySelectorAll('.task-select-input').forEach(i => i.checked = false);
      document.querySelectorAll('.task-select-checkbox').forEach(b => b.classList.remove('selected'));
      updateBulkUI();
    });
  }

  function renderCalendar() {
    const container = document.getElementById('calendar-content');
    if (!container) return;

    const data = getData();
    if (data.tasks.filter(t => t.dueDate).length === 0 && data.events.length === 0) {
      container.innerHTML = renderEmptyState('Nothing scheduled', 'Add tasks with due dates or create events to populate your calendar.', 'New Event', 'empty-calendar-event', 'calendar');
      document.getElementById('empty-calendar-event')?.addEventListener('click', () => openEventDrawerCreate());
      return;
    }

    let calMonth = parseInt(localStorage.getItem('pm-cal-month') || new Date().getMonth());
    let calYear = parseInt(localStorage.getItem('pm-cal-year') || new Date().getFullYear());
    let calView = localStorage.getItem('pm-cal-view') || 'month';
    if (isNaN(calMonth)) calMonth = new Date().getMonth();
    if (isNaN(calYear)) calYear = new Date().getFullYear();

    function saveCalNav() {
      localStorage.setItem('pm-cal-month', calMonth);
      localStorage.setItem('pm-cal-year', calYear);
      localStorage.setItem('pm-cal-view', calView);
    }

    function render() {
      const today = new Date();
      const data = getData();
      const firstDay = new Date(calYear, calMonth, 1).getDay();
      const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

      const tasksByDate = {};
      data.tasks.forEach(t => {
        if (t.dueDate) {
          var key = dueDatePart(t.dueDate);
          if (!tasksByDate[key]) tasksByDate[key] = [];
          tasksByDate[key].push(t);
        }
      });

      const eventsByDate = {};
      data.events.forEach(e => {
        var key = dueDatePart(e.date);
        if (key) {
          if (!eventsByDate[key]) eventsByDate[key] = [];
          eventsByDate[key].push(e);
        }
      });

      let mainHtml = '';

      if (calView === 'week') {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        mainHtml = `<div class="week-calendar"><div class="week-header">${weekdays.map((d, i) => {
          const date = new Date(weekStart);
          date.setDate(weekStart.getDate() + i);
          const dateStr = date.toISOString().split('T')[0];
          const isToday = today.toDateString() === date.toDateString();
          return `<div class="week-day-header"><span class="week-day-name">${d}</span><span class="week-day-number ${isToday ? 'today' : ''}">${date.getDate()}</span></div>`;
        }).join('')}</div><div class="week-body" id="week-body">${weekdays.map((_, i) => {
          const date = new Date(weekStart);
          date.setDate(weekStart.getDate() + i);
          const dateStr = date.toISOString().split('T')[0];
          const dayTasks = tasksByDate[dateStr] || [];
          const dayEvents = eventsByDate[dateStr] || [];
          const items = [...dayTasks.map(t => ({ type: 'task', name: t.name, id: t.id })), ...dayEvents.map(e => ({ type: 'event', name: e.name, id: e.id }))];
          return `<div class="week-cell" data-date="${dateStr}">${items.map(it => `<div class="week-event ${it.type === 'task' ? 'emerald' : 'amber'}" data-${it.type}-id="${it.id}" draggable="true" style="top:${items.indexOf(it) * 22 + 2}px;height:18px;font-size:10px;line-height:18px;">${it.name}</div>`).join('')}</div>`;
        }).join('')}</div></div>`;
      } else {
        let gridHtml = '<div class="calendar-grid"><div class="calendar-weekdays">';
        weekdays.forEach(d => { gridHtml += '<span class="calendar-weekday">' + d + '</span>'; });
        gridHtml += '</div><div class="calendar-days">';
        for (let i = 0; i < firstDay; i++) {
          gridHtml += '<div class="calendar-day empty"></div>';
        }
        for (let day = 1; day <= daysInMonth; day++) {
          const dateStr = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
          const isToday = today.getFullYear() === calYear && today.getMonth() === calMonth && today.getDate() === day;
          const hasTasks = (tasksByDate[dateStr] && tasksByDate[dateStr].length > 0);
          const hasEvents = (eventsByDate[dateStr] && eventsByDate[dateStr].length > 0);
          const tasks = tasksByDate[dateStr] || [];
          const overdue = tasks.some(t => t.status !== 'done' && new Date(t.dueDate) < new Date());
          gridHtml += '<div class="calendar-day' + (isToday ? ' today' : '') + ((hasTasks || hasEvents) ? ' has-tasks' : '') + '" data-date="' + dateStr + '"><span class="calendar-day-number">' + day + '</span>';
          if (hasTasks || hasEvents) {
            gridHtml += '<div class="calendar-day-dots">';
            if (hasTasks) gridHtml += '<span class="calendar-dot' + (overdue ? ' overdue' : '') + '"></span>';
            if (hasEvents) gridHtml += '<span class="calendar-dot" style="background:var(--accent);"></span>';
            gridHtml += '</div>';
          }
          gridHtml += '</div>';
        }
        gridHtml += '</div></div>';
        mainHtml = gridHtml;
      }

      const sortedTasks = data.tasks.filter(t => t.dueDate && t.status !== 'done').sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8);
      let sidebarHtml = '<div class="calendar-sidebar"><div class="widget"><div class="widget-header"><h3 class="widget-title">Upcoming Deadlines</h3></div><div class="deadline-list">';
      if (sortedTasks.length === 0) {
        sidebarHtml += '<p style="font-size:var(--text-sm);color:var(--text-tertiary);padding:var(--space-4) 0;text-align:center;">No upcoming deadlines</p>';
      } else {
        sortedTasks.forEach(t => {
          const project = data.projects.find(p => p.id === t.projectId);
          const due = new Date(t.dueDate);
          const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
          const isOverdue = diffDays < 0;
          const urgency = isOverdue ? 'urgent' : (diffDays <= 2 ? 'soon' : 'normal');
          sidebarHtml += '<div class="deadline-item" data-task-id="' + t.id + '"><div class="deadline-color" style="background:' + (project ? project.color : 'var(--primary)') + '"></div><div class="deadline-info"><div class="deadline-title">' + t.name + '</div><div class="deadline-date">' + t.dueDate + '</div></div><span class="deadline-days ' + urgency + '">' + (isOverdue ? Math.abs(diffDays) + 'd overdue' : (diffDays === 0 ? 'Today' : diffDays + 'd')) + '</span></div>';
        });
      }
      sidebarHtml += '</div></div></div>';

      container.innerHTML = `<div class="calendar-layout"><div class="calendar-main"><div class="calendar-nav">
        <div style="display:flex;align-items:center;gap:var(--space-2);">
          <button class="btn btn-ghost btn-icon" id="cal-prev"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
          <span class="calendar-nav-title">${months[calMonth]} ${calYear}</span>
          <button class="btn btn-ghost btn-icon" id="cal-next"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
        </div>
        <div class="segmented-control">
          <button class="segmented-control-item ${calView === 'month' ? 'active' : ''}" id="cal-view-month">Month</button>
          <button class="segmented-control-item ${calView === 'week' ? 'active' : ''}" id="cal-view-week">Week</button>
        </div>
      </div>${mainHtml}</div>${sidebarHtml}</div>`;

      document.getElementById('cal-prev')?.addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } saveCalNav(); render(); });
      document.getElementById('cal-next')?.addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } saveCalNav(); render(); });
      document.getElementById('cal-view-month')?.addEventListener('click', () => { calView = 'month'; saveCalNav(); render(); });
      document.getElementById('cal-view-week')?.addEventListener('click', () => { calView = 'week'; saveCalNav(); render(); });

      if (calView === 'week') {
        setTimeout(() => {
          container.querySelectorAll('.week-cell').forEach(cell => {
            cell.addEventListener('click', () => {
              const date = cell.dataset.date;
              const dateTasks = data.tasks.filter(t => t.dueDate === date);
              const dateEvents = data.events.filter(e => e.date === date);
              if (dateTasks.length === 1 && dateEvents.length === 0) openTaskDrawerEdit(dateTasks[0].id);
              else openCalendarDayList(date, dateTasks, dateEvents);
            });
          });
          container.querySelectorAll('.week-event').forEach(ev => {
            ev.addEventListener('click', (e) => {
              e.stopPropagation();
              if (ev.dataset.taskId) openTaskDrawerEdit(ev.dataset.taskId);
            });
            ev.addEventListener('dragstart', function (e) {
              e.dataTransfer.setData('text/plain', JSON.stringify({ type: this.dataset.taskId ? 'task' : 'event', id: this.dataset.taskId || this.dataset.eventId }));
              this.style.opacity = '0.4';
            });
            ev.addEventListener('dragend', function () { this.style.opacity = ''; });
          });
          container.querySelectorAll('.week-cell').forEach(cell => {
            cell.addEventListener('dragover', function (e) { e.preventDefault(); this.style.background = 'var(--primary-bg)'; });
            cell.addEventListener('dragleave', function () { this.style.background = ''; });
            cell.addEventListener('drop', function (e) {
              e.preventDefault();
              this.style.background = '';
              var date = this.dataset.date;
              if (!date) return;
              try {
                var data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (data.type === 'task') {
                  API.patch('/tasks/' + data.id, { due_date: date }).then(function () {
                    showToast('Task rescheduled to ' + date);
                    refreshCurrentView();
                  }).catch(function () { showToast('Failed to reschedule', 'error'); });
                }
              } catch (err) {}
            });
          });
        }, 0);
      }

      if (calView === 'month') {
        container.querySelectorAll('.calendar-day:not(.empty)').forEach(day => {
          day.addEventListener('click', () => {
            const date = day.dataset.date;
            const dateTasks = data.tasks.filter(t => t.dueDate === date);
            const dateEvents = data.events.filter(e => e.date === date);
            if (dateTasks.length === 0 && dateEvents.length === 0) return;
            if (dateTasks.length === 1 && dateEvents.length === 0) {
              openTaskDrawerEdit(dateTasks[0].id);
            } else {
              openCalendarDayList(date, dateTasks, dateEvents);
            }
          });
          let dragStartDate = null;
          day.addEventListener('mousedown', (e) => {
            dragStartDate = day.dataset.date;
            const onMouseUp = (ev) => {
              const endDay = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.calendar-day');
              const endDate = endDay?.dataset.date;
              if (endDate && endDate !== dragStartDate) {
                const s = dragStartDate < endDate ? dragStartDate : endDate;
                const e = dragStartDate < endDate ? endDate : dragStartDate;
                openTaskDrawerCreate(getData().projects[0]?.id, 'todo', s, e);
              }
              document.removeEventListener('mouseup', onMouseUp);
            };
            document.addEventListener('mouseup', onMouseUp);
          });
        });
      }

      container.querySelectorAll('.deadline-item').forEach(item => {
        item.addEventListener('click', () => {
          if (item.dataset.taskId) openTaskDrawerEdit(item.dataset.taskId);
        });
      });
    }

    render();
  }

  function openCalendarDayList(date, tasks, events) {
    events = events || [];
    const badges = document.getElementById('drawer-badges');
    const content = document.getElementById('drawer-content');
    if (!content) return;
    badges.innerHTML = '<span class="badge badge-info">' + date + '</span>';
    let html = '<div style="padding:var(--space-2) 0;">';
    html += '<p style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-3);">' + tasks.length + ' task(s), ' + events.length + ' event(s)</p>';
    html += '<div style="display:flex;flex-direction:column;gap:var(--space-2);">';
    tasks.forEach(t => {
      html += '<div class="task-item" style="margin:0;" data-task-id="' + t.id + '"><button class="task-checkbox ' + (t.status === 'done' ? 'checked' : '') + '"></button><div class="task-item-content"><span class="task-item-title">' + t.name + '</span></div></div>';
    });
    events.forEach(e => {
      html += '<div class="task-item" style="margin:0;border-left:3px solid var(--accent);cursor:pointer;" data-event-id="' + e.id + '"><div class="task-item-content"><span class="task-item-title">' + e.name + '</span><span style="font-size:var(--text-xs);color:var(--text-tertiary);">' + (e.time || '') + '</span></div></div>';
    });
    html += '</div></div><div class="task-drawer-actions"><button class="btn btn-ghost" id="cal-day-close">Close</button></div>';
    content.innerHTML = html;
    openDrawer();
    document.getElementById('cal-day-close')?.addEventListener('click', closeDrawer);
    initTaskItemListeners();
    content.querySelectorAll('[data-event-id]').forEach(function (el) {
      el.addEventListener('click', function () { closeDrawer(); openEventDrawerEdit(this.dataset.eventId); });
    });
  }

  function renderTeam() {
    const data = getData();
    const container = document.getElementById('team-content');
    const subtitle = document.getElementById('team-subtitle');
    if (!container) return;
    if (subtitle) subtitle.textContent = `${data.team.length} member${data.team.length !== 1 ? 's' : ''}`;
    if (data.team.length === 0) {
      container.innerHTML = renderEmptyState('No team members yet', 'Invite team members to collaborate on projects and share the workload.', 'Add Member', 'empty-add-member', 'team');
      document.getElementById('empty-add-member')?.addEventListener('click', () => openTeamDrawerCreate());
      return;
    }
    const roleOrder = ['Owner', 'Admin', 'Member'];
    const grouped = {};
    roleOrder.forEach(r => grouped[r] = []);
    data.team.forEach(m => {
      const role = m.role || 'Member';
      if (grouped[role]) grouped[role].push(m);
      else grouped['Member'].push(m);
    });
    const roleIcons = {
      Owner: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
      Admin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/></svg>',
      Member: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
    };
    let html = '<div class="team-members-list">';
    roleOrder.forEach(role => {
      const members = grouped[role];
      if (!members || members.length === 0) return;
      html += `<div class="team-section-heading"><span class="team-section-icon">${roleIcons[role]}</span>${role}<span class="team-section-count">${members.length}</span></div>`;
      members.forEach(m => {
        const initials = getInitials(m.name);
        const color = m.color || 'var(--primary)';
        const avatarHtml = m.photo
          ? `<div class="team-member-avatar"><div class="avatar" style="width:40px;height:40px;"><img src="${m.photo}" alt="${m.name}" class="team-member-photo"></div></div>`
          : `<div class="team-member-avatar"><div class="avatar" style="background:${color};width:40px;height:40px;font-size:14px;">${initials}</div></div>`;
        html += `<div class="team-member-row" data-member-id="${m.id}">${avatarHtml}<div class="team-member-info"><span class="team-member-name">${m.name} <span class="role-badge role-${role.toLowerCase()}">${role}</span></span></div><div class="team-member-actions"><button class="btn-icon-small edit-member-btn" data-member-id="${m.id}" title="Edit member"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="btn-icon-small delete-member-btn" data-member-id="${m.id}" title="Remove member" style="color:var(--danger);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></div></div>`;
      });
    });
    html += '</div>';
    container.innerHTML = html;
    container.querySelectorAll('.edit-member-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openTeamDrawerEdit(btn.dataset.memberId); });
    });
    container.querySelectorAll('.delete-member-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showConfirmDialog({ title: 'Remove team member?', confirmLabel: 'Remove', danger: true })
          .then(function (ok) { if (ok) deleteTeamMember(btn.dataset.memberId); });
      });
    });
  }

  function renderAnalytics() {
    const data = getData();
    const container = document.getElementById('analytics-content');
    if (!container) return;
    if (data.tasks.length === 0 && data.projects.length === 0) {
      container.innerHTML = renderEmptyState('No data yet', 'Create projects and tasks to see analytics and track your progress.', 'Create Project', 'empty-analytics-create', 'chart');
      document.getElementById('empty-analytics-create')?.addEventListener('click', () => openProjectDrawerCreate());
      return;
    }
    const totalTasks = data.tasks.length;
    const completedTasks = data.tasks.filter(t => t.status === 'done').length;
    const rate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const byStatus = { backlog: 0, todo: 0, inprogress: 0, review: 0, done: 0 };
    data.tasks.forEach(t => { if (byStatus[t.status] !== undefined) byStatus[t.status]++; });
    const byProject = {};
    data.tasks.forEach(t => { byProject[t.projectId] = (byProject[t.projectId] || 0) + 1; });

    const statusLabels = { backlog: 'Backlog', todo: 'To Do', inprogress: 'In Progress', review: 'In Review', done: 'Done' };
    const statusColors = { backlog: '#7A7370', todo: COLORS[3], inprogress: COLORS[0], review: COLORS[6], done: COLORS[1] };
    const statuses = ['backlog', 'todo', 'inprogress', 'review', 'done'];

    const size = 160, cx = size/2, cy = size/2, r = 60, strokeW = 16;
    const total = totalTasks || 1;
    let cumulative = 0;
    let donutSlices = '';
    statuses.forEach(s => {
      const val = byStatus[s];
      if (val === 0) return;
      const pct = val / total;
      const startAngle = cumulative * 2 * Math.PI;
      cumulative += pct;
      const endAngle = cumulative * 2 * Math.PI;
      const x1 = cx + r * Math.sin(startAngle);
      const y1 = cy - r * Math.cos(startAngle);
      const x2 = cx + r * Math.sin(endAngle);
      const y2 = cy - r * Math.cos(endAngle);
      const large = pct > 0.5 ? 1 : 0;
      donutSlices += '<path d="M' + cx + ' ' + cy + ' L' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 + ' Z" fill="' + statusColors[s] + '" stroke="var(--bg-elevated)" stroke-width="2"/>';
    });
    const donutHtml = `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px;"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg-tertiary)" stroke-width="${strokeW}"/>${donutSlices}<circle cx="${cx}" cy="${cy}" r="${r - strokeW}" fill="var(--bg-elevated)"/><text x="${cx}" y="${cy - 4}" text-anchor="middle" font-family="var(--font-sans)" font-size="28" font-weight="700" fill="var(--text-primary)">${rate}%</text><text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">${completedTasks}/${totalTasks}</text></svg>`;

    let barHtml = '';
    const topProjects = Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxTasks = topProjects[0] ? topProjects[0][1] : 1;
    topProjects.forEach(([pid, count]) => {
      const p = data.projects.find(pr => pr.id === pid);
      if (!p) return;
      barHtml += `<div class="bar-chart-row"><div class="bar-chart-label"><span class="sidebar-dot" style="background:${p.color};"></span>${p.name}</div><div class="bar-chart-bar"><div class="bar-chart-fill" style="width:${(count/maxTasks*100)}%;background:${p.color};"></div></div><div class="bar-chart-value">${count}</div></div>`;
    });

    const overdue = data.tasks.filter(t => t.status !== 'done' && t.dueDate && new Date(t.dueDate) < new Date()).length;
    const inProgress = data.tasks.filter(t => t.status === 'inprogress').length;

    container.innerHTML = `<div class="stats-row"><div class="stat-card"><div class="stat-card-header"><span class="stat-card-label">Total Tasks</span></div><div class="stat-card-value">${totalTasks}</div>${totalTasks > 0 ? `<div class="stat-card-change positive"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>${Math.round(completedTasks/totalTasks*100)}% done</div>` : ''}</div><div class="stat-card"><div class="stat-card-header"><span class="stat-card-label">In Progress</span></div><div class="stat-card-value">${inProgress}</div>${inProgress > 0 ? `<div class="stat-card-change" style="color:var(--primary);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>Active</div>` : ''}</div><div class="stat-card"><div class="stat-card-header"><span class="stat-card-label">Completion Rate</span></div><div class="stat-card-value">${rate}%</div>${rate > 0 ? `<div class="stat-card-change ${rate >= 50 ? 'positive' : 'negative'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>${rate}% overall</div>` : ''}</div><div class="stat-card"><div class="stat-card-header"><span class="stat-card-label">Overdue</span></div><div class="stat-card-value" style="color:${overdue > 0 ? 'var(--danger)' : 'var(--text-primary)'};">${overdue}</div>${overdue > 0 ? `<div class="stat-card-change negative"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>Needs attention</div>` : '<div class="stat-card-change positive">All on track</div>'}</div></div><div class="analytics-grid"><div class="chart-card"><div class="chart-card-header"><div><div class="chart-card-title">Task Distribution</div><div class="chart-card-subtitle">Breakdown by status</div></div></div><div class="chart-container-donut">${donutHtml}</div><div class="chart-legend-grid">${statuses.map(s => `<div class="legend-item"><span class="legend-dot" style="background:${statusColors[s]};"></span>${statusLabels[s]} (${byStatus[s]})</div>`).join('')}</div></div><div class="chart-card"><div class="chart-card-header"><div><div class="chart-card-title">Tasks by Project</div><div class="chart-card-subtitle">Top projects</div></div></div>${barHtml || '<p style="font-size:var(--text-sm);color:var(--text-tertiary);text-align:center;padding:var(--space-6);">No tasks yet</p>'}</div></div>`;
  }

  function createProject(name, color) {
    var c = color || COLORS[state.projects.length % COLORS.length];
    API.post('/projects', { name: name, color: c }).then(function (p) {
      state.projects.unshift(p);
      showToast('Project created');
      saveData();
      refreshCurrentView();
    }).catch(function (err) { showToast(err.message || 'Failed to create project', 'error'); });
  }

  function updateProject(projectId, updates) {
    API.patch('/projects/' + projectId, updates).then(function (p) {
      var idx = state.projects.findIndex(function (x) { return x.id === projectId; });
      if (idx !== -1) state.projects[idx] = p;
      showToast('Project updated');
      refreshCurrentView();
    }).catch(function (err) { showToast(err.message || 'Failed to update project', 'error'); });
  }

  function deleteProject(projectId) {
    var projects = state.projects;
    var archived = state.archivedProjects || [];
    var project = projects.find(function (p) { return p.id === projectId; }) || archived.find(function (p) { return p.id === projectId; });
    if (!project) {
      API.del('/projects/' + projectId).then(function () {
        state.tasks = state.tasks.filter(function (t) { return t.projectId !== projectId; });
        state.projects = state.projects.filter(function (p) { return p.id !== projectId; });
        state.archivedProjects = (state.archivedProjects || []).filter(function (p) { return p.id !== projectId; });
        showToast('Project deleted');
        if (currentProjectId === projectId) { currentProjectId = null; navigateTo('projects'); }
        else refreshCurrentView();
      }).catch(function (err) { showToast(err.message || 'Failed to delete project', 'error'); });
      return;
    }
    var savedTasks = state.tasks.filter(function (t) { return t.projectId === projectId; });
    state.tasks = state.tasks.filter(function (t) { return t.projectId !== projectId; });
    state.projects = state.projects.filter(function (p) { return p.id !== projectId; });
    state.archivedProjects = (state.archivedProjects || []).filter(function (p) { return p.id !== projectId; });
    showUndoToast('Project deleted', function () {
      state.projects.push(project);
      savedTasks.forEach(function (t) { state.tasks.push(t); });
      refreshCurrentView();
      showToast('Project restored', 'success');
    }, 5000);
    if (currentProjectId === projectId) { currentProjectId = null; navigateTo('projects'); }
    else refreshCurrentView();
    API.del('/projects/' + projectId).catch(function (err) {
      state.projects.push(project);
      savedTasks.forEach(function (t) { state.tasks.push(t); });
      refreshCurrentView();
      showToast(err.message || 'Failed to delete project', 'error');
    });
  }

  function archiveProject(projectId) {
    var p = state.projects.find(function (x) { return x.id === projectId; });
    if (!p) {
      API.patch('/projects/' + projectId, { archived: true }).then(function () {
        showToast('Project archived');
        if (currentProjectId === projectId) { currentProjectId = null; navigateTo('projects'); }
        else refreshCurrentView();
      }).catch(function (err) { showToast(err.message || 'Failed to archive project', 'error'); });
      return;
    }
    var idx = state.projects.findIndex(function (x) { return x.id === projectId; });
    state.projects.splice(idx, 1);
    p.archived = true;
    if (!state.archivedProjects) state.archivedProjects = [];
    state.archivedProjects.push(p);
    showUndoToast('Project archived', function () {
      var ai = state.archivedProjects.findIndex(function (x) { return x.id === projectId; });
      if (ai !== -1) state.archivedProjects.splice(ai, 1);
      p.archived = false;
      state.projects.push(p);
      refreshCurrentView();
      showToast('Project restored', 'success');
    }, 5000);
    if (currentProjectId === projectId) { currentProjectId = null; navigateTo('projects'); }
    else refreshCurrentView();
    API.patch('/projects/' + projectId, { archived: true }).catch(function (err) {
      var ai = state.archivedProjects.findIndex(function (x) { return x.id === projectId; });
      if (ai !== -1) state.archivedProjects.splice(ai, 1);
      p.archived = false;
      state.projects.push(p);
      refreshCurrentView();
      showToast(err.message || 'Failed to archive project', 'error');
    });
  }

  function unarchiveProject(projectId) {
    API.patch('/projects/' + projectId, { archived: false }).then(function (p) {
      var idx = (state.archivedProjects || []).findIndex(function (x) { return x.id === projectId; });
      if (idx !== -1) { state.archivedProjects.splice(idx, 1); }
      p.archived = false;
      state.projects.unshift(p);
      showToast('Project restored');
      refreshCurrentView();
    }).catch(function (err) { showToast(err.message || 'Failed to restore project', 'error'); });
  }

  function renderArchivedProjects(container) {
    var archived = state.archivedProjects || [];
    if (archived.length === 0) return;
    var html = '<div class="section" style="margin-top:var(--space-8);opacity:0.7;"><div class="section-header"><h2 class="section-title">Archived Projects</h2></div><div class="projects-grid">';
    archived.forEach(function (p) {
      html += '<div class="project-card-large" style="opacity:0.7;"><div class="project-card-body"><div class="project-card-large-header"><h3 class="project-card-title">' + p.name + '</h3><button class="btn-icon-small unarchive-project-btn" data-project-id="' + p.id + '" title="Restore project"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></button></div></div></div>';
    });
    html += '</div></div>';
    container.insertAdjacentHTML('beforeend', html);
    container.querySelectorAll('.unarchive-project-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); unarchiveProject(btn.dataset.projectId); });
    });
  }

  function createTask(name, projectId, status, dueDate, priority, description, assigneeId, recurrence) {
    API.post('/tasks', {
      project_id: projectId, name: name, status: status || 'todo',
      due_date: dueDate || null, priority: priority || 'medium',
      description: description || '', assignee_id: assigneeId || null,
      recurrence: recurrence || 'none',
    }).then(function (t) {
      state.tasks.unshift(t);
      showToast('Task created');
      saveData();
      refreshCurrentView();
    }).catch(function (err) { showToast(err.message || 'Failed to create task', 'error'); });
  }

  function updateTask(taskId, updates) {
    var mapped = {};
    if (updates.name !== undefined) mapped.name = updates.name;
    if (updates.description !== undefined) mapped.description = updates.description;
    if (updates.status !== undefined) mapped.status = updates.status;
    if (updates.priority !== undefined) mapped.priority = updates.priority;
    if (updates.dueDate !== undefined) mapped.due_date = updates.dueDate || null;
    if (updates.assigneeId !== undefined) mapped.assignee_id = updates.assigneeId;
    if (updates.recurrence !== undefined) mapped.recurrence = updates.recurrence;
    if (updates.projectId !== undefined) mapped.project_id = updates.projectId;

    API.patch('/tasks/' + taskId, mapped).then(function (t) {
      var idx = state.tasks.findIndex(function (x) { return x.id === taskId; });
      if (idx !== -1) {
        state.tasks[idx] = t;
        if (updates.subtasks !== undefined) state.tasks[idx].subtasks = updates.subtasks;
        if (updates.comments !== undefined) state.tasks[idx].comments = updates.comments;
      }
      showToast('Task updated');
      refreshCurrentView();
    }).catch(function (err) { showToast(err.message || 'Failed to update task', 'error'); });
  }

  function deleteTask(taskId) {
    var task = state.tasks.find(function (t) { return t.id === taskId; });
    if (!task) return;
    state.tasks = state.tasks.filter(function (t) { return t.id !== taskId; });
    playSound('delete');
    optimisticCompleteTask(taskId);
    refreshCurrentView();
    showUndoToast('Task deleted', function () {
      state.tasks.push(task);
      refreshCurrentView();
      showToast('Task restored', 'success');
      playSound('success');
    }, 5000);
    API.del('/tasks/' + taskId).catch(function (err) {
      state.tasks.push(task);
      refreshCurrentView();
      showToast(err.message || 'Failed to delete task', 'error');
    });
  }

  function createTeamMember(name, role, photo) {
    API.post('/team', { name: name, role: role || 'Member', photo_url: photo || null }).then(function (m) {
      if ((m.photo_url || m.photoUrl) && !m.photo) m.photo = m.photo_url || m.photoUrl;
      state.team.push(m);
      showToast('Team member added');
      refreshCurrentView();
    }).catch(function (err) { showToast(err.message || 'Failed to add member', 'error'); });
  }

  function updateTeamMember(memberId, updates) {
    var mapped = {};
    if (updates.name !== undefined) mapped.name = updates.name;
    if (updates.role !== undefined) mapped.role = updates.role;
    if (updates.color !== undefined) mapped.color = updates.color;
    if (updates.photo !== undefined) mapped.photo_url = updates.photo;

    API.patch('/team/' + memberId, mapped).then(function (m) {
      if ((m.photo_url || m.photoUrl) && !m.photo) m.photo = m.photo_url || m.photoUrl;
      var idx = state.team.findIndex(function (x) { return x.id === memberId; });
      if (idx !== -1) state.team[idx] = m;
      showToast('Team member updated');
      refreshCurrentView();
    }).catch(function (err) { showToast(err.message || 'Failed to update member', 'error'); });
  }

  function deleteTeamMember(memberId) {
    API.del('/team/' + memberId).then(function () {
      state.tasks.forEach(function (t) { if (t.assignee_id === memberId) t.assignee_id = null; });
      state.team = state.team.filter(function (m) { return m.id !== memberId; });
      showToast('Team member removed');
      refreshCurrentView();
    }).catch(function (err) { showToast(err.message || 'Failed to remove member', 'error'); });
  }

  function createEvent(name, date, time) {
    API.post('/events', { name: name, date: date, time: time || '09:00' }).then(function (e) {
      state.events.push(e);
      showToast('Event created');
      refreshCurrentView();
    }).catch(function (err) { showToast(err.message || 'Failed to create event', 'error'); });
  }

  function deleteEvent(eventId) {
    API.del('/events/' + eventId).then(function () {
      state.events = state.events.filter(function (e) { return e.id !== eventId; });
      showToast('Event deleted');
      refreshCurrentView();
    }).catch(function (err) { showToast(err.message || 'Failed to delete event', 'error'); });
  }

  function toggleTaskStatus(taskId) {
    var task = state.tasks.find(function (t) { return t.id === taskId; });
    if (!task) return;
    var prevStatus = task.status;
    var newIsDone = task.status !== 'done';
    task.status = newIsDone ? 'done' : 'todo';
    optimisticCompleteTask(taskId);
    playSound(newIsDone ? 'complete' : 'default');
    refreshCurrentView();
    showDock(newIsDone ? 'Marked as done' : 'Reopened', 'check', 1200);
    API.patch('/tasks/' + taskId + '/toggle').then(function (res) {
      task.status = res.status;
      if (task.status === 'done') {
        if (task.project_id) {
          var pt = state.tasks.filter(function (t2) { return t2.project_id === task.project_id; });
          var allDone = pt.length > 0 && pt.every(function (t2) { return t2.status === 'done'; });
          if (allDone) { triggerCelebration(); announceToScreenReader('All tasks in project completed!'); }
        }
        playSound('complete');
      }
    }).catch(function (err) {
      task.status = prevStatus;
      refreshCurrentView();
      showToast(err.message || 'Failed to toggle task', 'error');
    });
  }

  function showPageSkeleton(pageId) {
    var page = document.getElementById('page-' + pageId);
    if (!page) return;
    var contentAreas = { dashboard: 'dashboard-content', projects: 'projects-content', tasks: 'tasks-content', goals: 'goals-page-content', calendar: 'calendar-content', team: 'team-content', analytics: 'analytics-content', settings: null };
    var areaId = contentAreas[pageId];
    if (areaId) {
      var area = document.getElementById(areaId);
      if (area && !area.querySelector('.skeleton')) {
        area.innerHTML = '';
        showSkeleton(area, 4, 'card');
      }
    }
  }

  let currentProjectId = null;
  let pageTransitionActive = false;

  function addRevealClasses(container) {
    var selectors = [
      '.stat-card',
      '.project-card',
      '.project-card-large',
      '.section-header',
      '.kanban-column',
      '.task-group',
      '.task-item',
      '.team-member-row',
      '.widget',
      '.chart-card',
      '.deadline-item',
      '.settings-section'
    ];
    for (var s = 0; s < selectors.length; s++) {
      var els = container.querySelectorAll(selectors[s]);
      for (var e = 0; e < els.length; e++) {
        els[e].classList.add('reveal');
        els[e].style.setProperty('--reveal-index', e);
      }
    }
  }

  function triggerReveals(container, delay) {
    if (!container) return;
    var els = container.querySelectorAll('.anim-fade-up, .anim-fade-in, .anim-stagger');
    els.forEach(function (el, i) {
      setTimeout(function () {
        el.classList.add('visible');
        if (el.classList.contains('stat-card')) animateCounters(el);
      }, i * (delay || 50));
    });
  }

  var scrollObserver = null;
  function observeScrollEntrances(container) {
    if (!container) return;
    if (scrollObserver) scrollObserver.disconnect();
    scrollObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          scrollObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    container.querySelectorAll('.scroll-entrance, .scroll-entrance-left, .scroll-entrance-right, .scroll-entrance-scale').forEach(function (el) {
      scrollObserver.observe(el);
    });
  }

  function animateCounters(container) {
    var els = container.querySelectorAll ? container.querySelectorAll('.stat-counter') : [container].filter(function (e) { return e && e.matches('.stat-counter'); });
    els.forEach(function (el) {
      var target = parseInt(el.dataset.target, 10);
      if (isNaN(target) || target === 0) { el.textContent = '0'; return; }
      var duration = Math.min(1200, Math.max(400, target * 10));
      var start = performance.now();
      function step(now) {
        var p = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(eased * target);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  var goalsPageRenderer = null;

  function switchPage(pageId) {
    switch (pageId) {
      case 'dashboard': renderDashboard(); break;
      case 'projects': renderProjects(); break;
      case 'project-detail': renderProjectDetail(currentProjectId); break;
      case 'tasks': renderTasks(); break;
      case 'goals': if (goalsPageRenderer) goalsPageRenderer(); break;
      case 'calendar': renderCalendar(); break;
      case 'team': renderTeam(); break;
      case 'analytics': renderAnalytics(); break;
    }
    setTimeout(initTooltips, 50);
  }

  function flashLoadingBar() {
    var bar = document.getElementById('loading-bar');
    if (!bar) return;
    bar.classList.remove('active', 'finishing');
    bar.style.width = '0';
    bar.style.opacity = '1';
    requestAnimationFrame(function () {
      bar.style.width = '35%';
      bar.classList.add('active');
    });
  }

    function navigateTo(pageId, projectId) {
      if (pageTransitionActive) {
        if (clearPageTimer) { clearTimeout(clearPageTimer); clearPageTimer = null; }
        var currentActive = document.querySelector('.page.active');
        if (currentActive) currentActive.classList.remove('active', 'entering', 'exiting');
        var bar = document.getElementById('loading-bar');
        if (bar) { bar.classList.remove('active', 'finishing'); bar.style.width = ''; bar.style.opacity = ''; }
        pageTransitionActive = false;
      }
      if (clearPageTimer) { clearTimeout(clearPageTimer); clearPageTimer = null; }
      pageTransitionActive = true;
      if (projectId) currentProjectId = projectId;

      flashLoadingBar();

    document.querySelectorAll('.sidebar-item').forEach(function (i) { i.classList.remove('active'); });
    var navigationPageId = pageId === 'project-detail' ? 'projects' : pageId;
    var sidebarTarget = document.querySelector('.sidebar-item[data-page="' + navigationPageId + '"]');
    if (sidebarTarget) sidebarTarget.classList.add('active');
    document.querySelectorAll('.nav-item-mobile').forEach(function (i) { i.classList.remove('active'); });
    var mobileTarget = document.querySelector('.nav-item-mobile[data-page="' + navigationPageId + '"]');
    if (mobileTarget) mobileTarget.classList.add('active');

    updateBreadcrumbs(pageId);
    localStorage.setItem('pm-last-page', pageId);
    if (pageId === 'project-detail' && projectId) localStorage.setItem('pm-last-project', projectId);
    else localStorage.removeItem('pm-last-project');

    var oldPage = document.querySelector('.page.active');
    var newPage = document.getElementById('page-' + pageId);

    function finishTransition() {
      if (!pageTransitionActive) return;
      pageTransitionActive = false;
      if (newPage) {
        newPage.classList.remove('entering');
        triggerReveals(newPage, 60);
        observeScrollEntrances(newPage);
        initTooltips();
      }

      document.querySelector('.page-content').scrollTo({ top: 0, behavior: 'instant' });
      completeLoadingBar();
    }

  function completeLoadingBar() {
    var bar = document.getElementById('loading-bar');
    if (!bar) return;
    bar.classList.add('finishing');
    bar.style.width = '100%';
    setTimeout(function () {
      bar.style.opacity = '0';
      setTimeout(function () {
        bar.classList.remove('active', 'finishing');
        bar.style.width = '';
        bar.style.opacity = '';
      }, 300);
    }, 200);
  }

    if (oldPage && newPage && oldPage !== newPage) {
      oldPage.classList.add('exiting');

      newPage.classList.add('active');
      try { switchPage(pageId); } catch (err) { console.warn('switchPage(' + pageId + ') failed:', err); }
      addRevealClasses(newPage);
      newPage.classList.add('entering');

      clearPageTimer = setTimeout(function () {
        oldPage.classList.remove('active', 'exiting');
        finishTransition();
      }, 500);
    } else if (newPage) {
      newPage.classList.add('active');
      try { switchPage(pageId); } catch (err) { console.warn('switchPage(' + pageId + ') failed:', err); }
      addRevealClasses(newPage);
      newPage.classList.add('entering');
      setTimeout(finishTransition, 450);
    } else {
      pageTransitionActive = false;
      completeLoadingBar();
    }
  }

  var clearPageTimer = null;

  function refreshCurrentView() {
  const activePage = document.querySelector('.page.active');
    if (!activePage) return;
    const pageId = activePage.id.replace('page-', '');
    if (pageId === 'project-detail') renderProjectDetail(currentProjectId);
    else switchPage(pageId);
    updateProjectCount();
    updateCommandPaletteProjects();
    updateNotificationBadge();
  }

  function updateBreadcrumbs(pageId) {
    const bc = document.querySelector('.top-nav-breadcrumbs');
    if (!bc) return;
    let name = pageId.charAt(0).toUpperCase() + pageId.slice(1);
    if (pageId === 'project-detail' && currentProjectId) {
      const data = getData();
      const p = data.projects.find(p => p.id === currentProjectId);
      if (p) name = p.name;
    }
    bc.innerHTML = `<span class="breadcrumb-item">Workspace</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg><span class="breadcrumb-item active">${name}</span>`;
  }

  function initNavigation() {
    document.querySelectorAll('.sidebar-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        const p = item.dataset.page;
        navigateTo(p === 'project-detail' ? 'projects' : p);
      });
    });
    document.querySelectorAll('.nav-item-mobile[data-page]').forEach(item => {
      item.addEventListener('click', () => navigateTo(item.dataset.page));
    });
  }

  function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const menuBtn = document.getElementById('menu-toggle');

    const toggleDesktop = () => {
      sidebar?.classList.toggle('collapsed');
      localStorage.setItem('sidebar-collapsed', sidebar?.classList.contains('collapsed') ? 'true' : 'false');
    };

    const toggleMobile = () => {
      sidebar?.classList.toggle('mobile-open');
      document.body.classList.toggle('sidebar-open');
    };

    toggle?.addEventListener('click', toggleDesktop);
    menuBtn?.addEventListener('click', () => {
      if (window.innerWidth > 768) toggleDesktop();
      else toggleMobile();
    });

    if (localStorage.getItem('sidebar-collapsed') === 'true') sidebar?.classList.add('collapsed');

    document.addEventListener('click', (e) => {
      if (sidebar?.classList.contains('mobile-open') && !sidebar.contains(e.target) && !menuBtn?.contains(e.target)) {
        sidebar.classList.remove('mobile-open');
        document.body.classList.remove('sidebar-open');
      }
    });
  }

  function initDarkMode() {
    const themeToggle = document.getElementById('theme-toggle');
    const settingsToggle = document.getElementById('dark-mode-toggle');
    function setTheme(dark) {
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      localStorage.setItem('theme', dark ? 'dark' : 'light');
      if (settingsToggle) settingsToggle.classList.toggle('active', dark);
    }
    const saved = localStorage.getItem('theme');
    setTheme(saved === 'dark' || !saved);
    themeToggle?.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      
      // Animation
      themeToggle.style.transform = 'scale(0.8) rotate(-45deg)';
      setTimeout(() => {
        setTheme(!isDark);
        themeToggle.style.transform = 'scale(1.1) rotate(0deg)';
        setTimeout(() => {
          themeToggle.style.transform = '';
        }, 200);
      }, 100);
    });
    settingsToggle?.addEventListener('click', () => {
      settingsToggle.classList.toggle('active');
      setTheme(settingsToggle.classList.contains('active'));
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('theme')) setTheme(e.matches);
    });
  }

  function initCommandPalette() {
    const overlay = document.getElementById('command-palette');
    const trigger = document.getElementById('cmdk-trigger');
    const backdrop = overlay?.querySelector('.command-palette-backdrop');
    const input = overlay?.querySelector('.command-palette-input');
     let focusedIndex = 0;
     function getVisibleItems() {
       return Array.from(overlay?.querySelectorAll('.command-item') || []).filter(function (item) {
         return item.style.display !== 'none';
       });
     }

     function resetCommandSearch() {
       overlay?.querySelectorAll('.command-item').forEach(function (item) { item.style.display = ''; item.classList.remove('focused'); });
       overlay?.querySelectorAll('.command-group-title').forEach(function (group) { group.style.display = ''; });
       const empty = overlay?.querySelector('.command-empty-state');
       if (empty) empty.hidden = true;
       focusedIndex = 0;
     }

     function openCmdk() {
       resetCommandSearch();
       overlay?.classList.add('active');
       if (overlay) overlay.style.display = 'flex';
       setTimeout(() => input?.focus(), 50);
     }
    function animateClose(el, callback) {
      if (!el) return;
      el.classList.add('exiting');
      const onEnd = () => {
        el.classList.remove('exiting');
        if (callback) callback();
        el.removeEventListener('animationend', onEnd);
      };
      el.addEventListener('animationend', onEnd);
      // Fallback
      setTimeout(onEnd, 500);
    }

    function closeCmdk() { 
      var overlay = document.getElementById('command-palette');
      if (!overlay) return;
      var cmdk = overlay.querySelector('.command-palette');
      if (cmdk) {
        animateClose(cmdk, () => {
          overlay.classList.remove('active');
          overlay.style.display = 'none';
          var input = overlay.querySelector('.command-palette-input');
          if (input) input.value = '';
        });
      } else {
        overlay.classList.remove('active');
        overlay.style.display = 'none';
      }
    }
    trigger?.addEventListener('click', openCmdk);
    backdrop?.addEventListener('click', closeCmdk);
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); overlay?.classList.contains('active') ? closeCmdk() : openCmdk(); }
      if (e.key === 'Escape') { closeCmdk(); closeDrawer(); }
    });
    input?.addEventListener('keydown', (e) => {
       const items = getVisibleItems();
      if (!items?.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); items.forEach(i => i.classList.remove('focused')); focusedIndex = Math.min(focusedIndex + 1, items.length - 1); items[focusedIndex]?.classList.add('focused'); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items.forEach(i => i.classList.remove('focused')); focusedIndex = Math.max(focusedIndex - 1, 0); items[focusedIndex]?.classList.add('focused'); }
      else if (e.key === 'Enter') { e.preventDefault(); items[focusedIndex]?.click(); }
    });
    var cmdQueue = null;
    input?.addEventListener('input', function(e) {
      var q = e.target.value.toLowerCase();
      if (cmdQueue) cancelAnimationFrame(cmdQueue);
      cmdQueue = requestAnimationFrame(function() {
        cmdQueue = null;
        var items = overlay.querySelectorAll('.command-item');
        var visibleCount = 0;
        for (var i = 0; i < items.length; i++) {
           var text = items[i].dataset.search || items[i].textContent || '';
           var isVisible = window.UiState ? window.UiState.matchesCommandQuery({ label: text }, q) : text.toLowerCase().includes(q);
          items[i].style.display = isVisible ? '' : 'none';
          if (isVisible) {
            items[i].style.animation = 'none';
            items[i].offsetHeight;
            items[i].style.animation = 'revealIn 0.3s var(--ease-out) both';
            items[i].style.animationDelay = (visibleCount * 30) + 'ms';
             visibleCount++;
           }
         }
         overlay.querySelectorAll('.command-group-title').forEach(function (group) {
           var next = group.nextElementSibling;
           var hasVisibleItem = false;
           while (next && !next.classList.contains('command-group-title')) {
             if (next.classList.contains('command-item') && next.style.display !== 'none') hasVisibleItem = true;
             next = next.nextElementSibling;
           }
           group.style.display = hasVisibleItem ? '' : 'none';
         });
         var empty = overlay.querySelector('.command-empty-state');
         if (empty) empty.hidden = visibleCount > 0;
         focusedIndex = 0;
         getVisibleItems()[0]?.classList.add('focused');
       });
    });

    overlay?.addEventListener('click', (e) => {
       const item = e.target.closest('.command-item');
       if (!item) return;
       const action = item.dataset.action;
       const projectId = item.dataset.projectId;
       const taskId = item.dataset.taskId;
       closeCmdk();
       if (projectId) {
         navigateTo('project-detail', projectId);
       } else if (taskId) {
         openTaskDrawerEdit(taskId);
       } else if (action === 'create-task') {
        const data = getData();
        if (data.projects.length > 0) openTaskDrawerCreate(data.projects[0].id);
        else { showToast('Create a project first'); navigateTo('projects'); }
      } else if (action === 'create-project') {
        openProjectDrawerCreate();
      } else if (action === 'create-event') {
        openEventDrawerCreate();
      } else if (action === 'nav-dashboard') {
        navigateTo('dashboard');
      } else if (action === 'nav-projects') {
        navigateTo('projects');
      } else if (action === 'nav-calendar') {
        navigateTo('calendar');
      } else if (action === 'nav-tasks') {
        navigateTo('tasks');
      } else if (action === 'nav-goals') {
        navigateTo('goals');
      } else if (action === 'nav-team') {
        navigateTo('team');
      } else if (action === 'nav-analytics') {
        navigateTo('analytics');
      } else if (action === 'nav-settings') {
        navigateTo('settings');
      }
    });
  }

  // --- Drawer (shared slide-out panel) ---
  function closeDrawer() {
    const overlay = document.getElementById('task-drawer-overlay');
    const drawer = document.getElementById('task-drawer');
    if (!drawer) return;
    drawer.classList.add('exiting');
    const onEnd = () => {
      drawer.classList.remove('active', 'exiting');
      overlay?.classList.remove('active');
      drawer.removeEventListener('animationend', onEnd);
    };
    drawer.addEventListener('animationend', onEnd);
    setTimeout(onEnd, 500);
  }

  function openDrawer() {
    const overlay = document.getElementById('task-drawer-overlay');
    const drawer = document.getElementById('task-drawer');
    overlay?.classList.add('active');
    drawer?.classList.add('active');
    setTimeout(() => trapFocus(drawer), 100);
  }

  // --- Custom Dropdown ---
  function buildDropdown(options, selectedValue, onChange) {
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-dropdown';

    const trigger = document.createElement('div');
    trigger.className = 'dropdown-trigger';

    const selected = options.find(o => o.value === selectedValue) || options[0];
    trigger.innerHTML = `<span class="dropdown-text">${selected.html || selected.label}</span><svg class="dropdown-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu';
    menu.style.display = 'none';

    let isOpen = false;
    let currentValue = selectedValue;

    options.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'dropdown-item' + (opt.value === currentValue ? ' selected' : '');
      item.innerHTML = opt.html || opt.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        currentValue = opt.value;
        trigger.querySelector('.dropdown-text').innerHTML = opt.html || opt.label;
        menu.querySelectorAll('.dropdown-item').forEach(d => d.classList.remove('selected'));
        item.classList.add('selected');
        close();
        onChange(opt.value);
      });
      menu.appendChild(item);
    });

    function open() {
      closeAllDropdowns();
      menu.style.display = 'block';
      wrapper.classList.add('open');
      isOpen = true;
      
      // Ensure menu is within viewport
      const rect = menu.getBoundingClientRect();
      if (rect.bottom > window.innerHeight) {
        menu.style.top = 'auto';
        menu.style.bottom = 'calc(100% + 4px)';
      }
    }

    function close() {
      menu.style.display = 'none';
      wrapper.classList.remove('open');
      isOpen = false;
      menu.style.top = '';
      menu.style.bottom = '';
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      isOpen ? close() : open();
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    return { 
      element: wrapper, 
      setValue: (val) => {
        currentValue = val;
        const opt = options.find(o => o.value === val);
        if (opt) {
          trigger.querySelector('.dropdown-text').innerHTML = opt.html || opt.label;
          menu.querySelectorAll('.dropdown-item').forEach(d => {
            const itemText = d.textContent.trim();
            d.classList.toggle('selected', itemText === (opt.label || '').trim());
          });
        }
      }
    };
  }

  function closeAllDropdowns() {
    document.querySelectorAll('.custom-dropdown .dropdown-menu').forEach(m => m.style.display = 'none');
    document.querySelectorAll('.custom-dropdown.open').forEach(d => d.classList.remove('open'));
  }

  // --- Task Drawer ---
  function openTaskDrawerCreate(projectId, initialStatus, startDate, endDate) {
    const data = getData();
    if (data.projects.length === 0) { showToast('Create a project first'); return; }

    const project = projectId ? data.projects.find(p => p.id === projectId) : null;
    const projects = data.projects;
    const status = initialStatus || 'todo';

    var defaultDue;
    if (startDate) {
      defaultDue = startDate.length > 10 ? startDate.slice(0, 16) : startDate + 'T17:00';
    } else {
      var d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(17, 0, 0, 0);
      defaultDue = d.toISOString().slice(0, 16);
    }

    const badges = document.getElementById('drawer-badges');
    const content = document.getElementById('drawer-content');
    if (!content) return;

    badges.innerHTML = project ? `<span class="badge" style="background:${project.color};color:white;">${project.name}</span>` : '';

    content.innerHTML = `
      <div class="task-drawer-title-area">
        <input type="text" class="task-drawer-title" id="new-task-title" placeholder="Task name" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="task-drawer-section">
        <textarea class="task-drawer-description" id="new-task-desc" placeholder="Add a description..." autocomplete="off" autocorrect="off" spellcheck="false"></textarea>
      </div>
      <div class="task-drawer-meta">
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Due Date
          </span>
           <input type="datetime-local" class="task-drawer-meta-value" id="new-task-due" value="${defaultDue}">
        </div>
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Project
          </span>
          <div id="task-project-dropdown"></div>
        </div>
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            Priority
          </span>
          <div id="task-priority-dropdown"></div>
        </div>
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            Assignee
          </span>
          <div id="task-assignee-dropdown"></div>
        </div>
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            Recurrence
          </span>
          <div id="task-recur-dropdown"></div>
        </div>
      </div>
      <div class="task-drawer-actions">
        <button class="btn btn-ghost" id="create-task-cancel">Cancel</button>
        <button class="btn btn-primary" id="create-task-submit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Create Task
        </button>
      </div>`;

    openDrawer();

    let selectedProjectId = projectId || (projects.length > 0 ? projects[0].id : '');
    let selectedPriority = 'medium';

    const projectOpts = projects.map(p => ({
      value: p.id,
      html: `<span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:12px;height:12px;border-radius:50%;background:${p.color};display:inline-block;"></span>${p.name}</span>`
    }));
    const projectDrop = buildDropdown(projectOpts, selectedProjectId, (v) => { selectedProjectId = v; });
    document.getElementById('task-project-dropdown').appendChild(projectDrop.element);

    const priorityOpts = ['low', 'medium', 'high'].map(p => ({
      value: p,
      html: `<span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:${PRIORITY_COLORS[p]};display:inline-block;"></span>${p.charAt(0).toUpperCase() + p.slice(1)}</span>`
    }));
    const priorityDrop = buildDropdown(priorityOpts, selectedPriority, (v) => { selectedPriority = v; });
    document.getElementById('task-priority-dropdown').appendChild(priorityDrop.element);

    let selectedAssignee = null;
    const assigneeOpts = [{ value: '', html: '<span style="color:var(--text-tertiary);">Unassigned</span>' }].concat(data.team.map(m => ({
      value: m.id,
      html: `<span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:24px;height:24px;border-radius:50%;background:${m.color || 'var(--primary)'};display:inline-flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:600;overflow:hidden;">${m.photo ? `<img src="${m.photo}" alt="" style="width:100%;height:100%;object-fit:cover;">` : getInitials(m.name)}</span>${m.name}</span>`
    })));
    const assigneeDrop = buildDropdown(assigneeOpts, '', (v) => { selectedAssignee = v || null; });
    document.getElementById('task-assignee-dropdown').appendChild(assigneeDrop.element);

    let selectedRecur = 'none';
    const recurOpts = [
      { value: 'none', label: 'None' },
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: 'Weekly' },
      { value: 'monthly', label: 'Monthly' }
    ].map(r => ({ value: r.value, html: `<span>${r.label}</span>` }));
    const recurDrop = buildDropdown(recurOpts, selectedRecur, (v) => { selectedRecur = v; });
    document.getElementById('task-recur-dropdown').appendChild(recurDrop.element);

    setTimeout(() => document.getElementById('new-task-title')?.focus(), 100);

    document.getElementById('create-task-cancel')?.addEventListener('click', closeDrawer);
    document.getElementById('create-task-submit')?.addEventListener('click', () => {
      const title = document.getElementById('new-task-title')?.value?.trim();
      const description = document.getElementById('new-task-desc')?.value?.trim();
      const dueDate = document.getElementById('new-task-due')?.value;
      if (!title) { showToast('Please enter a task name', 'warning'); return; }
      createTask(title, selectedProjectId, status, dueDate, selectedPriority, description, selectedAssignee, selectedRecur);
      closeDrawer();
    });
    document.getElementById('new-task-title')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('create-task-submit')?.click();
    });
  }

  function openTaskDrawerEdit(taskId) {
    const data = getData();
    const task = data.tasks.find(t => t.id === taskId);
    if (!task) return;

    const project = data.projects.find(p => p.id === task.projectId);
    const projects = data.projects;

    const badges = document.getElementById('drawer-badges');
    const content = document.getElementById('drawer-content');
    if (!content) return;

    badges.innerHTML = project ? `<span class="badge" style="background:${project.color};color:white;">${project.name}</span>` : '';

    content.innerHTML = `
      <div class="task-drawer-title-area">
        <input type="text" class="task-drawer-title" id="edit-task-title" value="${task.name}" placeholder="Task name" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="task-drawer-section">
        <div style="margin-bottom:var(--space-2);display:flex;gap:6px;">
          <button class="btn btn-xs btn-ghost" id="edit-desc-preview-btn">Preview</button>
          <button class="btn btn-xs btn-ghost active" id="edit-desc-edit-btn">Edit</button>
        </div>
        <textarea class="task-drawer-description" id="edit-task-desc" placeholder="Add a description... Use **bold**, *italic*, \`code\`, - lists" autocomplete="off" autocorrect="off" spellcheck="false">${task.description || ''}</textarea>
        <div id="edit-task-desc-preview" class="task-drawer-description" style="display:none;">${renderMarkdown(task.description || '')}</div>
      </div>
       <div class="task-drawer-section">
         <div class="task-drawer-section-header">
           <span class="task-drawer-section-title">Subtasks</span>
           <button class="btn btn-sm btn-ghost" id="add-subtask-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Add</button>
         </div>
         <div class="subtask-list" id="subtask-list"></div>
       </div>
       <div class="task-drawer-section">
         <div class="task-drawer-section-header">
           <span class="task-drawer-section-title">Comments</span>
         </div>
         <div class="comment-list" id="comment-list"></div>
         <div class="comment-input-area">
           <input type="text" class="comment-input" id="comment-input" placeholder="Write a comment..." autocomplete="off">
           <button class="btn btn-sm btn-primary" id="add-comment-btn">Post</button>
         </div>
       </div>
      <div class="task-drawer-meta">
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Due Date
          </span>
           <input type="datetime-local" class="task-drawer-meta-value" id="edit-task-due" value="${task.dueDate ? (task.dueDate.length > 10 ? task.dueDate.slice(0, 16) : task.dueDate + 'T00:00') : ''}">
        </div>
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Project
          </span>
          <div id="edit-task-project-dropdown"></div>
        </div>
        <div class="task-drawer-meta-row">
           <span class="task-drawer-meta-label">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
             Priority
           </span>
           <div id="edit-task-priority-dropdown"></div>
         </div>
         <div class="task-drawer-meta-row">
           <span class="task-drawer-meta-label">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
             Status
           </span>
           <div id="edit-task-status-dropdown"></div>
         </div>
         <div class="task-drawer-meta-row">
           <span class="task-drawer-meta-label">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
             Assignee
           </span>
           <div id="edit-task-assignee-dropdown"></div>
         </div>
         <div class="task-drawer-meta-row">
            <span class="task-drawer-meta-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
              Recurrence
            </span>
            <div id="edit-task-recur-dropdown"></div>
          </div>
          <div class="task-drawer-meta-row">
            <span class="task-drawer-meta-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              Time Spent
            </span>
            <span style="display:flex;align-items:center;gap:8px;">
              <span id="edit-task-timer-display" style="font-size:var(--text-sm);font-weight:var(--weight-medium);font-variant-numeric:tabular-nums;">${formatTime(task.time_spent || 0)}</span>
              <button class="btn btn-sm ${task._timerRunning ? 'btn-danger' : 'btn-outline'}" id="edit-task-timer-btn">${task._timerRunning ? 'Stop' : 'Start'}</button>
            </span>
          </div>
          <div class="task-drawer-meta-row">
            <span class="task-drawer-meta-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="20" y1="12" x2="4" y2="12"></line></svg>
              Tags
            </span>
            <input type="text" class="task-drawer-meta-value" id="edit-task-tags" value="${task.tags || ''}" placeholder="tag1, tag2, tag3" style="border:none;background:transparent;font:inherit;color:inherit;min-width:160px;text-align:right;">
          </div>
          <div class="task-drawer-meta-row">
            <span class="task-drawer-meta-label">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              Attachments
            </span>
            <button class="btn btn-sm btn-ghost" id="edit-task-add-attachment">+ Add</button>
          </div>
        </div>
        <div class="task-drawer-section" id="edit-task-attachments-section" style="display:none;">
          <div class="task-drawer-section-header">
            <span class="task-drawer-section-title">Files</span>
          </div>
          <div id="edit-task-attachments-list"></div>
        </div>
       <div class="task-drawer-actions">
         <button class="btn btn-ghost" id="edit-task-delete" style="color:var(--danger);">
           <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
           Delete
         </button>
        <button class="btn btn-ghost" id="edit-task-cancel">Cancel</button>
        <button class="btn btn-primary" id="edit-task-submit">Save Changes</button>
      </div>`;

    openDrawer();

    let selectedProjectId = task.projectId;
     let selectedPriority = task.priority || 'medium';
     let selectedStatus = task.status || 'todo';

     const projectOpts = projects.map(p => ({
       value: p.id,
       html: `<span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:12px;height:12px;border-radius:50%;background:${p.color};display:inline-block;"></span>${p.name}</span>`
     }));
     const projectDrop = buildDropdown(projectOpts, selectedProjectId, (v) => { selectedProjectId = v; });
     document.getElementById('edit-task-project-dropdown').appendChild(projectDrop.element);

     const priorityOpts = ['low', 'medium', 'high'].map(p => ({
       value: p,
       html: `<span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:${PRIORITY_COLORS[p]};display:inline-block;"></span>${p.charAt(0).toUpperCase() + p.slice(1)}</span>`
     }));
     const priorityDrop = buildDropdown(priorityOpts, selectedPriority, (v) => { selectedPriority = v; });
     document.getElementById('edit-task-priority-dropdown').appendChild(priorityDrop.element);

     const statusOpts = [
       { value: 'backlog', label: 'Backlog' },
       { value: 'todo', label: 'To Do' },
       { value: 'inprogress', label: 'In Progress' },
       { value: 'review', label: 'In Review' },
       { value: 'done', label: 'Done' }
     ].map(s => ({
       value: s.value,
       html: `<span>${s.label}</span>`
     }));
     const statusDrop = buildDropdown(statusOpts, selectedStatus, (v) => { selectedStatus = v; });
     document.getElementById('edit-task-status-dropdown').appendChild(statusDrop.element);

     let selectedAssignee = task.assigneeId || null;
     const assigneeOpts = [{ value: '', html: '<span style="color:var(--text-tertiary);">Unassigned</span>' }].concat(data.team.map(m => ({
       value: m.id,
        html: `<span style="display:inline-flex;align-items:center;gap:8px;"><span style="width:24px;height:24px;border-radius:50%;background:${m.color || 'var(--primary)'};display:inline-flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:600;overflow:hidden;">${m.photo ? `<img src="${m.photo}" alt="" style="width:100%;height:100%;object-fit:cover;">` : getInitials(m.name)}</span>${m.name}</span>`
      })));
      const assigneeDrop = buildDropdown(assigneeOpts, selectedAssignee || '', (v) => { selectedAssignee = v || null; });
      document.getElementById('edit-task-assignee-dropdown').appendChild(assigneeDrop.element);

      let selectedRecur = task.recurrence || 'none';
     const recurOpts = [
       { value: 'none', label: 'None' },
       { value: 'daily', label: 'Daily' },
       { value: 'weekly', label: 'Weekly' },
       { value: 'monthly', label: 'Monthly' }
     ].map(r => ({ value: r.value, html: `<span>${r.label}</span>` }));
     const recurDrop = buildDropdown(recurOpts, selectedRecur, (v) => { selectedRecur = v; });
     document.getElementById('edit-task-recur-dropdown').appendChild(recurDrop.element);

    document.getElementById('edit-task-cancel')?.addEventListener('click', closeDrawer);
    document.getElementById('edit-task-delete')?.addEventListener('click', () => {
      deleteTask(taskId);
      closeDrawer();
    });
    document.getElementById('edit-task-submit')?.addEventListener('click', () => {
      const title = document.getElementById('edit-task-title')?.value?.trim();
      const description = document.getElementById('edit-task-desc')?.value?.trim();
      const dueDate = document.getElementById('edit-task-due')?.value;
      const tags = document.getElementById('edit-task-tags')?.value?.trim() || '';
      if (!title) { showToast('Please enter a task name', 'warning'); return; }
      if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
      var updateData = { name: title, description, projectId: selectedProjectId, dueDate, priority: selectedPriority, status: selectedStatus, assigneeId: selectedAssignee, recurrence: selectedRecur, tags: tags };
      if (task._timerRunning || _timerElapsed > 0) {
        updateData.time_spent = (task.time_spent || 0) + _timerElapsed;
      }
      updateTask(taskId, updateData);
      if (_attachments && _attachments.length > 0) {
        updateTask(taskId, { attachments: JSON.stringify(_attachments) });
      }
      syncSubtasks(taskId, subtasks, origSubtaskIds);
      syncComments(taskId, comments, origCommentIds);
      closeDrawer();
    });

    let subtasks = (task.subtasks || []).map(s => ({ ...s }));
    let comments = (task.comments || []).map(c => ({ ...c }));
    let origSubtaskIds = subtasks.filter(s => s.id).map(s => s.id);
    let origCommentIds = comments.filter(c => c.id).map(c => c.id);

    function syncSubtasks(tId, list, origIds) {
      var currentIds = list.filter(s => s.id).map(s => s.id);
      var removed = origIds.filter(id => !currentIds.includes(id));
      removed.forEach(id => API.del('/subtasks/' + id).catch(function () {}));
      list.forEach(function (s) {
        if (!s.id) {
          API.post('/subtasks', { task_id: tId, text: s.text }).catch(function () {});
        } else if (s._changed) {
          API.patch('/subtasks/' + s.id, { done: s.done }).catch(function () {});
        }
      });
    }

    function syncComments(tId, list, origIds) {
      var currentIds = list.filter(c => c.id).map(c => c.id);
      var removed = origIds.filter(id => !currentIds.includes(id));
      removed.forEach(id => API.del('/comments/' + id).catch(function () {}));
      list.forEach(function (c) {
        if (!c.id) {
          API.post('/comments', { task_id: tId, text: c.text, author: c.author || 'You' }).catch(function () {});
        }
      });
    }

    function renderSubtasks() {
      const list = document.getElementById('subtask-list');
      if (!list) return;
      if (subtasks.length === 0) {
        list.innerHTML = '<div style="padding:var(--space-2) 0;font-size:var(--text-sm);color:var(--text-tertiary);">No subtasks yet</div>';
        return;
      }
      list.innerHTML = subtasks.map((st, i) => `
        <div class="subtask-item">
          <button class="subtask-checkbox ${st.done ? 'checked' : ''}" data-index="${i}"></button>
          <span class="subtask-title ${st.done ? 'completed' : ''}">${st.text}</span>
          <button class="btn-icon-small" data-remove-subtask="${i}" style="margin-left:auto;color:var(--text-tertiary);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
        </div>
      `).join('');
      list.querySelectorAll('.subtask-checkbox').forEach(cb => {
        cb.addEventListener('click', () => {
          const idx = parseInt(cb.dataset.index);
          subtasks[idx].done = !subtasks[idx].done;
          subtasks[idx]._changed = true;
          renderSubtasks();
        });
      });
      list.querySelectorAll('[data-remove-subtask]').forEach(btn => {
        btn.addEventListener('click', () => {
          subtasks.splice(parseInt(btn.dataset.removeSubtask), 1);
          renderSubtasks();
        });
      });
    }

    function renderComments() {
      const list = document.getElementById('comment-list');
      if (!list) return;
      if (comments.length === 0) {
        list.innerHTML = '<div style="padding:var(--space-2) 0;font-size:var(--text-sm);color:var(--text-tertiary);">No comments yet</div>';
        return;
      }
      const data = getData();
      list.innerHTML = comments.map(c => `
        <div class="comment-item">
          <div class="avatar" style="width:28px;height:28px;font-size:10px;margin-top:2px;overflow:hidden;${data.user?.photo ? 'background:transparent;' : ''}">${data.user?.photo ? `<img src="${data.user.photo}" alt="" style="width:100%;height:100%;object-fit:cover;">` : getInitials(data.user?.name || 'U')}</div>
          <div class="comment-body">
            <div class="comment-header"><span class="comment-author">${data.user?.name || 'You'}</span><span class="comment-time">${new Date(c.created_at || c.time).toLocaleDateString()}</span></div>
            <div class="comment-text">${c.text}</div>
          </div>
        </div>
      `).join('');
    }

    var _timerRunning = task._timerRunning || false;
    var _timerStart = task._timerStart || null;
    var _timerElapsed = 0;
    var _timerInterval = null;
    var _attachments = [];

    try { _attachments = JSON.parse(task.attachments || '[]'); } catch (e) { _attachments = []; }

    function updateTimerDisplay() {
      var total = (task.time_spent || 0) + _timerElapsed;
      var el = document.getElementById('edit-task-timer-display');
      if (el) el.textContent = formatTime(total);
    }

    function startTimer() {
      _timerRunning = true;
      _timerInterval = setInterval(function () {
        _timerElapsed++;
        updateTimerDisplay();
      }, 1000);
      var btn = document.getElementById('edit-task-timer-btn');
      if (btn) { btn.textContent = 'Stop'; btn.className = 'btn btn-sm btn-danger'; }
    }

    function stopTimer() {
      _timerRunning = false;
      if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
      var btn = document.getElementById('edit-task-timer-btn');
      if (btn) { btn.textContent = 'Start'; btn.className = 'btn btn-sm btn-outline'; }
    }

    document.getElementById('edit-task-timer-btn')?.addEventListener('click', function () {
      if (_timerRunning) stopTimer();
      else startTimer();
    });

    function renderAttachments() {
      var section = document.getElementById('edit-task-attachments-section');
      var list = document.getElementById('edit-task-attachments-list');
      if (!section || !list) return;
      if (_attachments.length === 0) { section.style.display = 'none'; return; }
      section.style.display = '';
      list.innerHTML = _attachments.map(function (a, i) {
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-light);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><span style="flex:1;font-size:var(--text-sm);color:var(--text-primary);">' + a.name + '</span><a href="' + a.url + '" download="' + a.name + '" class="btn-icon-small" title="Download"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></a><button class="btn-icon-small" data-remove-attach="' + i + '" style="color:var(--danger);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div>';
      }).join('');
      list.querySelectorAll('[data-remove-attach]').forEach(function (btn) {
        btn.addEventListener('click', function () { _attachments.splice(parseInt(this.dataset.removeAttach), 1); renderAttachments(); });
      });
    }

    document.getElementById('edit-task-add-attachment')?.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip';
      input.onchange = function () {
        var file = input.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { showToast('File must be under 5MB', 'warning'); return; }
        var reader = new FileReader();
        reader.onload = function (e) {
          _attachments.push({ name: file.name, url: e.target.result });
          renderAttachments();
          showToast('File attached', 'success');
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });

    document.getElementById('edit-desc-edit-btn')?.addEventListener('click', function () {
      document.getElementById('edit-task-desc').style.display = '';
      document.getElementById('edit-task-desc-preview').style.display = 'none';
      this.classList.add('active');
      document.getElementById('edit-desc-preview-btn')?.classList.remove('active');
    });
    document.getElementById('edit-desc-preview-btn')?.addEventListener('click', function () {
      var text = document.getElementById('edit-task-desc')?.value || '';
      document.getElementById('edit-task-desc-preview').innerHTML = renderMarkdown(text);
      document.getElementById('edit-task-desc').style.display = 'none';
      document.getElementById('edit-task-desc-preview').style.display = '';
      this.classList.add('active');
      document.getElementById('edit-desc-edit-btn')?.classList.remove('active');
    });

    renderSubtasks();
    renderComments();
    renderAttachments();
    updateTimerDisplay();

    document.getElementById('add-subtask-btn')?.addEventListener('click', () => {
      showConfirmDialog({ title: 'New subtask', input: { placeholder: 'Subtask name' }, confirmLabel: 'Add' }).then(function (text) {
      if (text) {
        subtasks.push({ text: text, done: false });
        renderSubtasks();
      }
      });
    });

    document.getElementById('add-comment-btn')?.addEventListener('click', () => {
      const input = document.getElementById('comment-input');
      const text = input?.value?.trim();
      if (text) {
        comments.push({ text, created_at: new Date().toISOString(), author: 'user' });
        input.value = '';
        renderComments();
      }
    });
    document.getElementById('comment-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('add-comment-btn')?.click();
    });
  }

  // --- Project Drawer ---
  function openProjectDrawerCreate() {
    const content = document.getElementById('drawer-content');
    const badges = document.getElementById('drawer-badges');
    if (!content) return;

    badges.innerHTML = '';
    content.innerHTML = `
      <div class="task-drawer-title-area">
        <input type="text" class="task-drawer-title" id="new-project-title" placeholder="Project name" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="task-drawer-meta">
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            Color
          </span>
          <div class="project-color-options">
            <input type="color" id="project-color-picker" class="project-color-picker" value="${COLORS[0]}">
          </div>
        </div>
      </div>
      <div class="task-drawer-actions">
        <button class="btn btn-ghost" id="create-project-cancel">Cancel</button>
        <button class="btn btn-primary" id="create-project-submit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Create Project
        </button>
      </div>`;

    openDrawer();

    const picker = document.getElementById('project-color-picker');
    let selectedColor = picker.value;
    picker.addEventListener('input', () => { selectedColor = picker.value; });

    setTimeout(() => document.getElementById('new-project-title')?.focus(), 100);
    document.getElementById('create-project-cancel')?.addEventListener('click', closeDrawer);
    document.getElementById('create-project-submit')?.addEventListener('click', () => {
      const title = document.getElementById('new-project-title')?.value?.trim();
      if (!title) { showToast('Please enter a project name', 'warning'); return; }
      createProject(title, selectedColor);
      closeDrawer();
    });
    document.getElementById('new-project-title')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('create-project-submit')?.click();
    });
  }

  function openProjectDrawerEdit(projectId) {
    const data = getData();
    const project = data.projects.find(p => p.id === projectId);
    if (!project) return;
    const content = document.getElementById('drawer-content');
    const badges = document.getElementById('drawer-badges');
    if (!content) return;
    badges.innerHTML = '';
    content.innerHTML = `
      <div class="task-drawer-title-area">
        <input type="text" class="task-drawer-title" id="edit-project-title" value="${project.name}" placeholder="Project name" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="task-drawer-meta">
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            Color
          </span>
          <div class="project-color-options">
            <input type="color" id="project-color-picker" class="project-color-picker" value="${project.color}">
          </div>
        </div>
      </div>
      <div class="task-drawer-section">
        <div class="task-drawer-section-header">
          <span class="task-drawer-section-title">Share</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="email" class="input input-sm" id="share-email-input" placeholder="user@email.com" style="flex:1;" autocomplete="off" autocorrect="off" spellcheck="false">
          <button class="btn btn-primary btn-sm" id="share-project-btn">Share</button>
        </div>
        <div id="shared-with-list" style="margin-top:8px;font-size:var(--text-sm);color:var(--text-tertiary);"></div>
      </div>
      <div class="task-drawer-actions">
        <button class="btn btn-ghost" id="edit-project-cancel">Cancel</button>
        <button class="btn btn-primary" id="edit-project-submit">Save Changes</button>
      </div>`;
    openDrawer();
    var picker = document.getElementById('project-color-picker');
    var selectedColor = picker ? picker.value : project.color;
    if (picker) picker.addEventListener('input', function () { selectedColor = picker.value; });
    setTimeout(function () { document.getElementById('edit-project-title')?.focus(); }, 100);
    document.getElementById('edit-project-cancel')?.addEventListener('click', closeDrawer);
    document.getElementById('edit-project-submit')?.addEventListener('click', function () {
      var title = document.getElementById('edit-project-title')?.value?.trim();
      if (!title) { showToast('Please enter a project name', 'warning'); return; }
      updateProject(projectId, { name: title, color: selectedColor });
      closeDrawer();
    });
    document.getElementById('share-project-btn')?.addEventListener('click', function () {
      var email = document.getElementById('share-email-input')?.value?.trim();
      if (!email) { showToast('Enter an email address', 'warning'); return; }
      API.post('/projects/' + projectId + '/share', { email: email }).then(function () {
        showToast('Shared with ' + email, 'success');
        document.getElementById('share-email-input').value = '';
        renderSharedWith(projectId);
      }).catch(function (err) { showToast(err.message || 'Failed to share', 'error'); });
    });
    renderSharedWith(projectId);
    function renderSharedWith(pid) {
      var list = document.getElementById('shared-with-list');
      if (!list) return;
      API.get('/projects').then(function (allProjects) {
        var p = allProjects.find(function (x) { return x.id === pid; });
        if (!p || !p.shared_with || p.shared_with.length === 0) { list.textContent = 'Not shared with anyone'; return; }
        list.innerHTML = p.shared_with.map(function (email) {
          return '<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px;padding:2px 8px;background:var(--primary-bg);border-radius:var(--radius-sm);font-size:var(--text-xs);color:var(--primary);">' + email + '</span>';
        }).join(' ');
      }).catch(function () { list.textContent = ''; });
    }
  }

  // --- Event Drawer ---
  function openEventDrawerCreate() {
    const content = document.getElementById('drawer-content');
    const badges = document.getElementById('drawer-badges');
    if (!content) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const defaultDate = tomorrow.toISOString().split('T')[0];

    badges.innerHTML = '<span class="badge badge-info">Calendar</span>';
    content.innerHTML = `
      <div class="task-drawer-title-area">
        <input type="text" class="task-drawer-title" id="new-event-title" placeholder="Event name" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="task-drawer-meta">
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Date
          </span>
          <input type="date" class="task-drawer-meta-value" id="new-event-date" value="${defaultDate}" style="border:none;background:transparent;font:inherit;color:inherit;width:auto;">
        </div>
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            Time
          </span>
          <input type="time" class="task-drawer-meta-value" id="new-event-time" value="09:00" style="border:none;background:transparent;font:inherit;color:inherit;width:auto;">
        </div>
      </div>
      <div class="task-drawer-actions">
        <button class="btn btn-ghost" id="create-event-cancel">Cancel</button>
        <button class="btn btn-primary" id="create-event-submit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Create Event
        </button>
      </div>`;

    openDrawer();
    setTimeout(() => document.getElementById('new-event-title')?.focus(), 100);
    document.getElementById('create-event-cancel')?.addEventListener('click', closeDrawer);
    document.getElementById('create-event-submit')?.addEventListener('click', () => {
      const title = document.getElementById('new-event-title')?.value?.trim();
      const date = document.getElementById('new-event-date')?.value;
      const time = document.getElementById('new-event-time')?.value;
      if (!title) { showToast('Please enter an event name', 'warning'); return; }
      createEvent(title, date, time);
      closeDrawer();
    });
    document.getElementById('new-event-title')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('create-event-submit')?.click();
    });
  }

  function openEventDrawerEdit(eventId) {
    var event = state.events.find(function (e) { return e.id === eventId; });
    if (!event) { showToast('Event not found', 'error'); return; }
    const content = document.getElementById('drawer-content');
    const badges = document.getElementById('drawer-badges');
    if (!content) return;
    badges.innerHTML = '<span class="badge badge-info">Calendar</span>';
    content.innerHTML = `
      <div class="task-drawer-title-area">
        <input type="text" class="task-drawer-title" id="edit-event-title" value="${event.name}" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="task-drawer-meta">
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            Date
          </span>
          <input type="date" class="task-drawer-meta-value" id="edit-event-date" value="${event.date}">
        </div>
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            Time
          </span>
          <input type="time" class="task-drawer-meta-value" id="edit-event-time" value="${event.time || '09:00'}">
        </div>
      </div>
      <div class="task-drawer-actions">
        <button class="btn btn-ghost" id="edit-event-delete" style="color:var(--danger);margin-right:auto;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          Delete
        </button>
        <button class="btn btn-ghost" id="edit-event-cancel">Cancel</button>
        <button class="btn btn-primary" id="edit-event-submit">Save</button>
      </div>`;
    openDrawer();
    setTimeout(function () { document.getElementById('edit-event-title')?.focus(); }, 100);
    document.getElementById('edit-event-cancel')?.addEventListener('click', closeDrawer);
    document.getElementById('edit-event-submit')?.addEventListener('click', function () {
      var title = document.getElementById('edit-event-title')?.value?.trim();
      var date = document.getElementById('edit-event-date')?.value;
      var time = document.getElementById('edit-event-time')?.value;
      if (!title) { showToast('Please enter an event name', 'warning'); return; }
      API.patch('/events/' + eventId, { name: title, date: date, time: time }).then(function (updated) {
        var idx = state.events.findIndex(function (e) { return e.id === eventId; });
        if (idx !== -1) state.events[idx] = updated;
        showToast('Event updated');
        closeDrawer();
        refreshCurrentView();
      }).catch(function (err) { showToast(err.message || 'Failed to update event', 'error'); });
    });
    document.getElementById('edit-event-delete')?.addEventListener('click', function () {
      showConfirmDialog({ title: 'Delete event?', confirmLabel: 'Delete', danger: true })
        .then(function (ok) { if (ok) { closeDrawer(); deleteEvent(eventId); } });
    });
  }

  // --- Team Drawer ---
  function openTeamDrawerCreate() {
    const content = document.getElementById('drawer-content');
    const badges = document.getElementById('drawer-badges');
    if (!content) return;

    badges.innerHTML = '<span class="badge badge-info">Team</span>';
    content.innerHTML = `
      <div class="task-drawer-title-area">
        <input type="text" class="task-drawer-title" id="new-member-name" placeholder="Member name" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="task-drawer-meta">
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            Photo
          </span>
          <div class="team-photo-upload">
            <div class="team-photo-preview" id="create-member-photo-preview">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            </div>
            <input type="file" accept="image/*" id="create-member-photo-input" hidden>
            <button class="btn btn-ghost" id="create-member-photo-btn">Upload Photo</button>
            <button class="btn btn-ghost" id="create-member-photo-remove" style="display:none;color:var(--danger);">Remove</button>
          </div>
        </div>
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Role
          </span>
          <div id="member-role-dropdown"></div>
        </div>
      </div>
      <div class="task-drawer-actions">
        <button class="btn btn-ghost" id="create-member-cancel">Cancel</button>
        <button class="btn btn-primary" id="create-member-submit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
          Add Member
        </button>
      </div>`;

    openDrawer();

    let selectedRole = 'Member';
    let selectedPhoto = null;
    const roleOpts = ['Member', 'Admin', 'Owner'].map(r => ({ value: r, label: r }));
    const roleDrop = buildDropdown(roleOpts, selectedRole, (v) => { selectedRole = v; });
    document.getElementById('member-role-dropdown').appendChild(roleDrop.element);

    const photoInput = document.getElementById('create-member-photo-input');
    const photoPreview = document.getElementById('create-member-photo-preview');
    const photoBtn = document.getElementById('create-member-photo-btn');
    const photoRemove = document.getElementById('create-member-photo-remove');
    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
      const file = photoInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        selectedPhoto = e.target.result;
        photoPreview.innerHTML = `<img src="${selectedPhoto}" alt="Preview">`;
        photoBtn.textContent = 'Change Photo';
        photoRemove.style.display = '';
      };
      reader.readAsDataURL(file);
    });
    photoRemove.addEventListener('click', () => {
      selectedPhoto = null;
      photoInput.value = '';
      photoPreview.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
      photoBtn.textContent = 'Upload Photo';
      photoRemove.style.display = 'none';
    });

    setTimeout(() => document.getElementById('new-member-name')?.focus(), 100);
    document.getElementById('create-member-cancel')?.addEventListener('click', closeDrawer);
    document.getElementById('create-member-submit')?.addEventListener('click', () => {
      const name = document.getElementById('new-member-name')?.value?.trim();
      if (!name) { showToast('Please enter a member name', 'warning'); return; }
      createTeamMember(name, selectedRole, selectedPhoto);
      closeDrawer();
    });
    document.getElementById('new-member-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('create-member-submit')?.click();
    });
  }

  function openTeamDrawerEdit(memberId) {
    const data = getData();
    const member = data.team.find(m => m.id === memberId);
    if (!member) return;
    const content = document.getElementById('drawer-content');
    const badges = document.getElementById('drawer-badges');
    if (!content) return;
    badges.innerHTML = '<span class="badge badge-info">Edit Member</span>';
    const existingPhoto = member.photo || null;
    content.innerHTML = `
      <div class="task-drawer-title-area">
        <input type="text" class="task-drawer-title" id="edit-member-name" value="${member.name}" placeholder="Member name" autocomplete="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="task-drawer-meta">
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            Photo
          </span>
          <div class="team-photo-upload">
            <div class="team-photo-preview" id="edit-member-photo-preview">${existingPhoto ? `<img src="${existingPhoto}" alt="Preview">` : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'}</div>
            <input type="file" accept="image/*" id="edit-member-photo-input" hidden>
            <button class="btn btn-ghost" id="edit-member-photo-btn">${existingPhoto ? 'Change Photo' : 'Upload Photo'}</button>
            <button class="btn btn-ghost" id="edit-member-photo-remove" style="${existingPhoto ? '' : 'display:none;'}color:var(--danger);">Remove</button>
          </div>
        </div>
        <div class="task-drawer-meta-row">
          <span class="task-drawer-meta-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Role
          </span>
          <div id="edit-member-role-dropdown"></div>
        </div>
      </div>
      <div class="task-drawer-actions">
        <button class="btn btn-ghost" id="edit-member-delete" style="color:var(--danger);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>Remove</button>
        <button class="btn btn-ghost" id="edit-member-cancel">Cancel</button>
        <button class="btn btn-primary" id="edit-member-submit">Save Changes</button>
      </div>`;
    openDrawer();
    let selectedRole = member.role || 'Member';
    let selectedPhoto = member.photo || null;
    const roleOpts = ['Member', 'Admin', 'Owner'].map(r => ({ value: r, label: r }));
    const roleDrop = buildDropdown(roleOpts, selectedRole, (v) => { selectedRole = v; });
    document.getElementById('edit-member-role-dropdown').appendChild(roleDrop.element);

    const photoInput = document.getElementById('edit-member-photo-input');
    const photoPreview = document.getElementById('edit-member-photo-preview');
    const photoBtn = document.getElementById('edit-member-photo-btn');
    const photoRemove = document.getElementById('edit-member-photo-remove');
    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
      const file = photoInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        selectedPhoto = e.target.result;
        photoPreview.innerHTML = `<img src="${selectedPhoto}" alt="Preview">`;
        photoBtn.textContent = 'Change Photo';
        photoRemove.style.display = '';
      };
      reader.readAsDataURL(file);
    });
    photoRemove.addEventListener('click', () => {
      selectedPhoto = null;
      photoInput.value = '';
      photoPreview.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
      photoBtn.textContent = 'Upload Photo';
      photoRemove.style.display = 'none';
    });

    setTimeout(() => document.getElementById('edit-member-name')?.focus(), 100);
    document.getElementById('edit-member-cancel')?.addEventListener('click', closeDrawer);
    document.getElementById('edit-member-delete')?.addEventListener('click', () => {
      showConfirmDialog({ title: 'Remove team member?', confirmLabel: 'Remove', danger: true })
        .then(function (ok) { if (ok) { deleteTeamMember(memberId); closeDrawer(); } });
    });
    document.getElementById('edit-member-submit')?.addEventListener('click', () => {
      const name = document.getElementById('edit-member-name')?.value?.trim();
      if (!name) { showToast('Please enter a name', 'warning'); return; }
      updateTeamMember(memberId, { name, role: selectedRole, photo: selectedPhoto });
      closeDrawer();
    });
  }

  // --- Drawer close handlers ---
  function initTaskDrawer() {
    const overlay = document.getElementById('task-drawer-overlay');
    const closeBtn = document.getElementById('drawer-close');
    closeBtn?.addEventListener('click', closeDrawer);
    overlay?.addEventListener('click', closeDrawer);
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.custom-dropdown')) closeAllDropdowns();
      const notifDropdown = document.getElementById('notification-dropdown');
      const notifBtn = document.getElementById('notifications-btn');
      if (notifDropdown && notifDropdown.style.display === 'flex' && !notifDropdown.contains(e.target) && !notifBtn?.contains(e.target)) {
        closeNotificationDropdown();
      }
      const userDd = document.getElementById('user-dropdown');
      const userTrig = document.getElementById('user-menu-trigger');
      if (userDd && userDd.style.display === 'block' && !userDd.contains(e.target) && !userTrig?.contains(e.target)) {
        userDd.style.display = 'none';
      }
      const wsDd = document.getElementById('workspace-dropdown');
      const wsTrig = document.getElementById('workspace-switcher');
      if (wsDd && wsDd.style.display === 'block' && !wsDd.contains(e.target) && !wsTrig?.contains(e.target)) {
        wsDd.style.display = 'none';
      }
    });
  }

  function initTaskItemListeners() {
    document.querySelectorAll('.task-item, .kanban-card').forEach(item => {
      const checkbox = item.querySelector('.task-checkbox');
      checkbox?.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        toggleTaskStatus(item.dataset.taskId); 
      });
      item.addEventListener('click', () => {
        openTaskDrawerEdit(item.dataset.taskId);
      });
    });
  }

  function initKanbanDrag() {
    const columns = document.querySelectorAll('.kanban-cards');
    let draggedCard = null;
    var dragTick = false;

    function getDragAfterElement(container, y) {
      var elements = container.querySelectorAll('.kanban-card:not(.dragging)');
      var closestEl = null;
      var closestOffset = Number.NEGATIVE_INFINITY;
      for (var i = 0; i < elements.length; i++) {
        var box = elements[i].getBoundingClientRect();
        var offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closestOffset) { closestOffset = offset; closestEl = elements[i]; }
      }
      return closestEl;
    }

    document.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.kanban-card');
      if (card) { draggedCard = card; setTimeout(() => card.classList.add('dragging'), 0); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); }
    });

    document.addEventListener('dragend', (e) => {
      const card = e.target.closest('.kanban-card');
      if (card) {
        card.classList.remove('dragging');
        draggedCard = null;
        columns.forEach(col => {
          col.classList.remove('drag-over');
          const count = col.querySelectorAll('.kanban-card').length;
          const countEl = col.parentElement.querySelector('.kanban-count');
          if (countEl) countEl.textContent = count;
        });
      }
    });

    columns.forEach(column => {
      var dragRAF = null;
      column.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        column.classList.add('drag-over');
        if (dragRAF) return;
        dragRAF = requestAnimationFrame(function() {
          dragRAF = null;
          var afterElement = getDragAfterElement(column, e.clientY);
          if (draggedCard) {
            if (afterElement) column.insertBefore(draggedCard, afterElement);
            else column.appendChild(draggedCard);
          }
        });
      });
      column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
      column.addEventListener('drop', (e) => {
        e.preventDefault();
        column.classList.remove('drag-over');
        if (!draggedCard) return;
        const taskId = draggedCard.dataset.taskId;
        const newStatus = column.dataset.status;
        if (taskId && newStatus) {
          const data = getData();
          const task = data.tasks.find(t => t.id === taskId);
          if (task) {
            var oldStatus = task.status;
            task.status = newStatus;
            showToast('Task moved');
            API.patch('/tasks/' + taskId, { status: newStatus }).catch(function () {
              task.status = oldStatus;
              refreshCurrentView();
            });
          }
        }
      });
    });
  }

  function initFAB() {
    function toggleQuickMenu(btn) {
      var existing = document.getElementById('quick-create-menu');
      if (existing) { existing.remove(); return; }
      var data = getData();
      var menu = document.createElement('div');
      menu.id = 'quick-create-menu';
      menu.className = 'quick-create-menu';
      var items = [];
      items.push({ label: 'New Project', icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', action: function () { openProjectDrawerCreate(); }, hint: '' });
      if (data.projects.length > 0) {
        items.push({ label: 'New Task', icon: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', action: function () { openTaskDrawerCreate(data.projects[0].id); }, hint: 'T' });
      }
      items.push({ label: 'New Event', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', action: function () { openEventDrawerCreate(); }, hint: '' });
      menu.innerHTML = items.map(function (it) {
        return '<div class="quick-create-item" tabindex="0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + it.icon + '</svg><span>' + it.label + '</span>' + (it.hint ? '<kbd class="kbd-small">' + it.hint + '</kbd>' : '') + '</div>';
      }).join('');
      document.body.appendChild(menu);
      var rect = btn.getBoundingClientRect();
      menu.style.top = (rect.bottom + 6) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      requestAnimationFrame(function () { menu.classList.add('active'); });
      menu.addEventListener('click', function (e) {
        var item = e.target.closest('.quick-create-item');
        if (!item) return;
        var idx = Array.from(menu.children).indexOf(item);
        if (items[idx]) { items[idx].action(); }
        menu.remove();
      });
      var close = function (e) { if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('click', close); } };
      setTimeout(function () { document.addEventListener('click', close); }, 0);
    }

    var qcBtn = document.getElementById('quick-create');
    if (qcBtn) {
      qcBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleQuickMenu(qcBtn); });
    }
    var fabBtn = document.getElementById('fab');
    if (fabBtn) {
      fabBtn.addEventListener('click', function () {
        var data = getData();
        if (data.projects.length === 0) { navigateTo('projects'); showToast('Create a project first'); }
        else openTaskDrawerCreate(data.projects[0].id);
      });
    }
  }

  function initNewProjectButtons() {
    document.getElementById('dashboard-new-project')?.addEventListener('click', () => openProjectDrawerCreate());
    document.getElementById('projects-new-project')?.addEventListener('click', () => openProjectDrawerCreate());
    document.getElementById('project-add-task')?.addEventListener('click', () => openTaskDrawerCreate(currentProjectId));
    document.getElementById('tasks-new-task')?.addEventListener('click', () => {
      const data = getData();
      if (data.projects.length === 0) { showToast('Create a project first'); navigateTo('projects'); }
      else openTaskDrawerCreate(data.projects[0].id);
    });
    document.getElementById('calendar-new-event')?.addEventListener('click', () => openEventDrawerCreate());
    document.getElementById('team-invite')?.addEventListener('click', () => openTeamDrawerCreate());
  }

  function initBackButton() {
    document.getElementById('back-to-projects')?.addEventListener('click', () => { currentProjectId = null; navigateTo('projects'); });
  }

  function initSettings() {
    const settingsName = document.getElementById('settings-name');
    const navItems = document.querySelectorAll('.settings-nav-item');
    const sections = document.querySelectorAll('.settings-section');

    navItems.forEach((item, index) => {
      item.addEventListener('click', () => {
        navItems.forEach(nav => nav.classList.remove('active'));
        sections.forEach(sec => sec.style.display = 'none');
        item.classList.add('active');
        if (sections[index]) sections[index].style.display = 'block';
      });
    });

    // Initialize display
    sections.forEach((sec, i) => {
      sec.style.display = i === 0 ? 'block' : 'none';
    });

    settingsName?.addEventListener('blur', () => validateInput(settingsName, { required: true, minLength: 2 }));
    settingsName?.addEventListener('input', () => {
      if (settingsName.classList.contains('error') || settingsName.classList.contains('valid'))
        validateInput(settingsName, { required: true, minLength: 2 });
    });
    settingsName?.addEventListener('change', () => {
      const data = getData();
      if (data.user && settingsName.value.trim()) {
        data.user.name = settingsName.value.trim();
        saveData(data);
        updateUserInfo();
        API.patch('/user', { name: data.user.name }).then(function () {
          showToast('Profile updated', 'success');
        }).catch(function () {
          showToast('Failed to save name', 'error');
        });
      }
    });

    document.getElementById('date-format-select')?.addEventListener('change', (e) => {
      localStorage.setItem('pm-date-format', e.target.value);
      showToast('Date format updated', 'success');
      refreshCurrentView();
    });
    const savedFormat = localStorage.getItem('pm-date-format');
    if (savedFormat) {
      const sel = document.getElementById('date-format-select');
      if (sel) sel.value = savedFormat;
    }

    initSmtpSettings();
    initWebhookSettings();

    document.getElementById('export-data-btn')?.addEventListener('click', exportData);
    document.getElementById('import-data-btn')?.addEventListener('click', () => {
      document.getElementById('import-data-input')?.click();
    });
    document.getElementById('import-data-input')?.addEventListener('change', (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
    });
    document.getElementById('clear-data-btn')?.addEventListener('click', clearAllData);

    var soundToggle = document.getElementById('sound-toggle');
    if (soundToggle) {
      soundToggle.classList.toggle('active', soundEnabled);
      soundToggle.addEventListener('click', function () {
        soundEnabled = !soundEnabled;
        localStorage.setItem('pm-sound-enabled', soundEnabled);
        soundToggle.classList.toggle('active', soundEnabled);
        if (soundEnabled) playSound('success');
        showToast(soundEnabled ? 'Sound enabled' : 'Sound disabled', 'info');
      });
    }
  }

  function initWebhookSettings() {
    var input = document.getElementById('webhook-url-input');
    var saveBtn = document.getElementById('webhook-save-btn');
    if (!input || !saveBtn) return;
    API.get('/settings/webhook').then(function (data) {
      if (data && data.webhook_url) input.value = data.webhook_url;
    }).catch(function () {});
    saveBtn.addEventListener('click', function () {
      var url = input.value.trim();
      API.put('/settings/webhook', { webhook_url: url }).then(function () {
        showToast('Webhook URL saved', 'success');
      }).catch(function (err) { showToast(err.message || 'Failed', 'error'); });
    });
  }

  function initSmtpSettings() {
    var statusEl = document.getElementById('smtp-status');
    function setStatus(msg, type) {
      statusEl.textContent = msg;
      statusEl.style.color = type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--success)' : 'var(--text-tertiary)';
    }

    function getForm() {
      return {
        host: document.getElementById('smtp-host').value.trim(),
        port: parseInt(document.getElementById('smtp-port').value.trim()) || 587,
        secure: document.getElementById('smtp-secure').classList.contains('active'),
        user: document.getElementById('smtp-user').value.trim(),
        pass: document.getElementById('smtp-pass').value.trim(),
        fromName: document.getElementById('smtp-from-name').value.trim() || 'Project Manager',
        fromAddr: document.getElementById('smtp-from-addr').value.trim(),
      };
    }

    function fillForm(cfg) {
      document.getElementById('smtp-host').value = cfg.host || '';
      document.getElementById('smtp-port').value = cfg.port || '587';
      var toggle = document.getElementById('smtp-secure');
      if (cfg.secure) toggle.classList.add('active'); else toggle.classList.remove('active');
      document.getElementById('smtp-user').value = cfg.user || '';
      document.getElementById('smtp-pass').value = '';
      document.getElementById('smtp-from-name').value = cfg.fromName || 'Project Manager';
      document.getElementById('smtp-from-addr').value = cfg.fromAddr || '';
    }

    API.getSmtpConfig().then(function (res) {
      if (res.configured) fillForm(res);
    }).catch(function () {});

    document.getElementById('smtp-save-btn').addEventListener('click', function () {
      var cfg = getForm();
      if (!cfg.host || !cfg.user) {
        setStatus('Host and Username are required.', 'error');
        return;
      }
      if (!cfg.pass && !document.getElementById('smtp-pass').dataset.saved) {
        setStatus('Password is required.', 'error');
        return;
      }
      setStatus('Saving...', '');
      API.saveSmtpConfig(cfg).then(function () {
        document.getElementById('smtp-pass').dataset.saved = '1';
        setStatus('SMTP settings saved.', 'success');
      }).catch(function (err) {
        setStatus(err.body?.error || 'Failed to save.', 'error');
      });
    });

    document.getElementById('smtp-test-btn').addEventListener('click', function () {
      var cfg = getForm();
      if (!cfg.host || !cfg.user || !cfg.pass) {
        setStatus('Fill all required fields first.', 'error');
        return;
      }
      setStatus('Sending test email...', '');
      API.testSmtpConfig(cfg).then(function () {
        setStatus('Test email sent! Check your inbox (or spam).', 'success');
      }).catch(function (err) {
        setStatus(err.body?.error || 'Test failed.', 'error');
      });
    });
  }

  function getNotifications() {
    const data = getData();
    const today = new Date().toISOString().split('T')[0];
    const notifs = [];
    data.tasks.forEach(t => {
      if (t.status !== 'done' && t.dueDate) {
        var d = dueDatePart(t.dueDate);
        if (d < today) {
          notifs.push({ id: 'overdue-' + t.id, taskId: t.id, type: 'overdue', text: `"${t.name}" is overdue`, date: d, icon: 'danger' });
        } else if (d === today) {
          notifs.push({ id: 'due-' + t.id, taskId: t.id, type: 'due', text: `"${t.name}" is due today`, date: d, icon: 'warning' });
        } else {
          const dueDate = new Date(t.dueDate);
          const diffDays = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
          if (diffDays <= 1) {
            notifs.push({ id: 'soon-' + t.id, taskId: t.id, type: 'soon', text: `"${t.name}" due tomorrow`, date: t.dueDate, icon: 'info' });
          }
        }
      }
    });
    return notifs.sort((a, b) => a.date.localeCompare(b.date));
  }

  function updateNotificationBadge() {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    const notifs = getNotifications();
    const readIds = JSON.parse(localStorage.getItem('pm-read-notifs') || '[]');
    const unread = notifs.filter(n => !readIds.includes(n.id));
    if (unread.length > 0) {
      badge.style.display = 'flex';
      badge.textContent = unread.length > 9 ? '9+' : unread.length;
    } else {
      badge.style.display = 'none';
    }
  }

  function renderNotificationDropdown() {
    const list = document.getElementById('notification-list');
    if (!list) return;
    const notifs = getNotifications();
    const readIds = JSON.parse(localStorage.getItem('pm-read-notifs') || '[]');
    if (notifs.length === 0) {
      list.innerHTML = '<div class="notification-empty">No notifications</div>';
      return;
    }
    list.innerHTML = notifs.map(n => {
      const isUnread = !readIds.includes(n.id);
      const iconColors = { danger: 'var(--danger)', warning: 'var(--warning)', info: 'var(--info)' };
      return `<div class="notification-item ${isUnread ? 'unread' : ''}" data-task-id="${n.taskId}" data-notif-id="${n.id}">
        <div class="notification-item-icon" style="background:${iconColors[n.icon] || 'var(--bg-tertiary)'};color:white;font-size:12px;">${n.icon === 'danger' ? '!' : n.icon === 'warning' ? '!' : 'i'}</div>
        <div class="notification-item-content">
          <div class="notification-item-text">${n.text}</div>
          <div class="notification-item-time">${n.date}</div>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.notification-item').forEach(item => {
      item.addEventListener('click', () => {
        const taskId = item.dataset.taskId;
        const notifId = item.dataset.notifId;
        if (taskId) {
          const readIds = JSON.parse(localStorage.getItem('pm-read-notifs') || '[]');
          if (!readIds.includes(notifId)) { readIds.push(notifId); localStorage.setItem('pm-read-notifs', JSON.stringify(readIds)); }
          openTaskDrawerEdit(taskId);
        }
        closeNotificationDropdown();
      });
    });
  }

  function toggleNotificationDropdown() {
    const dropdown = document.getElementById('notification-dropdown');
    if (!dropdown) return;
    const isOpen = dropdown.style.display === 'flex';
    if (isOpen) { closeNotificationDropdown(); return; }
    renderNotificationDropdown();
    dropdown.style.display = 'flex';
  }

  function closeNotificationDropdown() {
    const dropdown = document.getElementById('notification-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    updateNotificationBadge();
  }

  function announceToScreenReader(message) {
    const el = document.getElementById('aria-live');
    if (el) { el.textContent = ''; setTimeout(() => { el.textContent = message; }, 50); }
  }

  function formatDate(dateStr, format) {
    if (!dateStr) return '';
    format = format || localStorage.getItem('pm-date-format') || 'yyyy-mm-dd';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    if (format === 'mm/dd/yyyy') return parts[1] + '/' + parts[2] + '/' + parts[0];
    if (format === 'dd/mm/yyyy') return parts[2] + '/' + parts[1] + '/' + parts[0];
    return dateStr;
  }

  function exportData() {
    const data = getData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project-manager-backup-' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported', 'success');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data.projects || !data.tasks) { showToast('Invalid backup file', 'error'); return; }
        showConfirmDialog({ title: 'Replace all data?', message: 'This will replace all current data with the contents of this backup.', confirmLabel: 'Import', danger: true }).then(function (ok) {
        if (!ok) return;
        showToast('Importing data...', 'info');
        clearAllDataSilent();
        var chain = Promise.resolve();
        data.projects.forEach(function (p) {
          chain = chain.then(function () { return API.post('/projects', { name: p.name, color: p.color || '#DA5427' }); });
        });
        chain = chain.then(function () { return API.get('/projects'); }).then(function (newProjects) {
          var pmap = {};
          data.projects.forEach(function (p, i) { pmap[p.id] = newProjects[i] ? newProjects[i].id : null; });
          data.tasks.forEach(function (t) {
            chain = chain.then(function () {
              return API.post('/tasks', {
                project_id: pmap[t.projectId] || pmap[t.project_id],
                name: t.name, description: t.description || '', status: t.status || 'todo',
                priority: t.priority || 'medium', due_date: t.dueDate || t.due_date || null,
                recurrence: t.recurrence || 'none',
              });
            });
          });
        });
        if (data.team) {
          data.team.forEach(function (m) {
            chain = chain.then(function () { return API.post('/team', { name: m.name, role: m.role || 'Member', color: m.color || '#DA5427' }).catch(function () {}); });
          });
        }
        if (data.events) {
          data.events.forEach(function (e) {
            chain = chain.then(function () { return API.post('/events', { name: e.name, date: e.date, time: e.time || '09:00' }).catch(function () {}); });
          });
        }
        chain.then(function () {
          showToast('Import complete!', 'success');
          loadAllData().then(function () { refreshCurrentView(); });
        }).catch(function () { showToast('Import failed', 'error'); });
        });
      } catch { showToast('Invalid file format', 'error'); }
    };
    reader.readAsText(file);
  }

  function clearAllDataSilent() {
    Promise.all([
      API.del('/projects').catch(function () {}),
      API.del('/tasks').catch(function () {}),
      API.del('/team').catch(function () {}),
      API.del('/events').catch(function () {}),
    ]);
  }

  function clearAllData() {
    showConfirmDialog({
      title: 'Delete all data?',
      message: 'All projects, tasks, team members and events will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true,
    }).then(function (ok) {
      if (!ok) return;
      Promise.all([
        API.del('/projects'),
        API.del('/tasks'),
        API.del('/team'),
        API.del('/events'),
      ]).then(function () {
        state.projects = [];
        state.tasks = [];
        state.team = [];
        state.events = [];
        localStorage.removeItem('pm-last-page');
        localStorage.removeItem('pm-last-project');
        localStorage.removeItem('pm-read-notifs');
        showToast('All data cleared.', 'success');
        refreshCurrentView();
      }).catch(function () { showToast('Failed to clear data', 'error'); });
    });
  }

  function renderActivityFeed(container) {
    if (!container) return;
    API.get('/activity').then(function (logs) {
      if (!logs || logs.length === 0) {
        container.innerHTML = '<p style="font-size:var(--text-sm);color:var(--text-tertiary);padding:var(--space-3) 0;text-align:center;">No recent activity</p>';
        return;
      }
      var icons = {
        'task-created': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
        'task-completed': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        'task-moved': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>',
        'project-created': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
        'task-deleted': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
        'default': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>'
      };
      container.innerHTML = logs.slice(0, 8).map(function (a) {
        var d = new Date(a.createdAt);
        var timeStr = formatActivityTime(d);
        return '<div class="activity-item"><div class="activity-icon" style="background:var(--bg-tertiary);color:var(--text-secondary);">' + (icons[a.type] || icons['default']) + '</div><div class="activity-content"><div class="activity-text">' + a.description + '</div><div class="activity-time">' + timeStr + '</div></div></div>';
      }).join('');
    }).catch(function () {
      container.innerHTML = '<p style="font-size:var(--text-sm);color:var(--text-tertiary);padding:var(--space-3) 0;text-align:center;">Could not load activity</p>';
    });
  }

  function triggerConfetti() {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
    document.body.appendChild(container);
    const colors = [COLORS[0], COLORS[1], COLORS[3], COLORS[6], COLORS[7], '#FFD700', '#FF6B6B', '#4ECDC4'];
    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      const size = 6 + Math.random() * 8;
      piece.style.cssText = 'position:absolute;width:' + size + 'px;height:' + size + 'px;background:' + colors[Math.floor(Math.random() * colors.length)] + ';left:' + Math.random() * 100 + '%;top:-20px;border-radius:' + (Math.random() > 0.5 ? '50%' : '2px') + ';animation:confettiFall ' + (1 + Math.random() * 2) + 's ease-in forwards;animation-delay:' + Math.random() * 1.5 + 's;';
      container.appendChild(piece);
    }
    setTimeout(() => container.remove(), 4000);
  }

  function trapFocus(element) {
    const focusable = element.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    element.addEventListener('keydown', function trapHandler(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    first.focus();
  }

  function toggleUserMenu() {
    const dropdown = document.getElementById('user-dropdown');
    if (!dropdown) return;
    const data = getData();
    if (data.user) {
      var uda = document.getElementById('user-dropdown-avatar');
      var hasPhoto = data.user.photo && data.user.photo.length > 0;
      var initials = getInitials(data.user.name);
      if (uda) { uda.textContent = hasPhoto ? '' : initials; uda.style.backgroundImage = hasPhoto ? 'url(' + data.user.photo + ')' : ''; uda.style.backgroundSize = hasPhoto ? 'cover' : ''; uda.style.backgroundPosition = hasPhoto ? 'center' : ''; }
      document.getElementById('user-dropdown-name').textContent = data.user.name;
      document.getElementById('user-dropdown-email').textContent = data.user.email || (data.user.username ? '@' + data.user.username : '');
    }
    const isOpen = dropdown.style.display === 'block';
    dropdown.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      dropdown.querySelectorAll('.user-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          const action = item.dataset.action;
          dropdown.style.display = 'none';
          if (action === 'profile' || action === 'settings') navigateTo('settings');
          if (action === 'export') exportData();
        });
      });
    }
  }

  function toggleWorkspaceDropdown() {
    const dropdown = document.getElementById('workspace-dropdown');
    if (!dropdown) return;
    const data = getData();
    if (data.user) {
      var wda = document.getElementById('ws-dropdown-avatar');
      var hasPhoto = data.user.photo && data.user.photo.length > 0;
      var initials = getInitials(data.user.name);
      if (wda) { wda.textContent = hasPhoto ? '' : initials; wda.style.backgroundImage = hasPhoto ? 'url(' + data.user.photo + ')' : ''; wda.style.backgroundSize = hasPhoto ? 'cover' : ''; wda.style.backgroundPosition = hasPhoto ? 'center' : ''; }
      document.getElementById('ws-dropdown-name').textContent = data.user.name;
      document.getElementById('ws-dropdown-email').textContent = data.user.email || (data.user.username ? '@' + data.user.username : '');
    }
    const isOpen = dropdown.style.display === 'block';
    dropdown.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      dropdown.querySelectorAll('.workspace-dropdown-item').forEach(item => {
        item.onclick = () => {
          dropdown.style.display = 'none';
          if (item.dataset.action === 'profile' || item.dataset.action === 'settings') navigateTo('settings');
        };
      });
    }
  }

  var dockTimer = null;

  function showDock(message, iconType, duration) {
    var dock = document.getElementById('status-dock');
    var text = document.getElementById('dock-text');
    var icon = document.getElementById('dock-icon');
    if (!dock || !text) return;
    clearTimeout(dockTimer);
    var icons = {
      check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
      sync: '<svg class="spin-slow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>',
      save: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>',
      bell: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
    };
    if (icon && icons[iconType]) icon.innerHTML = icons[iconType];
    text.textContent = message;
    dock.classList.add('visible');
    duration = duration || 2000;
    dockTimer = setTimeout(function () { dock.classList.remove('visible'); }, duration);
  }

  function showDockSync(message) {
    showDock(message, 'sync', 3000);
  }

  function showDockSaved(message) {
    showDock(message, 'save', 1500);
  }

  function showDockCheck(message) {
    showDock(message, 'check', 1500);
  }

  function showToast(message, type, duration) {
    type = type || 'default';
    duration = duration || 3000;
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type + ' entering';
    const icons = {
      success: '<svg class="toast-icon toast-icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
      error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
      warning: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
      default: ''
    };
    toast.innerHTML = (icons[type] || '') + '<span class="toast-message">' + message + '</span><button class="toast-close" aria-label="Dismiss"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>';
    container.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.remove('entering');
    });
    toast.querySelector('.toast-close')?.addEventListener('click', function (e) {
      e.stopPropagation();
      removeToast(toast);
    });
    var timer = setTimeout(function () { removeToast(toast); }, duration);
    toast._timer = timer;
    toast.addEventListener('mouseenter', function () { clearTimeout(timer); });
    toast.addEventListener('mouseleave', function () {
      var t = setTimeout(function () { removeToast(toast); }, 1500);
      toast._timer = t;
    });
    announceToScreenReader(message);
  }

  function removeToast(toast) {
    if (toast._removing) return;
    toast._removing = true;
    clearTimeout(toast._timer);
    toast.classList.add('removing');
    setTimeout(function () {
      if (toast.parentNode) toast.remove();
      document.querySelectorAll('.toast').forEach(function (t, i) {
        t.style.transitionDelay = (i * 0.03) + 's';
      });
    }, 250);
  }

  function showConfirmDialog(opts) {
    opts = opts || {};
    var withInput = !!opts.input;
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'confirm-dialog-overlay';
      overlay.innerHTML =
        '<div class="confirm-dialog-backdrop"></div>' +
        '<div class="confirm-dialog' + (opts.danger ? ' confirm-dialog-danger' : '') + '" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">' +
          (opts.title ? '<h3 class="confirm-dialog-title" id="confirm-dialog-title">' + opts.title + '</h3>' : '') +
          (opts.message ? '<p class="confirm-dialog-message">' + opts.message + '</p>' : '') +
          (withInput ? '<input class="input confirm-dialog-input" type="text" placeholder="' + (opts.input.placeholder || '') + '">' : '') +
          '<div class="confirm-dialog-actions">' +
            '<button type="button" class="btn btn-ghost" data-action="cancel">' + (opts.cancelLabel || 'Cancel') + '</button>' +
            '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-action="confirm">' + (opts.confirmLabel || 'Confirm') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      requestAnimationFrame(function () { overlay.classList.add('active'); });

      var input = overlay.querySelector('.confirm-dialog-input');
      if (input) setTimeout(function () { input.focus(); }, 60);

      function close(result) {
        document.removeEventListener('keydown', onKey);
        overlay.classList.remove('active');
        overlay.classList.add('exiting');
        setTimeout(function () { overlay.remove(); }, 200);
        resolve(result);
      }
      function confirmValue() { return withInput ? (input.value.trim() || null) : true; }
      function cancelValue() { return withInput ? null : false; }
      function onKey(e) {
        if (e.key === 'Escape') close(cancelValue());
        else if (e.key === 'Enter' && (!withInput || document.activeElement === input)) close(confirmValue());
      }
      overlay.querySelector('[data-action="cancel"]').addEventListener('click', function () { close(cancelValue()); });
      overlay.querySelector('[data-action="confirm"]').addEventListener('click', function () { close(confirmValue()); });
      overlay.querySelector('.confirm-dialog-backdrop').addEventListener('click', function () { close(cancelValue()); });
      document.addEventListener('keydown', onKey);
    });
  }

  function showUndoToast(message, undoAction, duration) {
    duration = duration || 5000;
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-undo';
    let remaining = Math.ceil(duration / 1000);
    toast.innerHTML = '<span class="toast-message">' + message + '</span><span class="undo-countdown" id="undo-countdown">' + remaining + 's</span><button class="undo-btn" id="undo-action-btn"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>Undo</button><button class="toast-close" aria-label="Dismiss"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>';
    container.appendChild(toast);
    const timer = setInterval(function () {
      remaining--;
      var el = document.getElementById('undo-countdown');
      if (el) el.textContent = remaining + 's';
      if (remaining <= 0) { clearInterval(timer); removeToast(toast); }
    }, 1000);
    toast.querySelector('#undo-action-btn')?.addEventListener('click', function () {
      clearInterval(timer);
      undoAction();
      removeToast(toast);
    });
    toast.querySelector('.toast-close')?.addEventListener('click', function () {
      clearInterval(timer);
      removeToast(toast);
    });
    setTimeout(function () { clearInterval(timer); removeToast(toast); }, duration);
  }

  function renderRichTags(tagsStr) {
    if (!tagsStr) return '';
    var icons = {
      bug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
      urgent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      feature: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
      enhancement: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>',
      docs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
      design: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>'
    };
    var classMap = {
      bug: 'tag-bug', urgent: 'tag-urgent', feature: 'tag-feature',
      enhancement: 'tag-enhancement', docs: 'tag-docs', design: 'tag-design'
    };
    return tagsStr.split(',').map(function (t) {
      t = t.trim().toLowerCase();
      if (!t) return '';
      var cls = classMap[t] || 'tag-default';
      var icon = icons[t] || '';
      return '<span class="tag-pill ' + cls + '">' + icon + t + '</span>';
    }).join('');
  }

  function renderAssigneeStackCompact(assigneeIds, max) {
    max = max || 3;
    var data = getData();
    var assignees = [];
    (assigneeIds || []).forEach(function (id) {
      var m = data.team.find(function (x) { return x.id === id; });
      if (m) assignees.push(m);
    });
    if (assignees.length === 0) return '';
    var visible = assignees.slice(0, max);
    var extra = assignees.length - max;
    var html = '<div class="avatar-stack-compact">';
    visible.forEach(function (m) {
      var initials = getInitials(m.name);
      if (m.photo) {
        html += '<div class="avatar-compact" title="' + m.name + '"><img src="' + m.photo + '" alt=""></div>';
      } else {
        html += '<div class="avatar-compact" style="background:' + (m.color || 'var(--primary)') + ';" title="' + m.name + '">' + initials + '</div>';
      }
    });
    if (extra > 0) html += '<div class="avatar-compact" style="background:var(--bg-tertiary);color:var(--text-secondary);font-size:8px;border-color:var(--bg-elevated);">+' + extra + '</div>';
    html += '</div>';
    return html;
  }

  function renderSubtaskProgress(subtasks) {
    if (!subtasks || subtasks.length === 0) return '';
    var done = subtasks.filter(function (s) { return s.done; }).length;
    var total = subtasks.length;
    var cls = done === total ? 'complete' : '';
    return '<span class="progress-dot ' + cls + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg><span class="count-done">' + done + '</span>/<span class="count-total">' + total + '</span></span>';
  }

  function renderAttachmentCount(attachmentsStr) {
    if (!attachmentsStr || attachmentsStr === '[]') return '';
    try {
      var atts = JSON.parse(attachmentsStr);
      if (!atts || atts.length === 0) return '';
      return '<span class="progress-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>' + atts.length + '</span>';
    } catch (e) { return ''; }
  }

  function initTooltips() {
    var tooltipEls = document.querySelectorAll('[data-tooltip]');
    for (var i = 0; i < tooltipEls.length; i++) {
      if (!tooltipEls[i].getAttribute('data-tooltip-initialized')) {
        tooltipEls[i].setAttribute('data-tooltip-initialized', 'true');
      }
    }
  }

  var soundEnabled = localStorage.getItem('pm-sound-enabled') !== 'false';

  function playSound(type) {
    if (!soundEnabled) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.08;
      if (type === 'complete') {
        osc.frequency.value = 880;
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        setTimeout(function () {
          var o2 = ctx.createOscillator();
          var g2 = ctx.createGain();
          o2.connect(g2); g2.connect(ctx.destination);
          g2.gain.value = 0.06;
          o2.frequency.value = 1108;
          o2.start(ctx.currentTime);
          o2.stop(ctx.currentTime + 0.08);
          g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        }, 60);
      } else if (type === 'delete') {
        osc.frequency.value = 440;
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      } else if (type === 'success') {
        osc.frequency.value = 660;
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      } else {
        osc.frequency.value = 520;
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
      }
    } catch (e) {}
  }

  function triggerCelebration() {
    triggerConfetti();
    playSound('complete');
  }

  function optimisticCompleteTask(taskId) {
    var card = document.querySelector('.kanban-card[data-task-id="' + taskId + '"]');
    if (card) {
      card.classList.add('optimistic-done');
      var check = card.querySelector('.kanban-card-check');
      if (check) check.classList.add('optimistic-check');
    }
    var item = document.querySelector('.task-item[data-task-id="' + taskId + '"]');
    if (item) {
      item.classList.add('optimistic-done');
      var cb = item.querySelector('.task-checkbox');
      if (cb) cb.classList.add('optimistic-check');
    }
  }

  function setButtonLoading(btn, loading) {
    btn.classList.toggle('btn-loading', loading);
    btn.disabled = loading;
  }

  function validateInput(input, rules) {
    rules = rules || {};
    const value = input.value.trim();
    let isValid = true;
    let message = '';
    input.classList.remove('valid', 'error', 'warning');
    const hint = input.parentElement?.querySelector('.input-hint');
    if (hint) hint.remove();
    if (rules.required && !value) { isValid = false; message = rules.requiredMessage || 'This field is required'; }
    if (rules.minLength && value.length < rules.minLength) { isValid = false; message = rules.minLengthMessage || 'Must be at least ' + rules.minLength + ' characters'; }
    if (!isValid) {
      input.classList.add('error');
      if (message) {
        const hintEl = document.createElement('div');
        hintEl.className = 'input-hint error';
        hintEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>' + message;
        input.parentElement?.appendChild(hintEl);
      }
    } else if (value && (rules.required || rules.minLength)) {
      input.classList.add('valid');
    }
    return isValid;
  }

  function showSkeleton(container, count, type) {
    count = count || 3;
    type = type || 'card';
    const skeletons = [];
    for (let i = 0; i < count; i++) {
      const skel = document.createElement('div');
      skel.className = 'skeleton skeleton-' + type;
      container.appendChild(skel);
      skeletons.push(skel);
    }
    return skeletons;
  }

  function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'g') { window._gKeyPending = true; setTimeout(() => { window._gKeyPending = false; }, 1000); }
      else if (window._gKeyPending) {
        if (e.key === 'd') { e.preventDefault(); navigateTo('dashboard'); }
        if (e.key === 'p') { e.preventDefault(); navigateTo('projects'); }
        if (e.key === 'c') { e.preventDefault(); navigateTo('calendar'); }
        if (e.key === 'o') { e.preventDefault(); navigateTo('goals'); }
        window._gKeyPending = false;
      }
      if (e.key === 't' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); navigateTo('tasks'); }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        var activePage = document.querySelector('.page.active');
        var searchInput = activePage?.querySelector('.task-search-input, .filter-search');
        if (searchInput) { searchInput.focus(); searchInput.select(); }
        else { document.getElementById('command-palette')?.classList.add('active'); setTimeout(function () { document.querySelector('.command-palette-input')?.focus(); }, 50); }
      }
    });
  }

  function initResizeHandler() {
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const sidebar = document.getElementById('sidebar');
        if (window.innerWidth <= 768) { sidebar?.classList.remove('mobile-open'); document.body.classList.remove('sidebar-open'); }
      }, 150);
    });
  }

  function initScrollAnimations() {
    if (typeof IntersectionObserver === 'undefined') return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    function watch(el) {
      if (!el) return;
      if (el.matches && (el.matches('.anim-fade-up') || el.matches('.anim-fade-in') || el.matches('.anim-stagger'))) {
        observer.observe(el);
      }
      el.querySelectorAll('.anim-fade-up, .anim-fade-in, .anim-stagger').forEach(function (child) {
        observer.observe(child);
      });
    }
    var contentArea = document.querySelector('.page-content');
    if (contentArea) {
      var mutationObs = new MutationObserver(function () {
        watch(contentArea);
      });
      mutationObs.observe(contentArea, { childList: true, subtree: true });
    }
  }

    document.addEventListener('DOMContentLoaded', function () {
    function showAuth(id) {
      const views = ['auth-loading','auth-login','auth-signup','auth-forgot','auth-verify'];
      const currentView = views.find(v => {
        const el = document.getElementById(v);
        return el && el.style.display !== 'none';
      });

      if (currentView === id) return;

      const newEl = document.getElementById(id);
      const oldEl = currentView ? document.getElementById(currentView) : null;

      if (oldEl && newEl) {
        const isForward = (views.indexOf(id) > views.indexOf(currentView));
        oldEl.classList.add(isForward ? 'exiting-left' : 'exiting-right');
        
        // Orchestrate disappearance of children
        const children = oldEl.querySelectorAll('.onboarding-title, .onboarding-subtitle, .onboarding-step, .onboarding-btn');
        children.forEach((child, i) => {
          child.style.transition = 'all 0.4s var(--ease-out-expo)';
          child.style.opacity = '0';
          child.style.transform = 'translateY(-10px)';
          child.style.filter = 'blur(4px)';
        });

        const onEnd = () => {
          oldEl.style.display = 'none';
          oldEl.classList.remove('exiting-left', 'exiting-right');
          oldEl.removeEventListener('animationend', onEnd);
          
          newEl.style.display = '';
          newEl.style.animation = 'none';
          
          // Reset new children styles
          const newChildren = newEl.querySelectorAll('.onboarding-title, .onboarding-subtitle, .onboarding-step, .onboarding-btn');
          newChildren.forEach(child => {
            child.style.opacity = '';
            child.style.transform = '';
            child.style.filter = '';
            child.style.transition = '';
          });

          newEl.offsetHeight;
          newEl.style.animation = (isForward ? 'slideLeftIn' : 'slideRightIn') + ' 0.7s var(--ease-out-expo) both';
        };
        oldEl.addEventListener('animationend', onEnd);
        setTimeout(onEnd, 450);
      } else if (newEl) {
        views.forEach(v => {
          const el = document.getElementById(v);
          if (el) el.style.display = 'none';
        });
        newEl.style.display = '';
      }
    }

    function showAuthError(id, msg) {
      var el = document.getElementById(id);
      if (el) { el.style.display = ''; el.textContent = msg; }
    }

    function maybeShowSetupGuide() {
      var guide = document.getElementById('setup-guide');
      if (!guide || !state.user) return;
      if (state.projects.length > 0) return;
      var skipKey = 'pm-setup-skipped-' + state.user.id;
      if (localStorage.getItem(skipKey)) return;
      var firstName = (state.user.name || state.user.username || '').split(' ')[0];
      var title = document.getElementById('setup-guide-title');
      if (title && firstName) title.textContent = 'Welcome, ' + firstName;
      guide.style.display = '';
      requestAnimationFrame(function () { guide.classList.add('visible'); });
      document.getElementById('setup-create-project')?.addEventListener('click', function () {
        guide.classList.remove('visible');
        setTimeout(function () { guide.style.display = 'none'; }, 350);
        localStorage.removeItem(skipKey);
        openProjectDrawerCreate();
      });
      document.getElementById('setup-skip')?.addEventListener('click', function () {
        guide.classList.remove('visible');
        setTimeout(function () { guide.style.display = 'none'; }, 350);
        localStorage.setItem(skipKey, '1');
      });
    }

    function hideAuthError(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }

    function setAuthLoading(btnId, loading) {
      var btn = document.getElementById(btnId);
      if (btn) { btn.disabled = loading; btn.textContent = loading ? 'Please wait...' : btn.dataset.originalText || btn.textContent; }
    }

    function initPremiumInteractions() {
      // ponytail: magnetic-hover mousemove removed — getBoundingClientRect on every
      // card per mousemove frame = layout thrash. Re-add behind pointer:fine only if missed.
      document.addEventListener('mousedown', function(e) {
        var target = e.target.closest('.btn, .onboarding-btn');
        if (!target) return;
        var ripple = document.createElement('span');
        ripple.className = 'ripple-effect';
        ripple.style.left = (e.offsetX) + 'px';
        ripple.style.top = (e.offsetY) + 'px';
        target.appendChild(ripple);
        setTimeout(function() { ripple.remove(); }, 600);
      });
    }

    function initSSE() {
      var token = API.getToken();
      var url = '/api/events/subscribe';
      if (token) url += '?token=' + encodeURIComponent(token);
      var es = new EventSource(url);
      es.onmessage = function (e) {
        try {
          var data = JSON.parse(e.data);
          if (data.type !== 'connected') {
            setTimeout(function () { loadAllData().then(function () { refreshCurrentView(); }); }, 300);
          }
        } catch (err) {}
      };
      es.onerror = function () { setTimeout(initSSE, 5000); };
    }

    function initNotificationsFromAPI() {
      API.get('/notifications').then(function (notifs) {
        state.notifications = notifs || [];
        updateNotificationBadge();
        renderNotificationDropdown();
      }).catch(function () {});
    }

    var goalsState = { date: '', items: [], filter: 'all' };

    function goalsKey() {
      var u = getData().user;
      return 'pm-goals-' + ((u && (u.id || u.email)) || 'anon');
    }

    function todayKey() {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function shiftDate(dateStr, days) {
      var d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + days);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function dateLabel(dateStr) {
      var d = new Date(dateStr + 'T00:00:00');
      var label = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
      if (dateStr === todayKey()) return 'Today, ' + d.toLocaleDateString([], { month: 'long', day: 'numeric' });
      if (dateStr === shiftDate(todayKey(), -1)) return 'Yesterday, ' + d.toLocaleDateString([], { month: 'long', day: 'numeric' });
      return label;
    }

    function getGoalsMap() {
      try { return JSON.parse(localStorage.getItem(goalsKey()) || 'null') || {}; } catch (e) { return {}; }
    }

    function saveGoalsMap(map) {
      try { localStorage.setItem(goalsKey(), JSON.stringify(map)); } catch (e) {}
    }

    function normalizeGoalItems(items) {
      if (!Array.isArray(items)) return [];
      return items.filter(function (g) { return g && typeof g === 'object'; }).map(function (g) {
        return {
          id: String(g.id || 'g' + Date.now() + Math.random().toString(36).slice(2, 7)),
          text: typeof g.text === 'string' ? g.text : '',
          done: !!g.done,
          carried: !!g.carried
        };
      });
    }

    function migrateGoalsMap(map) {
      if (!map || typeof map !== 'object' || Array.isArray(map)) return (map && typeof map === 'object') ? map : {};
      if (map.date && !map[todayKey()] && !map[map.date]) {
        var legacy = {};
        legacy[map.date] = Array.isArray(map.items) ? map.items : [];
        return legacy;
      }
      return map;
    }

    function prevDayWithItems(map, date) {
      var keys = Object.keys(map).filter(function (d) { return d < date; }).sort();
      return keys.length ? keys[keys.length - 1] : null;
    }

    function ensureDay(date) {
      var map = migrateGoalsMap(getGoalsMap());
      if (!map[date]) {
        var prev = prevDayWithItems(map, date);
        var carried = prev
          ? normalizeGoalItems(map[prev]).filter(function (g) { return !g.done; }).map(function (g) { return { id: g.id, text: g.text, done: false, carried: true }; })
          : [];
        map[date] = carried;
        saveGoalsMap(map);
      }
      return normalizeGoalItems(map[date]);
    }

    function loadGoals(date) {
      goalsState.date = date || todayKey();
      goalsState.items = ensureDay(goalsState.date);
      return goalsState;
    }

    function saveGoals() {
      var map = migrateGoalsMap(getGoalsMap());
      map[goalsState.date] = goalsState.items;
      saveGoalsMap(map);
    }

    function goalsCounts() {
      var total = goalsState.items.length;
      var done = goalsState.items.filter(function (g) { return g.done; }).length;
      return { total: total, done: done, open: total - done, pct: total ? Math.round(done / total * 100) : 0 };
    }

    function goalsStreak() {
      var map = migrateGoalsMap(getGoalsMap());
      var streak = 0;
      var d = todayKey();
      if (!Array.isArray(map[d]) || !map[d].some(function (g) { return g.done; })) d = shiftDate(d, -1);
      while (Array.isArray(map[d]) && map[d].some(function (g) { return g.done; })) { streak++; d = shiftDate(d, -1); }
      return streak;
    }

    function updateGoalsBadge() {
      var badge = document.getElementById('goals-badge');
      var side = document.getElementById('sidebar-goal-count');
      var open = goalsCounts().open;
      if (badge) { if (open > 0) { badge.textContent = open; badge.style.display = ''; } else { badge.style.display = 'none'; } }
      if (side) side.textContent = open > 0 ? open : '';
    }

    function goalsItemHtml(g, showCarried) {
      return '<li class="goals-item' + (g.done ? ' done' : '') + '" data-id="' + g.id + '" draggable="true">' +
        '<span class="goals-grip" aria-hidden="true"><svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.5"/><circle cx="7.5" cy="2.5" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13.5" r="1.5"/><circle cx="7.5" cy="13.5" r="1.5"/></svg></span>' +
        '<button class="goals-check" data-id="' + g.id + '" aria-label="' + (g.done ? 'Mark as not done' : 'Mark as done') + '">' +
        (g.done ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '') +
        '</button>' +
        '<span class="goals-text" title="Double-click to edit">' + escapeHtml(g.text) +
        (showCarried && g.carried ? '<span class="goals-carried">carried over</span>' : '') +
        '</span>' +
        '<span class="goals-move"><button class="goals-up" data-id="' + g.id + '" aria-label="Move up"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button>' +
        '<button class="goals-down" data-id="' + g.id + '" aria-label="Move down"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button></span>' +
        '<button class="goals-edit" data-id="' + g.id + '" aria-label="Edit goal"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>' +
        '<button class="goals-delete" data-id="' + g.id + '" aria-label="Delete goal">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
        '</button>' +
        '</li>';
    }

    function renderGoals() {
      var list = document.getElementById('goals-list');
      var empty = document.getElementById('goals-empty');
      var countEl = document.getElementById('goals-progress-count');
      var pctEl = document.getElementById('goals-progress-pct');
      var ring = document.getElementById('goals-ring-fill');
      var c = goalsCounts();
      if (countEl) countEl.textContent = c.done + ' / ' + c.total;
      if (pctEl) pctEl.textContent = c.pct + '%';
      var circ = 2 * Math.PI * 38;
      if (ring) {
        ring.style.strokeDasharray = circ;
        ring.style.strokeDashoffset = circ - (c.pct / 100) * circ;
      }
      if (list) list.innerHTML = goalsState.items.map(function (g) { return goalsItemHtml(g, false); }).join('');
      if (empty) empty.hidden = c.total > 0;
      updateGoalsBadge();
    }

    function renderGoalsPage() {
      try {
        renderGoalsPageInner();
      } catch (err) {
        console.warn('renderGoalsPage failed:', err);
        var area = document.getElementById('goals-page-content');
        if (area) area.innerHTML = '<div class="goals-page-empty">' + renderEmptyState('Goals are taking a moment', 'Something went wrong loading your goals. Please try again.', null, '', 'target') + '</div>';
        completeLoadingBar();
        updateGoalsBadge();
      }
    }

    goalsPageRenderer = renderGoalsPage;

    function renderGoalsPageInner() {
      var area = document.getElementById('goals-page-content');
      if (!area) return;
      loadGoals(goalsState.date || todayKey());
      var c = goalsCounts();
      var streak = goalsStreak();
      var carriedCount = goalsState.items.filter(function (g) { return g.carried; }).length;
      var circ = 2 * Math.PI * 52;
      var nextBtn = document.getElementById('goals-next-day');
      if (nextBtn) nextBtn.disabled = goalsState.date >= todayKey();
      var todayBtn = document.getElementById('goals-today-btn');
      if (todayBtn) todayBtn.classList.toggle('active', goalsState.date === todayKey());

      var items = goalsState.items;
      if (goalsState.filter === 'open') items = items.filter(function (g) { return !g.done; });
      if (goalsState.filter === 'done') items = items.filter(function (g) { return g.done; });

      var hero =
        '<div class="goals-hero">' +
          '<div class="goals-hero-ring-wrap">' +
            '<svg class="goals-hero-ring" width="120" height="120" viewBox="0 0 120 120">' +
              '<circle class="goals-ring-track" cx="60" cy="60" r="52" fill="none" stroke-width="8"/>' +
              '<circle class="goals-hero-ring-fill" id="goals-hero-ring-fill" cx="60" cy="60" r="52" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + circ + '" stroke-dashoffset="' + circ + '"/>' +
            '</svg>' +
            '<div class="goals-hero-ring-label"><span class="goals-hero-pct" id="goals-hero-pct">' + c.pct + '%</span><span class="goals-hero-done-label">done</span></div>' +
          '</div>' +
          '<div class="goals-hero-info">' +
            '<div class="goals-hero-date" id="goals-hero-date">' + dateLabel(goalsState.date) + '</div>' +
            '<div class="goals-hero-stats">' +
              '<div class="goals-hero-stat"><span id="goals-hero-done">' + c.done + '</span><label>done</label></div>' +
              '<div class="goals-hero-stat"><span id="goals-hero-open">' + c.open + '</span><label>open</label></div>' +
              '<div class="goals-hero-stat"><span id="goals-hero-streak">' + streak + '</span><label>day streak</label></div>' +
            '</div>' +
            '<div class="goals-hero-note" id="goals-hero-note">' +
              (carriedCount > 0 && goalsState.date === todayKey() ? '<span class="goals-hero-chip">' + carriedCount + ' carried over from yesterday</span>' : '') +
              (c.total > 0 && c.done === c.total ? '<span class="goals-hero-chip goals-hero-chip-done">All goals complete</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>';

      var filter =
        '<div class="goals-page-filter">' +
          '<button class="goals-filter-chip' + (goalsState.filter === 'all' ? ' active' : '') + '" data-filter="all">All</button>' +
          '<button class="goals-filter-chip' + (goalsState.filter === 'open' ? ' active' : '') + '" data-filter="open">Open</button>' +
          '<button class="goals-filter-chip' + (goalsState.filter === 'done' ? ' active' : '') + '" data-filter="done">Done</button>' +
        '</div>';

      var addRow =
        '<form class="goals-add goals-page-add" id="goals-page-add-form">' +
          '<input type="text" class="goals-add-input" id="goals-page-add-input" placeholder="' + (goalsState.date === todayKey() ? 'Add a goal for today...' : 'Add a goal for this day...') + '" maxlength="200" autocomplete="off" spellcheck="false">' +
          '<button type="submit" class="btn btn-primary goals-add-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Add</button>' +
        '</form>';

      var listHtml =
        '<ul class="goals-list goals-page-list" id="goals-page-list">' +
        items.map(function (g) { return goalsItemHtml(g, true); }).join('') +
        '</ul>';

      var emptyHtml = '';
      if (goalsState.items.length === 0) {
        var isToday = goalsState.date === todayKey();
        emptyHtml = renderEmptyState(
          isToday ? 'No goals for today yet' : 'Nothing planned for this day',
          isToday ? 'Set a few intentions and check them off as the day unfolds.' : 'This day is a clean slate. Add a goal to change that.',
          isToday ? 'Add a goal' : null,
          'goals-empty-add',
          'target'
        );
      } else if (items.length === 0) {
        emptyHtml = renderEmptyState(
          'No ' + (goalsState.filter === 'done' ? 'completed' : 'open') + ' goals',
          'Try a different filter to see the rest of your list.',
          null,
          '',
          'search'
        );
      }

      area.innerHTML = hero + filter + addRow + listHtml + (emptyHtml ? '<div class="goals-page-empty">' + emptyHtml + '</div>' : '');

      document.getElementById('goals-empty-add')?.addEventListener('click', function () {
        var input = document.getElementById('goals-page-add-input');
        if (input) input.focus();
      });

      var ring = document.getElementById('goals-hero-ring-fill');
      if (ring) {
        requestAnimationFrame(function () {
          ring.style.strokeDasharray = circ;
          ring.style.strokeDashoffset = circ - (c.pct / 100) * circ;
        });
      }
      updateGoalsBadge();
    }

    function goalsStartEdit(id) {
      var li = document.querySelector('.goals-item[data-id="' + id + '"]');
      if (!li) return;
      var textEl = li.querySelector('.goals-text');
      if (!textEl || li.querySelector('.goals-edit-input')) return;
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'goals-edit-input';
      input.value = textEl.textContent.replace(/carried over/g, '').trim();
      input.maxLength = 200;
      textEl.replaceWith(input);
      input.focus();
      input.select();
      function commit(save) {
        var val = save ? input.value.trim() : null;
        if (val) {
          var item = goalsState.items.find(function (g) { return String(g.id) === id; });
          if (item) { item.text = val; delete item.carried; saveGoals(); }
        }
        if (document.querySelector('.page.active')?.id === 'page-goals') renderGoalsPage();
        else renderGoals();
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { commit(true); }
        else if (e.key === 'Escape') { commit(false); }
      });
      input.addEventListener('blur', function () { commit(true); });
    }

    function goalsMove(id, dir) {
      var idx = goalsState.items.findIndex(function (g) { return String(g.id) === id; });
      var target = idx + dir;
      if (idx < 0 || target < 0 || target >= goalsState.items.length) return;
      var tmp = goalsState.items[idx];
      goalsState.items[idx] = goalsState.items[target];
      goalsState.items[target] = tmp;
      saveGoals();
      if (document.querySelector('.page.active')?.id === 'page-goals') renderGoalsPage();
      else renderGoals();
    }

    function goalsReorder(fromId, toId) {
      var from = goalsState.items.findIndex(function (g) { return String(g.id) === fromId; });
      var to = goalsState.items.findIndex(function (g) { return String(g.id) === toId; });
      if (from < 0 || to < 0 || from === to) return;
      var item = goalsState.items.splice(from, 1)[0];
      goalsState.items.splice(to, 0, item);
      saveGoals();
      renderGoalsPage();
    }

    function openDailyGoals() {
      var overlay = document.getElementById('goals-overlay');
      if (!overlay) return;
      loadGoals(todayKey());
      var dateEl = document.getElementById('goals-date');
      if (dateEl) dateEl.textContent = dateLabel(todayKey());
      renderGoals();
      overlay.style.display = 'flex';
      requestAnimationFrame(function () { overlay.classList.add('active'); });
      setTimeout(function () {
        var input = document.getElementById('goals-add-input');
        if (input) input.focus();
      }, 120);
    }

    function closeDailyGoals() {
      var overlay = document.getElementById('goals-overlay');
      if (!overlay || !overlay.classList.contains('active')) return;
      overlay.classList.remove('active');
      setTimeout(function () { overlay.style.display = 'none'; }, 260);
    }

    function initDailyGoals() {
      document.getElementById('goals-btn')?.addEventListener('click', function () { openDailyGoals(); });
      document.getElementById('goals-close')?.addEventListener('click', closeDailyGoals);
      document.getElementById('goals-done')?.addEventListener('click', closeDailyGoals);
      document.getElementById('goals-backdrop')?.addEventListener('click', closeDailyGoals);
      document.getElementById('goals-add-form')?.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = document.getElementById('goals-add-input');
        var text = input ? input.value.trim() : '';
        if (!text) return;
        goalsState.items.push({ id: 'g' + Date.now() + Math.random().toString(36).slice(2, 7), text: text, done: false });
        saveGoals();
        renderGoals();
        if (input) input.value = '';
        input && input.focus();
        updateGoalsBadge();
      });
      document.getElementById('goals-list')?.addEventListener('click', function (e) {
        var check = e.target.closest('.goals-check');
        var del = e.target.closest('.goals-delete');
        if (check) {
          var item = goalsState.items.find(function (g) { return String(g.id) === check.dataset.id; });
          if (item) {
            item.done = !item.done;
            if (item.done) playSound('complete');
            saveGoals();
            renderGoals();
            if (goalsState.items.length > 0 && goalsState.items.every(function (g) { return g.done; })) showToast('All goals complete', 'success');
          }
        } else if (del) {
          goalsState.items = goalsState.items.filter(function (g) { return String(g.id) !== del.dataset.id; });
          saveGoals();
          renderGoals();
        }
      });

      document.getElementById('goals-page-open-overlay')?.addEventListener('click', function () {
        var input = document.getElementById('goals-page-add-input');
        if (input) input.focus();
        else openDailyGoals();
      });
      document.getElementById('goals-prev-day')?.addEventListener('click', function () {
        goalsState.date = shiftDate(goalsState.date || todayKey(), -1);
        renderGoalsPage();
      });
      document.getElementById('goals-next-day')?.addEventListener('click', function () {
        if (goalsState.date >= todayKey()) return;
        goalsState.date = shiftDate(goalsState.date || todayKey(), 1);
        renderGoalsPage();
      });
      document.getElementById('goals-today-btn')?.addEventListener('click', function () {
        goalsState.date = todayKey();
        renderGoalsPage();
      });

      document.addEventListener('submit', function (e) {
        if (e.target && e.target.id === 'goals-page-add-form') {
          e.preventDefault();
          var input = document.getElementById('goals-page-add-input');
          var text = input ? input.value.trim() : '';
          if (!text) return;
          goalsState.items.push({ id: 'g' + Date.now() + Math.random().toString(36).slice(2, 7), text: text, done: false });
          saveGoals();
          renderGoalsPage();
          if (input) input.value = '';
          input && input.focus();
        }
      });

      document.addEventListener('click', function (e) {
        var chip = e.target.closest('.goals-filter-chip');
        if (chip) {
          goalsState.filter = chip.dataset.filter;
          renderGoalsPage();
          return;
        }
        var editBtn = e.target.closest('.goals-edit');
        if (editBtn) { goalsStartEdit(editBtn.dataset.id); return; }
        var up = e.target.closest('.goals-up');
        if (up) { goalsMove(up.dataset.id, -1); return; }
        var down = e.target.closest('.goals-down');
        if (down) { goalsMove(down.dataset.id, 1); return; }
      });

      document.addEventListener('click', function (e) {
        var pageList = document.getElementById('goals-page-list');
        if (!pageList || !pageList.contains(e.target)) return;
        var check = e.target.closest('.goals-check');
        var del = e.target.closest('.goals-delete');
        if (check) {
          var item = goalsState.items.find(function (g) { return String(g.id) === check.dataset.id; });
          if (item) {
            item.done = !item.done;
            if (item.done) playSound('complete');
            saveGoals();
            renderGoalsPage();
            if (goalsState.items.length > 0 && goalsState.items.every(function (g) { return g.done; })) showToast('All goals complete', 'success');
          }
        } else if (del) {
          goalsState.items = goalsState.items.filter(function (g) { return String(g.id) !== del.dataset.id; });
          saveGoals();
          renderGoalsPage();
        }
      });
      document.addEventListener('dblclick', function (e) {
        var text = e.target.closest('.goals-text');
        if (text && text.closest('#goals-page-list')) goalsStartEdit(text.closest('.goals-item').dataset.id);
      });

      var dragId = null;
      document.addEventListener('dragstart', function (e) {
        var item = e.target.closest('.goals-item');
        if (item) { dragId = item.dataset.id; item.classList.add('goals-dragging'); }
      });
      document.addEventListener('dragend', function (e) {
        var item = e.target.closest('.goals-item');
        if (item) item.classList.remove('goals-dragging');
      });
      document.addEventListener('dragover', function (e) {
        var item = e.target.closest('.goals-item');
        if (item && dragId && item.dataset.id !== dragId) { e.preventDefault(); item.classList.add('goals-drag-over'); }
      });
      document.addEventListener('dragleave', function (e) {
        var item = e.target.closest('.goals-item');
        if (item) item.classList.remove('goals-drag-over');
      });
      document.addEventListener('drop', function (e) {
        var item = e.target.closest('.goals-item');
        if (item && dragId && item.dataset.id !== dragId) {
          e.preventDefault();
          goalsReorder(dragId, item.dataset.id);
        }
        dragId = null;
      });

      document.addEventListener('keydown', function (e) {
        var overlay = document.getElementById('goals-overlay');
        if (e.key === 'Escape' && overlay && overlay.classList.contains('active')) closeDailyGoals();
      });
      var seen = localStorage.getItem('pm-goals-last-seen');
      var today = todayKey();
      if (seen !== today) {
        localStorage.setItem('pm-goals-last-seen', today);
        try { openDailyGoals(); } catch (err) { console.warn('openDailyGoals failed:', err); }
      }
    }

    function bootApp() {
      initNavigation();
      initSidebar();
      initDarkMode();
      initCommandPalette();
      initTaskDrawer();
      initFAB();
      initNewProjectButtons();
      initBackButton();
      initSettings();
      initProfilePicture();
      initKeyboardShortcuts();
      initResizeHandler();
      initScrollAnimations();
      initPremiumInteractions();
      initTooltips();
      initDailyGoals();
      initSSE();
      initNotificationsFromAPI();
      document.getElementById('notifications-btn')?.addEventListener('click', function (e) { e.stopPropagation(); toggleNotificationDropdown(); });
      document.getElementById('mark-all-read')?.addEventListener('click', function (e) {
        e.stopPropagation();
        var notifs = getNotifications();
        localStorage.setItem('pm-read-notifs', JSON.stringify(notifs.map(function (n) { return n.id; })));
        renderNotificationDropdown();
        updateNotificationBadge();
      });
      var tasksSearchInput = document.getElementById('tasks-search');
      var tasksSearchTerm = '';
      var tasksFilterDebounced = debounce(function () { filterTasksUI(tasksSearchTerm); }, 80);
       tasksSearchInput?.addEventListener('input', function () {
         var val = this.value.toLowerCase();
         if (val === tasksSearchTerm) return;
         tasksSearchTerm = val;
         tasksFilterDebounced();
         updateTaskFilterReset();
       });
       document.getElementById('tasks-sort')?.addEventListener('change', function () {
         saveTaskViewPreferences(document.querySelector('#tasks-filter-bar .filter-chip.active')?.dataset.filter || 'all', this.value);
         renderTasks();
         if (tasksSearchTerm) setTimeout(function () { filterTasksUI(tasksSearchTerm); }, 0);
         updateTaskFilterReset();
       });
       document.querySelectorAll('#tasks-filter-bar .filter-chip').forEach(function (chip) {
         chip.addEventListener('click', function () {
           document.querySelectorAll('#tasks-filter-bar .filter-chip').forEach(function (c) { c.classList.remove('active'); });
           chip.classList.add('active');
           saveTaskViewPreferences(chip.dataset.filter, document.getElementById('tasks-sort')?.value || 'due-asc');
           renderTasks();
           if (tasksSearchTerm) filterTasksUI(tasksSearchTerm);
           updateTaskFilterReset();
         });
       });
       document.getElementById('tasks-reset-filters')?.addEventListener('click', function () {
         if (tasksSearchInput) tasksSearchInput.value = '';
         tasksSearchTerm = '';
         document.querySelectorAll('#tasks-filter-bar .filter-chip').forEach(function (chip) { chip.classList.toggle('active', chip.dataset.filter === 'all'); });
         var sort = document.getElementById('tasks-sort');
         if (sort) sort.value = 'due-asc';
         saveTaskViewPreferences('all', 'due-asc');
         renderTasks();
         updateTaskFilterReset();
       });
      document.getElementById('gantt-btn')?.addEventListener('click', function () { openGanttView(currentProjectId); });
    document.getElementById('auto-prioritize-btn')?.addEventListener('click', function () { autoPrioritizeTasks(); });
    document.getElementById('auto-schedule-btn')?.addEventListener('click', function () { autoScheduleTasks(); });
      var projectsSearchInput = document.getElementById('projects-search');
      var projectsSearchTerm = '';
      var projectsFilterDebounced = debounce(function () { filterProjectsUI(projectsSearchTerm); }, 80);
      projectsSearchInput?.addEventListener('input', function () {
        var val = this.value.toLowerCase();
         if (val === projectsSearchTerm) return;
         projectsSearchTerm = val;
         projectsFilterDebounced();
         updateProjectsFilterReset();
       });
       document.getElementById('projects-reset-search')?.addEventListener('click', function () {
         if (projectsSearchInput) projectsSearchInput.value = '';
         projectsSearchTerm = '';
         filterProjectsUI('');
         updateProjectsFilterReset();
       });
      document.getElementById('user-menu-trigger')?.addEventListener('click', function (e) { e.stopPropagation(); toggleUserMenu(); });
      document.getElementById('workspace-switcher')?.addEventListener('click', function (e) { e.stopPropagation(); toggleWorkspaceDropdown(); });
       document.querySelector('.sidebar-kbd-hint')?.addEventListener('click', function () {
         document.getElementById('cmdk-trigger')?.click();
       });

       restoreTaskViewPreferences();
       updateTaskFilterReset();
       updateProjectsFilterReset();
       if (state.user) {
        updateUserInfo();
        updateProjectCount();
        updateCommandPaletteProjects();
        var lastPage = localStorage.getItem('pm-last-page');
        if (lastPage === 'project-detail') {
          navigateTo('project-detail', localStorage.getItem('pm-last-project') || state.projects[0]?.id);
        } else if (lastPage) {
          navigateTo(lastPage);
        } else {
          navigateTo('dashboard');
        }
      }

      maybeShowSetupGuide();
    }

    var onboarding = document.getElementById('onboarding');
    if (Auth.isAuthenticated()) {
      showAuth('auth-loading');
      var minSignInTime = new Promise(function (resolve) { setTimeout(resolve, 2000); });
      loadAllData().then(function () {
        return minSignInTime;
      }).then(function () {
        onboarding?.classList.add('hidden');
        bootApp();
      }).catch(function () {
        showAuth('auth-login');
      });
    } else {
      showAuth('auth-login');
    }

    document.getElementById('auth-show-signup')?.addEventListener('click', function (e) { e.preventDefault(); showAuth('auth-signup'); });
    document.getElementById('auth-show-login-from-signup')?.addEventListener('click', function (e) { e.preventDefault(); showAuth('auth-login'); });
    document.getElementById('auth-show-forgot')?.addEventListener('click', function (e) { e.preventDefault(); showAuth('auth-forgot'); });
    document.getElementById('auth-show-login-from-forgot')?.addEventListener('click', function (e) { e.preventDefault(); showAuth('auth-login'); });
    document.getElementById('auth-show-login-from-verify')?.addEventListener('click', function (e) { e.preventDefault(); showAuth('auth-login'); });

    document.querySelectorAll('.password-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = this.dataset.target;
        var input = document.getElementById(id);
        if (!input) return;
        var isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        this.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
        this.innerHTML = isHidden
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      });
    });

    document.getElementById('login-submit')?.addEventListener('click', function () {
      var username = document.getElementById('login-username')?.value?.trim();
      var password = document.getElementById('login-password')?.value;
      var rememberMe = document.getElementById('login-remember')?.checked !== false;
      if (!username || !password) { showAuthError('login-error', 'Please enter your username and password.'); return; }
      hideAuthError('login-error');
      setAuthLoading('login-submit', true);
      Auth.login(username, password, rememberMe).then(function () {
        showAuth('auth-loading');
        loadAllData().then(function () {
          onboarding?.classList.add('hidden');
          bootApp();
        });
      }).catch(function (err) {
        showAuthError('login-error', err.body?.error || err.message || 'Sign in failed.');
        setAuthLoading('login-submit', false);
      });
    });

    document.getElementById('login-password')?.addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('login-submit')?.click(); });

    document.getElementById('signup-submit')?.addEventListener('click', function () {
      var username = document.getElementById('signup-username')?.value?.trim();
      var name = document.getElementById('signup-name')?.value?.trim();
      var password = document.getElementById('signup-password')?.value;
      if (!username || !password) { showAuthError('signup-error', 'Please enter a username and password.'); return; }
      if (username.length < 3) { showAuthError('signup-error', 'Username must be at least 3 characters.'); return; }
      if (!/^[a-zA-Z0-9_.-]+$/.test(username)) { showAuthError('signup-error', 'Username can only contain letters, numbers, dots, dashes, and underscores.'); return; }
      if (password.length < 8) { showAuthError('signup-error', 'Password must be at least 8 characters.'); return; }
      hideAuthError('signup-error');
      setAuthLoading('signup-submit', true);
      Auth.signup(username, password, name).then(function () {
        Auth.login(username, password, true).then(function () {
          showAuth('auth-loading');
          loadAllData().then(function () {
            onboarding?.classList.add('hidden');
            bootApp();
          });
        }).catch(function () {
          setAuthLoading('signup-submit', false);
          showAuth('auth-login');
        });
      }).catch(function (err) {
        showAuthError('signup-error', err.body?.error || err.message || 'Sign up failed.');
        setAuthLoading('signup-submit', false);
      });
    });

    document.getElementById('signup-password')?.addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('signup-submit')?.click(); });

    document.getElementById('forgot-submit')?.addEventListener('click', function () {
      var email = document.getElementById('forgot-email')?.value?.trim();
      if (!email) { showAuthError('forgot-error', 'Please enter your email.'); return; }
      hideAuthError('forgot-error');
      document.getElementById('forgot-success').style.display = 'none';
      setAuthLoading('forgot-submit', true);
      Auth.forgotPassword(email).then(function () {
        setAuthLoading('forgot-submit', false);
        document.getElementById('forgot-success').textContent = 'If that email is registered, a reset link has been sent.';
        document.getElementById('forgot-success').style.display = '';
      }).catch(function (err) {
        showAuthError('forgot-error', err.body?.error || err.message || 'Request failed.');
        setAuthLoading('forgot-submit', false);
      });
    });

    document.getElementById('forgot-email')?.addEventListener('keydown', function (e) { if (e.key === 'Enter') document.getElementById('forgot-submit')?.click(); });
  });
})();

