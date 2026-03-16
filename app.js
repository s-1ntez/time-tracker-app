import { registerSW } from "virtual:pwa-register";
import { isTauri } from "@tauri-apps/api/core";
import { isCloudConfigured, supabase } from "./supabaseClient";

const STORAGE_KEY = "time-tracker-app-v1";
const CLOUD_TABLE = "user_state";

const state = loadState();
let uiTick = null;
let selectedProjectId = state.projects[0]?.id || null;
let pendingRenameSave = null;
let pendingConfirmAction = null;
let pendingTaskTimeTaskId = null;
let syncTimeout = null;
let currentUser = null;
let syncing = false;
let reminderTimeout = null;
let tauriNotificationPlugin = undefined;
let updaterPlugin = undefined;
let processPlugin = undefined;
let pendingUpdate = null;
let updaterBusy = false;

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
  statsMonthPrev: document.getElementById("stats-month-prev"),
  statsMonthNext: document.getElementById("stats-month-next"),
  statsMonthInput: document.getElementById("stats-month-input"),
  statsMonthLabel: document.getElementById("stats-month-label"),
  statsModeProjects: document.getElementById("stats-mode-projects"),
  statsModeTasks: document.getElementById("stats-mode-tasks"),
  statsSelectedLabel: document.getElementById("stats-selected-label"),
  statsSelected: document.getElementById("stats-selected"),
  statsPrevious: document.getElementById("stats-previous"),
  statsTotal: document.getElementById("stats-total"),
  statsTableHead: document.getElementById("stats-table-head"),
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
  taskTimeDialog: document.getElementById("task-time-dialog"),
  taskTimeForm: document.getElementById("task-time-form"),
  taskTimeTitle: document.getElementById("task-time-title"),
  taskTimeHours: document.getElementById("task-time-hours"),
  taskTimeMinutes: document.getElementById("task-time-minutes"),
  taskTimeNote: document.getElementById("task-time-note"),
  taskTimeCancel: document.getElementById("task-time-cancel"),
  authEmail: document.getElementById("auth-email"),
  authPassword: document.getElementById("auth-password"),
  authLogin: document.getElementById("auth-login"),
  authSignup: document.getElementById("auth-signup"),
  authLogout: document.getElementById("auth-logout"),
  cloudSync: document.getElementById("cloud-sync"),
  authStatus: document.getElementById("auth-status"),
  notifyEnable: document.getElementById("notify-enable"),
  notifyReminderMinutes: document.getElementById("notify-reminder-minutes"),
  notifySave: document.getElementById("notify-save"),
  notifyStatus: document.getElementById("notify-status"),
  updaterBox: document.getElementById("updater-box"),
  updaterCheck: document.getElementById("updater-check"),
  updaterStatus: document.getElementById("updater-status"),
};

bindEvents();
renderAll();
ensureTick();
registerSW({ immediate: true });
initUpdater();

function bindEvents() {
  window.addEventListener("online", () => {
    if (currentUser) scheduleCloudPush(50);
  });
  els.projectForm.addEventListener("submit", onAddProject);
  els.taskForm.addEventListener("submit", onAddTask);
  els.timerStart.addEventListener("click", onTimerStart);
  els.timerPause.addEventListener("click", onTimerPause);
  els.timerStop.addEventListener("click", onTimerStop);
  els.manualForm.addEventListener("submit", onAddManualTime);
  els.statsMonthPrev.addEventListener("click", () => changeStatsMonth(-1));
  els.statsMonthNext.addEventListener("click", () => changeStatsMonth(1));
  els.statsMonthInput.addEventListener("change", onStatsMonthChange);
  els.statsModeProjects.addEventListener("click", () => setStatsBreakdownMode("projects"));
  els.statsModeTasks.addEventListener("click", () => setStatsBreakdownMode("tasks"));
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
  els.taskTimeForm.addEventListener("submit", onTaskTimeSubmit);
  els.taskTimeCancel.addEventListener("click", closeTaskTimeDialog);
  els.taskTimeDialog.addEventListener("close", () => {
    pendingTaskTimeTaskId = null;
  });
  els.authLogin.addEventListener("click", onAuthLogin);
  els.authSignup.addEventListener("click", onAuthSignup);
  els.authLogout.addEventListener("click", onAuthLogout);
  els.cloudSync.addEventListener("click", onCloudSync);
  els.notifyEnable.addEventListener("click", onEnableNotifications);
  els.notifySave.addEventListener("click", onSaveNotificationSettings);
  els.updaterCheck.addEventListener("click", onUpdaterAction);
}

