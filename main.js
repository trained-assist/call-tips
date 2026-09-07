'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let setupWindow = null;
let overlayWindow = null;
let tray = null;
let pendingSessionData = null;

// ── Menu bar app (macOS: hide from dock) ───────────────────────────────────
if (process.platform === 'darwin') {
  app.dock.hide();
}

// ── Tray icon (16×16 white mic silhouette, template image for macOS) ────────
function buildTrayIcon() {
  // 16×16 white PNG encoded as base64 — simple mic shape on transparent bg
  // Generated inline so no external file needed
  const ICON_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwY' +
    'AAAAsklEQVQ4y2NgIID/VMgzEFIDALiIBAT8QpAHYUABDGQwwz4JLgDg4wMIGCJogE2ACBX' +
    'ZuU5dAN4HMvFM6MGEQAAAAbJRU5ErkJggg==';

  // Use a simple emoji+title approach instead (most reliable cross-platform)
  const empty = nativeImage.createEmpty();
  return empty;
}

function createSetupWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  setupWindow = new BrowserWindow({
    width: 480,
    height: 760,
    x: width - 500,
    y: 30,
    title: 'Call Tips',
    resizable: false,
    // macOS: panel-style window that doesn't take focus away from other apps
    type: process.platform === 'darwin' ? 'panel' : 'normal',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  // Don't quit when setup closes — stay in tray
  setupWindow.on('close', (e) => {
    e.preventDefault();
    setupWindow.hide();
  });
}

function createOverlayWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    width: 380,
    height: 320,
    x: Math.round((width - 380) / 2),
    y: 8,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    // macOS: 'screen-saver' level puts it above fullscreen apps (Zoom, Meet)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  // Level 'screen-saver' = above fullscreen video call windows on macOS
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  overlayWindow.on('closed', () => { overlayWindow = null; });

  overlayWindow.webContents.on('did-finish-load', () => {
    if (pendingSessionData) {
      overlayWindow.webContents.send('session-data', pendingSessionData);
      pendingSessionData = null;
    }
  });
}

app.whenReady().then(() => {
  // ── Tray ────────────────────────────────────────────────────────────────
  const icon = buildTrayIcon();
  tray = new Tray(icon);

  // On macOS: show emoji+text in the menu bar (much more visible than icon)
  if (process.platform === 'darwin') {
    tray.setTitle('⚡');
  }
  tray.setToolTip('Call Tips — AI интервью-ассистент');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '📋 Настройки / Новый звонок',
      click: () => {
        if (!setupWindow) {
          createSetupWindow();
        }
        setupWindow.show();
        setupWindow.focus();
      },
    },
    {
      label: '🟢 Показать подсказки',
      click: () => { overlayWindow?.show(); },
      enabled: false,
      id: 'show-overlay',
    },
    { type: 'separator' },
    { label: 'Выйти', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);

  // Left-click on tray icon → show/hide setup
  tray.on('click', () => {
    if (!setupWindow) {
      createSetupWindow();
      setupWindow.show();
    } else if (setupWindow.isVisible()) {
      setupWindow.hide();
    } else {
      setupWindow.show();
      setupWindow.focus();
    }
  });

  // Open setup on first launch
  createSetupWindow();
  setupWindow.show();
});

// ── IPC ────────────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => ({
  deepgramKey: process.env.DEEPGRAM_API_KEY || '',
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
}));

ipcMain.handle('start-call', (_, sessionData) => {
  pendingSessionData = sessionData;
  if (!overlayWindow) {
    createOverlayWindow();
  } else {
    overlayWindow.show();
    overlayWindow.webContents.send('session-data', sessionData);
    pendingSessionData = null;
  }
  setupWindow?.hide();

  // Update tray menu to enable "show overlay"
  const menu = tray.getContextMenu?.();
  const item = menu?.getMenuItemById?.('show-overlay');
  if (item) item.enabled = true;

  return true;
});

ipcMain.handle('stop-call', () => {
  overlayWindow?.close();
  overlayWindow = null;
  if (!setupWindow) {
    createSetupWindow();
  }
  setupWindow.show();
  setupWindow.focus();
  return true;
});

// OpenRouter proxy (avoids CORS in renderer)
ipcMain.handle('llm-call', (_, { model, messages, maxTokens, jsonMode }) => {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: model || 'google/gemini-2.5-flash-lite',
      messages,
      max_tokens: maxTokens || 400,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });

    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'call-tips-win',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.choices?.[0]?.message?.content || '');
        } catch {
          reject(new Error('JSON parse error'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
});

// Keep alive when all windows closed (live in tray)
app.on('window-all-closed', (e) => e.preventDefault());
