import {
  clearDatabase, deleteDatabase, deleteRecord, keepMainBankAccount, openDatabase, readAll, replaceAll,
  seedStore, storeNames, writeRecord,
} from "./db.js";
import {
  amountToMinor, closeDialog, DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, filterTransactions,
  getMonthTotals, monthKey, openDialog, OVERALL_BUDGET_CATEGORY_ID, PALETTE, parseCsv,
} from "./utils.js";
import { renderAdmin, renderBudgets, renderPlanning, renderSettings, renderTransactions } from "./ui.js";
import { renderDashboard } from "./ui-dashboard.js";
import { createBudgetDialog, createContributionDialog, createGoalDialog, createOverallBudgetDialog, createRecurringDialog } from "./forms.js";
import { processRecurring } from "./recurring.js";
import { exportCsv, importCsv, openCsvImport, renderCsvMapping } from "./backup.js";
import { deleteCategory, reassignCategory } from "./category-actions.js";
import { createClient } from "@supabase/supabase-js";
import { clearSync, configureSync, requestSync } from "./supabase-sync.js";

const root = document.querySelector("#view-root");
const shell = document.querySelector(".app-shell");
const transactionDialog = document.querySelector("#transaction-dialog");
const csvDialog = document.querySelector("#csv-dialog");
const categoryDialog = document.querySelector("#category-dialog");
const authGate = document.querySelector("#auth-gate");
const authForm = document.querySelector("#auth-form");
const passwordRecoveryForm = document.querySelector("#password-recovery-form");
const authMessage = document.querySelector("#auth-message");
const authSubmit = document.querySelector("#auth-submit");
const authModeToggle = document.querySelector("#auth-mode-toggle");
const forgotPasswordButton = document.querySelector("#forgot-password");
const profileNameDialog = document.querySelector("#profile-name-dialog");
const profileNameForm = document.querySelector("#profile-name-form");
const profileNameError = document.querySelector("#profile-name-error");
const passwordChangeDialog = document.querySelector("#password-change-dialog");
const passwordChangeForm = document.querySelector("#password-change-form");
const passwordChangeMessage = document.querySelector("#password-change-message");
const accountDeleteDialog = document.querySelector("#account-delete-dialog");
const accountDeleteForm = document.querySelector("#account-delete-form");
const accountDeleteMessage = document.querySelector("#account-delete-message");
const state = {
  database: null, view: "dashboard", selectedMonth: monthKey(new Date()), transactions: [], categories: [],
  budgets: [], accounts: [], goals: [], recurring: [], settings: defaultSettings(), user: null, profile: null,
  adminUsers: [], adminPage: 1, adminHasMore: false, adminLoading: false, adminError: "", adminSearch: "",
  filters: { query: "", categoryId: "", accountId: "", dateFrom: "", dateTo: "" },
  listLimit: 50, currentType: "expense", editingId: null, csvData: null, pendingCategoryId: null,
};
let toastTimer;
let lastUndo;
let supabase;
let authMode = "sign-in";
let activeUserId = null;
let workspaceInitialization = null;
let profileNameResolver = null;
let profileThemeSyncFailed = false;
let adminSearchTimer;
let passwordRecoveryMode = false;

function defaultSettings() {
  return { theme: "light", currency: "INR", locale: "en-IN", schemaVersion: 1 };
}

function readSettings(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(`paisa-settings-${userId}`)
      || localStorage.getItem("paisa-settings") || "{}");
    const theme = saved.theme === "dark" ? "dark" : "light";
    const currency = ["INR", "USD", "EUR", "GBP", "SGD", "AUD"].includes(saved.currency) ? saved.currency : "INR";
    const locale = ["en-IN", "en-US", "en-GB"].includes(saved.locale) ? saved.locale : "en-IN";
    return { theme, currency, locale, schemaVersion: 1 };
  } catch (error) {
    console.warn("Could not read Paisa preferences; using defaults.", error);
    return defaultSettings();
  }
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function persistSettings() {
  localStorage.setItem(`paisa-settings-${state.user.id}`, JSON.stringify(state.settings));
}

function profileCacheKey(userId) {
  return `paisa-profile-${userId}`;
}

function pendingThemeKey(userId) {
  return `paisa-pending-theme-${userId}`;
}

function cacheProfile(userId, profile) {
  localStorage.setItem(profileCacheKey(userId), JSON.stringify(profile));
}

function readCachedProfile(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(profileCacheKey(userId)) || "null");
    if (!saved || typeof saved !== "object") return null;
    return {
      displayName: typeof saved.displayName === "string" ? saved.displayName : "",
      theme: saved.theme === "dark" || saved.theme === "light" ? saved.theme : null,
      role: saved.role === "admin" ? "admin" : "user",
    };
  } catch (error) {
    console.warn("Could not read the cached profile.", error);
    return null;
  }
}