async function initUpdater() {
  if (!isTauri()) return;

  els.updaterBox.hidden = false;
  setUpdaterStatus("Проверяю обновления...");
  await checkForUpdates(false);
}

async function onUpdaterAction() {
  if (updaterBusy) return;
  if (pendingUpdate) {
    await installPendingUpdate();
    return;
  }
  await checkForUpdates(true);
}

async function checkForUpdates(fromButton) {
  if (!isTauri()) return;

  updaterBusy = true;
  updateUpdaterButton();

  try {
    const { check } = await getUpdaterPlugin();
    pendingUpdate = await check();

    if (pendingUpdate) {
      setUpdaterStatus(`Доступна версия ${pendingUpdate.version}.`);
    } else {
      setUpdaterStatus(fromButton ? "Установлена актуальная версия." : "Автообновление включено.");
    }
  } catch (error) {
    pendingUpdate = null;
    setUpdaterStatus(`Ошибка обновления: ${getErrorMessage(error)}`);
  } finally {
    updaterBusy = false;
    updateUpdaterButton();
  }
}

async function installPendingUpdate() {
  if (!pendingUpdate) return;

  updaterBusy = true;
  updateUpdaterButton();
  let downloadedBytes = 0;
  let totalBytes = 0;

  try {
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === "Started") {
        totalBytes = Number(event.data.contentLength || 0);
        setUpdaterStatus("Скачиваю обновление...");
      }
      if (event.event === "Progress") {
        downloadedBytes += Number(event.data.chunkLength || 0);
        const sizeLabel = totalBytes
          ? `${Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))}%`
          : `${Math.round(downloadedBytes / 1024)} KB`;
        setUpdaterStatus(`Скачиваю обновление: ${sizeLabel}`);
      }
      if (event.event === "Finished") {
        setUpdaterStatus("Устанавливаю обновление...");
      }
    });

    const { relaunch } = await getProcessPlugin();
    setUpdaterStatus("Обновление установлено. Перезапуск...");
    await relaunch();
  } catch (error) {
    setUpdaterStatus(`Не удалось установить обновление: ${getErrorMessage(error)}`);
  } finally {
    pendingUpdate = null;
    updaterBusy = false;
    updateUpdaterButton();
  }
}

function setUpdaterStatus(message) {
  els.updaterStatus.textContent = message;
}

function updateUpdaterButton() {
  if (updaterBusy) {
    els.updaterCheck.disabled = true;
    els.updaterCheck.textContent = "Подождите...";
    return;
  }

  els.updaterCheck.disabled = false;
  els.updaterCheck.textContent = pendingUpdate
    ? `Установить ${pendingUpdate.version}`
    : "Проверить обновления";
}

async function getUpdaterPlugin() {
  if (updaterPlugin) return updaterPlugin;
  updaterPlugin = await import("@tauri-apps/plugin-updater");
  return updaterPlugin;
}

async function getProcessPlugin() {
  if (processPlugin) return processPlugin;
  processPlugin = await import("@tauri-apps/plugin-process");
  return processPlugin;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function initCloud() {
  if (!isCloudConfigured || !supabase) {
    setAuthStatus("Облако не подключено. Добавьте ключи Supabase.");
    updateCloudControls();
    return;
  }

  setAuthStatus("Проверка сессии...");
  updateCloudControls();

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    setAuthStatus(`Ошибка сессии: ${error.message}`, true);
    updateCloudControls();
    return;
  }

  currentUser = data.session?.user || null;
  updateCloudControls();

  if (currentUser) {
    await syncFromCloud();
    setAuthStatus(`Выполнен вход: ${currentUser.email || currentUser.id}`);
  } else {
    setAuthStatus("Войдите, чтобы включить синхронизацию.");
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    updateCloudControls();
    if (currentUser) {
      await syncFromCloud();
      setAuthStatus(`Выполнен вход: ${currentUser.email || currentUser.id}`);
    } else {
      setAuthStatus("Вы вышли из аккаунта. Данные сохранены локально.");
    }
  });
}

async function onAuthLogin() {
  if (!isCloudConfigured || !supabase) return;
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) {
    setAuthStatus("Введите email и пароль.", true);
    return;
  }
  setAuthStatus("Вход...");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setAuthStatus(`Ошибка входа: ${error.message}`, true);
  }
}

