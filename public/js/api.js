var API_BASE = (function () {
  var server = localStorage.getItem('pm-server') || '';
  return server.replace(/\/+$/, '') + '/api';
})();

var authToken = sessionStorage.getItem('pm-token') || localStorage.getItem('pm-token');
var tokenStorage = localStorage.getItem('pm-token') ? 'local' : (sessionStorage.getItem('pm-token') ? 'session' : null);

var pending = {};
var useMock = localStorage.getItem('pm-use-mock') === 'true';

function camelize(str) {
  return str.replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); });
}

function camelizeKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(camelizeKeys);
  }
  if (obj !== null && typeof obj === 'object') {
    var result = {};
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[camelize(key)] = camelizeKeys(obj[key]);
      }
    }
    return result;
  }
  return obj;
}

// ── Client-Side Mock Database ──
function mockFetch(path, options) {
  return new Promise(function (resolve, reject) {
    var body = null;
    if (options.body) {
      try { body = JSON.parse(options.body); } catch (e) {}
    }
    var method = options.method || 'GET';
    var parts = path.split('/').filter(Boolean);
    var userId = "mock-user-1";

    function getStore(key, defaults) {
      var val = localStorage.getItem('mock-db-' + key);
      return val ? JSON.parse(val) : (defaults || []);
    }

    function setStore(key, val) {
      localStorage.setItem('mock-db-' + key, JSON.stringify(val));
    }

    // Auth
    if (parts[0] === 'auth') {
      if (parts[1] === 'me') {
        return resolve({ id: userId, name: "User", email: "user@email.com", photoUrl: null });
      }
      if (parts[1] === 'login') {
        return resolve({ token: "mock-token-xyz" });
      }
      if (parts[1] === 'signup') {
        return resolve({ message: "Account created. Welcome!", userId: userId });
      }
    }

    // Projects
    if (parts[0] === 'projects') {
      var projects = getStore('projects', []);

      if (parts.length === 1) {
        if (method === 'GET') return resolve(projects);
        if (method === 'POST') {
          var newProj = {
            id: "p_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            name: body.name,
            color: body.color || "#DA5427",
            archived: false,
            createdAt: new Date().toISOString()
          };
          projects.push(newProj);
          setStore('projects', projects);
          return resolve(newProj);
        }
      } else if (parts.length === 2) {
        var id = parts[1];
        var idx = projects.findIndex(function(p) { return p.id === id; });
        if (method === 'PATCH') {
          if (idx !== -1) {
            Object.assign(projects[idx], body);
            setStore('projects', projects);
            return resolve(projects[idx]);
          }
        }
        if (method === 'DELETE') {
          if (idx !== -1) {
            projects.splice(idx, 1);
            setStore('projects', projects);
            return resolve({ message: "Deleted" });
          }
        }
      }
    }

    // Tasks
    if (parts[0] === 'tasks') {
      var tasks = getStore('tasks', []);

      if (parts.length === 1) {
        if (method === 'GET') return resolve(tasks);
        if (method === 'POST') {
          var newTask = {
            id: "t_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            projectId: body.projectId,
            name: body.name,
            description: body.description || "",
            status: body.status || "todo",
            priority: body.priority || "medium",
            dueDate: body.dueDate || null,
            assigneeId: body.assigneeId || null,
            recurrence: body.recurrence || "none",
            tags: body.tags || "",
            timeSpent: 0,
            attachments: "[]",
            createdAt: new Date().toISOString()
          };
          tasks.push(newTask);
          setStore('tasks', tasks);
          return resolve(newTask);
        }
      } else if (parts.length === 2) {
        var id = parts[1];
        var idx = tasks.findIndex(function(t) { return t.id === id; });
        if (method === 'PATCH') {
          if (idx !== -1) {
            Object.assign(tasks[idx], body);
            setStore('tasks', tasks);
            return resolve(tasks[idx]);
          }
          return resolve({});
        }
        if (method === 'DELETE') {
          if (idx !== -1) {
            tasks.splice(idx, 1);
            setStore('tasks', tasks);
            return resolve({ message: "Deleted" });
          }
          return resolve({});
        }
      }
    }

    // Subtasks
    if (parts[0] === 'subtasks') {
      var subtasks = getStore('subtasks', []);
      if (parts.length === 1) {
        if (method === 'POST') {
          var newSub = {
            id: "s_" + Date.now(),
            taskId: body.taskId,
            text: body.text,
            done: false
          };
          subtasks.push(newSub);
          setStore('subtasks', subtasks);
          return resolve(newSub);
        }
      } else if (parts.length === 2) {
        var id = parts[1];
        var idx = subtasks.findIndex(function(s) { return s.id === id; });
        if (method === 'PATCH') {
          if (idx !== -1) {
            Object.assign(subtasks[idx], body);
            setStore('subtasks', subtasks);
            return resolve(subtasks[idx]);
          }
          return resolve({});
        }
        if (method === 'DELETE') {
          if (idx !== -1) {
            subtasks.splice(idx, 1);
            setStore('subtasks', subtasks);
            return resolve({ message: "Deleted" });
          }
          return resolve({});
        }
      }
    }

    // Comments
    if (parts[0] === 'comments') {
      var comments = getStore('comments', []);
      if (parts.length === 1) {
        if (method === 'POST') {
          var newComment = {
            id: "c_" + Date.now(),
            taskId: body.taskId,
            text: body.text,
            author: "User",
            createdAt: new Date().toISOString()
          };
          comments.push(newComment);
          setStore('comments', comments);
          return resolve(newComment);
        }
      }
    }

    // Team
    if (parts[0] === 'team') {
      var team = getStore('team', []);
      if (method === 'GET') return resolve(team);
      if (method === 'POST') {
        var newMember = {
          id: "m_" + Date.now(),
          name: body.name,
          role: body.role || "Member",
            color: body.color || "#2E9E58",
          createdAt: new Date().toISOString()
        };
        team.push(newMember);
        setStore('team', team);
        return resolve(newMember);
      }
    }

    // Goals
    if (parts[0] === 'goals') {
      var goals = getStore('goals', []);
      if (method === 'GET') return resolve(goals);
      if (method === 'POST') {
        var newGoal = {
          id: "g_" + Date.now(),
          name: body.name,
          targetDate: body.targetDate || null,
          progress: body.progress || 0
        };
        goals.push(newGoal);
        setStore('goals', goals);
        return resolve(newGoal);
      }
      if (parts.length === 2) {
        var id = parts[1];
        var idx = goals.findIndex(function(g) { return g.id === id; });
        if (method === 'PATCH') {
          if (idx !== -1) {
            Object.assign(goals[idx], body);
            setStore('goals', goals);
            return resolve(goals[idx]);
          }
          return resolve({});
        }
        if (method === 'DELETE') {
          if (idx !== -1) {
            goals.splice(idx, 1);
            setStore('goals', goals);
            return resolve({ message: "Deleted" });
          }
          return resolve({});
        }
      }
    }

    // Notifications
    if (parts[0] === 'notifications') {
      var notifs = getStore('notifications', []);
      if (method === 'GET') return resolve(notifs);
      if (method === 'PATCH') {
        notifs.forEach(function(n) { n.read = true; });
        setStore('notifications', notifs);
        return resolve({ message: "All read" });
      }
    }

    // Events
    if (parts[0] === 'events') {
      var events = getStore('events', []);
      if (parts.length === 1) {
        if (method === 'GET') return resolve(events);
        if (method === 'POST') {
          var newEvent = {
            id: "e_" + Date.now(),
            name: body.name,
            date: body.date,
            time: body.time || "09:00"
          };
          events.push(newEvent);
          setStore('events', events);
          return resolve(newEvent);
        }
      } else if (parts.length === 2) {
        var id = parts[1];
        var idx = events.findIndex(function(e) { return e.id === id; });
        if (method === 'DELETE') {
          if (idx !== -1) {
            events.splice(idx, 1);
            setStore('events', events);
            return resolve({ message: "Deleted" });
          }
          return resolve({});
        }
      }
    }

    // Activity
    if (parts[0] === 'activity') {
      var activity = getStore('activity', []);
      return resolve(activity);
    }

    // Settings
    if (parts[0] === 'settings') {
      if (parts[1] === 'smtp') {
        var smtp = getStore('smtp', { host: "", port: 587, secure: false, user: "" });
        if (method === 'GET') return resolve(smtp);
        if (method === 'PUT') {
          setStore('smtp', body);
          return resolve({ message: "Saved" });
        }
      }
    }

    resolve({});
  });
}