async function loadProfile(user) {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, theme, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    if (!navigator.onLine) {
      const cached = readCachedProfile(user.id);
      const pendingTheme = localStorage.getItem(pendingThemeKey(user.id));
      if (cached) return {
        ...cached,
        theme: pendingTheme === "light" || pendingTheme === "dark" ? pendingTheme : cached.theme,
      };
    }
    throw error;
  }
  if (!data) throw new Error("Your profile is missing. Apply the latest supabase/schema.sql and sign in again.");
  const profile = {
    displayName: data.display_name,
    theme: data.theme,
    role: data.role,
  };
  const pendingTheme = localStorage.getItem(pendingThemeKey(user.id));
  if (pendingTheme === "light" || pendingTheme === "dark") {
    profile.theme = pendingTheme;
    if (navigator.onLine) {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ theme: pendingTheme })
        .eq("user_id", user.id);
      if (updateError) {
        profileThemeSyncFailed = true;
        console.error("Could not sync the saved theme.", updateError);
      } else {
        localStorage.removeItem(pendingThemeKey(user.id));
      }
    }
  }
  cacheProfile(user.id, profile);
  return profile;
}

async function saveProfileTheme(theme) {
  localStorage.setItem(pendingThemeKey(state.user.id), theme);
  if (!navigator.onLine) return false;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ theme })
      .eq("user_id", state.user.id)
      .select("user_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Your profile could not be found.");
    localStorage.removeItem(pendingThemeKey(state.user.id));
    state.profile.theme = theme;
    cacheProfile(state.user.id, state.profile);
    return true;
  } catch (error) {
    console.error("Could not save the theme to Supabase.", error);
    return false;
  }
}

function requestProfileName() {
  profileNameForm.reset();
  profileNameForm.elements.displayName.value = state.profile?.displayName ?? "";
  profileNameError.hidden = true;
  document.querySelector("#profile-name-cancel").hidden = true;
  openDialog(profileNameDialog);
  return new Promise((resolve) => { profileNameResolver = resolve; });
}

async function saveProfileName(event) {
  event.preventDefault();
  const submit = profileNameForm.querySelector('button[type="submit"]');
  const displayName = profileNameForm.elements.displayName.value.trim();
  if (!displayName || displayName.length > 80) return;
  submit.disabled = true;
  profileNameError.hidden = true;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("user_id", state.user.id)
      .select("user_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Your profile could not be found.");
    state.profile.displayName = displayName;
    cacheProfile(state.user.id, state.profile);
    document.querySelector("#profile-name").textContent = displayName;
    document.querySelector("#profile-avatar").textContent = displayName.slice(0, 1).toUpperCase();
    closeDialog(profileNameDialog);
    if (!shell.hidden) render();
    showToast("Name updated.");
    profileNameResolver?.();
    profileNameResolver = null;
  } catch (error) {
    profileNameError.textContent = error.message || "Could not save your name.";
    profileNameError.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

const appServices = { writeRecord, keepMainBankAccount, reloadData, render, showToast, localDateString, persistSettings };

function updateSyncStatus(status) {
  const indicator = document.querySelector("#sync-status");
  indicator.textContent = status.message;
  indicator.dataset.state = status.state;
  indicator.title = status.message;
  indicator.hidden = status.state === "idle";
}

function updateAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle("is-error", isError);
  authMessage.hidden = !message;
}

function setAuthMode(mode) {
  authMode = mode;
  const signingIn = mode === "sign-in";
  authForm.hidden = false;
  passwordRecoveryForm.hidden = true;
  authSubmit.textContent = signingIn ? "Sign in" : "Create account";
  authModeToggle.textContent = signingIn ? "Create an account" : "I already have an account";
  forgotPasswordButton.hidden = !signingIn;
  authModeToggle.hidden = false;
  document.querySelector("#auth-heading").textContent = signingIn ? "Welcome back" : "Create your account";
  document.querySelector("#auth-password").autocomplete = signingIn ? "current-password" : "new-password";
  document.querySelector("#auth-name").hidden = signingIn;
  document.querySelector('label[for="auth-name"]').hidden = signingIn;
  document.querySelector("#auth-name").required = !signingIn;
  updateAuthMessage("");
}

function showAuthGate() {
  document.querySelector(".app-shell").hidden = true;
  authGate.hidden = false;
}