async function onAuthSignup() {
  if (!isCloudConfigured || !supabase) return;
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) {
    setAuthStatus("Введите email и пароль.", true);
    return;
  }
  setAuthStatus("Регистрация...");
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    setAuthStatus(`Ошибка регистрации: ${error.message}`, true);
    return;
  }
  setAuthStatus("Аккаунт создан. Проверьте email (если включено подтверждение).");
}

async function onAuthLogout() {
  if (!isCloudConfigured || !supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) {
    setAuthStatus(`Ошибка выхода: ${error.message}`, true);
  }
}

async function onCloudSync() {
  if (!currentUser) {
    setAuthStatus("Сначала войдите в аккаунт.", true);
    return;
  }
  await syncFromCloud();
  await syncToCloud();
}

function updateCloudControls() {
  const cloudReady = isCloudConfigured && Boolean(supabase);
  const authed = Boolean(currentUser);

  els.authEmail.disabled = !cloudReady || authed;
  els.authPassword.disabled = !cloudReady || authed;
  els.authLogin.disabled = !cloudReady || authed;
  els.authSignup.disabled = !cloudReady || authed;
  els.authLogout.disabled = !cloudReady || !authed;
  els.cloudSync.disabled = !cloudReady || !authed || syncing;
}

function setAuthStatus(message, isError = false) {
  els.authStatus.textContent = message;
  els.authStatus.style.color = isError ? "#b00020" : "";
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
  const taskName = state.tasks.find((t) => t.id === taskId)?.name || "Задача";
  void sendNotification("Таймер запущен", taskName);
  scheduleReminder();
}

function onTimerPause() {
  if (!state.activeTimer || !state.activeTimer.isRunning) return;
  state.activeTimer.accumulatedMs += Date.now() - state.activeTimer.lastResumedAt;
  state.activeTimer.isRunning = false;
  persistAndRender();
  clearReminder();
  const taskName = state.tasks.find((t) => t.id === state.activeTimer?.taskId)?.name || "Задача";
  void sendNotification("Таймер на паузе", taskName);
}

function onTimerStop() {
  if (!state.activeTimer) return;
  const taskName = state.tasks.find((t) => t.id === state.activeTimer.taskId)?.name || "Задача";
  finalizeActiveTimer();
  persistAndRender();
  clearReminder();
  void sendNotification("Таймер остановлен", taskName);
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

function onStatsMonthChange() {
  const value = els.statsMonthInput.value;
  if (!isValidMonthKey(value)) return;
  state.ui.selectedStatsMonth = value;
  saveState(state);
  renderStats();
}

function changeStatsMonth(delta) {
  state.ui.selectedStatsMonth = shiftMonthKey(state.ui.selectedStatsMonth, delta);
  saveState(state);
  renderStats();
}

function setStatsBreakdownMode(mode) {
  if (mode !== "projects" && mode !== "tasks") return;
  state.ui.statsBreakdownMode = mode;
  saveState(state);
  renderStats();
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
  state.cloudMeta.updatedAt = Date.now();
  saveState(state);
  renderAll();
  scheduleCloudPush();
}

function scheduleCloudPush(delayMs = 900) {
  if (!currentUser || syncing) return;
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncToCloud();
  }, delayMs);
}

async function syncFromCloud() {
  if (!currentUser || !supabase) return;

  setAuthStatus("Скачиваю данные из облака...");
  syncing = true;
  updateCloudControls();

  const { data, error } = await supabase
    .from(CLOUD_TABLE)
    .select("payload, updated_at")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  syncing = false;
  updateCloudControls();

  if (error) {
    setAuthStatus(`Ошибка чтения облака: ${error.message}`, true);
    return;
  }
  if (!data?.payload) {
    setAuthStatus("Облако пустое. Загружу локальные данные.");
    await syncToCloud();
    return;
  }

  const remote = normalizeState(data.payload);
  const remoteUpdatedAt = Number(new Date(data.updated_at)) || 0;
  const localUpdatedAt = Number(state.cloudMeta?.updatedAt || 0);

  if (remoteUpdatedAt >= localUpdatedAt) {
    replaceState(remote);
    state.cloudMeta.updatedAt = remoteUpdatedAt;
    saveState(state);
    renderAll();
    setAuthStatus("Данные синхронизированы из облака.");
  } else {
    await syncToCloud();
  }
}

