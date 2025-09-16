// --- FIREBASE IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- PRO PLUS SCRIPT (UPGRADED & FIXED) ---

// --- Core Variables ---
const GEMINI_API_KEY = ""; // Provided by environment
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;

let proData = {};
let charts = { consistencyChart: null, sidebarTaskChart: null };
let threeJS = { scene: null, camera: null, renderer: null, animator: null, objects: {}, mouse: new THREE.Vector2(-100,-100) };
let clockInterval = null;
let soundManager = {};
let firebase = { app: null, db: null, auth: null, userId: null, dataUnsubscribe: null };
let isFirebaseReady = false; // Ensures Firebase is loaded before cloud writes
let isInitialLoad = true;

// State for Utilities
let timer = { interval: null, endTime: 0, paused: false, duration: 0 };
let stopwatch = { interval: null, startTime: 0, elapsed: 0, running: false, laps: [] };

const defaultProData = {
    settings: { theme: 'pro-plus-theme', sounds: true, userName: "" },
    schedule: {
        monday: { day: "Monday", classes: [], gym: { id: '', title: "", time: "", workout: [] }, otherTasks: [] },
        tuesday: { day: "Tuesday", classes: [], gym: { id: '', title: "", time: "", workout: [] }, otherTasks: [] },
        wednesday: { day: "Wednesday", classes: [], gym: { id: '', title: "", time: "", workout: [] }, otherTasks: [] },
        thursday: { day: "Thursday", classes: [], gym: { id: '', title: "", time: "", workout: [] }, otherTasks: [] },
        friday: { day: "Friday", classes: [], gym: { id: '', title: "", time: "", workout: [] }, otherTasks: [] },
        saturday: { day: "Saturday", classes: [], gym: { id: '', title: "", time: "", workout: [] }, otherTasks: [] },
        sunday: { day: "Sunday", classes: [], gym: { id: '', title: "", time: "", workout: [] }, otherTasks: [] }
    },
    habits: [
        { id: 'habit-1', text: 'Read 10 Pages', streak: 5, priority: 3, history: [] },
        { id: 'habit-2', text: 'Code for 1 hour', streak: 25, priority: 5, history: [] },
        { id: 'habit-3', text: 'Meditate 10 mins', streak: 12, priority: 2, history: [] },
        { id: 'habit-4', text: 'Drink 3L Water', streak: 3, priority: 1, history: [] },
    ],
    projects: [
        { id: `proj-1`, name: "Personal Website", status: 'active', description: "Create a new portfolio using Three.js and modern CSS.", deadline: "2025-10-31", tasks: [{id: `task-1`, text: "Design wireframes", done: true, priority: 3}, {id: `task-2`, text: "Develop landing page", done: false, priority: 2}] },
        { id: `proj-2`, name: "AI Productivity App", status: 'active', description: "Build a prototype for a voice-controlled dashboard.", deadline: "2025-12-15", tasks: [{id: `task-3`, text: "Setup database schema", done: true, priority: 3}, {id: `task-4`, text: "Implement voice commands", done: false, priority: 2}, {id: `task-5`, text: "Deploy to test server", done: false, priority: 1}] }
    ],
    journal: "",
    lastUpdated: new Date().toISOString(),
};

// --- SOUND ENGINE ---
function initSoundManager() {
    const createSynth = (volume = -12) => new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sine" }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.5 } }).toDestination().set({ volume });
    soundManager.uiClick = createSynth(-15);
    soundManager.taskComplete = createSynth(-10);
    soundManager.modalOpen = createSynth(-18);
    soundManager.tabChange = createSynth(-20);
    soundManager.error = createSynth(-10);
    soundManager.timerAlarm = createSynth(-5);

    soundManager.playSound = (sound, note = 'C4', duration = '8n') => {
        if (!proData.settings?.sounds || !soundManager[sound]) return;
        Tone.start();
        soundManager[sound].triggerAttackRelease(note, duration);
    };

    document.body.addEventListener('click', (e) => {
        if (e.target.closest('button, .nav-btn, .checkbox-custom')) {
            soundManager.playSound('uiClick', 'C3');
        }
    }, true);
}

// --- DATA PERSISTENCE (HYBRID LOCAL + FIREBASE) ---
function saveData() {
    try {
        localStorage.setItem('proPlusData', JSON.stringify(proData));
    } catch (e) {
        console.error("Error saving data to localStorage:", e);
    }
    syncDataWithFirestore();
}

async function syncDataWithFirestore() {
    if (!firebase.userId || !isFirebaseReady) {
        if(!isFirebaseReady) console.log("Firebase not ready, skipping cloud sync.");
        return;
    }
    const syncStatusEl = document.getElementById('sync-status');
    const syncIndicatorEl = document.getElementById('sync-indicator');
    const lastSyncedEl = document.getElementById('last-synced');
    
    syncStatusEl.textContent = "Syncing...";
    syncIndicatorEl.classList.add('syncing');

    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const docRef = doc(firebase.db, `artifacts/${appId}/users/${firebase.userId}/proPlusData`);
        proData.lastUpdated = new Date().toISOString();
        await setDoc(docRef, proData, { merge: true });
        syncStatusEl.textContent = "Synced";
        if(lastSyncedEl) lastSyncedEl.textContent = `Last: ${new Date().toLocaleTimeString()}`;
    } catch (error) {
        console.error("Error syncing data to Firestore:", error);
        syncStatusEl.textContent = "Error";
    } finally {
        setTimeout(() => syncIndicatorEl.classList.remove('syncing'), 500);
    }
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initSoundManager();
    initializeFirebase();
    bindUniversalEventListeners();
});

function initializeFirebase() {
    try {
        const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
        firebase.app = initializeApp(firebaseConfig);
        firebase.db = getFirestore(firebase.app);
        firebase.auth = getAuth(firebase.app);

        onAuthStateChanged(firebase.auth, async (user) => {
            if (user) {
                firebase.userId = user.uid;
                await setupDataListener();
            } else {
                const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
                try {
                    if (token) {
                        await signInWithCustomToken(firebase.auth, token);
                    } else {
                       await signInAnonymously(firebase.auth);
                    }
                } catch(e) {
                    console.error("Authentication failed, falling back to anonymous", e);
                    await signInAnonymously(firebase.auth);
                }
            }
        });
    } catch (e) {
        console.error("Firebase initialization failed. Using local fallback.", e);
        isFirebaseReady = false;
        loadDataFromLocalStorage();
        initializeAppUI();
    }
}

function loadDataFromLocalStorage() {
    try {
        const localData = localStorage.getItem('proPlusData');
        if (localData) {
            proData = JSON.parse(localData);
            console.log("Loaded data from local backup.");
        } else {
            proData = JSON.parse(JSON.stringify(defaultProData));
            console.log("No local backup found. Initializing with default data.");
        }
    } catch (e) {
        console.error("Failed to load or parse local data. Using default data.", e);
        proData = JSON.parse(JSON.stringify(defaultProData));
    }
}


async function setupDataListener() {
    if (firebase.dataUnsubscribe) firebase.dataUnsubscribe();
    
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const docRef = doc(firebase.db, `artifacts/${appId}/users/${firebase.userId}/proPlusData`);

    firebase.dataUnsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            console.log("Loaded data from Firestore.");
            const remoteData = docSnap.data();
            proData = {
                ...JSON.parse(JSON.stringify(defaultProData)),
                ...remoteData,
                settings: { ...defaultProData.settings, ...(remoteData.settings || {}) },
                schedule: { ...defaultProData.schedule, ...(remoteData.schedule || {}) },
            };
            Object.keys(defaultProData.schedule).forEach(day => {
                proData.schedule[day] = { ...defaultProData.schedule[day], ...(proData.schedule[day] || {}) };
                proData.schedule[day].gym = { ...defaultProData.schedule[day].gym, ...(proData.schedule[day].gym || {}) };
                proData.schedule[day].classes = proData.schedule[day].classes || [];
                proData.schedule[day].otherTasks = proData.schedule[day].otherTasks || [];
                proData.schedule[day].gym.workout = proData.schedule[day].gym.workout || [];
            });
            localStorage.setItem('proPlusData', JSON.stringify(proData));
        } else {
            console.log("No data in Firestore. Checking local backup.");
            loadDataFromLocalStorage();
            isFirebaseReady = true; 
            saveData();
        }
        
        if (isInitialLoad) {
            initializeAppUI();
            isInitialLoad = false;
        } else {
            const currentTab = document.querySelector('.nav-btn.active')?.dataset.tab;
            if (currentTab) {
                window.changeTab(currentTab, true);
            }
        }
        renderSidebarTaskChart();
        isFirebaseReady = true; 
    }, (error) => {
        console.error("Error listening to Firestore. Falling back to local data.", error);
        isFirebaseReady = false; 
        loadDataFromLocalStorage();
        if (isInitialLoad) {
            initializeAppUI();
            isInitialLoad = false;
        }
    });
}

function initializeAppUI() {
    applyTheme(true);
    window.changeTab('dashboard');
    renderSidebarTaskChart();
}

function bindUniversalEventListeners() {
    document.getElementById('project-form').addEventListener('submit', handleProjectFormSubmit);
    document.getElementById('task-form').addEventListener('submit', handleTaskFormSubmit);
    document.getElementById('habit-form').addEventListener('submit', handleHabitFormSubmit);
    document.getElementById('schedule-event-form').addEventListener('submit', handleScheduleEventFormSubmit);
    
    document.getElementById('event-specific-fields').addEventListener('click', e => {
        if(e.target.classList.contains('remove-exercise-btn')) {
            e.target.closest('.exercise-field-group').remove();
        }
    });
    
    document.getElementById('add-exercise-btn').addEventListener('click', () => {
        addExerciseField();
    });

    document.getElementById('schedule-event-type').addEventListener('change', (e) => {
        document.getElementById('class-fields').classList.toggle('hidden', e.target.value !== 'class');
        document.getElementById('gym-fields').classList.toggle('hidden', e.target.value !== 'gym');
    });

    document.getElementById('confirmation-modal').addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        if (target.id === 'confirm-btn' && window.confirmAction) window.confirmAction();
        if (target.id === 'merge-btn' && window.importMergeAction) window.importMergeAction();
        if (target.id === 'overwrite-btn' && window.importOverwriteAction) window.importOverwriteAction();
        
        closeModal('confirmation-modal');
    });
}


// --- THEME & SETTINGS ---
function applyTheme(isInitialLoad = false) {
    const theme = proData.settings.theme;
    document.documentElement.setAttribute('data-theme', theme);
    
    const isDashboard = document.querySelector('.nav-btn[data-tab="dashboard"].active');
    if (!isInitialLoad && isDashboard) {
        initDynamicBackground();
    }
}

window.changeTheme = (theme) => {
    proData.settings.theme = theme;
    applyTheme();
    saveData();
    if (charts.consistencyChart) { renderAnalyticsChart(); }
    if (charts.sidebarTaskChart) { renderSidebarTaskChart(); }
};

window.toggleSounds = (checkbox) => {
    proData.settings.sounds = checkbox.checked;
    saveData();
}

