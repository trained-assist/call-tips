'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, screen } = require('electron');
const path = require('path');
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let setupWindow = null;
let overlayWindow = null;
let tray = null;
let pendingSessionData = null;

function createSetupWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  setupWindow = new BrowserWindow({
    width: 480,
    height: 740,
    x: width - 500,
    y: 40,
    title: 'Call Tips',
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWindow.on('closed', () => { setupWindow = null; });
}

function createOverlayWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    width: 380,
    height: 340,
    x: Math.round((width - 380) / 2),
    y: 16,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.on('closed', () => { overlayWindow = null; });

  overlayWindow.webContents.on('did-finish-load', () => {
    if (pendingSessionData) {
      overlayWindow.webContents.send('session-data', pendingSessionData);
      pendingSessionData = null;
    }
  });
}

app.whenReady().then(() => {
  createSetupWindow();

  // Minimal tray icon (white square fallback if no icon file)
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage.createEmpty();
    tray = new Tray(img);
    tray.setToolTip('Call Tips');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Setup', click: () => setupWindow ? setupWindow.show() : createSetupWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
  } catch {
    // tray optional
  }
});

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
  return true;
});

ipcMain.handle('stop-call', () => {
  overlayWindow?.close();
  overlayWindow = null;
  setupWindow ? setupWindow.show() : createSetupWindow();
  return true;
});

// All OpenRouter/LLM calls proxied through main process (avoids CORS)
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

app.on('window-all-closed', e => e.preventDefault()); // stay alive in tray