function apiFetch(path, options) {
  options = options || {};
  
  if (useMock) {
    return mockFetch(path, options).then(camelizeKeys);
  }

  var url = API_BASE + path;
  var headers = options.headers || {};

  if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  if (authToken) {
    headers['Authorization'] = 'Bearer ' + authToken;
  }

  var fetchOptions = {
    method: options.method || 'GET',
    headers: headers,
  };

  if (options.body !== undefined) {
    fetchOptions.body = options.body;
  }

  var cacheKey = options.method === 'GET' && path;
  if (cacheKey && pending[cacheKey]) {
    return pending[cacheKey];
  }

  var promise = fetch(url, fetchOptions).then(function (res) {
    if (res.status === 401) {
      setAuthToken(null);
      window.location.reload();
      throw new Error('Session expired');
    }
    if (res.status === 503) {
      console.warn("DB offline. Auto-activating client-side offline mock mode.");
      localStorage.setItem('pm-use-mock', 'true');
      window.location.reload();
      throw new Error('Database offline');
    }
    if (!res.ok) {
      return res.json().then(function (body) {
        var err = new Error(body.error || 'Request failed');
        err.status = res.status;
        err.body = body;
        throw err;
      }, function () {
        var err = new Error(res.statusText || 'Request failed');
        err.status = res.status;
        throw err;
      });
    }
    return res.json().then(camelizeKeys);
  }).catch(function (err) {
    // Also fallback if fetch fails completely (network error)
    if (err.message === 'Failed to fetch' || err.status === 503) {
      console.warn("Server unavailable. Auto-activating client-side offline mock mode.");
      localStorage.setItem('pm-use-mock', 'true');
      window.location.reload();
      return;
    }
    throw err;
  });

  if (cacheKey) {
    pending[cacheKey] = promise;
    promise.then(function () { delete pending[cacheKey]; }, function () { delete pending[cacheKey]; });
  }

  return promise;
}