async function syncToCloud() {
  if (!currentUser || !supabase) return;

  syncing = true;
  updateCloudControls();
  setAuthStatus("Отправляю данные в облако...");

  const updatedAt = Date.now();
  state.cloudMeta.updatedAt = updatedAt;
  const payload = serializeStateForCloud();

  const { error } = await supabase.from(CLOUD_TABLE).upsert(
    {
      user_id: currentUser.id,
      payload,
      updated_at: new Date(updatedAt).toISOString(),
    },
    { onConflict: "user_id" },
  );

  syncing = false;
  updateCloudControls();

  if (error) {
    setAuthStatus(`Ошибка записи в облако: ${error.message}`, true);
    return;
  }

  saveState(state);
  setAuthStatus("Синхронизация выполнена.");
}

function serializeStateForCloud() {
  return {
    projects: state.projects,
    tasks: state.tasks,
    sessions: state.sessions,
    activeTimer: state.activeTimer,
    cloudMeta: state.cloudMeta,
    settings: state.settings,
  };
}

function replaceState(next) {
  const normalized = normalizeState(next);
  const localUi = state.ui || defaultUIState();
  state.projects = normalized.projects;
  state.tasks = normalized.tasks;
  state.sessions = normalized.sessions;
  state.activeTimer = normalized.activeTimer;
  state.cloudMeta = normalized.cloudMeta;
  state.settings = normalized.settings;
  state.ui = localUi;
  selectedProjectId = normalized.projects[0]?.id || null;
}

function renderAll() {
  guardSelectedProject();
  renderProjects();
  renderTasks();
  renderTimer();
  renderStats();
  renderNotificationSettings();
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
    const addTimeBtn = fragment.querySelector(".add-task-time");
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

    addTimeBtn.addEventListener("click", () => {
      openTaskTimeDialog(task);
    });

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

function openTaskTimeDialog(task) {
  pendingTaskTimeTaskId = task.id;
  els.taskTimeTitle.textContent = `Добавить время: ${task.name}`;
  els.taskTimeHours.value = "";
  els.taskTimeMinutes.value = "";
  els.taskTimeNote.value = "";
  els.taskTimeDialog.showModal();
  els.taskTimeHours.focus();
}

function closeTaskTimeDialog() {
  if (els.taskTimeDialog.open) {
    els.taskTimeDialog.close();
  }
}

function onTaskTimeSubmit(event) {
  event.preventDefault();
  if (!pendingTaskTimeTaskId) return;

  const task = state.tasks.find((t) => t.id === pendingTaskTimeTaskId);
  if (!task) return;

  const hours = Number(els.taskTimeHours.value || 0);
  const minutes = Number(els.taskTimeMinutes.value || 0);

  if (hours < 0 || minutes < 0 || minutes > 59 || Number.isNaN(hours) || Number.isNaN(minutes)) {
    alert("Введите корректное время.");
    return;
  }

  const durationMs = (hours * 60 + minutes) * 60 * 1000;
  if (!durationMs) {
    alert("Укажите время больше нуля.");
    return;
  }

  state.sessions.push({
    id: uid("s"),
    projectId: task.projectId,
    taskId: task.id,
    startedAt: Date.now(),
    endedAt: Date.now(),
    durationMs,
    source: "manual",
    note: els.taskTimeNote.value.trim(),
  });

  closeTaskTimeDialog();
  persistAndRender();
}

function renderStats() {
  const selectedMonth = state.ui.selectedStatsMonth;
  const previousMonth = shiftMonthKey(selectedMonth, -1);
  const selectedRange = monthRange(selectedMonth);
  const previousRange = monthRange(previousMonth);

  let selectedTotal = 0;
  let previousTotal = 0;
  let total = 0;

  const projectTotals = new Map();
  const taskTotals = new Map();

  for (const session of state.sessions) {
    const endedAt = Number(session.endedAt) || 0;
    total += session.durationMs;

    if (endedAt >= selectedRange.start && endedAt < selectedRange.end) {
      selectedTotal += session.durationMs;
      projectTotals.set(
        session.projectId,
        (projectTotals.get(session.projectId) || 0) + session.durationMs,
      );
      taskTotals.set(session.taskId, (taskTotals.get(session.taskId) || 0) + session.durationMs);
    }

    if (endedAt >= previousRange.start && endedAt < previousRange.end) {
      previousTotal += session.durationMs;
    }
  }

  els.statsMonthInput.value = selectedMonth;
  els.statsMonthLabel.textContent = formatMonthLabel(selectedMonth);
  els.statsSelectedLabel.textContent = formatMonthLabel(selectedMonth);
  els.statsSelected.textContent = formatDuration(selectedTotal);
  els.statsPrevious.textContent = formatDuration(previousTotal);
  els.statsTotal.textContent = formatDuration(total);
  els.statsModeProjects.classList.toggle("active", state.ui.statsBreakdownMode === "projects");
  els.statsModeTasks.classList.toggle("active", state.ui.statsBreakdownMode === "tasks");

  renderStatsTable(state.ui.statsBreakdownMode, projectTotals, taskTotals);
}

function renderStatsTable(mode, projectTotals, taskTotals) {
  const columns =
    mode === "tasks"
      ? ["Задача", "Проект", "Время"]
      : ["Проект", "Время"];

  els.statsTableHead.innerHTML = `
    <tr>${columns.map((column) => `<th>${column}</th>`).join("")}</tr>
  `;
  els.statsTableBody.innerHTML = "";

  const rows =
    mode === "tasks"
      ? buildTaskStatsRows(taskTotals)
      : buildProjectStatsRows(projectTotals);

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.className = "stats-empty";
    td.textContent = "За выбранный месяц данных пока нет.";
    tr.appendChild(td);
    els.statsTableBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    els.statsTableBody.appendChild(tr);
  }
}