// --- TAB/VIEW MANAGEMENT ---
window.changeTab = (tabName, fromListener = false) => {
    if(!fromListener) soundManager.playSound('tabChange', 'C2');

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.nav-btn[data-tab="${tabName}"]`).classList.add('active');

    const main = document.getElementById('main-content');
    main.innerHTML = ''; 

    if (clockInterval) clearInterval(clockInterval);
    if (stopwatch.interval) clearInterval(stopwatch.interval);
    if (timer.interval) clearInterval(timer.interval);
    cleanupDynamicBackground();

    switch(tabName) {
        case 'dashboard': renderDashboard(); break;
        case 'projects': renderProjects(); break;
        case 'habits': renderHabitsPage(); break;
        case 'command': renderCommandCenter(); break;
        case 'journal': renderJournal(); break;
        case 'settings': renderSettings(); break;
    }
}

// --- DASHBOARD: SMART LAYOUT ---
function getSmartLayout() {
    let components = [
        { id: 'agenda', priority: 10, component: renderAgendaCard, width: 2, height: 2, focus: true },
        { id: 'utilities', priority: 8, component: renderUtilitiesCard, width: 2, height: 2, focus: true },
        { id: 'projects', priority: 7, component: renderProjectsOverviewCard, width: 1, height: 1 },
        { id: 'analytics', priority: 6, component: renderAnalyticsCard, width: 2, height: 1 },
    ];
    
    return components.sort((a, b) => b.priority - a.priority);
}

function getGreeting() {
    const hour = new Date().getHours();
    const userName = proData.settings?.userName;
    const greeting = hour < 12 ? "Good Morning" : hour < 18 ? "Good Afternoon" : "Good Evening";
    return `${greeting}${userName ? `, ${userName}` : ''}`;
}


function updateClock() {
    const dateEl = document.getElementById('current-date');
    const timeEl = document.getElementById('current-time');
    if (dateEl && timeEl) {
        const now = new Date();
        dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        timeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
}

window.toggleFocusMode = () => {
    document.body.classList.toggle('focus-mode');
    soundManager.playSound('uiClick', document.body.classList.contains('focus-mode') ? 'E4' : 'C4');
}

function renderDashboard() {
    const main = document.getElementById('main-content');
    const themeOptions = [
        { value: 'pro-plus-theme', text: 'Pro Plus' },
        { value: 'crimson-theme', text: 'Crimson' },
        { value: 'matrix-theme', text: 'Matrix' },
        { value: 'galaxy-theme', text: 'Galaxy' },
        { value: 'synthwave-theme', text: 'Synthwave' },
        { value: 'deep-sea-theme', text: 'Deep Sea' },
        { value: 'black-hole-theme', text: 'Black Hole' },
        { value: 'ocean-waves-theme', text: 'Ocean Waves' },
        { value: 'rocket-launch-theme', text: 'Rocket Launch' },
    ].map(opt => `<option value="${opt.value}" ${proData.settings.theme === opt.value ? 'selected' : ''}>${opt.text}</option>`).join('');

    main.innerHTML = `
        <header class="flex flex-wrap items-center justify-between mb-6 gap-4">
            <div>
                <h1 class="text-3xl sm:text-4xl font-bold font-orbitron text-header tracking-tight">${getGreeting()}</h1>
                <div class="flex items-center text-md text-secondary">
                    <span id="current-date"></span><span class="mx-2">|</span><span id="current-time"></span>
                </div>
            </div>
            <div id="dashboard-controls" class="flex items-center gap-2 md:gap-4">
                 <div class="control-group theme-control">
                     <select id="theme-dashboard-select" onchange="changeTheme(this.value)" class="pro-input !text-sm !p-2 !pr-8">${themeOptions}</select>
                 </div>
                <button onclick="toggleFocusMode()" class="secondary-btn focus-control" title="Toggle Focus Mode">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><circle cx="12" cy="12" r="3"></circle><path d="M7 12h-4"></path><path d="M12 7V3"></path><path d="M17 12h4"></path><path d="M12 17v4"></path></svg>
                    <span class="hidden md:inline">Focus</span>
                </button>
            </div>
        </header>
        <div id="smart-layout-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 auto-rows-[220px]"></div>
    `;
    updateClock();
    clockInterval = setInterval(updateClock, 1000);

    const grid = document.getElementById('smart-layout-grid');
    const layout = getSmartLayout();
    layout.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = `glass-card p-4 lg:p-6 no-hover`;
        if (item.id === 'agenda') {
            card.classList.add('clickable-card');
            card.classList.remove('no-hover');
            card.setAttribute('onclick', 'openScheduleModal()');
        }
        if(item.focus) card.classList.add('focus-priority');
        card.style.gridColumn = `span ${item.width}`;
        card.style.gridRow = `span ${item.height}`;
        card.style.setProperty('--animation-delay', `${index * 100}ms`);
        card.innerHTML = item.component(item);
        grid.appendChild(card);
        
        if(item.id === 'analytics') {
            setTimeout(() => renderAnalyticsChart(), 100);
        }
    });

    initDynamicBackground();
}

function renderAgendaCard() {
    const todayKey = new Date().toLocaleDateString('en-us', { weekday: 'long' }).toLowerCase();
    const todaySchedule = proData.schedule[todayKey] || { classes: [], gym: {}, otherTasks: [] };
    let content = '<p class="text-secondary flex items-center justify-center h-full">No events scheduled for today.</p>';

    const events = [
        ...(todaySchedule.classes || []).map(c => ({...c, type: 'class'})),
        ...(todaySchedule.otherTasks || []).map(t => ({...t, type: 'otherTask'})),
        ...(todaySchedule.gym?.title ? [{...todaySchedule.gym, name: todaySchedule.gym.title, type: 'gym'}] : [])
    ].sort((a, b) => (a.time || "00:00").split('-')[0].localeCompare((b.time || "00:00").split('-')[0]));

    if (events.length > 0) {
        content = `<div class="space-y-3 overflow-y-auto h-full max-h-[calc(100%-2rem)] pr-2">${events.map(event => `
            <div class="flex items-center text-sm">
                <span class="font-bold w-24">${(event.time || "00:00-00:00").split('-')[0].trim()}</span>
                <span class="h-4 w-px bg-[--card-border] mx-4"></span>
                <div class="flex-grow">
                    <p>${event.name}</p>
                    ${event.location ? `<p class="text-xs text-secondary">${event.location}</p>` : ''}
                </div>
            </div>
        `).join('')}</div>`;
    }
    return `
        <h3 class="text-xl font-bold font-orbitron mb-4 text-header">Today's Agenda</h3>
        <div class="flex-grow relative">${content}</div>
    `;
}

const todayISO = () => new Date().toISOString().split('T')[0];

function isHabitDoneToday(habitId) {
    const habit = proData.habits.find(h => h.id === habitId);
    if (!habit || !habit.history) return false;
    return habit.history.some(entry => entry.date === todayISO() && entry.done);
}

/**
 * [FIXED] Recalculates the streak for a habit based on its history.
 * This version is more robust and correctly handles consecutive days.
 * @param {object} habit - The habit object with a history array.
 * @returns {number} The calculated streak count.
 */
function recalculateStreak(habit) {
    if (!habit.history || habit.history.length === 0) return 0;

    const doneDates = habit.history
        .filter(entry => entry.done)
        .map(entry => {
            const date = new Date(entry.date);
            date.setUTCHours(12, 0, 0, 0); // Normalize to midday UTC to avoid timezone issues
            return date;
        })
        .sort((a, b) => b - a);
    
    // Remove duplicate dates
    const uniqueDates = doneDates.filter((date, index, self) =>
        index === self.findIndex(d => d.getTime() === date.getTime())
    );

    if (uniqueDates.length === 0) return 0;

    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const mostRecent = uniqueDates[0];

    // If the last completion was before yesterday, streak is broken.
    if (mostRecent.getTime() < yesterday.getTime()) {
        return 0;
    }

    let streak = 0;
    let currentDay = new Date(mostRecent);

    for (const date of uniqueDates) {
        if (date.getTime() === currentDay.getTime()) {
            streak++;
            currentDay.setDate(currentDay.getDate() - 1);
        } else {
            break; // Gap found, streak is broken
        }
    }
    return streak;
}


window.toggleHabit = (id) => {
    const habit = proData.habits.find(h => h.id === id);
    if(habit) {
        const todayStr = todayISO();
        let todayEntry = habit.history?.find(e => e.date === todayStr);
        
        if (todayEntry) {
            todayEntry.done = !todayEntry.done;
        } else {
            if(!habit.history) habit.history = [];
            habit.history.push({ date: todayStr, done: true });
        }

        habit.streak = recalculateStreak(habit);
        
        soundManager.playSound('taskComplete', todayEntry?.done ?? true ? 'G4' : 'G3');

        updateAndRefreshHabits();
    }
}

function updateAndRefreshHabits() {
    saveData();
    if(document.getElementById('habits-page-container')) {
        renderHabitListForPage();
    }
    
    const analyticsCard = document.querySelector('.glass-card:has(h3:contains("Weekly Analytics"))');
    if(analyticsCard) {
        analyticsCard.innerHTML = renderAnalyticsCard();
        setTimeout(() => renderAnalyticsChart(), 50);
    }
}

function renderProjectsOverviewCard() {
    if (!proData.projects || proData.projects.length === 0) {
        return `<h3 class="text-xl font-bold font-orbitron mb-4 text-header">Priority Project</h3><p class="text-secondary">No active projects.</p>`;
    }
    const highPriorityProject = [...proData.projects]
        .filter(p => p.status === 'active' && p.tasks.some(t => !t.done))
        .sort((a,b) => new Date(a.deadline) - new Date(b.deadline))[0] || proData.projects.find(p => p.status === 'active') || proData.projects[0];
    
    if (!highPriorityProject) {
        return `<h3 class="text-xl font-bold font-orbitron mb-4 text-header">Priority Project</h3><p class="text-secondary">No active projects.</p>`;
    }

    const progress = highPriorityProject.tasks.length > 0 ? Math.round((highPriorityProject.tasks.filter(t => t.done).length / highPriorityProject.tasks.length) * 100) : 0;
    
    return `
        <h3 class="text-xl font-bold font-orbitron mb-4 text-header">Priority Project</h3>
        <div class="h-full flex flex-col justify-between flex-grow">
            <div>
                <p class="font-bold text-[--accent-color-secondary]">${highPriorityProject.name}</p>
                <p class="text-xs text-secondary mt-1">Deadline: ${highPriorityProject.deadline}</p>
            </div>
            <div class="mt-4">
                <div class="flex justify-between items-baseline mb-1">
                    <p class="text-sm">Progress</p>
                    <p class="text-sm font-bold">${progress}%</p>
                </div>
                <div class="project-progress-bar"><div class="project-progress-inner" style="width: ${progress}%"></div></div>
            </div>
        </div>
    `;
}

function renderAnalyticsCard() {
    return `
        <h3 class="text-xl font-bold font-orbitron mb-4 text-header">Weekly Analytics</h3>
        <div class="flex-grow relative h-[calc(100%-40px)]">
            <canvas id="consistency-chart"></canvas>
        </div>
    `;
}

function renderAnalyticsChart() {
    const ctx = document.getElementById('consistency-chart');
    if(!ctx) return;
    if(charts.consistencyChart) charts.consistencyChart.destroy();
    
    const labels = [];
    const data = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
        const dateStr = d.toISOString().split('T')[0];
        
        const totalHabits = proData.habits.length;
        if(totalHabits === 0) {
            data.push(0);
            continue;
        }
        const completedHabits = proData.habits.filter(h => h.history?.some(e => e.date === dateStr && e.done)).length;
        data.push((completedHabits / totalHabits) * 100);
    }
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
    const accentColorSecondary = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-secondary').trim();

    charts.consistencyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Habit Consistency',
                data,
                backgroundColor: data.map(d => d === 100 ? accentColor : accentColorSecondary + '80'),
                borderColor: accentColor,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.1)'}, ticks: { color: 'var(--text-secondary)', callback: val => val + '%' } },
                x: { grid: { display: false }, ticks: { color: 'var(--text-secondary)'} }
            },
            plugins: { legend: { display: false }, tooltip: { enabled: true, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(0)}%` } } }
        }
    });
}

// --- DYNAMIC BACKGROUNDS (NEW) ---

function cleanupDynamicBackground() {
    if (threeJS.animator) {
        cancelAnimationFrame(threeJS.animator);
        threeJS.animator = null;
    }
    if (threeJS.renderer) {
        threeJS.renderer.domElement.remove();
        threeJS.renderer.dispose();
        threeJS.renderer = null;
    }
    document.getElementById('deep-sea-particles')?.remove();
    document.getElementById('synthwave-grid')?.remove();
}