function showPasswordRecovery() {
  passwordRecoveryMode = true;
  showAuthGate();
  document.querySelector("#auth-heading").textContent = "Choose a new password";
  document.querySelector(".auth-description").textContent = "Enter a new password for your account.";
  authForm.hidden = true;
  passwordRecoveryForm.hidden = false;
  authModeToggle.hidden = true;
  forgotPasswordButton.hidden = true;
  updateAuthMessage("");
}

async function handleForgotPassword() {
  const email = authForm.elements.email.value.trim();
  if (!email || !authForm.elements.email.checkValidity()) {
    authForm.elements.email.reportValidity();
    return;
  }
  forgotPasswordButton.disabled = true;
  updateAuthMessage("");
  try {
    const redirectTo = new URL(location.pathname, location.origin).toString();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    updateAuthMessage("If an account exists for that email, a password reset link has been sent.");
  } catch (error) {
    updateAuthMessage(error.message || "Could not send a password reset email.", true);
  } finally {
    forgotPasswordButton.disabled = false;
  }
}

async function handlePasswordRecoverySubmit(event) {
  event.preventDefault();
  const submit = passwordRecoveryForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  updateAuthMessage("");
  try {
    const password = passwordRecoveryForm.elements.password.value;
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    passwordRecoveryMode = false;
    passwordRecoveryForm.reset();
    setAuthMode("sign-in");
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (data.session) {
      await activateSession(data.session);
      showToast("Your password has been updated.");
    } else {
      updateAuthMessage("Your password has been updated. Sign in with your new password.");
    }
  } catch (error) {
    updateAuthMessage(error.message || "Could not update your password.", true);
  } finally {
    submit.disabled = false;
  }
}

async function handlePasswordChange(event) {
  event.preventDefault();
  const submit = passwordChangeForm.querySelector('button[type="submit"]');
  const currentPassword = passwordChangeForm.elements.currentPassword.value;
  const newPassword = passwordChangeForm.elements.newPassword.value;
  const confirmPassword = passwordChangeForm.elements.confirmPassword.value;
  passwordChangeMessage.hidden = true;
  if (newPassword !== confirmPassword) {
    passwordChangeMessage.textContent = "The new passwords do not match.";
    passwordChangeMessage.hidden = false;
    return;
  }
  if (newPassword === currentPassword) {
    passwordChangeMessage.textContent = "Choose a password different from your current one.";
    passwordChangeMessage.hidden = false;
    return;
  }
  submit.disabled = true;
  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: state.user.email,
      password: currentPassword,
    });
    if (signInError) throw new Error("The current password is incorrect.");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    closeDialog(passwordChangeDialog);
    passwordChangeForm.reset();
    showToast("Your password has been updated.");
  } catch (error) {
    passwordChangeMessage.textContent = error.message || "Could not update your password.";
    passwordChangeMessage.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

async function handleAccountDelete(event) {
  event.preventDefault();
  const submit = accountDeleteForm.querySelector('button[type="submit"]');
  accountDeleteMessage.hidden = true;
  if (accountDeleteForm.elements.confirmation.value.trim() !== "DELETE") {
    accountDeleteMessage.textContent = "Type DELETE exactly to confirm.";
    accountDeleteMessage.hidden = false;
    return;
  }
  submit.disabled = true;
  let accountDeleted = false;
  try {
    const result = await invokeAdmin({ action: "delete-own-account", confirmation: "DELETE" });
    accountDeleted = true;
    const userId = state.user.id;
    const databaseName = `paisa-finance-${userId}`;
    clearSync();
    let localCleanupError = null;
    if (state.database) {
      try {
        await clearDatabase(state.database);
        state.database.close();
        await deleteDatabase(databaseName);
      } catch (error) {
        state.database.close();
        try {
          await deleteDatabase(databaseName);
        } catch (deleteError) {
          localCleanupError = deleteError;
          console.error("Could not remove local data after account deletion.", error, deleteError);
        }
      }
    }

    let signOutError = null;
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      signOutError = error;
    } catch (error) {
      signOutError = error;
    }
    await deactivateSession();
    for (const key of [
      `paisa-settings-${userId}`,
      `paisa-profile-${userId}`,
      `paisa-pending-theme-${userId}`,
      `paisa-local-import-${userId}`,
    ]) localStorage.removeItem(key);
    closeDialog(accountDeleteDialog);
    authForm.reset();
    setAuthMode("sign-in");
    const cleanupWarning = localCleanupError || signOutError;
    updateAuthMessage(cleanupWarning
      ? `${result.message} This device could not fully clear local account data; close other Paisa tabs and clear this site's data.`
      : result.message, Boolean(cleanupWarning));
  } catch (error) {
    if (accountDeleted) {
      await deactivateSession();
      closeDialog(accountDeleteDialog);
      authForm.reset();
      setAuthMode("sign-in");
      updateAuthMessage("Your account was deleted, but local cleanup did not finish. Clear this site's data before using Paisa again.", true);
    } else {
      accountDeleteMessage.textContent = error.message || "Could not delete your account.";
      accountDeleteMessage.hidden = false;
    }
  } finally {
    submit.disabled = false;
  }
}

