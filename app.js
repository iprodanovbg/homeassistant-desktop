const {
  app,
  dialog,
  ipcMain,
  shell,
  globalShortcut,
  screen,
  net,
  Menu,
  Tray,
  BrowserWindow,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const AutoLaunch = require('auto-launch');
const Positioner = require('electron-traywindow-positioner');
const Bonjour = require('bonjour-service');
const bonjour = new Bonjour.Bonjour();
const config = require('./config');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.allowRendererProcessReuse = true;

// prevent multiple instances
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      showWindow();
    }
  });
}

// hide dock icon on macOS
if (process.platform === 'darwin') {
  app.dock.hide();
}

const autoLauncher = new AutoLaunch({ name: 'Home Assistant Desktop' });

const indexFile = `file://${__dirname}/web/index.html`;
const errorFile = `file://${__dirname}/web/error.html`;

let autostartEnabled = false;
let forceQuit = false;
let resizeEvent = false;

function registerKeyboardShortcut() {
  globalShortcut.register('CommandOrControl+Alt+X', () => {
    if (window.isVisible()) {
      window.hide();
    } else {
      showWindow();
    }
  });
}

function unregisterKeyboardShortcut() {
  globalShortcut.unregisterAll();
}

function useAutoUpdater() {
  autoUpdater.on('error', (message) => {
    console.error('There was a problem updating the application');
    console.error(message);
  });

  autoUpdater.on('update-downloaded', () => {
    forceQuit = true;
    autoUpdater.quitAndInstall();
  });

  setInterval(() => {
    if (config.get('autoUpdate')) {
      autoUpdater.checkForUpdates();
    }
  }, 1000 * 60 * 60);

  if (config.get('autoUpdate')) {
    autoUpdater.checkForUpdates();
  }
}

function checkAutoStart() {
  autoLauncher
    .isEnabled()
    .then((isEnabled) => {
      autostartEnabled = isEnabled;
    })
    .catch((err) => {
      console.error(err);
    });
}

function startAvailabilityCheck() {
  let interval;

  function availabilityCheck() {
    const request = net.request(`${currentInstance()}/auth/providers`);
    request.on('response', (response) => {
      showError(response.statusCode !== 200);
    });
    request.on('error', (error) => {
      clearInterval(interval);
      showError(true);

      if (config.get('automaticSwitching')) {
        checkForAvailableInstance();
      }
    });
    request.end();
  }

  interval = setInterval(availabilityCheck, 3000);
}

function changePosition() {
  const trayBounds = tray.getBounds();
  const windowBounds = window.getBounds();
  const displayWorkArea = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  }).workArea;
  const taskBarPosition = Positioner.getTaskbarPosition(trayBounds);

  if (taskBarPosition === 'top' || taskBarPosition === 'bottom') {
    const alignment = {
      x: 'center',
      y: taskBarPosition === 'top' ? 'up' : 'down',
    };

    if (trayBounds.x + (trayBounds.width + windowBounds.width) / 2 < displayWorkArea.width) {
      Positioner.position(window, trayBounds, alignment);
    } else {
      const { y } = Positioner.calculate(window.getBounds(), trayBounds, alignment);

      window.setPosition(
        displayWorkArea.width - windowBounds.width + displayWorkArea.x,
        y + (taskBarPosition === 'bottom' && displayWorkArea.y),
        false,
      );
    }
  } else {
    const alignment = {
      x: taskBarPosition,
      y: 'center',
    };

    if (trayBounds.y + (trayBounds.height + windowBounds.height) / 2 < displayWorkArea.height) {
      const { x, y } = Positioner.calculate(window.getBounds(), trayBounds, alignment);
      window.setPosition(x + (taskBarPosition === 'right' && displayWorkArea.x), y);
    } else {
      const { x } = Positioner.calculate(window.getBounds(), trayBounds, alignment);
      window.setPosition(x, displayWorkArea.y + displayWorkArea.height - windowBounds.height, false);
    }
  }
}

