const fs = require('fs');
const path = require('path');

const EMPLOYEES_FILE = path.join(__dirname, '..', 'config', 'employees.json');
const ADMINS_FILE = path.join(__dirname, '..', 'config', 'admins.json');

// Re-read config on every check so the lists can be updated without restarting,
// with a short cache to avoid hammering the filesystem.
let cache = { at: 0, employees: new Map(), admins: new Set() };
const TTL_MS = 10_000;

function load() {
  const now = Date.now();
  if (now - cache.at < TTL_MS) return cache;
  const emp = JSON.parse(fs.readFileSync(EMPLOYEES_FILE, 'utf8'));
  const adm = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
  cache = {
    at: now,
    employees: new Map(emp.employees.map(e => [e.email.toLowerCase(), e.name])),
    admins: new Set(adm.admins.map(e => e.toLowerCase())),
  };
  return cache;
}

function isAllowedEmployee(email) {
  return load().employees.has(String(email || '').toLowerCase());
}

function employeeName(email) {
  return load().employees.get(String(email || '').toLowerCase()) || null;
}

function isAdmin(email) {
  return load().admins.has(String(email || '').toLowerCase());
}

module.exports = { isAllowedEmployee, employeeName, isAdmin };