function buildProjectStatsRows(projectTotals) {
  return state.projects
    .map((project) => ({
      name: project.name,
      durationMs: projectTotals.get(project.id) || 0,
    }))
    .filter((row) => row.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs || a.name.localeCompare(b.name, "ru"))
    .map((row) => [row.name, formatDuration(row.durationMs)]);
}

function buildTaskStatsRows(taskTotals) {
  const projectsById = new Map(state.projects.map((project) => [project.id, project]));
  return state.tasks
    .map((task) => ({
      taskName: task.name,
      projectName: projectsById.get(task.projectId)?.name || "Без проекта",
      durationMs: taskTotals.get(task.id) || 0,
    }))
    .filter((row) => row.durationMs > 0)
    .sort((a, b) => {
      if (b.durationMs !== a.durationMs) return b.durationMs - a.durationMs;
      return a.taskName.localeCompare(b.taskName, "ru");
    })
    .map((row) => [row.taskName, row.projectName, formatDuration(row.durationMs)]);
}

function ensureTick() {
  if (uiTick) return;
  uiTick = setInterval(() => {
    if (state.activeTimer?.isRunning) renderTimer();
  }, 250);
}

async function initNotifications() {
  if (!state.settings) state.settings = defaultSettings();
  if (state.activeTimer?.isRunning) {
    scheduleReminder();
  }
  await renderNotificationSettings();
}

async function onEnableNotifications() {
  const permission = await requestNotificationPermission();
  if (permission === "unsupported") {
    els.notifyStatus.textContent = "Уведомления не поддерживаются на этом устройстве.";
    return;
  }
  state.settings.notificationsEnabled = permission === "granted";
  saveState(state);
  await renderNotificationSettings();
}

function onSaveNotificationSettings() {
  const minutes = Number(els.notifyReminderMinutes.value || 0);
  if (Number.isNaN(minutes) || minutes < 5 || minutes > 240) {
    els.notifyStatus.textContent = "Интервал должен быть от 5 до 240 минут.";
    return;
  }
  state.settings.reminderMinutes = minutes;
  saveState(state);
  void renderNotificationSettings();
  if (state.activeTimer?.isRunning) {
    scheduleReminder();
  }
}

async function renderNotificationSettings() {
  if (!state.settings) state.settings = defaultSettings();
  const permission = await getNotificationPermission();
  els.notifyReminderMinutes.value = state.settings.reminderMinutes;
  const enabled = state.settings.notificationsEnabled && permission === "granted";
  if (permission === "unsupported") {
    els.notifyStatus.textContent = "Уведомления не поддерживаются на этом устройстве.";
  } else if (permission === "denied") {
    els.notifyStatus.textContent = "Доступ к уведомлениям запрещён в настройках.";
  } else if (enabled) {
    els.notifyStatus.textContent = `Уведомления включены. Напоминание: каждые ${state.settings.reminderMinutes} мин.`;
  } else {
    els.notifyStatus.textContent = "Уведомления выключены.";
  }
}

async function sendNotification(title, body) {
  if (!state.settings?.notificationsEnabled) return;
  const permission = await getNotificationPermission();
  if (permission !== "granted") return;

  const plugin = await getTauriNotificationPlugin();
  if (plugin) {
    await plugin.sendNotification({
      title,
      body,
      ongoing: false,
    });
    return;
  }

  if ("Notification" in window) {
    new Notification(title, { body, tag: "time-tracker-notify" });
  }
}

