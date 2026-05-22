// ===== CCS SIT-IN MONITORING SYSTEM =====
// Simple localStorage-based data management

const DB = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  getObj(key) { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } },
  setObj(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

// ===== AUTH =====
const Auth = {
  login(idNumber, password) {
    const users = DB.get('ccs_users');
    const user = users.find(u => u.idNumber === idNumber && u.password === password);
    if (user) {
      DB.setObj('ccs_session', user);
      return user;
    }
    return null;
  },

  register(data) {
    const users = DB.get('ccs_users');
    if (users.find(u => u.idNumber === data.idNumber)) return { error: 'ID Number already registered.' };
    const user = { 
      ...data, 
      id: Date.now(), 
      role: 'student', 
      remainingSessions: 30,
      course: 'N/A',
      courseLevel: 0
    };
    users.push(user);
    DB.set('ccs_users', users);
    return { success: true, user };
  },

  logout() {
    localStorage.removeItem('ccs_session');
    // Works whether called from root or pages/ subfolder
    const isInPages = window.location.pathname.includes('/pages/');
    window.location.href = isInPages ? '../login.html' : 'login.html';
  },

  current() { return DB.getObj('ccs_session'); },

  isAdmin() { const u = this.current(); return u && u.role === 'admin'; },

  require(admin = false) {
    const u = this.current();
    if (!u) { window.location.href = 'login.html'; return null; }
    if (admin && u.role !== 'admin') { window.location.href = 'dashboard.html'; return null; }
    return u;
  }
};

// ===== SIT-IN =====
const SitIn = {
  getAll() { return DB.get('ccs_sitins'); },

  getActive() { return this.getAll().filter(s => s.status === 'active'); },

  getByStudent(idNumber) { return this.getAll().filter(s => s.studentId === idNumber); },

  start(studentId, studentName, purpose, lab) {
    const active = this.getAll().find(s => s.studentId === studentId && s.status === 'active');
    if (active) return { error: 'Student already has an active sit-in session.' };

    const users = DB.get('ccs_users');
    const user = users.find(u => u.idNumber === studentId);
    if (!user || user.remainingSessions <= 0) return { error: 'No remaining sessions.' };

    const sitin = {
      id: Date.now(),
      studentId,
      studentName,
      purpose,
      lab,
      timeIn: new Date().toISOString(),
      timeOut: null,
      status: 'active',
      date: new Date().toLocaleDateString()
    };

    const sitins = this.getAll();
    sitins.push(sitin);
    DB.set('ccs_sitins', sitins);

    // Deduct session
    user.remainingSessions--;
    DB.set('ccs_users', users);
    if (Auth.current().idNumber === studentId) {
      DB.setObj('ccs_session', { ...Auth.current(), remainingSessions: user.remainingSessions });
    }

    return { success: true, sitin };
  },

  request(studentId, studentName, purpose, lab) {
    const active = this.getAll().find(s => s.studentId === studentId && s.status === 'active');
    if (active) return { error: 'Student already has an active sit-in session.' };

    const sitin = {
      id: Date.now(),
      studentId,
      studentName,
      purpose,
      lab,
      timeIn: null,
      timeOut: null,
      status: 'pending',
      date: new Date().toLocaleDateString(),
      requestedAt: new Date().toISOString()
    };

    const sitins = this.getAll();
    sitins.push(sitin);
    DB.set('ccs_sitins', sitins);
    return { success: true, sitin };
  },

  getPending() { return this.getAll().filter(s => s.status === 'pending'); },

  approve(sitinId) {
    const sitins = this.getAll();
    const idx = sitins.findIndex(s => s.id === sitinId && s.status === 'pending');
    if (idx === -1) return { error: 'Pending request not found.' };

    const users = DB.get('ccs_users');
    const user = users.find(u => u.idNumber === sitins[idx].studentId);
    if (!user || user.remainingSessions <= 0) return { error: 'No remaining sessions for this student.' };

    sitins[idx].status = 'active';
    sitins[idx].timeIn = new Date().toISOString();
    // Deduct session
    user.remainingSessions--;
    DB.set('ccs_users', users);
    // Update session object if the approved student is the current session
    if (Auth.current()?.idNumber === user.idNumber) {
      DB.setObj('ccs_session', { ...Auth.current(), remainingSessions: user.remainingSessions });
    }

    DB.set('ccs_sitins', sitins);
    return { success: true, sitin: sitins[idx] };
  },

  decline(sitinId) {
    const sitins = this.getAll();
    const idx = sitins.findIndex(s => s.id === sitinId && s.status === 'pending');
    if (idx === -1) return { error: 'Pending request not found.' };
    sitins[idx].status = 'declined';
    DB.set('ccs_sitins', sitins);
    return { success: true };
  },

  end(sitinId) {
    const sitins = this.getAll();
    const idx = sitins.findIndex(s => s.id === sitinId);
    if (idx === -1) return { error: 'Session not found.' };
    sitins[idx].status = 'done';
    sitins[idx].timeOut = new Date().toISOString();
    DB.set('ccs_sitins', sitins);
    return { success: true };
  },

  formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  formatDuration(timeIn, timeOut) {
    const end = timeOut ? new Date(timeOut) : new Date();
    const diff = Math.floor((end - new Date(timeIn)) / 60000);
    const h = Math.floor(diff / 60), m = diff % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
};

// ===== USERS =====
const Users = {
  getAll() { return DB.get('ccs_users'); },

  find(idNumber) { return this.getAll().find(u => u.idNumber === idNumber); },

  update(idNumber, data) {
    const users = this.getAll();
    const idx = users.findIndex(u => u.idNumber === idNumber);
    if (idx === -1) return { error: 'User not found.' };
    // Prevent student remainingSessions from exceeding 30
    if (data.hasOwnProperty('remainingSessions') && users[idx].role === 'student') {
      data.remainingSessions = Math.min(30, parseInt(data.remainingSessions) || 0);
    }
    users[idx] = { ...users[idx], ...data };
    DB.set('ccs_users', users);
    // Update session if self
    if (Auth.current()?.idNumber === idNumber) {
      DB.setObj('ccs_session', users[idx]);
    }
    return { success: true, user: users[idx] };
  },

  resetSessions(idNumber, count = 30) {
    return this.update(idNumber, { remainingSessions: count });
  }
};

// ===== ANNOUNCEMENTS =====
const Announcements = {
  getAll() { return DB.get('ccs_announcements'); },
  post(title, message) {
    const announcements = this.getAll();
    const announcement = {
      id: Date.now(),
      title,
      message,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    announcements.unshift(announcement);
    DB.set('ccs_announcements', announcements);
    return announcement;
  },
  delete(id) {
    const announcements = this.getAll().filter(a => a.id !== id);
    DB.set('ccs_announcements', announcements);
  }
};

// ===== FEEDBACK =====
const Feedback = {
  getAll() { return DB.get('ccs_feedback'); },
  getByStudent(idNumber) { return this.getAll().filter(f => f.studentId === idNumber); },
  post(studentId, studentName, message) {
    const feedback = this.getAll();
    const entry = {
      id: Date.now(),
      studentId,
      studentName,
      message,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    feedback.unshift(entry);
    DB.set('ccs_feedback', feedback);
    return entry;
  }
};

// ===== REWARDS =====
const Rewards = {
  getAll() { return DB.get('ccs_rewards'); },
  getByStudent(idNumber) { return this.getAll().filter(r => r.studentId === idNumber); },
  add(studentId, points, reason) {
    const rewards = this.getAll();
    const entry = {
      id: Date.now(),
      studentId,
      points: parseInt(points),
      reason,
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    rewards.unshift(entry);
    DB.set('ccs_rewards', rewards);
    return entry;
  },
  getTotalPoints(idNumber) {
    return this.getByStudent(idNumber).reduce((sum, r) => sum + r.points, 0);
  }
};

// ===== ANALYTICS =====
const Analytics = {
  getRoomUsage() {
    const sitins = SitIn.getAll();
    const usage = {};
    sitins.forEach(s => {
      usage[s.lab] = (usage[s.lab] || 0) + 1;
    });
    return Object.entries(usage).sort((a, b) => b[1] - a[1]);
  },
  getTopStudents() {
    const sitins = SitIn.getAll();
    const usage = {};
    sitins.forEach(s => {
      usage[s.studentId] = (usage[s.studentId] || { name: s.studentName, count: 0 });
      usage[s.studentId].count++;
    });
    return Object.entries(usage).map(([id, data]) => ({ id, name: data.name, sessions: data.count })).sort((a, b) => b.sessions - a.sessions);
  },
  getTotalSessions() {
    return SitIn.getAll().length;
  },
  getActiveSessions() {
    return SitIn.getActive().length;
  },
  getAverageDuration() {
    const completed = SitIn.getAll().filter(s => s.status === 'done' && s.timeOut);
    if (!completed.length) return 0;
    const totalMinutes = completed.reduce((sum, s) => sum + SitIn.formatDuration(s.timeIn, s.timeOut).replace('h', '*60').replace('m', '').split('*').reduce((a, b) => a * b, 1), 0);
    return Math.round(totalMinutes / completed.length);
  }
};

// ===== RESERVATIONS =====
const Reservations = {
  getAll() { return DB.get('ccs_reservations'); },
  getByStudent(idNumber) { return this.getAll().filter(r => r.studentId === idNumber); },
  // Very small overlap check for same lab + pc
  isAvailable(lab, pc, date, start, end) {
    const list = this.getAll().filter(r => r.lab === lab && r.date === date);
    const toMin = t => {
      if (!t) return 0; const parts = t.split(':'); return parseInt(parts[0] || 0) * 60 + parseInt(parts[1] || 0);
    };
    const s = toMin(start), e = toMin(end);
    for (const r of list) {
      if (!r.pcs.includes(pc)) continue;
      const rs = toMin(r.startTime), re = toMin(r.endTime);
      if (!(e <= rs || s >= re)) return false;
    }
    return true;
  },
  post(studentId, studentName, lab, pcs, date, startTime, endTime, purpose) {
    const reservations = this.getAll();
    const entry = {
      id: Date.now(),
      studentId,
      studentName,
      lab,
      pcs, // array of pc numbers
      date,
      startTime,
      endTime,
      purpose: purpose || '',
      status: 'reserved',
      createdAt: new Date().toISOString()
    };
    reservations.unshift(entry);
    DB.set('ccs_reservations', reservations);
    return entry;
  }
};

// Reservation admin helpers
Reservations.getPending = function() {
  return this.getAll().filter(r => r.status === 'reserved');
};

Reservations.approve = function(resId) {
  const reservations = this.getAll();
  const idx = reservations.findIndex(r => r.id === resId && r.status === 'reserved');
  if (idx === -1) return { error: 'Reservation not found.' };
  const r = reservations[idx];
  // Try to start a sit-in for this reservation
  const startRes = SitIn.start(r.studentId, r.studentName, r.purpose || '', r.lab);
  if (startRes.error) return { error: startRes.error };
  reservations[idx].status = 'approved';
  reservations[idx].sitinId = startRes.sitin.id;
  DB.set('ccs_reservations', reservations);
  return { success: true, sitin: startRes.sitin };
};

Reservations.decline = function(resId) {
  const reservations = this.getAll();
  const idx = reservations.findIndex(r => r.id === resId && r.status === 'reserved');
  if (idx === -1) return { error: 'Reservation not found.' };
  reservations[idx].status = 'declined';
  DB.set('ccs_reservations', reservations);
  return { success: true };
};

// ===== UI HELPERS =====
function showAlert(id, message, type = 'danger') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `alert alert-${type} show`;
  el.innerHTML = `<span>${type === 'success' ? '✅' : '⚠️'}</span> ${message}`;
  setTimeout(() => { el.className = 'alert'; }, 4000);
}

function openModal(id) { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

function setNavUser() {
  const user = Auth.current();
  if (!user) return;
  const el = document.getElementById('nav-user-name');
  if (el) el.textContent = user.firstName + ' ' + user.lastName;
}

// ===== SEED ADMIN =====
function seedAdmin() {
  const users = DB.get('ccs_users');
  if (!users.find(u => u.idNumber === 'admin')) {
    users.push({
      id: 1,
      idNumber: 'admin',
      password: 'admin123',
      firstName: 'Admin',
      lastName: 'CCS',
      middleName: '',
      role: 'admin',
      course: 'N/A',
      courseLevel: 0,
      email: 'admin@ccs.edu',
      address: 'UC Main Campus',
      remainingSessions: 9999
    });
    DB.set('ccs_users', users);
  }
}

seedAdmin();