function checkForAvailableInstance() {
  const instances = config.get('allInstances');

  if (instances?.length > 1) {
    bonjour.find({ type: 'home-assistant' }, (instance) => {
      if (instance.txt.internal_url && instances.indexOf(instance.txt.internal_url) !== -1) {
        return currentInstance(instance.txt.internal_url);
      }

      if (instance.txt.external_url && instances.indexOf(instance.txt.external_url) !== -1) {
        return currentInstance(instance.txt.external_url);
      }
    });
    let found;
    for (let instance of instances.filter((e) => e.url !== currentInstance())) {
      const request = net.request(`${instance}/auth/providers`);
      request.on('response', (response) => {
        if (response.statusCode === 200) {
          found = instance;
        }
      });
      request.on('error', (_) => {
      });
      request.end();

      if (found) {
        currentInstance(found);
        break;
      }
    }
  }
}

function getMenu() {
  let instancesMenu = [
    {
      label: 'Open in Browser',
      enabled: currentInstance(),
      click: () => {
        shell.openExternal(currentInstance());
      },
    },
    {
      type: 'separator',
    },
  ];

  const allInstances = config.get('allInstances');

  if (allInstances) {
    allInstances.forEach((e) => {
      instancesMenu.push({
        label: e,
        type: 'checkbox',
        checked: currentInstance() === e,
        click: () => {
          currentInstance(e);
          window.loadURL(e);
          window.show();
        },
      });
    });

    instancesMenu.push(
      {
        type: 'separator',
      },
      {
        label: 'Add another Instance...',
        click: () => {
          config.delete('currentInstance');
          window.loadURL(indexFile);
          window.show();
        },
      },
      {
        label: 'Automatic Switching',
        type: 'checkbox',
        enabled: config.has('allInstances') && config.get('allInstances').length > 1,
        checked: config.get('automaticSwitching'),
        click: () => {
          config.set('automaticSwitching', !config.get('automaticSwitching'));
        },
      },
    );
  } else {
    instancesMenu.push({ label: 'Not Connected...', enabled: false });
  }

  return Menu.buildFromTemplate([
    {
      label: 'Show/Hide Window',
      visible: process.platform === 'linux',
      click: () => {
        if (window.isVisible()) {
          window.hide();
        } else {
          showWindow();
        }
      },
    },
    {
      visible: process.platform === 'linux',
      type: 'separator',
    },
    ...instancesMenu,
    {
      type: 'separator',
    },
    {
      label: 'Hover to Show',
      visible: process.platform !== 'linux' && !config.get('detachedMode'),
      enabled: !config.get('detachedMode'),
      type: 'checkbox',
      checked: !config.get('disableHover'),
      click: () => {
        config.set('disableHover', !config.get('disableHover'));
      },
    },
    {
      label: 'Stay on Top',
      type: 'checkbox',
      checked: config.get('stayOnTop'),
      click: () => {
        config.set('stayOnTop', !config.get('stayOnTop'));
        window.setAlwaysOnTop(config.get('stayOnTop'));

        if (window.isAlwaysOnTop()) {
          showWindow();
        }
      },
    },
    {
      label: 'Start at Login',
      type: 'checkbox',
      checked: autostartEnabled,
      click: () => {
        if (autostartEnabled) {
          autoLauncher.disable();
        } else {
          autoLauncher.enable();
        }

        checkAutoStart();
      },
    },
    {
      label: 'Enable Shortcut',
      type: 'checkbox',
      accelerator: 'CommandOrControl+Alt+X',
      checked: config.get('shortcutEnabled'),
      click: () => {
        config.set('shortcutEnabled', !config.get('shortcutEnabled'));

        if (config.get('shortcutEnabled')) {
          registerKeyboardShortcut();
        } else {
          unregisterKeyboardShortcut();
        }
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Use detached Window',
      type: 'checkbox',
      checked: config.get('detachedMode'),
      click: () => {
        config.set('detachedMode', !config.get('detachedMode'));
        window.hide();
        createMainWindow(config.get('detachedMode'));
      },
    },
    {
      label: 'Use Fullscreen',
      type: 'checkbox',
      checked: config.get('fullScreen'),
      accelerator: 'CommandOrControl+Alt+Return',
      click: () => {
        toggleFullScreen();
      },
    },
    {
      type: 'separator',
    },
    {
      label: `v${app.getVersion()}`,
      enabled: false,
    },
    {
      label: 'Automatic Updates',
      type: 'checkbox',
      checked: config.get('autoUpdate'),
      click: () => {
        config.set('autoUpdate', !config.get('autoUpdate'));
      },
    },
    {
      label: 'Open on github.com',
      click: () => {
        shell.openExternal('https://github.com/iprodanovbg/homeassistant-desktop');
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Reload Window',
      click: () => {
        window.reload();
        window.show();
        window.focus();
      },
    },
    {
      label: 'Reset Application...',
      click: () => {
        dialog
          .showMessageBox({
            message: 'Are you sure you want to reset Home Assistant Desktop?',
            buttons: ['Reset Everything!', 'Reset Windows', 'Cancel'],
          })
          .then((res) => {
            if (res.response === 0) {
              config.clear();
              window.webContents.session.clearCache();
              window.webContents.session.clearStorageData();
              app.relaunch();
              app.exit();
            }

            if (res.response === 1) {
              config.delete('windowSizeDetached');
              config.delete('windowSize');
              config.delete('windowPosition');
              config.delete('fullScreen');
              config.delete('detachedMode');
              app.relaunch();
              app.exit();
            }
          });
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Quit',
      click: () => {
        forceQuit = true;
        app.quit();
      },
    },
  ]);
}

function createMainWindow(show = false) {
  window = new BrowserWindow({
    width: 420,
    height: 420,
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // window.webContents.openDevTools();
  window.loadURL(indexFile);

  // open external links in default browser
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // hide scrollbar
  window.webContents.on('did-finish-load', function () {
    window.webContents.insertCSS('::-webkit-scrollbar { display: none; } body { -webkit-user-select: none; }');

    if (config.get('detachedMode') && process.platform === 'darwin') {
      window.webContents.insertCSS('body { -webkit-app-region: drag; }');
    }

    // let code = `document.addEventListener('mousemove', () => { ipcRenderer.send('mousemove'); });`;
    // window.webContents.executeJavaScript(code);
  });

  if (config.get('detachedMode')) {
    if (config.has('windowPosition')) {
      window.setSize(...config.get('windowSizeDetached'));
    } else {
      config.set('windowPosition', window.getPosition());
    }

    if (config.has('windowSizeDetached')) {
      window.setPosition(...config.get('windowPosition'));
    } else {
      config.set('windowSizeDetached', window.getSize());
    }
  } else if (config.has('windowSize')) {
    window.setSize(...config.get('windowSize'));
  } else {
    config.set('windowSize', window.getSize());
  }

  window.on('resize', (e) => {
    // ignore resize event when using fullscreen mode
    if (window.isFullScreen()) {
      return e;
    }

    if (!config.get('disableHover') || resizeEvent) {
      config.set('disableHover', true);
      resizeEvent = e;
      setTimeout(() => {
        if (resizeEvent === e) {
          config.set('disableHover', false);
          resizeEvent = false;
        }
      }, 600);
    }

    if (config.get('detachedMode')) {
      config.set('windowSizeDetached', window.getSize());
    } else {
      if (process.platform !== 'linux') {
        changePosition();
      }

      config.set('windowSize', window.getSize());
    }
  });

  window.on('move', () => {
    if (config.get('detachedMode')) {
      config.set('windowPosition', window.getPosition());
    }
  });

  window.on('close', (e) => {
    if (!forceQuit) {
      window.hide();
      e.preventDefault();
    }
  });

  window.on('blur', () => {
    if (!config.get('detachedMode') && !window.isAlwaysOnTop()) {
      window.hide();
    }
  });

  window.setAlwaysOnTop(!!config.get('stayOnTop'));

  if (window.isAlwaysOnTop() || show) {
    showWindow();
  }

  toggleFullScreen(!!config.get('fullScreen'));
}

function showWindow() {
  if (!config.get('detachedMode')) {
    changePosition();
  }

  if (!window.isVisible()) {
    window.setVisibleOnAllWorkspaces(true); // put the window on all screens
    window.show();
    window.focus();
    window.setVisibleOnAllWorkspaces(false); // disable all screen behavior
  }
}

function createTray() {
  tray = new Tray(
    ['win32', 'linux'].includes(process.platform) ? `${__dirname}/assets/IconWin.png` : `${__dirname}/assets/IconTemplate.png`,
  );

  tray.on('click', () => {
    if (window.isVisible()) {
      window.hide();
    } else {
      showWindow();
    }
  });

  tray.on('right-click', () => {
    if (!config.get('detachedMode')) {
      window.hide();
    }

    tray.popUpContextMenu(getMenu());
  });

  let timer = undefined;

  tray.on('mouse-move', () => {
    if (config.get('detachedMode') || window.isAlwaysOnTop() || config.get('disableHover')) {
      return;
    }

    if (!window.isVisible()) {
      showWindow();
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      let mousePos = screen.getCursorScreenPoint();
      let trayBounds = tray.getBounds();

      if (
        !(mousePos.x >= trayBounds.x && mousePos.x <= trayBounds.x + trayBounds.width) ||
        !(mousePos.y >= trayBounds.y && mousePos.y <= trayBounds.y + trayBounds.height)
      ) {
        setWindowFocusTimer();
      }
    }, 100);
  });
}

function setWindowFocusTimer() {
  setTimeout(() => {
    let mousePos = screen.getCursorScreenPoint();
    let windowPosition = window.getPosition();
    let windowSize = window.getSize();

    if (
      !resizeEvent &&
      (
        !(mousePos.x >= windowPosition[ 0 ] && mousePos.x <= windowPosition[ 0 ] + windowSize[ 0 ]) ||
        !(mousePos.y >= windowPosition[ 1 ] && mousePos.y <= windowPosition[ 1 ] + windowSize[ 1 ])
      )
    ) {
      window.hide();
    } else {
      setWindowFocusTimer();
    }
  }, 110);
}

function toggleFullScreen(mode = !window.isFullScreen()) {
  config.set('fullScreen', mode);
  window.setFullScreen(mode);

  if (mode) {
    window.setAlwaysOnTop(true);
  } else {
    window.setAlwaysOnTop(config.get('stayOnTop'));
  }
}

function currentInstance(url = null) {
  if (url) {
    config.set('currentInstance', config.get('allInstances').indexOf(url));
  }

  if (config.has('currentInstance')) {
    return config.get('allInstances')[ config.get('currentInstance') ];
  }

  return false;
}

function addInstance(url) {
  if (!config.has('allInstances')) {
    config.set('allInstances', []);
  }

  let instances = config.get('allInstances');

  if (instances.find((e) => e === url)) {
    currentInstance(url);

    return;
  }

  // active hover by default after adding first instance
  if (!instances.length) {
    config.set('disableHover', false);
  }

  instances.push(url);
  config.set('allInstances', instances);
  currentInstance(url);
}

function showError(isError) {
  if (!isError && window.webContents.getURL().includes('error.html')) {
    window.loadURL(indexFile);
  }

  if (isError && currentInstance() && !window.webContents.getURL().includes('error.html')) {
    window.loadURL(errorFile);
  }
}

app.on('ready', async () => {
  useAutoUpdater();
  checkAutoStart();

  createTray();
  // workaround for initial window misplacement due to traybounds being incorrect
  while (tray.getBounds().x === 0 && process.uptime() <= 1) {
    await delay(15);
  }
  createMainWindow(!config.has('currentInstance'));

  if (process.platform === 'linux') {
    tray.setContextMenu(getMenu());
  }

  startAvailabilityCheck();

  // register shortcut
  if (config.get('shortcutEnabled')) {
    registerKeyboardShortcut();
  }

  globalShortcut.register('CommandOrControl+Alt+Return', () => {
    toggleFullScreen();
  });

  // disable hover for first start
  if (!config.has('currentInstance')) {
    config.set('disableHover', true);
  }

  // enable auto update by default
  if (!config.has('autoUpdate')) {
    config.set('autoUpdate', true);
  }
});

app.on('will-quit', () => {
  unregisterKeyboardShortcut();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('get-instances', (event) => {
  event.reply('get-instances', config.get('allInstances') || []);
});

ipcMain.on('ha-instance', (event, url) => {
  if (url) {
    addInstance(url);
  }

  if (currentInstance()) {
    event.reply('ha-instance', currentInstance());
  }
});
