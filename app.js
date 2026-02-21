import { registerSW } from "virtual:pwa-register";

const STORAGE_KEY = "time-tracker-app-v1";

const state = loadState();
let uiTick = null;
let selectedProjectId = state.projects[0]?.id || null;
let pendingRenameSave = null;
let pendingConfirmAction = null;

const els = {
  projectForm: document.getElementById("project-form"),
  projectName: document.getElementById("project-name"),
  projectList: document.getElementById("project-list"),
  taskForm: document.getElementById("task-form"),
  taskName: document.getElementById("task-name"),
  taskList: document.getElementById("task-list"),
  tasksTitle: document.getElementById("tasks-title"),
  timerTaskSelect: document.getElementById("timer-task-select"),
  timerReadout: document.getElementById("timer-readout"),
  timerStart: document.getElementById("timer-start"),
  timerPause: document.getElementById("timer-pause"),
  timerStop: document.getElementById("timer-stop"),
  manualForm: document.getElementById("manual-form"),
  manualHours: document.getElementById("manual-hours"),
  manualMinutes: document.getElementById("manual-minutes"),
  manualNote: document.getElementById("manual-note"),
  statsToday: document.getElementById("stats-today"),
  statsWeek: document.getElementById("stats-week"),
  statsTotal: document.getElementById("stats-total"),
  statsTableBody: document.getElementById("stats-table-body"),
  exportBtn: document.getElementById("export-btn"),
  importInput: document.getElementById("import-input"),
  projectTemplate: document.getElementById("project-item-template"),
  taskTemplate: document.getElementById("task-item-template"),
  renameDialog: document.getElementById("rename-dialog"),
  renameForm: document.getElementById("rename-form"),
  renameTitle: document.getElementById("rename-title"),
  renameInput: document.getElementById("rename-input"),
  renameCancel: document.getElementById("rename-cancel"),
  confirmDialog: document.getElementById("confirm-dialog"),
  confirmForm: document.getElementById("confirm-form"),
  confirmTitle: document.getElementById("confirm-title"),
  confirmMessage: document.getElementById("confirm-message"),
  confirmCancel: document.getElementById("confirm-cancel"),
  confirmOk: document.getElementById("confirm-ok"),
};

bindEvents();
renderAll();
ensureTick();
registerSW({ immediate: true });

function bindEvents() {
  els.projectForm.addEventListener("submit", onAddProject);
  els.taskForm.addEventListener("submit", onAddTask);
  els.timerStart.addEventListener("click", onTimerStart);
  els.timerPause.addEventListener("click", onTimerPause);
  els.timerStop.addEventListener("click", onTimerStop);
  els.manualForm.addEventListener("submit", onAddManualTime);
  els.exportBtn.addEventListener("click", onExport);
  els.importInput.addEventListener("change", onImport);
  els.renameForm.addEventListener("submit", onRenameSubmit);
  els.renameCancel.addEventListener("click", closeRenameDialog);
  els.renameDialog.addEventListener("close", () => {
    pendingRenameSave = null;
  });
  els.confirmForm.addEventListener("submit", onConfirmSubmit);
  els.confirmCancel.addEventListener("click", closeConfirmDialog);
  els.confirmDialog.addEventListener("close", () => {
    pendingConfirmAction = null;
  });
}

function onAddProject(event) {
  event.preventDefault();
  const name = els.projectName.value.trim();
  if (!name) return;
  state.projects.push({
    id: uid("p"),
    name,
    createdAt: Date.now(),
  });
  selectedProjectId = state.projects[state.projects.length - 1].id;
  els.projectName.value = "";
  persistAndRender();
}

function onAddTask(event) {
  event.preventDefault();
  if (!selectedProjectId) {
    alert("Сначала создайте проект.");
    return;
  }
  const name = els.taskName.value.trim();
  if (!name) return;
  state.tasks.push({
    id: uid("t"),
    projectId: selectedProjectId,
    name,
    done: false,
    createdAt: Date.now(),
  });
  els.taskName.value = "";
  persistAndRender();
}

function onTimerStart() {
  const projectId = selectedProjectId;
  if (!projectId) {
    alert("Выберите проект.");
    return;
  }
  const taskId = els.timerTaskSelect.value;
  if (!taskId) {
    alert("Добавьте и выберите задачу.");
    return;
  }

  if (!state.activeTimer) {
    state.activeTimer = {
      projectId,
      taskId,
      startedAt: Date.now(),
      lastResumedAt: Date.now(),
      accumulatedMs: 0,
      isRunning: true,
    };
  } else {
    if (state.activeTimer.taskId !== taskId || state.activeTimer.projectId !== projectId) {
      const proceed = confirm("Сейчас уже есть активный таймер. Переключить на новую задачу?");
      if (!proceed) return;
      finalizeActiveTimer();
      state.activeTimer = {
        projectId,
        taskId,
        startedAt: Date.now(),
        lastResumedAt: Date.now(),
        accumulatedMs: 0,
        isRunning: true,
      };
    } else if (!state.activeTimer.isRunning) {
      state.activeTimer.isRunning = true;
      state.activeTimer.lastResumedAt = Date.now();
    }
  }

  persistAndRender();
}