function clearReminder() {
  if (reminderTimeout) {
    clearTimeout(reminderTimeout);
    reminderTimeout = null;
  }
}

function scheduleReminder() {
  clearReminder();
  if (!state.activeTimer?.isRunning) return;
  const minutes = Number(state.settings?.reminderMinutes || 30);
  const intervalMs = minutes * 60 * 1000;
  const elapsed =
    state.activeTimer.accumulatedMs + (Date.now() - state.activeTimer.lastResumedAt);
  const delay = Math.max(1000, intervalMs - (elapsed % intervalMs));

  reminderTimeout = setTimeout(() => {
    if (!state.activeTimer?.isRunning) return;
    const taskName = state.tasks.find((t) => t.id === state.activeTimer.taskId)?.name || "Задача";
    void sendNotification("Таймер всё ещё работает", `Проверьте задачу: ${taskName}`);
    scheduleReminder();
  }, delay);
}

async function getTauriNotificationPlugin() {
  if (!isTauri()) return null;
  if (tauriNotificationPlugin !== undefined) return tauriNotificationPlugin;
  try {
    tauriNotificationPlugin = await import("@tauri-apps/plugin-notification");
    return tauriNotificationPlugin;
  } catch (_error) {
    tauriNotificationPlugin = null;
    return null;
  }
}

async function getNotificationPermission() {
  const plugin = await getTauriNotificationPlugin();
  if (plugin) {
    try {
      const granted = await plugin.isPermissionGranted();
      return granted ? "granted" : "default";
    } catch (_error) {
      return "unsupported";
    }
  }

  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

async function requestNotificationPermission() {
  const plugin = await getTauriNotificationPlugin();
  if (plugin) {
    try {
      const result = await plugin.requestPermission();
      if (result === "granted" || result === "denied" || result === "default") return result;
      return result ? "granted" : "default";
    } catch (_error) {
      return "unsupported";
    }
  }

  if (!("Notification" in window)) return "unsupported";
  return Notification.requestPermission();
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

function currentMonthKey() {
  return monthKeyFromTimestamp(Date.now());
}

function monthKeyFromTimestamp(ts) {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function isValidMonthKey(value) {
  return /^\d{4}-\d{2}$/.test(value);
}

function shiftMonthKey(monthKey, delta) {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const date = new Date(Number(yearRaw), Number(monthRaw) - 1 + delta, 1);
  return monthKeyFromTimestamp(date.getTime());
}

function monthRange(monthKey) {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const start = new Date(Number(yearRaw), Number(monthRaw) - 1, 1).getTime();
  const end = new Date(Number(yearRaw), Number(monthRaw), 1).getTime();
  return { start, end };
}

function formatMonthLabel(monthKey) {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const date = new Date(Number(yearRaw), Number(monthRaw) - 1, 1);
  const label = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
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
    cloudMeta: {
      updatedAt: 0,
    },
    settings: defaultSettings(),
    ui: defaultUIState(),
  };
}

function defaultSettings() {
  return {
    notificationsEnabled: false,
    reminderMinutes: 30,
  };
}

function defaultUIState() {
  return {
    selectedStatsMonth: currentMonthKey(),
    statsBreakdownMode: "projects",
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

  const cloudMeta =
    input.cloudMeta && typeof input.cloudMeta === "object" ? input.cloudMeta : {};
  base.cloudMeta = {
    updatedAt: Math.max(0, Number(cloudMeta.updatedAt) || 0),
  };

  const settings =
    input.settings && typeof input.settings === "object" ? input.settings : {};
  base.settings = {
    notificationsEnabled: Boolean(settings.notificationsEnabled),
    reminderMinutes: Math.min(240, Math.max(5, Number(settings.reminderMinutes) || 30)),
  };

  const ui = input.ui && typeof input.ui === "object" ? input.ui : {};
  const defaultUi = defaultUIState();
  base.ui = {
    selectedStatsMonth: isValidMonthKey(ui.selectedStatsMonth)
      ? ui.selectedStatsMonth
      : defaultUi.selectedStatsMonth,
    statsBreakdownMode: ui.statsBreakdownMode === "tasks" ? "tasks" : "projects",
  };

  return base;
}

function isValidState(input) {
  if (!input || typeof input !== "object") return false;
  return Array.isArray(input.projects) && Array.isArray(input.tasks) && Array.isArray(input.sessions);
}