function initDynamicBackground() {
    cleanupDynamicBackground();
    const theme = proData.settings.theme;
    
    // On small screens, skip heavy 3D backgrounds for performance.
    if (window.innerWidth <= 768) {
      const heavyThemes = ['galaxy-theme', 'pro-plus-theme', 'crimson-theme', 'matrix-theme', 'black-hole-theme', 'ocean-waves-theme', 'rocket-launch-theme'];
      if (heavyThemes.includes(theme)) {
        return; // Exit and let the CSS-based backgrounds show
      }
    }
    
    switch (theme) {
        case 'galaxy-theme':
            initGalaxyScene();
            break;
        case 'pro-plus-theme':
        case 'crimson-theme':
        case 'matrix-theme':
            initParticleScene();
            break;
        case 'deep-sea-theme':
            const particleContainer = document.createElement('div');
            particleContainer.id = 'deep-sea-particles';
            for (let i = 0; i < 50; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                particle.style.left = `${Math.random() * 100}vw`;
                particle.style.top = `${Math.random() * 100}vh`;
                particle.style.animationDuration = `${Math.random() * 20 + 10}s`;
                particle.style.animationDelay = `${Math.random() * -30}s`;
                particleContainer.appendChild(particle);
            }
            document.body.prepend(particleContainer);
            break;
        case 'synthwave-theme':
            const grid = document.createElement('div');
            grid.id = 'synthwave-grid';
            document.body.prepend(grid);
            break;
        case 'black-hole-theme':
            initBlackHoleScene();
            break;
        case 'ocean-waves-theme':
            initOceanWavesScene();
            break;
        case 'rocket-launch-theme':
            initRocketLaunchScene();
            break;
    }
}

function initParticleScene() {
    const container = document.body;
    threeJS.scene = new THREE.Scene();
    threeJS.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    threeJS.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    threeJS.renderer.setSize(window.innerWidth, window.innerHeight);
    threeJS.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    threeJS.renderer.domElement.className = 'three-canvas';
    container.prepend(threeJS.renderer.domElement);
    threeJS.camera.position.z = 15;

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-secondary').trim();
    const particles = new THREE.BufferGeometry();
    const positions = new Float32Array(5000 * 3);
    for (let i = 0; i < 5000 * 3; i++) positions[i] = (Math.random() - 0.5) * 30;
    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMaterial = new THREE.PointsMaterial({
        color: accentColor, size: 0.05, transparent: true, blending: THREE.AdditiveBlending,
    });
    threeJS.objects.particles = new THREE.Points(particles, particleMaterial);
    threeJS.scene.add(threeJS.objects.particles);

    const clock = new THREE.Clock();
    function animateParticles() {
        threeJS.animator = requestAnimationFrame(animateParticles);
        const elapsedTime = clock.getElapsedTime();
        threeJS.objects.particles.rotation.y = elapsedTime * 0.05;
        threeJS.objects.particles.rotation.x = threeJS.mouse.y * 0.2;
        threeJS.objects.particles.rotation.y += threeJS.mouse.x * 0.2;
        threeJS.renderer.render(threeJS.scene, threeJS.camera);
    }
    animateParticles();
}

function initGalaxyScene() {
    const container = document.body;
    threeJS.scene = new THREE.Scene();
    threeJS.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    threeJS.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    threeJS.renderer.setSize(window.innerWidth, window.innerHeight);
    threeJS.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    threeJS.renderer.domElement.className = 'three-canvas';
    container.prepend(threeJS.renderer.domElement);
    threeJS.camera.position.z = 30;
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    threeJS.scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffcc33, 2, 300);
    threeJS.scene.add(pointLight);

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = [];
    for (let i = 0; i < 10000; i++) {
        starPositions.push(THREE.MathUtils.randFloatSpread(200), THREE.MathUtils.randFloatSpread(200), THREE.MathUtils.randFloatSpread(200));
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.1 });
    threeJS.objects.stars = new THREE.Points(starGeometry, starMaterial);
    threeJS.scene.add(threeJS.objects.stars);

    const planetData = [
        { name: 'mercury', color: 0x999999, size: 0.5, distance: 8, speed: 0.004 },
        { name: 'venus', color: 0xffd700, size: 1, distance: 12, speed: 0.002 },
        { name: 'earth', color: 0x0077ff, size: 1.2, distance: 18, speed: 0.001 },
        { name: 'mars', color: 0xff5733, size: 0.8, distance: 25, speed: 0.0008 }
    ];
    threeJS.objects.planets = [];
    planetData.forEach(data => {
        const geometry = new THREE.SphereGeometry(data.size, 32, 32);
        const material = new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.8 });
        const planet = new THREE.Mesh(geometry, material);
        const pivot = new THREE.Object3D();
        pivot.add(planet);
        planet.position.x = data.distance;
        threeJS.scene.add(pivot);
        threeJS.objects.planets.push({ mesh: planet, pivot, speed: data.speed });
    });

    const clock = new THREE.Clock();
    function animateGalaxy() {
        threeJS.animator = requestAnimationFrame(animateGalaxy);
        threeJS.objects.planets.forEach(p => {
            p.pivot.rotation.y += p.speed;
            p.mesh.rotation.y += 0.01;
        });
        threeJS.objects.stars.rotation.y -= 0.0001;
        threeJS.renderer.render(threeJS.scene, threeJS.camera);
    }
    animateGalaxy();
}

function initBlackHoleScene() {
    const container = document.body;
    threeJS.scene = new THREE.Scene();
    threeJS.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    threeJS.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    threeJS.renderer.setSize(window.innerWidth, window.innerHeight);
    threeJS.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    threeJS.renderer.domElement.className = 'three-canvas';
    container.prepend(threeJS.renderer.domElement);
    threeJS.camera.position.z = 50;
    threeJS.camera.lookAt(0,0,0);

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
    const accentColorSecondary = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-secondary').trim();

    // Black Hole
    const blackHoleGeom = new THREE.SphereGeometry(2, 32, 32);
    const blackHoleMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    threeJS.objects.blackHole = new THREE.Mesh(blackHoleGeom, blackHoleMat);
    threeJS.scene.add(threeJS.objects.blackHole);

    // Accretion Disk
    const particleCount = 20000;
    const positions = new Float32Array(particleCount * 3);
    threeJS.objects.particleVelocities = [];
    const colors = new Float32Array(particleCount * 3);
    const color1 = new THREE.Color(accentColor);
    const color2 = new THREE.Color(accentColorSecondary);

    for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        const radius = Math.random() * 20 + 5;
        const angle = Math.random() * Math.PI * 2;
        positions[i3] = Math.cos(angle) * radius;
        positions[i3 + 1] = (Math.random() - 0.5) * 1.5;
        positions[i3 + 2] = Math.sin(angle) * radius;

        const mixedColor = color1.clone().lerp(color2, Math.random());
        colors[i3] = mixedColor.r;
        colors[i3 + 1] = mixedColor.g;
        colors[i3 + 2] = mixedColor.b;
        
        threeJS.objects.particleVelocities.push( ( (1 / radius) * 0.1) + Math.random() * 0.01 );
    }
    const particleGeom = new THREE.BufferGeometry();
    particleGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const particleMat = new THREE.PointsMaterial({ size: 0.1, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.7 });
    threeJS.objects.accretionDisk = new THREE.Points(particleGeom, particleMat);
    threeJS.objects.accretionDisk.rotation.x = Math.PI / 3;
    threeJS.scene.add(threeJS.objects.accretionDisk);

    const clock = new THREE.Clock();
    function animateBlackHole() {
        threeJS.animator = requestAnimationFrame(animateBlackHole);
        const delta = clock.getDelta();
        
        const positions = threeJS.objects.accretionDisk.geometry.attributes.position.array;
        for(let i=0; i < particleCount; i++) {
            const i3 = i * 3;
            const x = positions[i3];
            const z = positions[i3 + 2];
            const angle = Math.atan2(z, x) + threeJS.objects.particleVelocities[i];
            const radius = Math.sqrt(x*x + z*z);
            positions[i3] = Math.cos(angle) * radius;
            positions[i3+2] = Math.sin(angle) * radius;
        }
        threeJS.objects.accretionDisk.geometry.attributes.position.needsUpdate = true;
        
        threeJS.renderer.render(threeJS.scene, threeJS.camera);
    }
    animateBlackHole();
}

function initOceanWavesScene() {
    const container = document.body;
    threeJS.scene = new THREE.Scene();
    threeJS.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    threeJS.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    threeJS.renderer.setSize(window.innerWidth, window.innerHeight);
    threeJS.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    threeJS.renderer.domElement.className = 'three-canvas';
    container.prepend(threeJS.renderer.domElement);
    
    threeJS.camera.position.set(0, 20, 40);
    threeJS.camera.lookAt(0, 0, 0);

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();

    // Lighting
    threeJS.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 50, 50);
    threeJS.scene.add(dirLight);

    // Water plane
    const waterGeom = new THREE.PlaneGeometry(200, 200, 100, 100);
    const waterMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(accentColor),
        shininess: 100,
        transparent: true,
        opacity: 0.8,
    });
    const water = new THREE.Mesh(waterGeom, waterMat);
    water.rotation.x = -Math.PI / 2;
    threeJS.objects.water = water;
    threeJS.objects.water.originalVertices = Array.from(water.geometry.attributes.position.array);
    threeJS.scene.add(water);

    const clock = new THREE.Clock();
    function animateWaves() {
        threeJS.animator = requestAnimationFrame(animateWaves);
        const elapsedTime = clock.getElapsedTime();
        
        const vertices = threeJS.objects.water.geometry.attributes.position.array;
        const original = threeJS.objects.water.originalVertices;

        for (let i = 0; i < vertices.length; i += 3) {
            const x = original[i];
            const y = original[i + 1];
            // Manipulate z-coordinate (which is 'up' for the rotated plane)
            vertices[i + 2] = (Math.sin(x * 0.1 + elapsedTime) + Math.cos(y * 0.1 + elapsedTime)) * 1.5;
        }

        threeJS.objects.water.geometry.attributes.position.needsUpdate = true;
        threeJS.objects.water.geometry.computeVertexNormals();
        
        threeJS.renderer.render(threeJS.scene, threeJS.camera);
    }
    animateWaves();
}