function onTimerPause() {
  if (!state.activeTimer || !state.activeTimer.isRunning) return;
  state.activeTimer.accumulatedMs += Date.now() - state.activeTimer.lastResumedAt;
  state.activeTimer.isRunning = false;
  persistAndRender();
}

function onTimerStop() {
  if (!state.activeTimer) return;
  finalizeActiveTimer();
  persistAndRender();
}

function finalizeActiveTimer() {
  if (!state.activeTimer) return;
  const timer = state.activeTimer;
  const now = Date.now();
  let durationMs = timer.accumulatedMs;
  if (timer.isRunning) {
    durationMs += now - timer.lastResumedAt;
  }
  if (durationMs > 0) {
    state.sessions.push({
      id: uid("s"),
      projectId: timer.projectId,
      taskId: timer.taskId,
      startedAt: timer.startedAt,
      endedAt: now,
      durationMs,
      source: "timer",
      note: "",
    });
  }
  state.activeTimer = null;
}

function onAddManualTime(event) {
  event.preventDefault();
  if (!selectedProjectId) {
    alert("Выберите проект.");
    return;
  }
  const hours = Number(els.manualHours.value || 0);
  const minutes = Number(els.manualMinutes.value || 0);
  if (hours < 0 || minutes < 0 || minutes > 59 || Number.isNaN(hours) || Number.isNaN(minutes)) {
    alert("Введите корректное время.");
    return;
  }
  const durationMs = (hours * 60 + minutes) * 60 * 1000;
  if (!durationMs) {
    alert("Укажите время больше нуля.");
    return;
  }

  const taskId = ensureManualTask(selectedProjectId);
  state.sessions.push({
    id: uid("s"),
    projectId: selectedProjectId,
    taskId,
    startedAt: Date.now(),
    endedAt: Date.now(),
    durationMs,
    source: "manual",
    note: els.manualNote.value.trim(),
  });
  els.manualHours.value = "";
  els.manualMinutes.value = "";
  els.manualNote.value = "";
  persistAndRender();
}

function onExport() {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "time-tracker-export.json";
  a.click();
  URL.revokeObjectURL(url);
}

function onImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result || "{}"));
      if (!isValidState(imported)) {
        alert("Невалидный файл импорта.");
        return;
      }
      Object.assign(state, normalizeState(imported));
      selectedProjectId = state.projects[0]?.id || null;
      persistAndRender();
    } catch (error) {
      alert("Не удалось прочитать JSON.");
    } finally {
      els.importInput.value = "";
    }
  };
  reader.readAsText(file);
}

function persistAndRender() {
  saveState(state);
  renderAll();
}

function renderAll() {
  guardSelectedProject();
  renderProjects();
  renderTasks();
  renderTimer();
  renderStats();
}

function renderProjects() {
  els.projectList.innerHTML = "";
  for (const project of state.projects) {
    const fragment = els.projectTemplate.content.cloneNode(true);
    const li = fragment.querySelector("li");
    const selectBtn = fragment.querySelector(".select-project");
    const renameBtn = fragment.querySelector(".rename-project");
    const deleteBtn = fragment.querySelector(".delete-project");

    selectBtn.textContent = project.name;
    selectBtn.classList.toggle("selected", project.id === selectedProjectId);
    selectBtn.addEventListener("click", () => {
      selectedProjectId = project.id;
      renderAll();
    });

    renameBtn.addEventListener("click", () => {
      openRenameDialog("Переименовать проект", project.name, (value) => {
        project.name = value;
        persistAndRender();
      });
    });

    deleteBtn.addEventListener("click", () => {
      openConfirmDialog(
        "Удалить проект",
        `Удалить проект "${project.name}" вместе с задачами и историей времени?`,
        "Удалить",
        () => {
          state.projects = state.projects.filter((p) => p.id !== project.id);
          const removedTaskIds = new Set(
            state.tasks.filter((t) => t.projectId === project.id).map((t) => t.id),
          );
          state.tasks = state.tasks.filter((t) => t.projectId !== project.id);
          state.sessions = state.sessions.filter(
            (s) => s.projectId !== project.id && !removedTaskIds.has(s.taskId),
          );

          if (state.activeTimer?.projectId === project.id) {
            state.activeTimer = null;
          }
          if (selectedProjectId === project.id) {
            selectedProjectId = state.projects[0]?.id || null;
          }

          persistAndRender();
        },
      );
    });

    els.projectList.appendChild(li);
  }
}