async function mergeLegacyLocalData(userId) {
  const marker = `paisa-local-import-${userId}`;
  if (localStorage.getItem(marker)) return;
  const legacyDatabase = await openDatabase();
  const collections = Object.fromEntries(await Promise.all(
    storeNames.map(async (store) => [store, await readAll(legacyDatabase, store)]),
  ));
  const hasUserData = ["transactions", "budgets", "goals", "recurring"].some((store) => collections[store].length)
    || collections.categories.some((category) => !DEFAULT_CATEGORIES.some((item) => item.id === category.id))
    || collections.accounts.some((account) => account.id !== "bank");
  if (!hasUserData) return;
  const shouldImport = window.confirm(
    "Paisa found data saved by the previous local version. Merge records that are not already in this Supabase account? The old browser copy will remain untouched.",
  );
  localStorage.setItem(marker, shouldImport ? "imported" : "skipped");
  if (!shouldImport) return;
  for (const store of storeNames) {
    const existing = new Set((await readAll(state.database, store)).map((item) => item.id));
    for (const item of collections[store]) {
      if (!existing.has(item.id)) await writeRecord(state.database, store, item);
    }
  }
  showToast("Existing local records were added to your account and will sync.");
}

async function initializeWorkspace(session) {
  const user = session.user;
  state.user = user;
  profileThemeSyncFailed = false;
  state.profile = await loadProfile(user);
  if (activeUserId !== user.id) return;
  state.settings = readSettings(user.id);
  if (state.profile.theme === "light" || state.profile.theme === "dark") {
    state.settings.theme = state.profile.theme;
  } else {
    state.profile.theme = state.settings.theme;
    if (!await saveProfileTheme(state.profile.theme)) profileThemeSyncFailed = true;
  }
  applyTheme();
  if (!state.profile.displayName) await requestProfileName();
  if (activeUserId !== user.id) return;
  state.database = await openDatabase(`paisa-finance-${user.id}`);
  await configureSync({
    client: supabase,
    user,
    database: state.database,
    onStatus: updateSyncStatus,
  });
  await mergeLegacyLocalData(user.id);
  await seedStore(state.database, "categories", DEFAULT_CATEGORIES);
  await seedStore(state.database, "accounts", DEFAULT_ACCOUNTS);
  await keepMainBankAccount(state.database);
  await reloadData();
  await processRecurring(state, localDateString);
  await reloadData();
  document.querySelector("#today-label").textContent = new Intl.DateTimeFormat(state.settings.locale, { weekday: "short", day: "numeric", month: "short" }).format(new Date());
  document.querySelector("#profile-name").textContent = state.profile.displayName;
  document.querySelector("#profile-avatar").textContent = state.profile.displayName.slice(0, 1).toUpperCase();
  render();
  authGate.hidden = true;
  document.querySelector(".app-shell").hidden = false;
  if (profileThemeSyncFailed) showToast("Theme is saved on this device but could not sync to your account.");
  if (navigator.storage?.persist) await navigator.storage.persist();
  if ("serviceWorker" in navigator) {
    const isLocalHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);
    if (isLocalHost) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) await registration.unregister();
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.filter((name) => name.startsWith("paisa-shell-")).map((name) => caches.delete(name)));
      } catch (error) {
        console.warn("Could not clear the local offline cache.", error);
      }
    } else if (location.protocol === "https:") {
      navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Offline support could not be enabled.", error));
    }
  }
}

async function activateSession(session) {
  if (!session) return;
  if (activeUserId === session.user.id) return;
  activeUserId = session.user.id;
  workspaceInitialization = initializeWorkspace(session);
  try {
    await workspaceInitialization;
  } catch (error) {
    console.error("Could not open the signed-in workspace.", error);
    activeUserId = null;
    clearSync();
    showAuthGate();
    updateAuthMessage(error.message || "Could not open your workspace.", true);
  } finally {
    workspaceInitialization = null;
  }
}

