const DB_NAME = 'ViceDesignDB';
const DB_VER = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(project) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put({ ...project, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadProject(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Auth (simulated - for demo only)
export function getAuthUser() {
  try { return JSON.parse(localStorage.getItem('vd_user') || 'null'); } catch { return null; }
}
export function setAuthUser(user) {
  localStorage.setItem('vd_user', JSON.stringify(user));
}
export function clearAuthUser() {
  localStorage.removeItem('vd_user');
}
export function signupUser(email, password, name) {
  const users = JSON.parse(localStorage.getItem('vd_users') || '[]');
  if (users.find(u => u.email === email)) return null;
  const user = { id: 'u_' + Date.now(), email, password, name, createdAt: Date.now() };
  users.push(user);
  localStorage.setItem('vd_users', JSON.stringify(users));
  setAuthUser(user);
  return user;
}
export function loginUser(email, password) {
  const users = JSON.parse(localStorage.getItem('vd_users') || '[]');
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return null;
  setAuthUser(user);
  return user;
}