function renderTasks() {
  const project = getSelectedProject();
  els.taskList.innerHTML = "";

  if (!project) {
    els.tasksTitle.textContent = "Задачи";
    els.timerTaskSelect.innerHTML = "";
    return;
  }

  els.tasksTitle.textContent = `Задачи: ${project.name}`;
  const tasks = getTasksByProject(project.id);
  const totals = taskTotalsById();

  els.timerTaskSelect.innerHTML = "";
  for (const task of tasks) {
    const opt = document.createElement("option");
    opt.value = task.id;
    opt.textContent = task.name;
    els.timerTaskSelect.appendChild(opt);
  }

  if (state.activeTimer?.projectId === project.id) {
    els.timerTaskSelect.value = state.activeTimer.taskId;
  }

  for (const task of tasks) {
    const fragment = els.taskTemplate.content.cloneNode(true);
    const li = fragment.querySelector("li");
    const toggle = fragment.querySelector(".toggle-task");
    const name = fragment.querySelector(".task-name");
    const time = fragment.querySelector(".task-time");
    const renameBtn = fragment.querySelector(".rename-task");
    const deleteBtn = fragment.querySelector(".delete-task");

    toggle.checked = task.done;
    toggle.addEventListener("change", () => {
      task.done = toggle.checked;
      persistAndRender();
    });

    name.textContent = task.name;
    name.classList.toggle("done", task.done);
    time.textContent = formatDuration(totals.get(task.id) || 0);

    renameBtn.addEventListener("click", () => {
      openRenameDialog("Переименовать задачу", task.name, (value) => {
        task.name = value;
        persistAndRender();
      });
    });

    deleteBtn.addEventListener("click", () => {
      openConfirmDialog(
        "Удалить задачу",
        `Удалить задачу "${task.name}" и все записи времени?`,
        "Удалить",
        () => {
          state.tasks = state.tasks.filter((t) => t.id !== task.id);
          state.sessions = state.sessions.filter((s) => s.taskId !== task.id);
          if (state.activeTimer?.taskId === task.id) {
            state.activeTimer = null;
          }
          persistAndRender();
        },
      );
    });

    els.taskList.appendChild(li);
  }
}

function renderTimer() {
  const timer = state.activeTimer;
  if (!timer) {
    els.timerReadout.textContent = "00:00:00";
    setTimerButtons(true, false, false);
    return;
  }
  const durationMs = timer.accumulatedMs + (timer.isRunning ? Date.now() - timer.lastResumedAt : 0);
  els.timerReadout.textContent = formatDuration(durationMs);
  setTimerButtons(!timer.isRunning, timer.isRunning, true);
}

function setTimerButtons(startEnabled, pauseEnabled, stopEnabled) {
  els.timerStart.disabled = !startEnabled;
  els.timerPause.disabled = !pauseEnabled;
  els.timerStop.disabled = !stopEnabled;
}

function openRenameDialog(title, initialValue, onSave) {
  pendingRenameSave = onSave;
  els.renameTitle.textContent = title;
  els.renameInput.value = initialValue;
  els.renameDialog.showModal();
  els.renameInput.focus();
  els.renameInput.select();
}

function closeRenameDialog() {
  if (els.renameDialog.open) {
    els.renameDialog.close();
  }
}

function onRenameSubmit(event) {
  event.preventDefault();
  const value = els.renameInput.value.trim();
  if (!value || !pendingRenameSave) return;
  pendingRenameSave(value);
  closeRenameDialog();
}

function openConfirmDialog(title, message, okLabel, onConfirm) {
  pendingConfirmAction = onConfirm;
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmOk.textContent = okLabel;
  els.confirmDialog.showModal();
}

function closeConfirmDialog() {
  if (els.confirmDialog.open) {
    els.confirmDialog.close();
  }
}

function onConfirmSubmit(event) {
  event.preventDefault();
  if (!pendingConfirmAction) return;
  pendingConfirmAction();
  closeConfirmDialog();
}