async function deactivateSession() {
  if (profileNameDialog.open) closeDialog(profileNameDialog);
  profileNameResolver?.();
  profileNameResolver = null;
  activeUserId = null;
  clearSync();
  state.user = null;
  state.profile = null;
  state.database = null;
  state.settings = defaultSettings();
  state.view = "dashboard";
  state.transactions = [];
  state.categories = [];
  state.budgets = [];
  state.accounts = [];
  state.goals = [];
  state.recurring = [];
  state.filteredTransactions = [];
  state.monthTotals = { income: 0, expense: 0 };
  state.filters = { query: "", categoryId: "", accountId: "", dateFrom: "", dateTo: "" };
  state.adminUsers = [];
  state.adminPage = 1;
  state.adminHasMore = false;
  state.adminLoading = false;
  state.adminError = "";
  state.adminSearch = "";
  lastUndo = null;
  clearTimeout(toastTimer);
  document.querySelector("#toast").classList.remove("is-visible");
  updateSyncStatus({ state: "idle", message: "" });
  showAuthGate();
}

async function initializeAuth() {
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = import.meta.env;
  if (!url || !key || url.includes("YOUR_PROJECT_ID") || key.includes("YOUR_SUPABASE_")) {
    document.querySelector("#auth-config-help").hidden = false;
    authForm.querySelectorAll("input, button").forEach((control) => { control.disabled = true; });
    updateAuthMessage("Add your Supabase project URL and publishable/anon key to .env, then restart the app.", true);
    showAuthGate();
    return;
  }
  supabase = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      showPasswordRecovery();
    } else if (event === "SIGNED_OUT") {
      passwordRecoveryMode = false;
      deactivateSession();
    } else if (session && !passwordRecoveryMode) {
      setTimeout(() => activateSession(session), 0);
    }
  });
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    updateAuthMessage(error.message, true);
    showAuthGate();
  } else if (data.session && passwordRecoveryMode) {
    showPasswordRecovery();
  } else if (data.session) {
    await activateSession(data.session);
  } else {
    showAuthGate();
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const displayName = authForm.elements.name.value.trim();
  const email = authForm.elements.email.value.trim();
  const password = authForm.elements.password.value;
  authSubmit.disabled = true;
  updateAuthMessage("");
  try {
    if (authMode === "sign-in") {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.session) await activateSession(data.session);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      if (error) throw error;
      if (data.session) await activateSession(data.session);
      else updateAuthMessage("Check your email to confirm your account, then sign in.");
    }
  } catch (error) {
    updateAuthMessage(error.message || "Authentication failed.", true);
  } finally {
    authSubmit.disabled = false;
  }
}

function render() {
  root.replaceChildren();
  const views = {
    dashboard: renderDashboard, transactions: renderTransactions, budgets: renderBudgets,
    planning: renderPlanning, settings: renderSettings,
  };
  if (state.profile?.role === "admin") views.admin = renderAdmin;
  (views[state.view] ?? renderDashboard)(state, root);
  const labels = { dashboard: "Overview", transactions: "Transactions", budgets: "Budgets", planning: "Goals & bills", settings: "Settings", admin: "Manage users" };
  document.querySelector("#page-label").textContent = labels[state.view] ?? "Overview";
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
    if (button.dataset.view === state.view) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelector("#currency-prefix").textContent = new Intl.NumberFormat(state.settings.locale, { style: "currency", currency: state.settings.currency }).formatToParts(0).find((part) => part.type === "currency")?.value ?? state.settings.currency;
  applyTheme();
}

function applyTheme() {
  const isDark = state.settings.theme === "dark";
  shell.classList.toggle("is-dark", isDark);
  document.body.classList.toggle("is-dark", isDark);
}

async function reloadData() {
  for (const store of storeNames) state[store] = await readAll(state.database, store);
  state.monthTotals = getMonthTotals(state.transactions, state.selectedMonth);
  state.filteredTransactions = filterTransactions(state.transactions, {
    ...state.filters,
    categoryNames: Object.fromEntries(state.categories.map((item) => [item.id, item.name])),
    accountNames: Object.fromEntries(state.accounts.map((item) => [item.id, item.name])),
  });
}

function showToast(message, undo = null) {
  const toast = document.querySelector("#toast");
  toast.replaceChildren();
  toast.append(document.createTextNode(message));
  if (undo) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = "Undo"; button.addEventListener("click", undo, { once: true });
    toast.append(button);
  }
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 4000);
}

async function invokeAdmin(body) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error?.name === "FunctionsFetchError") {
    throw new Error("Paisa could not reach the admin-users Edge Function. Confirm the app's Supabase project URL and deploy the function to that same project with `supabase functions deploy admin-users`.");
  }
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