function setAuthToken(token, rememberMe) {
  authToken = token;
  if (token) {
    if (rememberMe !== false) {
      localStorage.setItem('pm-token', token);
      sessionStorage.removeItem('pm-token');
      tokenStorage = 'local';
    } else {
      sessionStorage.setItem('pm-token', token);
      localStorage.removeItem('pm-token');
      tokenStorage = 'session';
    }
  } else {
    localStorage.removeItem('pm-token');
    sessionStorage.removeItem('pm-token');
    tokenStorage = null;
  }
}

function setServerUrl(url) {
  if (url) {
    localStorage.setItem('pm-server', url);
  } else {
    localStorage.removeItem('pm-server');
  }
}

function getAuthToken() {
  return authToken;
}

function isLoggedIn() {
  return !!authToken;
}

var API = {
  get: function (path) { return apiFetch(path, { method: 'GET' }); },
  post: function (path, body) { return apiFetch(path, { method: 'POST', body: JSON.stringify(body) }); },
  patch: function (path, body) { return apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) }); },
  del: function (path) { return apiFetch(path, { method: 'DELETE' }); },
  upload: function (path, formData) {
    return apiFetch(path, {
      method: 'POST',
      body: formData,
      headers: {},
    });
  },
  getSmtpConfig: function () { return apiFetch('/settings/smtp', { method: 'GET' }); },
  saveSmtpConfig: function (cfg) { return apiFetch('/settings/smtp', { method: 'PUT', body: JSON.stringify(cfg) }); },
  testSmtpConfig: function (cfg) { return apiFetch('/settings/smtp/test', { method: 'POST', body: JSON.stringify(cfg) }); },
  setToken: setAuthToken,
  getToken: getAuthToken,
  setServer: setServerUrl,
  isLoggedIn: isLoggedIn,
};