function initRocketLaunchScene() {
    const container = document.body;
    threeJS.scene = new THREE.Scene();
    threeJS.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    threeJS.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    threeJS.renderer.setSize(window.innerWidth, window.innerHeight);
    threeJS.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    threeJS.renderer.domElement.className = 'three-canvas';
    container.prepend(threeJS.renderer.domElement);
    threeJS.camera.position.z = 80;

    // Stars
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = [];
    for (let i = 0; i < 5000; i++) {
        starPositions.push(THREE.MathUtils.randFloatSpread(400), THREE.MathUtils.randFloatSpread(400), THREE.MathUtils.randFloatSpread(200));
    }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xaaaaaa, size: 0.2 });
    threeJS.objects.stars = new THREE.Points(starGeometry, starMaterial);
    threeJS.scene.add(threeJS.objects.stars);
    
    // Rockets
    threeJS.objects.rockets = [];
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
    const accentColorSecondary = getComputedStyle(document.documentElement).getPropertyValue('--accent-color-secondary').trim();

    for (let i = 0; i < 15; i++) {
        const rocket = new THREE.Group();

        // Body
        const bodyMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
        const bodyGeom = new THREE.CylinderGeometry(0.5, 0.8, 4, 8);
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        rocket.add(body);

        // Nose
        const noseMat = new THREE.MeshPhongMaterial({ color: new THREE.Color(accentColor) });
        const noseGeom = new THREE.ConeGeometry(0.5, 2, 8);
        const nose = new THREE.Mesh(noseGeom, noseMat);
        nose.position.y = 3;
        rocket.add(nose);
        
        // Flame
        const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accentColorSecondary) });
        const flameGeom = new THREE.ConeGeometry(0.5, 1.5, 8);
        const flame = new THREE.Mesh(flameGeom, flameMat);
        flame.position.y = -2.5;
        flame.rotation.x = Math.PI;
        rocket.add(flame);

        rocket.position.x = THREE.MathUtils.randFloatSpread(150);
        rocket.position.y = THREE.MathUtils.randFloatSpread(150) - 100;
        rocket.position.z = THREE.MathUtils.randFloatSpread(50) - 50;
        rocket.rotation.z = Math.PI;
        rocket.speed = Math.random() * 0.2 + 0.1;
        threeJS.scene.add(rocket);
        threeJS.objects.rockets.push(rocket);
    }
    
    function animateRockets() {
        threeJS.animator = requestAnimationFrame(animateRockets);
        
        threeJS.objects.rockets.forEach(rocket => {
            rocket.position.y += rocket.speed;
            rocket.children[2].scale.y = Math.random() * 0.5 + 0.8; // flicker flame
            if(rocket.position.y > 100) {
                rocket.position.y = -100;
                rocket.position.x = THREE.MathUtils.randFloatSpread(150);
            }
        });

        threeJS.renderer.render(threeJS.scene, threeJS.camera);
    }
    animateRockets();
}


// --- SIDEBAR CHART (NEW) ---
function calculateTaskStats() {
    let completed = 0;
    let total = 0;
    (proData.projects || []).forEach(project => {
        if (project.status === 'active') {
            total += project.tasks.length;
            completed += project.tasks.filter(t => t.done).length;
        }
    });
    return { completed, pending: total - completed, total };
}

function renderSidebarTaskChart() {
    const ctx = document.getElementById('sidebar-task-chart');
    if (!ctx) return;

    if (charts.sidebarTaskChart) {
        charts.sidebarTaskChart.destroy();
    }

    const stats = calculateTaskStats();
    document.getElementById('sidebar-stats').textContent = `${stats.completed} of ${stats.total} tasks complete`;
    
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();

    charts.sidebarTaskChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Completed', 'Pending'],
            datasets: [{
                data: [stats.completed, stats.pending],
                backgroundColor: [accentColor, 'rgba(170, 166, 195, 0.2)'],
                borderColor: 'transparent',
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        label: (ctx) => ` ${ctx.label}: ${ctx.raw}`
                    }
                }
            }
        }
    });
}


// --- PROJECTS PAGE (UPGRADED & FIXED) ---
function updateAndRefreshProjects() {
    if (document.getElementById('projects-container')) {
        handleFilterSortChange();
    }
    saveData();
    renderSidebarTaskChart();
}

function renderProjects() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <header class="flex flex-wrap items-center justify-between mb-6 gap-4">
            <h1 class="text-3xl sm:text-4xl font-bold font-orbitron text-header tracking-tight">Projects</h1>
            <div class="flex items-center gap-2">
                <select id="project-status-filter" onchange="handleFilterSortChange()" class="pro-input text-sm">
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                </select>
                <select id="project-sort" onchange="handleFilterSortChange()" class="pro-input text-sm">
                    <option value="deadline">Sort by Deadline</option>
                    <option value="name_asc">Sort by Name (A-Z)</option>
                    <option value="name_desc">Sort by Name (Z-A)</option>
                    <option value="progress">Sort by Progress</option>
                </select>
            </div>
            <button onclick="openModal('project-modal')" class="pro-btn">New Project</button>
        </header>
        <div id="projects-container" class="space-y-6"></div>
    `;
    
    handleFilterSortChange();
}

window.handleFilterSortChange = () => {
    const container = document.getElementById('projects-container');
    if (!container) return;
    const filterValue = document.getElementById('project-status-filter').value;
    const sortValue = document.getElementById('project-sort').value;

    let projectsToDisplay = (proData.projects || []).filter(p => {
        const progress = p.tasks.length > 0 ? (p.tasks.filter(t => t.done).length / p.tasks.length) * 100 : 0;
        if (filterValue === 'completed') {
            return progress === 100 && p.status === 'active';
        }
        return p.status === filterValue;
    });

    projectsToDisplay.sort((a, b) => {
        switch(sortValue) {
            case 'deadline': return new Date(a.deadline) - new Date(b.deadline);
            case 'name_asc': return a.name.localeCompare(b.name);
            case 'name_desc': return b.name.localeCompare(a.name);
            case 'progress': {
                const progressA = a.tasks.length > 0 ? (a.tasks.filter(t => t.done).length / a.tasks.length) : 0;
                const progressB = b.tasks.length > 0 ? (b.tasks.filter(t => t.done).length / b.tasks.length) : 0;
                return progressB - progressA;
            }
            default: return 0;
        }
    });

    container.innerHTML = '';
    if (projectsToDisplay.length === 0) {
        container.innerHTML = `<div class="glass-card text-center p-8"><p class="text-secondary">No projects match the current filter.</p></div>`;
    } else {
        projectsToDisplay.forEach((p, index) => container.appendChild(createProjectCard(p, index)));
    }
}

function createProjectCard(project, index) {
    const card = document.createElement('div');
    card.className = 'glass-card p-6';
    card.style.setProperty('--animation-delay', `${index * 100}ms`);
    
    const deadline = new Date(project.deadline);
    const today = new Date();
    today.setHours(0,0,0,0);
    const timeDiff = deadline.getTime() - today.getTime();
    const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

    if (project.status === 'active' && dayDiff < 0) {
        card.classList.add('deadline-overdue');
    } else if (project.status === 'active' && dayDiff <= 7) {
        card.classList.add('deadline-warning');
    }
    
    const progress = project.tasks.length > 0 ? Math.round((project.tasks.filter(t => t.done).length / project.tasks.length) * 100) : 0;
    
    const tasksHTML = project.tasks.sort((a,b) => b.priority - a.priority).map(task => `
        <div class="flex items-center justify-between py-2 border-b border-[--card-border]">
            <label for="${task.id}" class="flex items-center cursor-pointer text-sm">
                <input type="checkbox" id="${task.id}" ${task.done ? 'checked' : ''} onchange="toggleProjectTask('${project.id}', '${task.id}')" class="hidden">
                <span class="checkbox-custom ${task.done ? 'checked' : ''}"></span>
                <span class="priority-indicator priority-${task.priority}"></span>
                <span class="${task.done ? 'line-through text-secondary' : ''}">${task.text}</span>
            </label>
        </div>
    `).join('');
    
    let actionButtons = '';
    if (project.status === 'active') {
        actionButtons += `<button onclick='openModal("project-modal", proData.projects.find(p => p.id === "${project.id}"))' class="secondary-btn text-xs py-1 px-2">Edit</button>`;
        if (progress === 100) {
            actionButtons += `<button onclick="archiveProject('${project.id}')" class="secondary-btn text-xs py-1 px-2 ml-2">Archive</button>`;
        }
        actionButtons += `<button onclick="showConfirmation({ title: 'Delete Project?', message: 'Are you sure you want to delete this project?', confirmText: 'Delete' }, () => deleteProject('${project.id}'))" class="danger-btn text-xs py-1 px-2 ml-2">Delete</button>`;
    } else if (project.status === 'archived') {
        actionButtons = `<button onclick="unarchiveProject('${project.id}')" class="secondary-btn text-xs py-1 px-2">Restore</button>
                         <button onclick="showConfirmation({ title: 'Delete Permanently?', message: 'This will permanently delete the project and its tasks. This is irreversible.', confirmText: 'Delete' }, () => deleteProject('${project.id}'))" class="danger-btn text-xs py-1 px-2 ml-2">Delete Permanently</button>`;
    }


    card.innerHTML = `
        <div class="flex justify-between items-start">
            <div>
                <h3 class="text-xl font-bold font-orbitron text-header">${project.name}</h3>
                <p class="text-sm text-secondary mt-1">${project.description}</p>
                <p class="text-xs text-secondary mt-2">Deadline: ${project.deadline} ${project.status === 'active' && dayDiff >= 0 ? `(${dayDiff} days left)` : ''}</p>
            </div>
            <div class="flex items-center">
                ${actionButtons}
            </div>
        </div>
        <div class="mt-4">
            <div class="flex justify-between items-baseline mb-1">
                <p class="text-sm">Progress (${project.tasks.filter(t=>t.done).length}/${project.tasks.length})</p>
                <p class="text-sm font-bold">${progress}%</p>
            </div>
            <div class="project-progress-bar"><div class="project-progress-inner" style="width: ${progress}%"></div></div>
        </div>
        <div class="mt-4 space-y-2">${project.status === 'active' ? tasksHTML : '<p class="text-sm text-secondary text-center">Project is archived. Restore to see tasks.</p>'}</div>
        ${project.status === 'active' ? `<button onclick="openModal('task-modal', { projectId: '${project.id}' })" class="secondary-btn w-full mt-4 text-sm">Add Task</button>` : ''}
    `;
    return card;
}


// --- COMMAND CENTER ---
function renderCommandCenter() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <header class="mb-6">
            <h1 class="text-3xl sm:text-4xl font-bold font-orbitron text-header tracking-tight">Command Center</h1>
            <p class="text-md text-secondary">Your AI-powered mission control. Try: "What's my top priority?"</p>
        </header>
        <div class="glass-card h-[calc(100%-120px)] flex flex-col p-4">
            <div id="ai-chat-body" class="flex-grow space-y-4 overflow-y-auto p-4 flex flex-col">
                <div class="ai-message">Hello! I'm your PRO PLUS assistant. How can I help you optimize your day?</div>
            </div>
            <form id="ai-chat-form" class="mt-4 flex gap-4">
                <input id="ai-chat-input" type="text" placeholder="e.g., 'Add task to Personal Website...'" class="pro-input flex-grow">
                <button type="submit" class="pro-btn">Send</button>
            </form>
        </div>
    `;
    document.getElementById('ai-chat-form').addEventListener('submit', handleAssistantChat);
}