async function loadAdminUsers(page = 1) {
  if (state.profile?.role !== "admin") return;
  state.adminPage = page;
  state.adminLoading = true;
  state.adminError = "";
  render();
  try {
    const result = await invokeAdmin({ action: "list-users", page, search: state.adminSearch });
    state.adminUsers = result.users;
    state.adminHasMore = result.hasMore;
  } catch (error) {
    state.adminUsers = [];
    state.adminHasMore = false;
    state.adminError = error.message || "Could not load users.";
  } finally {
    state.adminLoading = false;
    render();
  }
}

async function performAdminAction(body) {
  const result = await invokeAdmin(body);
  showToast(result.message || "Admin action completed.");
  await loadAdminUsers(state.adminPage);
}

function transactionCategories(type) {
  return state.categories.filter((item) => item.type === type || item.type === "both");
}

function updateTransactionOptions() {
  const categorySelect = document.querySelector("#transaction-category");
  categorySelect.replaceChildren();
  for (const item of transactionCategories(state.currentType)) {
    const option = document.createElement("option"); option.value = item.id; option.textContent = `${item.icon}  ${item.name}`;
    categorySelect.append(option);
  }
  const accountSelect = document.querySelector("#transaction-account");
  accountSelect.replaceChildren();
  for (const item of state.accounts) {
    const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; accountSelect.append(option);
  }
}

function openTransaction(id = null, defaults = {}) {
  state.editingId = id;
  const editing = state.transactions.find((item) => item.id === id);
  const form = document.querySelector("#transaction-form");
  form.reset();
  state.currentType = editing?.type ?? defaults.type ?? "expense";
  document.querySelector("#transaction-title").textContent = editing ? "Edit transaction" : "New transaction";
  document.querySelectorAll(".type-switch button").forEach((button) => button.classList.toggle("is-selected", button.dataset.type === state.currentType));
  updateTransactionOptions();
  const actions = form.querySelector(".modal-actions");
  actions.querySelector(".delete-current")?.remove();
  if (editing) {
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "button button-quiet delete-current"; remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!window.confirm("Delete this transaction? This cannot be undone.")) return;
      await deleteRecord(state.database, "transactions", editing.id);
      closeDialog(transactionDialog); await reloadData(); render(); showToast("Transaction deleted.");
    });
    actions.prepend(remove);
  }
  document.querySelector("#transaction-amount").value = editing ? (editing.amountMinor / 100).toFixed(2) : defaults.amount ?? "";
  document.querySelector("#transaction-category").value = editing?.categoryId ?? defaults.categoryId ?? transactionCategories(state.currentType)[0]?.id ?? "";
  document.querySelector("#transaction-date").value = editing?.date ?? defaults.date ?? localDateString();
  document.querySelector("#transaction-account").value = editing?.accountId ?? state.accounts[0]?.id ?? "";
  document.querySelector("#transaction-note").value = editing?.note ?? defaults.note ?? "";
  openDialog(transactionDialog);
  const focusAmount = () => document.querySelector("#transaction-amount")?.focus();
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focusAmount);
  else setTimeout(focusAmount, 0);
}