function renderStats() {
  const now = Date.now();
  const dayStart = startOfDay(now);
  const weekStart = dayStart - 6 * 24 * 60 * 60 * 1000;

  let total = 0;
  let today = 0;
  let week = 0;

  const projectTotals = new Map();
  for (const session of state.sessions) {
    total += session.durationMs;
    projectTotals.set(
      session.projectId,
      (projectTotals.get(session.projectId) || 0) + session.durationMs,
    );
    if (session.endedAt >= dayStart) today += session.durationMs;
    if (session.endedAt >= weekStart) week += session.durationMs;
  }

  els.statsToday.textContent = formatDuration(today);
  els.statsWeek.textContent = formatDuration(week);
  els.statsTotal.textContent = formatDuration(total);

  els.statsTableBody.innerHTML = "";
  for (const project of state.projects) {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    const totalTd = document.createElement("td");
    nameTd.textContent = project.name;
    totalTd.textContent = formatDuration(projectTotals.get(project.id) || 0);
    tr.appendChild(nameTd);
    tr.appendChild(totalTd);
    els.statsTableBody.appendChild(tr);
  }
}

function ensureTick() {
  if (uiTick) return;
  uiTick = setInterval(() => {
    if (state.activeTimer?.isRunning) renderTimer();
  }, 250);
}

function getSelectedProject() {
  return state.projects.find((p) => p.id === selectedProjectId) || null;
}

function getTasksByProject(projectId) {
  return state.tasks.filter((t) => t.projectId === projectId);
}

function taskTotalsById() {
  const map = new Map();
  for (const s of state.sessions) {
    map.set(s.taskId, (map.get(s.taskId) || 0) + s.durationMs);
  }
  if (state.activeTimer) {
    const liveMs =
      state.activeTimer.accumulatedMs +
      (state.activeTimer.isRunning ? Date.now() - state.activeTimer.lastResumedAt : 0);
    map.set(state.activeTimer.taskId, (map.get(state.activeTimer.taskId) || 0) + liveMs);
  }
  return map;
}

function guardSelectedProject() {
  const exists = state.projects.some((p) => p.id === selectedProjectId);
  if (!exists) selectedProjectId = state.projects[0]?.id || null;
}

function ensureManualTask(projectId) {
  const existing = state.tasks.find((t) => t.projectId === projectId && t.name === "Ручной ввод");
  if (existing) return existing.id;
  const task = {
    id: uid("t"),
    projectId,
    name: "Ручной ввод",
    done: false,
    createdAt: Date.now(),
  };
  state.tasks.push(task);
  return task.id;
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function uid(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    return emptyState();
  }
}

function saveState(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function emptyState() {
  return {
    projects: [],
    tasks: [],
    sessions: [],
    activeTimer: null,
  };
}

function normalizeState(input) {
  const base = emptyState();
  if (!input || typeof input !== "object") return base;
  const projects = Array.isArray(input.projects) ? input.projects : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];

  base.projects = projects
    .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
    .map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: Number(p.createdAt) || Date.now(),
    }));

  const projectIds = new Set(base.projects.map((p) => p.id));
  base.tasks = tasks
    .filter(
      (t) =>
        t &&
        typeof t.id === "string" &&
        typeof t.projectId === "string" &&
        projectIds.has(t.projectId) &&
        typeof t.name === "string",
    )
    .map((t) => ({
      id: t.id,
      projectId: t.projectId,
      name: t.name,
      done: Boolean(t.done),
      createdAt: Number(t.createdAt) || Date.now(),
    }));

  const taskIds = new Set(base.tasks.map((t) => t.id));
  base.sessions = sessions
    .filter(
      (s) =>
        s &&
        typeof s.id === "string" &&
        typeof s.projectId === "string" &&
        typeof s.taskId === "string" &&
        projectIds.has(s.projectId) &&
        taskIds.has(s.taskId),
    )
    .map((s) => ({
      id: s.id,
      projectId: s.projectId,
      taskId: s.taskId,
      startedAt: Number(s.startedAt) || Date.now(),
      endedAt: Number(s.endedAt) || Date.now(),
      durationMs: Math.max(0, Number(s.durationMs) || 0),
      source: s.source === "manual" ? "manual" : "timer",
      note: typeof s.note === "string" ? s.note : "",
    }));

  if (
    input.activeTimer &&
    typeof input.activeTimer === "object" &&
    typeof input.activeTimer.projectId === "string" &&
    typeof input.activeTimer.taskId === "string" &&
    projectIds.has(input.activeTimer.projectId) &&
    taskIds.has(input.activeTimer.taskId)
  ) {
    base.activeTimer = {
      projectId: input.activeTimer.projectId,
      taskId: input.activeTimer.taskId,
      startedAt: Number(input.activeTimer.startedAt) || Date.now(),
      lastResumedAt: Number(input.activeTimer.lastResumedAt) || Date.now(),
      accumulatedMs: Math.max(0, Number(input.activeTimer.accumulatedMs) || 0),
      isRunning: Boolean(input.activeTimer.isRunning),
    };
  }

  return base;
}

function isValidState(input) {
  if (!input || typeof input !== "object") return false;
  return Array.isArray(input.projects) && Array.isArray(input.tasks) && Array.isArray(input.sessions);
}