// --- JOURNAL ---
function renderJournal() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <header class="mb-6">
            <h1 class="text-3xl sm:text-4xl font-bold font-orbitron text-header tracking-tight">Journal</h1>
            <p class="text-md text-secondary">A secure space for your thoughts.</p>
        </header>
        <div class="glass-card h-[calc(100%-100px)] flex flex-col p-2">
            <textarea id="journal-textarea" class="w-full h-full bg-transparent p-4 text-base leading-relaxed resize-none focus:outline-none" placeholder="Start writing...">${proData.journal || ''}</textarea>
        </div>
    `;
    const textarea = document.getElementById('journal-textarea');
    let timeout;
    textarea.addEventListener('keyup', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            proData.journal = e.target.value;
            saveData();
        }, 500);
    });
}

// --- SETTINGS (UPGRADED & FIXED) ---
function renderSettings() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <header class="mb-6">
            <h1 class="text-3xl sm:text-4xl font-bold font-orbitron text-header tracking-tight">Settings</h1>
            <p class="text-md text-secondary">Configure your PRO PLUS experience.</p>
        </header>
        <div class="space-y-6 max-w-2xl">
            <div class="glass-card p-6">
                <h3 class="text-xl font-bold mb-4 text-[--accent-color]">Personalization</h3>
                <div class="space-y-2">
                    <label for="user-name-input" class="block text-sm font-medium text-secondary">Your Name</label>
                    <input type="text" id="user-name-input" class="pro-input w-full" value="${proData.settings.userName || ''}" onkeyup="handleUserNameChange(this)" placeholder="Enter your name for greetings">
                </div>
            </div>

            <div class="glass-card p-6">
                <h3 class="text-xl font-bold mb-4 text-[--accent-color]">Your User ID</h3>
                <p class="text-xs text-secondary mb-2">This is your unique ID for data storage. You can use it to share data in future collaborative features.</p>
                <div class="flex items-center gap-2 p-2 rounded-lg bg-[--bg-primary]">
                    <input type="text" id="user-id-display" readonly value="${firebase.userId || 'Loading...'}" class="pro-input flex-grow !p-1 !border-0 !bg-transparent">
                    <button onclick="copyUserId()" class="secondary-btn text-xs !py-1 !px-2">Copy</button>
                </div>
            </div>

            <div class="glass-card p-6">
                <h3 class="text-xl font-bold mb-4 text-[--accent-color]">Sound</h3>
                 <div class="flex items-center justify-between mt-4">
                      <label for="sound-toggle" class="text-sm font-medium text-secondary">Enable Sounds</label>
                      <input type="checkbox" id="sound-toggle" onchange="toggleSounds(this)" class="toggle-switch">
                 </div>
            </div>

            <div class="glass-card p-6">
                <h3 class="text-xl font-bold mb-4 text-[--accent-color]">Data Management</h3>
                <div class="space-y-4">
                        <div>
                            <h4 class="font-semibold mb-2">Import Data</h4>
                            <p class="text-xs text-secondary mb-2">Import a backup file or schedule.</p>
                            <div class="flex gap-2">
                                <label for="import-data-input" class="secondary-btn cursor-pointer w-full text-center">Import JSON</label>
                                <input type="file" id="import-data-input" class="hidden" accept=".json" onchange="importData(event)">
                                 <label for="import-csv-input" class="secondary-btn cursor-pointer w-full text-center">Import CSV</label>
                                <input type="file" id="import-csv-input" class="hidden" accept=".csv" onchange="importScheduleFromCSV(event)">
                            </div>
                        </div>
                        <div>
                            <h4 class="font-semibold mb-2">Export Timetable</h4>
                            <p class="text-xs text-secondary mb-2">Export your weekly schedule.</p>
                            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                <button onclick="exportSchedule('ics')" class="secondary-btn text-sm">ICS</button>
                                <button onclick="exportSchedule('csv')" class="secondary-btn text-sm">CSV</button>
                                <button onclick="exportSchedule('json')" class="secondary-btn text-sm">JSON</button>
                                <button onclick="exportSchedule('pdf')" class="secondary-btn text-sm">PDF</button>
                                <button onclick="exportSchedule('word')" class="secondary-btn text-sm">Word</button>
                            </div>
                        </div>
                        <div>
                            <h4 class="font-semibold mb-2">Export Full Backup</h4>
                            <p class="text-xs text-secondary mb-2">Save a full backup of all your data.</p>
                            <button onclick="exportData()" class="secondary-btn w-full">Export All Data (JSON)</button>
                        </div>
                </div>
            </div>

            <div class="glass-card p-6">
                <h3 class="text-xl font-bold mb-4 text-[--danger-color]">Danger Zone</h3>
                <button onclick="showConfirmation({ title: 'Confirm Reset', message: 'This will reset all data. This action is irreversible!', confirmText: 'Reset' }, resetAllData)" class="danger-btn w-full">Reset All Data</button>
            </div>
        </div>
    `;
    document.getElementById('sound-toggle').checked = proData.settings.sounds;
}

window.copyUserId = () => {
    const userIdInput = document.getElementById('user-id-display');
    const copyBtn = document.querySelector('[onclick="copyUserId()"]');
    
    userIdInput.select();
    userIdInput.setSelectionRange(0, 99999); 
    
    try {
        document.execCommand('copy');
        soundManager.playSound('uiClick', 'G4');
        
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.disabled = true;
        
        setTimeout(() => { 
            copyBtn.textContent = originalText; 
            copyBtn.disabled = false;
        }, 2000);
    } catch (err) {
        console.error('Failed to copy User ID: ', err);
        soundManager.playSound('error', 'C3');
    }
}

// --- MODALS & FORMS ---
window.openModal = (modalId, data = null) => {
    soundManager.playSound('modalOpen', 'A3');
    const modal = document.getElementById(modalId);
    
    const form = modal.querySelector('form');
    if (form) form.reset();

    if (modalId === 'project-modal') {
        const project = data; // Data is the project object
        document.getElementById('project-id').value = project?.id || '';
        document.getElementById('project-name').value = project?.name || '';
        document.getElementById('project-description').value = project?.description || '';
        document.getElementById('project-deadline').value = project?.deadline || '';
        document.getElementById('project-modal-title').textContent = project ? 'Edit Project' : 'New Project';
    }

    if (modalId === 'task-modal' && data) {
        document.getElementById('task-project-id').value = data.projectId;
    }

    modal.classList.add('visible');
    setTimeout(() => {
        const firstInput = modal.querySelector('input[type="text"], input[type="date"], select, textarea');
        if (firstInput) firstInput.focus();
    }, 100);
}


window.closeModal = (modalId) => {
    soundManager.playSound('modalOpen', 'G3');
    document.getElementById(modalId).classList.remove('visible');
}



function handleTaskFormSubmit(e) {
    e.preventDefault();
    const projectId = document.getElementById('task-project-id').value;
    const taskName = document.getElementById('task-name').value;
    const taskPriority = parseInt(document.getElementById('task-priority').value);
    const project = proData.projects.find(p => p.id === projectId);
    if (project) {
        project.tasks.push({ id: `task-${Date.now()}`, text: taskName, done: false, priority: taskPriority });
        updateAndRefreshProjects();
    }
    window.closeModal('task-modal');
}

window.toggleProjectTask = (projectId, taskId) => {
    const project = proData.projects.find(p => p.id === projectId);
    if (project) {
        const task = project.tasks.find(t => t.id === taskId);
        if (task) {
            task.done = !task.done;
            soundManager.playSound('taskComplete', task.done ? 'E4' : 'E3');
            updateAndRefreshProjects();
        }
    }
}

window.deleteProject = (projectId) => {
    proData.projects = proData.projects.filter(p => p.id !== projectId);
    updateAndRefreshProjects();
}

window.archiveProject = (projectId) => {
    const project = proData.projects.find(p => p.id === projectId);
    if(project) {
        project.status = 'archived';
        updateAndRefreshProjects();
    }
}
window.unarchiveProject = (projectId) => {
    const project = proData.projects.find(p => p.id === projectId);
    if(project) {
        project.status = 'active';
        updateAndRefreshProjects();
    }
}

// --- NEW SETTINGS LOGIC ---
window.openHabitModal = (habitId = null) => {
    const title = document.getElementById('habit-modal-title');
    const idInput = document.getElementById('habit-id');
    const nameInput = document.getElementById('habit-name');
    const priorityInput = document.getElementById('habit-priority');

    if (habitId) {
        const habit = proData.habits.find(h => h.id === habitId);
        title.textContent = "Edit Habit";
        idInput.value = habit.id;
        nameInput.value = habit.text;
        priorityInput.value = habit.priority;
    } else {
        title.textContent = "New Habit";
        idInput.value = '';
        nameInput.value = '';
        priorityInput.value = 3;
    }
    openModal('habit-modal');
}

function handleHabitFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('habit-id').value;
    const text = document.getElementById('habit-name').value;
    const priority = parseInt(document.getElementById('habit-priority').value);

    if (id) {
        const habit = proData.habits.find(h => h.id === id);
        habit.text = text;
        habit.priority = priority;
    } else {
        const newHabit = {
            id: `habit-${Date.now()}`,
            text,
            priority,
            streak: 0,
            history: []
        };
        proData.habits.push(newHabit);
    }
    if (document.getElementById('habits-page-container')) {
        renderHabitListForPage();
    }
    saveData();
    closeModal('habit-modal');
}

window.deleteHabit = (habitId) => {
    proData.habits = proData.habits.filter(h => h.id !== habitId);
    if (document.getElementById('habits-page-container')) {
        renderHabitListForPage();
    }
    saveData();
}

let nameChangeTimeout;
window.handleUserNameChange = (input) => {
    clearTimeout(nameChangeTimeout);
    nameChangeTimeout = setTimeout(() => {
        proData.settings.userName = input.value;
        saveData();
    }, 500);
}


window.showConfirmation = (options, callback) => {
    const { title, message, confirmText, isDanger = true, buttons } = options;

    document.getElementById('confirmation-title').textContent = title || 'Confirm Action';
    document.getElementById('confirmation-message').textContent = message;

    const buttonsContainer = document.getElementById('confirmation-buttons');
    
    window.confirmAction = null;
    window.importMergeAction = null;
    window.importOverwriteAction = null;

    if (buttons) {
        buttonsContainer.innerHTML = buttons;
    } else {
        buttonsContainer.innerHTML = `
            <button id="confirm-btn" class="${isDanger ? 'danger-btn' : 'pro-btn'} font-semibold py-2 px-8 rounded-lg">${confirmText || 'Confirm'}</button>
            <button id="cancel-btn" class="secondary-btn font-semibold py-2 px-8 rounded-lg">Cancel</button>
        `;
        window.confirmAction = callback;
    }
    
    openModal('confirmation-modal');
}


// --- DATA MANAGEMENT (UPGRADED) ---
window.exportData = () => {
    const dataStr = JSON.stringify(proData, null, 2);
    const blob = new Blob([dataStr], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pro_plus_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

window.importData = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            if (importedData.settings && importedData.projects && importedData.habits) {
                window.importMergeAction = () => {
                    proData.projects.push(...importedData.projects.filter(p => !proData.projects.some(p2 => p2.id === p.id)));
                    proData.habits.push(...importedData.habits.filter(h => !proData.habits.some(h2 => h2.id === h.id)));
                    if (importedData.journal && !proData.journal) proData.journal = importedData.journal;
                    saveData();
                    initializeAppUI();
                };
                window.importOverwriteAction = () => {
                    proData = importedData;
                    saveData();
                    initializeAppUI();
                };

                showConfirmation({
                    title: 'Import Data',
                    message: 'How would you like to import this data? "Merge" will add new items, while "Overwrite" will replace all existing data.',
                    buttons: `
                        <button id="merge-btn" class="pro-btn font-semibold py-2 px-6 rounded-lg">Merge</button>
                        <button id="overwrite-btn" class="danger-btn font-semibold py-2 px-6 rounded-lg">Overwrite</button>
                        <button id="cancel-btn" class="secondary-btn font-semibold py-2 px-6 rounded-lg">Cancel</button>
                    `
                });
            } else {
                showConfirmation({title: "Import Failed", message: "The selected file is not a valid PRO PLUS backup.", buttons: `<button id="cancel-btn" class="secondary-btn font-semibold py-2 px-6 rounded-lg">OK</button>`});
                soundManager.playSound('error', 'C3');
            }
        } catch (err) {
            showConfirmation({title: "Import Failed", message: "There was an error reading the backup file.", buttons: `<button id="cancel-btn" class="secondary-btn font-semibold py-2 px-6 rounded-lg">OK</button>`});
            soundManager.playSound('error', 'C3');
        }
    };
    reader.readAsText(file);
    event.target.value = null; 
}


window.resetAllData = () => {
    proData = JSON.parse(JSON.stringify(defaultProData));
    saveData();
    window.changeTab('dashboard', true);
}

// --- SCHEDULE MODAL (UPGRADED & FIXED) ---

function refreshDashboardAgenda() {
    const isDashboardActive = document.querySelector('.nav-btn[data-tab="dashboard"].active');
    if (!isDashboardActive) return;

    const allCards = document.querySelectorAll('#smart-layout-grid .glass-card');
    for(const card of allCards) {
        const titleEl = card.querySelector('h3');
        if (titleEl && titleEl.textContent === "Today's Agenda") {
            card.innerHTML = renderAgendaCard();
            break; 
        }
    }
}