async function saveTransaction(event) {
  event.preventDefault();
  const form = event.target;
  const amountMinor = amountToMinor(form.elements.amount.value);
  if (!amountMinor) { form.elements.amount.setCustomValidity("Enter a valid amount greater than zero."); form.reportValidity(); form.elements.amount.setCustomValidity(""); return; }
  const existing = state.transactions.find((item) => item.id === state.editingId);
  const now = new Date().toISOString();
  const transaction = {
    id: existing?.id ?? crypto.randomUUID(), type: state.currentType, amountMinor,
    date: form.elements.date.value, categoryId: form.elements.categoryId.value,
    accountId: form.elements.accountId.value, note: form.elements.note.value.trim(),
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  await writeRecord(state.database, "transactions", transaction);
  closeDialog(transactionDialog); await reloadData(); render();
  if (!existing) {
    lastUndo = transaction.id;
    showToast("Transaction saved.", async () => {
      if (lastUndo !== transaction.id) return;
      await deleteRecord(state.database, "transactions", transaction.id);
      lastUndo = null; await reloadData(); render(); showToast("Transaction undone.");
    });
  } else showToast("Changes saved.");
}

async function handleClick(event) {
  const target = event.target.closest("[data-action], [data-view]");
  if (!target) return;
  if (target.dataset.view) {
    event.preventDefault();
    if (target.dataset.view === "admin" && state.profile?.role !== "admin") return;
    state.view = target.dataset.view;
    state.listLimit = 50;
    render();
    if (state.view === "admin") await loadAdminUsers(1);
    return;
  }
  const action = target.dataset.action;
  if (action === "close-dialog") closeDialog(target.closest("dialog"));
  else if (action === "close-profile-name") closeDialog(profileNameDialog);
  else if (action === "edit-profile-name") {
    profileNameForm.reset();
    profileNameForm.elements.displayName.value = state.profile.displayName;
    profileNameError.hidden = true;
    document.querySelector("#profile-name-cancel").hidden = false;
    openDialog(profileNameDialog);
  } else if (action === "change-password") {
    passwordChangeForm.reset();
    passwordChangeMessage.hidden = true;
    openDialog(passwordChangeDialog);
  } else if (action === "delete-account") {
    accountDeleteForm.reset();
    accountDeleteMessage.hidden = true;
    openDialog(accountDeleteDialog);
  }
  else if (action === "add-transaction") openTransaction();
  else if (action === "edit-transaction") openTransaction(target.dataset.id);
  else if (action === "show-transactions") { state.view = "transactions"; render(); }
  else if (action === "show-more") { state.listLimit += 50; render(); }
  else if (action === "add-budget") createBudgetDialog(state, "", appServices);
  else if (action === "edit-budget") createBudgetDialog(state, target.dataset.categoryId, appServices);
  else if (action === "set-overall-budget") createOverallBudgetDialog(state, appServices);
  else if (action === "add-goal") createGoalDialog(state, appServices);
  else if (action === "add-recurring") createRecurringDialog(state, appServices);
  else if (action === "contribute-goal") createContributionDialog(state, target.dataset.id, appServices);
  else if (action === "delete-goal" && window.confirm("Delete this savings goal?")) { await deleteRecord(state.database, "goals", target.dataset.id); await reloadData(); render(); showToast("Goal deleted."); }
  else if (action === "delete-recurring" && window.confirm("Delete this recurring rule? Past transactions will remain.")) { await deleteRecord(state.database, "recurring", target.dataset.id); await reloadData(); render(); showToast("Recurring rule deleted."); }
  else if (action === "export-csv") exportCsv(state);
  else if (action === "import-csv") openCsvImport(state, csvDialog);
  else if (action === "sync-now") await requestSync(true);
  else if (action === "admin-refresh") await loadAdminUsers(state.adminPage);
  else if (action === "admin-users-previous") await loadAdminUsers(Math.max(1, state.adminPage - 1));
  else if (action === "admin-users-next") await loadAdminUsers(state.adminPage + 1);
  else if (action === "admin-user-toggle") {
    await performAdminAction({ action: "set-ban", userId: target.dataset.userId, banned: target.dataset.banned === "true" });
  } else if (action === "admin-user-reset" && window.confirm("Send this user a password reset email?")) {
    await performAdminAction({ action: "send-password-reset", userId: target.dataset.userId });
  } else if (action === "admin-user-delete" && window.confirm(`Permanently delete ${target.dataset.email || "this user"} and their account data? This cannot be undone.`)) {
    await performAdminAction({ action: "delete-user", userId: target.dataset.userId });
  }
  else if (action === "sign-out") {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
    await deactivateSession();
  } else if (action === "reset-data" && window.confirm("Delete all financial data in this Supabase account and on this device? Your login and profile will remain. This cannot be undone.")) {
    await replaceAll(state.database, Object.fromEntries(storeNames.map((store) => [store, store === "categories" ? DEFAULT_CATEGORIES : store === "accounts" ? DEFAULT_ACCOUNTS : []])));
    state.settings = { ...defaultSettings(), theme: state.profile.theme };
    persistSettings();
    await reloadData(); render(); showToast("App data cleared.");
  } else if (action === "toggle-theme") await toggleTheme();
  else if (action === "delete-category") await deleteCategory(state, target.dataset.id, categoryDialog, appServices);
}

async function toggleTheme() {
  state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
  persistSettings();
  render();
  const synced = await saveProfileTheme(state.settings.theme);
  showToast(synced ? "Theme saved to your account." : "Theme is saved on this device and will sync when online.");
}

function handleFilter(event) {
  if (event.target.dataset.adminSearch) {
    state.adminSearch = event.target.value;
    clearTimeout(adminSearchTimer);
    adminSearchTimer = setTimeout(() => loadAdminUsers(1), 300);
    return;
  }
  const field = event.target.dataset.filter;
  if (!field) return;
  if (field === "month") state.selectedMonth = event.target.value || monthKey(new Date());
  else if (field === "currency" || field === "locale") { state.settings[field] = event.target.value; persistSettings(); }
  else state.filters[field] = event.target.value;
  const isTyping = field === "query";
  const cursor = isTyping ? event.target.selectionStart : null;
  reloadData().then(() => {
    render();
    if (isTyping) {
      const search = root.querySelector('[data-filter="query"]');
      search?.focus(); search?.setSelectionRange(cursor, cursor);
    }
  }).catch((error) => { console.error("Could not update the current view.", error); showToast("Could not refresh the view."); });
}

function handleForm(event) {
  const form = event.target;
  if (form.id === "profile-name-form") saveProfileName(event);
  else if (form.id === "password-change-form") handlePasswordChange(event);
  else if (form.id === "account-delete-form") handleAccountDelete(event);
  else if (form.dataset.form === "admin-name") {
    event.preventDefault();
    const displayName = form.elements.displayName.value.trim();
    invokeAdmin({ action: "update-name", userId: form.dataset.userId, displayName })
      .then(async (result) => {
        if (form.dataset.userId === state.user.id) {
          state.profile.displayName = displayName;
          cacheProfile(state.user.id, state.profile);
          document.querySelector("#profile-name").textContent = displayName;
          document.querySelector("#profile-avatar").textContent = displayName.slice(0, 1).toUpperCase();
        }
        showToast(result.message);
        await loadAdminUsers(state.adminPage);
      })
      .catch((error) => { console.error("Could not update the user name.", error); showToast(error.message || "Could not update the user name."); });
  } else if (form.id === "transaction-form") saveTransaction(event).catch((error) => { console.error("Could not save transaction.", error); showToast("Could not save transaction."); });
  else if (form.id === "csv-form") importCsv(event, state, { ...appServices, dialog: csvDialog }).catch((error) => { console.error("Could not import CSV.", error); showToast(error.message || "Could not import CSV."); });
  else if (form.id === "category-form") reassignCategory(event, state, categoryDialog, appServices).catch((error) => { console.error("Could not reassign category.", error); showToast("Could not reassign category."); });
  else if (form.dataset.form === "category") {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name || state.categories.some((item) => item.name.toLowerCase() === name.toLowerCase())) { showToast("Choose a category name that is not already in use."); return; }
    const icon = form.elements.icon.value.trim() || "✦";
    writeRecord(state.database, "categories", { id: crypto.randomUUID(), name, icon, color: PALETTE[state.categories.length % PALETTE.length], type: "both" })
      .then(async () => { await reloadData(); render(); showToast("Category added."); })
      .catch((error) => { console.error("Could not add category.", error); showToast("Could not add category."); });
  }
}