window.openScheduleModal = () => {
    soundManager.playSound('modalOpen', 'A3');
    const modalBody = document.getElementById('schedule-modal-body');
    if (modalBody) {
        modalBody.innerHTML = renderFullScheduleView();
    }
    openModal('schedule-modal');
}

window.openDayViewModal = (dayKey) => {
    soundManager.playSound('modalOpen', 'A4');
    const modalBody = document.getElementById('day-view-modal-body');
    const modalTitle = document.getElementById('day-view-modal-title');
    if (modalBody) {
        modalTitle.textContent = `${proData.schedule[dayKey].day}'s Timeline`;
        modalBody.innerHTML = renderDayView(dayKey);
    }
    openModal('day-view-modal');
}

window.openScheduleEventModal = (dayKey, eventType, eventId = null) => {
    const form = document.getElementById('schedule-event-form');
    form.reset();
    
    document.getElementById('schedule-day-key').value = dayKey;
    document.getElementById('schedule-event-id').value = eventId || '';
    document.getElementById('schedule-event-original-type').value = eventId ? eventType : '';
    document.getElementById('schedule-event-modal-title').textContent = eventId ? 'Edit Event' : 'Add Event';
    
    const eventTypeSelect = document.getElementById('schedule-event-type');
    eventTypeSelect.value = eventType;
    eventTypeSelect.dispatchEvent(new Event('change'));

    document.getElementById('gym-workout-container').innerHTML = '';
    
    if (eventId) {
        // Populate form with existing data
        const dayData = proData.schedule[dayKey];
        let eventData;
        if (eventType === 'class') eventData = dayData.classes.find(e => e.id === eventId);
        else if (eventType === 'otherTask') eventData = dayData.otherTasks.find(e => e.id === eventId);
        else if (eventType === 'gym') eventData = dayData.gym;

        if (eventData) {
            const [start, end] = (eventData.time || "00:00-00:00").split('-');
            document.getElementById('schedule-event-start-time').value = start?.trim();
            document.getElementById('schedule-event-end-time').value = end?.trim();
            document.getElementById('schedule-event-name').value = eventData.name || eventData.title;
            if (eventType === 'class') {
                document.getElementById('schedule-event-location').value = eventData.location;
            }
            if (eventType === 'gym' && eventData.workout) {
                eventData.workout.forEach(ex => addExerciseField(ex.exercise, ex.setsReps));
            }
        }
    }
    
    openModal('schedule-event-modal');
}

function addExerciseField(exercise = '', setsReps = '') {
    const container = document.getElementById('gym-workout-container');
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2 exercise-field-group';
    div.innerHTML = `
        <input type="text" placeholder="Exercise" value="${exercise}" class="pro-input flex-grow gym-exercise-name">
        <input type="text" placeholder="Sets/Reps" value="${setsReps}" class="pro-input flex-grow gym-exercise-sets">
        <button type="button" class="danger-btn text-xs !py-1 !px-2 remove-exercise-btn">&times;</button>
    `;
    container.appendChild(div);
}

function handleScheduleEventFormSubmit(e) {
    e.preventDefault();
    const dayKey = document.getElementById('schedule-day-key').value;
    const eventId = document.getElementById('schedule-event-id').value;
    const originalType = document.getElementById('schedule-event-original-type').value;
    const eventType = document.getElementById('schedule-event-type').value;
    
    const time = `${document.getElementById('schedule-event-start-time').value} - ${document.getElementById('schedule-event-end-time').value}`;
    const name = document.getElementById('schedule-event-name').value;
    const newId = `${eventType}-${Date.now()}`;
    const scheduleDay = proData.schedule[dayKey];

    // [FIX] If editing, remove the old event first
    if (eventId) {
        if (originalType === 'class') scheduleDay.classes = scheduleDay.classes.filter(e => e.id !== eventId);
        else if (originalType === 'otherTask') scheduleDay.otherTasks = scheduleDay.otherTasks.filter(e => e.id !== eventId);
        else if (originalType === 'gym') scheduleDay.gym = { id: '', title: '', time: '', workout: [] };
    }

    // Add the new or updated event to the correct category
    if (eventType === 'class') {
        const newClass = { id: eventId || newId, name, time, location: document.getElementById('schedule-event-location').value };
        scheduleDay.classes.push(newClass);
    } else if (eventType === 'otherTask') {
        const newTask = { id: eventId || newId, name, time };
        scheduleDay.otherTasks.push(newTask);
    } else if (eventType === 'gym') {
        const workout = [];
        document.querySelectorAll('.exercise-field-group').forEach(group => {
            const exercise = group.querySelector('.gym-exercise-name').value;
            const setsReps = group.querySelector('.gym-exercise-sets').value;
            if (exercise) workout.push({ exercise, setsReps });
        });
        scheduleDay.gym = { id: eventId || newId, title: name, time, workout };
    }

    saveData();
    closeModal('schedule-event-modal');
    
    // Refresh relevant views
    if (document.getElementById('day-view-modal').classList.contains('visible')) {
        document.getElementById('day-view-modal-body').innerHTML = renderDayView(dayKey);
    }
    if (document.getElementById('schedule-modal').classList.contains('visible')) {
        document.getElementById('schedule-modal-body').innerHTML = renderFullScheduleView();
    }
    const todayKey = new Date().toLocaleDateString('en-us', { weekday: 'long' }).toLowerCase();
    if (dayKey === todayKey) {
       refreshDashboardAgenda();
    }
}


function renderFullScheduleView() {
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const todayKey = new Date().toLocaleDateString('en-us', { weekday: 'long' }).toLowerCase();

    return weekdays.map(dayKey => {
        const dayData = proData.schedule[dayKey];
        if (!dayData) return '';

        const events = [
            ...(dayData.classes || []).map(c => ({...c, type: 'class'})),
            ...(dayData.otherTasks || []).map(t => ({...t, type: 'otherTask'})),
            ...(dayData.gym?.title ? [{...dayData.gym, name: dayData.gym.title, type: 'gym'}] : [])
        ].sort((a, b) => (a.time || "00:00").split('-')[0].localeCompare((b.time || "00:00").split('-')[0]));
        
        const isTodayClass = dayKey === todayKey ? 'is-today' : '';

        let eventsHTML = `<p class="text-sm text-secondary pl-12">No events scheduled.</p>`;
        if (events.length > 0) {
            eventsHTML = events.map(event => `
                <div class="schedule-event">
                    <span class="schedule-event-time">${(event.time || "00:00").split('-')[0].trim()}</span>
                    <div class="schedule-event-details">
                        <p class="schedule-event-name">${event.name}</p>
                        ${event.location ? `<p class="schedule-event-location">${event.location}</p>` : ''}
                    </div>
                </div>
            `).join('');
        }

        return `
            <div class="schedule-day-card is-clickable ${isTodayClass}" onclick="openDayViewModal('${dayKey}')">
                <div class="schedule-day-header">
                    <span>${dayData.day}</span>
                </div>
                ${eventsHTML}
            </div>
        `;
    }).join('');
}


function renderDayView(dayKey) {
    const dayData = proData.schedule[dayKey];
    if (!dayData) return '<p>No data for this day.</p>';
    
    const renderCategory = (title, items, type, renderItem) => {
        return `
            <div class="day-view-category">
                <div class="day-view-category-header">
                    <h4 class="day-view-category-title">${title}</h4>
                    <button onclick="openScheduleEventModal('${dayKey}', '${type}')" class="secondary-btn text-xs py-1 px-2">+ Add</button>
                </div>
                <div class="space-y-2">
                    ${items && items.length > 0 ? items.map(renderItem).join('') : '<p class="text-sm text-secondary">Nothing scheduled.</p>'}
                </div>
            </div>
        `;
    };

    const renderClass = (item) => `
        <div class="schedule-event group">
            <span class="schedule-event-time">${item.time}</span>
            <div class="schedule-event-details">
                <p class="schedule-event-name">${item.name}</p>
                <p class="schedule-event-location">${item.location}</p>
            </div>
            <div class="event-actions">
                <button onclick="openScheduleEventModal('${dayKey}', 'class', '${item.id}')" class="edit-event-btn">Edit</button>
                <button onclick="deleteScheduleEvent('${dayKey}', 'class', '${item.id}')" class="delete-event-btn">&times;</button>
            </div>
        </div>
    `;
    
    const renderOtherTask = (item) => `
        <div class="schedule-event group">
            <span class="schedule-event-time">${item.time}</span>
            <div class="schedule-event-details"><p class="schedule-event-name">${item.name}</p></div>
             <div class="event-actions">
                <button onclick="openScheduleEventModal('${dayKey}', 'otherTask', '${item.id}')" class="edit-event-btn">Edit</button>
                <button onclick="deleteScheduleEvent('${dayKey}', 'otherTask', '${item.id}')" class="delete-event-btn">&times;</button>
            </div>
        </div>
    `;

    const gymHTML = () => {
        const gymData = dayData.gym;
        if (!gymData || !gymData.title) {
            return '<p class="text-sm text-secondary">No workout scheduled.</p>';
        }
        return `
            <div class="schedule-event group">
                <span class="schedule-event-time">${gymData.time}</span>
                <div class="schedule-event-details">
                    <p class="schedule-event-name">${gymData.title}</p>
                </div>
                 <div class="event-actions">
                    <button onclick="openScheduleEventModal('${dayKey}', 'gym', '${gymData.id}')" class="edit-event-btn">Edit</button>
                    <button onclick="deleteScheduleEvent('${dayKey}', 'gym', '${gymData.id}')" class="delete-event-btn">&times;</button>
                </div>
            </div>
            ${(gymData.workout && gymData.workout.length > 0) ? `
            <div class="pl-12 mt-2 space-y-1">
                ${gymData.workout.map(w => `<div class="gym-exercise"><span>${w.exercise}</span><span>${w.setsReps}</span></div>`).join('')}
            </div>` : ''}
        `;
    };

    return `
        ${renderCategory('Classes', (dayData.classes || []).sort((a,b) => a.time.localeCompare(b.time)), 'class', renderClass)}
        <div class="day-view-category">
            <div class="day-view-category-header">
                <h4 class="day-view-category-title">Gym Session</h4>
                ${dayData.gym && dayData.gym.title ? '' : `<button onclick="openScheduleEventModal('${dayKey}', 'gym')" class="secondary-btn text-xs py-1 px-2">+ Add</button>`}
            </div>
            ${gymHTML()}
        </div>
        ${renderCategory('Other Tasks', (dayData.otherTasks || []).sort((a,b) => a.time.localeCompare(b.time)), 'otherTask', renderOtherTask)}
    `;
}

window.deleteScheduleEvent = (dayKey, eventType, eventId) => {
    const eventName = getEventNameById(dayKey, eventType, eventId);
    showConfirmation({
        title: 'Delete Event?',
        message: `Are you sure you want to delete "${eventName}"?`,
        confirmText: 'Delete'
    }, () => {
        if (eventType === 'class') {
            proData.schedule[dayKey].classes = proData.schedule[dayKey].classes.filter(c => c.id !== eventId);
        } else if (eventType === 'otherTask') {
            proData.schedule[dayKey].otherTasks = proData.schedule[dayKey].otherTasks.filter(t => t.id !== eventId);
        } else if (eventType === 'gym') {
            proData.schedule[dayKey].gym = { id: '', title: '', time: '', workout: [] };
        }
        saveData();
        if (document.getElementById('schedule-modal').classList.contains('visible')) {
            document.getElementById('schedule-modal-body').innerHTML = renderFullScheduleView();
        }
        if (document.getElementById('day-view-modal').classList.contains('visible')) {
            document.getElementById('day-view-modal-body').innerHTML = renderDayView(dayKey);
        }
        const todayKey = new Date().toLocaleDateString('en-us', { weekday: 'long' }).toLowerCase();
        if (dayKey === todayKey) {
            refreshDashboardAgenda();
        }
    });
}

function getEventNameById(dayKey, eventType, eventId) {
    const scheduleDay = proData.schedule[dayKey];
    if (!scheduleDay) return 'this event';

    if (eventType === 'class') {
        return (scheduleDay.classes || []).find(c => c.id === eventId)?.name || 'this event';
    } else if (eventType === 'otherTask') {
        return (scheduleDay.otherTasks || []).find(t => t.id === eventId)?.name || 'this event';
    } else if (eventType === 'gym') {
        return scheduleDay.gym?.title || 'this workout';
    }
    return 'this event';
}


window.exportSchedule = (format) => {
    switch(format) {
        case 'json': exportScheduleToJSON(); break;
        case 'csv': exportScheduleToCSV(); break;
        case 'ics': exportScheduleToICS(); break;
        case 'pdf': exportScheduleToPDF(); break;
        case 'word': exportScheduleToWord(); break;
    }
}

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function exportScheduleToJSON() {
    downloadFile('pro_plus_schedule.json', JSON.stringify(proData.schedule, null, 2), 'application/json');
}

function exportScheduleToCSV() {
    let csvContent = "Day,Start Time,End Time,Subject,Location,Type\n";
    const schedule = proData.schedule;
    for (const day in schedule) {
        (schedule[day].classes || []).forEach(c => {
            const [start, end] = c.time.split(' - ');
            csvContent += `${day},${start || ''},${end || ''},"${c.name}","${c.location || ''}",Class\n`;
        });
        if((schedule[day].gym?.title)) {
            const [start, end] = schedule[day].gym.time.split(' - ');
            csvContent += `${day},${start || ''},${end || ''},"${schedule[day].gym.title}","",Gym\n`;
        }
        (schedule[day].otherTasks || []).forEach(t => {
            const [start, end] = t.time.split(' - ');
            csvContent += `${day},${start || ''},${end || ''},"${t.name}","",Task\n`;
        });
    }
    downloadFile('pro_plus_schedule.csv', csvContent, 'text/csv');
}

function exportScheduleToICS() {
    let icsContent = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//PROPLUS//NONSGML v1.0//EN\n`;
    const dayMap = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
    const today = new Date();
    
    for (const day in proData.schedule) {
        const dayOfWeekNumber = dayMap[day];
        
        const processEvent = (event) => {
            const [start, end] = (event.time || "00:00-00:00").split('-');
            if(!start || !end) return;
            const [startHour, startMin] = start.trim().split(':');
            const [endHour, endMin] = end.trim().split(':');
            
            let eventDate = new Date();
            const currentDay = today.getDay();
            const distance = (dayOfWeekNumber - currentDay + 7) % 7;
            eventDate.setDate(today.getDate() + distance);

            const startDate = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate(), startHour, startMin);
            const endDate = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate(), endHour, endMin);
            
            const toUTC = (date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

            icsContent += 'BEGIN:VEVENT\n';
            icsContent += `DTSTAMP:${toUTC(new Date())}\n`;
            icsContent += `DTSTART:${toUTC(startDate)}\n`;
            icsContent += `DTEND:${toUTC(endDate)}\n`;
            icsContent += `RRULE:FREQ=WEEKLY;BYDAY=${day.substring(0,2).toUpperCase()}\n`;
            icsContent += `SUMMARY:${event.name || event.title}\n`;
            if (event.location) icsContent += `LOCATION:${event.location}\n`;
            icsContent += `UID:${day}-${start.replace(':','')}-${(event.name || event.title).replace(/\s/g, '')}@proplus.app\n`;
            icsContent += 'END:VEVENT\n';
        };
        
        (proData.schedule[day].classes || []).forEach(c => processEvent(c));
        (proData.schedule[day].otherTasks || []).forEach(t => processEvent(t));
        if (proData.schedule[day].gym?.title) processEvent(proData.schedule[day].gym);
    }
    
    icsContent += 'END:VCALENDAR';
    downloadFile('pro_plus_schedule.ics', icsContent, 'text/calendar');
}

function exportScheduleToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.text("PRO PLUS Weekly Schedule", 10, 10);
    doc.setFontSize(10);
    
    let y = 20;
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    days.forEach(day => {
        if (y > 280) { 
            doc.addPage();
            y = 10;
        }
        const scheduleDay = proData.schedule[day];
        if(!scheduleDay) return;
        doc.setFont('helvetica', 'bold');
        doc.text(scheduleDay.day, 10, y);
        y += 7;
        doc.setFont('helvetica', 'normal');
        
        (scheduleDay.classes || []).forEach(c => {
            doc.text(`${c.time}: ${c.name} (${c.location})`, 15, y);
            y += 5;
        });
        if((scheduleDay.gym?.title)) {
            doc.text(`${scheduleDay.gym.time}: ${scheduleDay.gym.title}`, 15, y);
            y += 5;
        }
        (scheduleDay.otherTasks || []).forEach(t => {
            doc.text(`${t.time}: ${t.name}`, 15, y);
            y += 5;
        });
        y+=5;
    });

    doc.save("pro_plus_schedule.pdf");
}

function exportScheduleToWord() {
    const { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, WidthType } = window.docx;

    const rows = [];
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    
    days.forEach(day => {
        const scheduleDay = proData.schedule[day];
        if (!scheduleDay) return;

        let dayEvents = '';
        (scheduleDay.classes || []).forEach(c => {
            dayEvents += `${c.time}: ${c.name} (${c.location})\n`;
        });
        if (scheduleDay.gym?.title) {
            dayEvents += `${scheduleDay.gym.time}: ${scheduleDay.gym.title}\n`;
        }
        (scheduleDay.otherTasks || []).forEach(t => {
            dayEvents += `${t.time}: ${t.name}\n`;
        });

        rows.push(new TableRow({
            children: [
                new TableCell({ children: [new Paragraph(day.charAt(0).toUpperCase() + day.slice(1))] }),
                new TableCell({ children: dayEvents.split('\n').filter(e => e).map(e => new Paragraph(e)) }),
            ],
        }));
    });
    
    const table = new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE }
    });
    
    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({
                    children: [new TextRun({ text: "PRO PLUS Weekly Schedule", bold: true, size: 32 })],
                }),
                table,
            ],
        }],
    });
    
    Packer.toBlob(doc).then(blob => {
        downloadFile('pro_plus_schedule.docx', blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });
}


// --- AI Chat (Gemini) ---
async function handleAssistantChat(e) {
    e.preventDefault();
    const form = document.getElementById('ai-chat-form');
    const input = document.getElementById('ai-chat-input');
    const body = document.getElementById('ai-chat-body');
    const userMessage = input.value.trim();
    if (!userMessage) return;

    body.innerHTML += `<div class="user-message">${userMessage}</div>`;
    input.value = '';
    form.querySelector('button').classList.add('is-loading');
    form.querySelector('button').disabled = true;
    body.scrollTop = body.scrollHeight;

    const thinkingMessage = document.createElement('div');
    thinkingMessage.className = 'ai-message opacity-50';
    thinkingMessage.textContent = 'Analyzing...';
    body.appendChild(thinkingMessage);
    body.scrollTop = body.scrollHeight;

    const systemPrompt = `You are PRO PLUS, an AI assistant integrated into a personal productivity dashboard.
    Your user's current data is provided below. Analyze it to answer questions and perform actions.
    When asked to perform an action (add, update, delete, complete), you MUST respond with a JSON object with "action" and "payload" keys.
    Example Actions:
    - {"action": "addTask", "payload": {"projectName": "Project Name", "taskText": "New Task Text"}}
    - {"action": "completeHabit", "payload": {"habitText": "Habit to complete"}}
    - {"action": "getSchedule", "payload": {"day": "monday"}}
    For general questions (e.g., 'what is my priority?'), respond with a concise, helpful, natural language text string. Do not use markdown.
    Keep your text responses under 50 words. Be direct and actionable.`;
    
    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: `USER DATA: ${JSON.stringify(proData)}\n\nUSER PROMPT: "${userMessage}"` }] }],
    };
    
    try {
        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if(!response.ok) throw new Error(`API Error: ${response.statusText}`);

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if(!text) throw new Error("No response from AI.");

        thinkingMessage.classList.remove('opacity-50');
        
        try {
            const parsed = JSON.parse(text);
            if(parsed.action) {
                const confirmation = executeAIAction(parsed.action, parsed.payload);
                thinkingMessage.textContent = confirmation;
            } else {
                thinkingMessage.textContent = text;
            }
        } catch(jsonError) {
            thinkingMessage.textContent = text;
        }

    } catch (error) {
        console.error("AI Assistant Error:", error);
        thinkingMessage.textContent = "Sorry, I encountered an error. Please try again.";
        thinkingMessage.style.backgroundColor = 'var(--danger-color)';
        soundManager.playSound('error', 'C3');
    } finally {
        form.querySelector('button').classList.remove('is-loading');
        form.querySelector('button').disabled = false;
        body.scrollTop = body.scrollHeight;
    }
}

function executeAIAction(action, payload) {
    let confirmation = "Action completed.";
    try {
        switch(action.toLowerCase()){
            case 'addtask': {
                if (!payload.projectName || !payload.taskText) throw new Error("Missing project name or task text.");
                const project = proData.projects.find(p => p.name.toLowerCase() === payload.projectName.toLowerCase());
                if(project) {
                    project.tasks.push({ id: `task-${Date.now()}`, text: payload.taskText, done: false, priority: 2 });
                    updateAndRefreshProjects();
                    confirmation = `Added task "${payload.taskText}" to project "${project.name}".`;
                } else throw new Error(`Project "${payload.projectName}" not found.`);
                break;
            }
            case 'completehabit': {
                if (!payload.habitText) throw new Error("Missing habit text.");
                const habit = proData.habits.find(h => h.text.toLowerCase().includes(payload.habitText.toLowerCase()));
                if(habit) {
                    if (!isHabitDoneToday(habit.id)) window.toggleHabit(habit.id);
                    confirmation = `Marked habit "${habit.text}" as complete. Keep up the great work!`;
                } else throw new Error(`Habit "${payload.habitText}" not found.`);
                break;
            }
            case 'getschedule': {
                if (!payload.day) throw new Error("Missing day for schedule lookup.");
                const day = payload.day.toLowerCase();
                const schedule = proData.schedule[day];
                if(schedule) {
                    const events = [
                        ...schedule.classes.map(c => `${c.time} - ${c.name}`),
                        schedule.gym.title ? `${schedule.gym.time} - ${schedule.gym.title}` : null,
                        ...schedule.otherTasks.map(t => `${t.time} - ${t.name}`)
                    ].filter(Boolean);
                    confirmation = events.length > 0 ? `On ${day}, you have: ${events.join(', ')}.` : `You have no events scheduled for ${day}.`;
                } else throw new Error(`No schedule found for ${payload.day}.`);
                break;
            }
            default:
                throw new Error("Unknown action requested.");
        }
    } catch (e) {
        console.error("AI Action execution failed:", e);
        confirmation = `Failed to execute action: ${e.message}`;
        soundManager.playSound('error', 'C3');
    }
    return confirmation;
}

// --- MODIFIED handleProjectFormSubmit to call updateAndRefreshProjects ---
function handleProjectFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('project-id').value;
    const existingProject = id ? proData.projects.find(p => p.id === id) : null;
    const newProject = {
        id: id || `proj-${Date.now()}`,
        name: document.getElementById('project-name').value,
        description: document.getElementById('project-description').value,
        deadline: document.getElementById('project-deadline').value,
        status: existingProject?.status || 'active',
        tasks: existingProject?.tasks || []
    };
    if (id) {
        proData.projects = proData.projects.map(p => p.id === id ? newProject : p);
    } else {
        if(!proData.projects) proData.projects = [];
        proData.projects.push(newProject);
    }
    updateAndRefreshProjects();
    window.closeModal('project-modal');
}