document.addEventListener("click", (event) => handleClick(event).catch((error) => { console.error("That action could not be completed.", error); showToast(error.message || "Something went wrong."); }));
document.addEventListener("input", handleFilter);
document.addEventListener("change", (event) => {
  if (event.target.id === "csv-file") {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => renderCsvMapping(state, parseCsv(text))).catch((error) => { console.error("Could not read CSV file.", error); showToast("Could not read that CSV file."); });
  } else if (event.target.dataset.filter) handleFilter(event);
});
document.addEventListener("submit", handleForm);
profileNameDialog.addEventListener("cancel", (event) => {
  if (document.querySelector("#profile-name-cancel").hidden) event.preventDefault();
});
authForm.addEventListener("submit", handleAuthSubmit);
forgotPasswordButton.addEventListener("click", handleForgotPassword);
passwordRecoveryForm.addEventListener("submit", handlePasswordRecoverySubmit);
authModeToggle.addEventListener("click", () => setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in"));
document.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches('[role="button"][data-action="edit-transaction"]')) {
    event.preventDefault();
    openTransaction(event.target.dataset.id);
  }
});
document.querySelectorAll(".type-switch button").forEach((button) => button.addEventListener("click", () => {
  state.currentType = button.dataset.type;
  document.querySelectorAll(".type-switch button").forEach((item) => item.classList.toggle("is-selected", item === button));
  updateTransactionOptions();
}));
document.querySelector("#theme-toggle").addEventListener("click", () => toggleTheme().catch((error) => {
  console.error("Could not change the theme.", error);
  showToast(error.message || "Could not change the theme.");
}));
document.querySelector("#transaction-amount").addEventListener("input", (event) => event.target.setCustomValidity(""));
window.addEventListener("online", async () => {
  if (!state.user) return;
  const pendingTheme = localStorage.getItem(pendingThemeKey(state.user.id));
  if (!pendingTheme) return;
  const synced = await saveProfileTheme(pendingTheme);
  if (synced) showToast("Theme synced to your account.");
});
initializeAuth().catch((error) => {
  console.error("Could not initialize Supabase authentication.", error);
  updateAuthMessage(error.message || "Could not connect to Supabase.", true);
  showAuthGate();
});