// --- [NEW] UTILITIES LOGIC (TIMER/STOPWATCH) ---

// Helper to format time
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    const milliseconds = Math.floor((ms % 1000) / 10).toString().padStart(2, '0');
    return `${minutes}:${seconds}:${milliseconds}`;
}
function formatTimerTime(s) {
    const totalSeconds = Math.max(0, s);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

// Stopwatch functions
window.startStopwatch = () => {
    if (stopwatch.running) return;
    stopwatch.running = true;
    stopwatch.startTime = Date.now() - stopwatch.elapsed;
    stopwatch.interval = setInterval(updateStopwatch, 10);
};
window.pauseStopwatch = () => {
    if (!stopwatch.running) return;
    stopwatch.running = false;
    clearInterval(stopwatch.interval);
};
window.resetStopwatch = () => {
    stopwatch.running = false;
    clearInterval(stopwatch.interval);
    stopwatch.elapsed = 0;
    stopwatch.laps = [];
    document.getElementById('stopwatch-display').textContent = '00:00:00';
    document.getElementById('laps-list').innerHTML = '';
};
window.lapStopwatch = () => {
    if (!stopwatch.running) return;
    stopwatch.laps.push(stopwatch.elapsed);
    const lapsList = document.getElementById('laps-list');
    lapsList.innerHTML = '';
    stopwatch.laps.forEach((lap, index) => {
        lapsList.innerHTML += `<li><span>Lap ${index + 1}</span><span>${formatTime(lap)}</span></li>`;
    });
    lapsList.scrollTop = lapsList.scrollHeight;
};
function updateStopwatch() {
    stopwatch.elapsed = Date.now() - stopwatch.startTime;
    document.getElementById('stopwatch-display').textContent = formatTime(stopwatch.elapsed);
}

// Timer functions
window.startTimer = () => {
    const mins = parseInt(document.getElementById('timer-minutes').value) || 0;
    const secs = parseInt(document.getElementById('timer-seconds').value) || 0;
    const totalSeconds = (mins * 60) + secs;

    if (totalSeconds <= 0) return;

    if (timer.paused) {
        timer.endTime = Date.now() + timer.duration;
    } else {
        timer.duration = totalSeconds * 1000;
        timer.endTime = Date.now() + timer.duration;
    }
    timer.paused = false;
    if (timer.interval) clearInterval(timer.interval);
    timer.interval = setInterval(updateTimer, 100);
    document.getElementById('timer-inputs').classList.add('hidden');
    document.getElementById('timer-display').classList.remove('hidden');
};
window.pauseTimer = () => {
    if (!timer.endTime || timer.paused) return;
    clearInterval(timer.interval);
    timer.paused = true;
    timer.duration = timer.endTime - Date.now();
};
window.resetTimer = () => {
    clearInterval(timer.interval);
    timer.endTime = 0;
    timer.paused = false;
    timer.duration = 0;
    document.getElementById('timer-inputs').classList.remove('hidden');
    document.getElementById('timer-display').classList.add('hidden');
    document.getElementById('timer-display').textContent = "00:00";
    document.getElementById('timer-display').classList.remove('timer-done');
    document.getElementById('timer-minutes').value = '10';
    document.getElementById('timer-seconds').value = '00';
};
function updateTimer() {
    const remaining = timer.endTime - Date.now();
    if (remaining <= 0) {
        clearInterval(timer.interval);
        document.getElementById('timer-display').textContent = "00:00";
        document.getElementById('timer-display').classList.add('timer-done');
        soundManager.playSound('timerAlarm', 'C5', '2n');
        return;
    }
    document.getElementById('timer-display').textContent = formatTimerTime(Math.ceil(remaining / 1000));
}

// --- [NEW] DASHBOARD CARD RENDERERS FOR UTILITIES ---
window.switchUtilityView = (view) => {
    const timerView = document.getElementById('utility-timer-view');
    const stopwatchView = document.getElementById('utility-stopwatch-view');
    const timerBtn = document.getElementById('utility-timer-btn');
    const stopwatchBtn = document.getElementById('utility-stopwatch-btn');

    if (view === 'timer') {
        timerView.classList.remove('hidden');
        stopwatchView.classList.add('hidden');
        timerBtn.classList.add('pro-btn');
        timerBtn.classList.remove('secondary-btn');
        stopwatchBtn.classList.add('secondary-btn');
        stopwatchBtn.classList.remove('pro-btn');
    } else {
        timerView.classList.add('hidden');
        stopwatchView.classList.remove('hidden');
        timerBtn.classList.remove('pro-btn');
        timerBtn.classList.add('secondary-btn');
        stopwatchBtn.classList.remove('pro-btn');
        stopwatchBtn.classList.add('pro-btn');
    }
}

function renderUtilitiesCard() {
    return `
        <div class="flex flex-col h-full">
            <div class="flex items-center justify-between mb-4">
                 <h3 class="text-xl font-bold font-orbitron text-header">Time Tools</h3>
                 <div class="flex items-center border border-[--card-border] rounded-lg p-1">
                    <button id="utility-timer-btn" onclick="switchUtilityView('timer')" class="pro-btn text-xs !py-1 !px-3">Timer</button>
                    <button id="utility-stopwatch-btn" onclick="switchUtilityView('stopwatch')" class="secondary-btn text-xs !py-1 !px-3">Stopwatch</button>
                 </div>
            </div>

            <div id="utility-timer-view" class="flex-grow flex flex-col">
                <div class="flex flex-col items-center justify-center flex-grow">
                    <div id="timer-display" class="digital-display text-5xl mb-4 hidden">10:00</div>
                    <div id="timer-inputs" class="timer-inputs">
                        <input id="timer-minutes" type="number" min="0" max="99" value="10" class="pro-input">
                        <span>:</span>
                        <input id="timer-seconds" type="number" min="0" max="59" value="00" class="pro-input">
                    </div>
                    <div class="utility-controls w-full">
                        <button onclick="startTimer()" class="pro-btn text-sm !py-2">Start</button>
                        <button onclick="pauseTimer()" class="secondary-btn text-sm !py-2">Pause</button>
                        <button onclick="resetTimer()" class="danger-btn text-sm !py-2">Reset</button>
                        <button onclick="startTimerWithPreset(25)" class="secondary-btn text-sm !py-2 col-span-3 md:col-span-1">Pomodoro (25m)</button>
                    </div>
                </div>
            </div>

            <div id="utility-stopwatch-view" class="flex-grow flex flex-col hidden">
                 <div class="flex flex-col items-center justify-center flex-grow">
                    <div id="stopwatch-display" class="digital-display text-4xl mb-4">00:00:00</div>
                    <div class="utility-controls w-full">
                        <button onclick="startStopwatch()" class="pro-btn text-sm !py-2">Start</button>
                        <button onclick="pauseStopwatch()" class="secondary-btn text-sm !py-2">Pause</button>
                        <button onclick="lapStopwatch()" class="secondary-btn text-sm !py-2">Lap</button>
                        <button onclick="resetStopwatch()" class="danger-btn text-sm !py-2">Reset</button>
                    </div>
                    <div class="laps-container w-full mt-2">
                        <ul id="laps-list" class="laps-list"></ul>
                    </div>
                </div>
            </div>
        </div>
    `;
}

window.startTimerWithPreset = (minutes) => {
    resetTimer();
    document.getElementById('timer-minutes').value = minutes;
    document.getElementById('timer-seconds').value = '00';
    startTimer();
}

// --- [NEW] CSV IMPORT ---
window.importScheduleFromCSV = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const csv = e.target.result;
            const lines = csv.split('\n').filter(line => line.trim() !== '');
            const header = lines.shift().toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
            
            // Basic validation
            if(!['day', 'start time', 'end time', 'subject'].every(h => header.includes(h))) {
                 throw new Error("Invalid CSV format. Required headers: Day, Start Time, End Time, Subject.");
            }

            let importCount = 0;
            lines.forEach(line => {
                const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
                const entry = header.reduce((obj, col, i) => {
                    obj[col] = values[i];
                    return obj;
                }, {});

                const dayKey = entry.day?.toLowerCase();
                if (proData.schedule[dayKey]) {
                    const eventType = entry.type?.toLowerCase() || 'class'; // Default to class for schedule import
                    const newEvent = {
                        id: `${eventType}-${Date.now()}-${importCount}`,
                        name: entry.subject,
                        time: `${entry['start time']} - ${entry['end time']}`,
                        location: entry.location || ''
                    };

                    if (eventType === 'class') {
                        proData.schedule[dayKey].classes.push(newEvent);
                        importCount++;
                    } else if (eventType === 'othertask' || eventType === 'task') {
                         proData.schedule[dayKey].otherTasks.push(newEvent);
                         importCount++;
                    } else if (eventType === 'gym') {
                        proData.schedule[dayKey].gym = { id: newEvent.id, title: newEvent.name, time: newEvent.time, workout: [] };
                        importCount++;
                    }
                }
            });
            
            if (importCount > 0) {
                saveData();
                showConfirmation({ title: "Import Successful", message: `Successfully imported ${importCount} schedule events.`, buttons: `<button id="cancel-btn" class="pro-btn font-semibold py-2 px-6 rounded-lg">OK</button>` });
            } else {
                 throw new Error("No valid events found in the CSV file.");
            }

        } catch (err) {
            console.error("CSV Import Error:", err);
            showConfirmation({title: "Import Failed", message: err.message, buttons: `<button id="cancel-btn" class="secondary-btn font-semibold py-2 px-6 rounded-lg">OK</button>`});
            soundManager.playSound('error', 'C3');
        }
    };
    reader.readAsText(file);
    event.target.value = null; 
};

// --- [NEW] HABITS PAGE ---
function renderHabitsPage() {
    const main = document.getElementById('main-content');
    main.innerHTML = `
        <header class="flex flex-wrap items-center justify-between mb-6 gap-4">
            <h1 class="text-3xl sm:text-4xl font-bold font-orbitron text-header tracking-tight">Habit Tracker</h1>
            <button class="pro-btn" onclick="openHabitModal()">Add New Habit</button>
        </header>
        <div id="habits-page-container" class="space-y-4"></div>
    `;
    renderHabitListForPage();
}

function renderHabitListForPage() {
    const container = document.getElementById('habits-page-container');
    if (!container) return;

    const habits = proData.habits || [];
    if (habits.length === 0) {
        container.innerHTML = `<div class="glass-card text-center p-8"><p class="text-secondary">No habits yet. Click 'Add New Habit' to get started!</p></div>`;
        return;
    }

    container.innerHTML = habits.sort((a,b) => b.priority - a.priority).map(habit => {
        const isDone = isHabitDoneToday(habit.id);
        return `
        <div class="glass-card p-4 flex items-center justify-between">
            <div class="flex items-center">
                <input type="checkbox" id="${habit.id}" ${isDone ? 'checked' : ''} onchange="toggleHabit('${habit.id}')" class="hidden">
                <label for="${habit.id}" class="checkbox-custom ${isDone ? 'checked' : ''} cursor-pointer"></label>
                <div class="ml-4">
                    <p class="text-base font-medium ${isDone ? 'line-through text-secondary' : ''}">${habit.text}</p>
                    <p class="text-xs text-secondary">Priority: ${habit.priority}</p>
                </div>
            </div>
            <div class="flex items-center gap-4">
                <span class="text-sm font-mono p-1 px-3 rounded-full bg-[--bg-primary]">🔥 ${habit.streak || 0}</span>
                <div>
                     <button class="secondary-btn text-xs py-1 px-2" onclick="openHabitModal('${habit.id}')">Edit</button>
                     <button class="danger-btn text-xs py-1 px-2 ml-2" onclick="showConfirmation({ title: 'Delete Habit?', message: 'Are you sure you want to delete this habit? This will also remove its history.', confirmText: 'Delete' }, () => deleteHabit('${habit.id}'))">Del</button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}
