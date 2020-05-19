const {app, Menu, Tray, dialog, ipcMain, BrowserWindow, shell, screen} = require('electron');
const {autoUpdater} = require('electron-updater');
const AutoLaunch = require('auto-launch');
const Positioner = require('electron-traywindow-positioner');
const Store = require('electron-store');

app.allowRendererProcessReuse = true;

// prevent multiple instances
if (!app.requestSingleInstanceLock()) {
    app.quit()
} else {
    app.on('second-instance', () => {
        if (window) showWindow();
    })
}

// hide dock icon on macOS
if (process.platform === 'darwin') app.dock.hide();

const store = new Store();
const autoLauncher = new AutoLaunch({name: 'Home Assistant Desktop'});

let autostartEnabled = false;
let forceQuit = false;

const useAutoUpdater = () => {
    autoUpdater.on('error', message => {
        console.error('There was a problem updating the application');
        console.error(message)
    });

    setInterval(() => {
        autoUpdater.checkForUpdates();
    }, 1000 * 60 * 30)

    autoUpdater.on('update-downloaded', () => {
        autoUpdater.quitAndInstall();
    });
}

const checkAutoStart = () => {
    autoLauncher.isEnabled().then((isEnabled) => {
        autostartEnabled = isEnabled;
    }).catch((err) => {
        console.error(err)
    });
};

const getMenu = () => {
    return Menu.buildFromTemplate([
        {
            label: (store.has('instance') ? store.get('instance').name : 'Not connected...'),
            enabled: !!store.has('instance'),
            click: () => {
                shell.openExternal(store.get('instance').url)
            }
        }, {
            type: 'separator'
        },
        {
            label: 'Hover to Show',
            type: 'checkbox',
            checked: !store.get('disableHover'),
            click: () => {
                store.set('disableHover', !store.get('disableHover'))
            }
        },
        {
            label: 'Stay on Top',
            type: 'checkbox',
            checked: window.isAlwaysOnTop(),
            click: () => {
                window.setAlwaysOnTop(!window.isAlwaysOnTop());
                if (window.isAlwaysOnTop()) showWindow();
            }
        },
        {
            label: 'Start at Login',
            type: 'checkbox',
            checked: autostartEnabled,
            click: () => {
                if (autostartEnabled) autoLauncher.disable(); else autoLauncher.enable();
                checkAutoStart()
            }
        }, {
            type: 'separator'
        },
        {
            label: 'Use detached Window',
            type: 'checkbox',
            checked: store.get('detachedMode'),
            click: () => {
                store.set('detachedMode', !store.get('detachedMode'));
                createMainWindow(store.get('detachedMode'))
            }
        },
        {
            type: 'separator'
        },
        {
            label: `v${app.getVersion()} (Auto Update)`,
            enabled: false
        },
        {
            label: 'Open on github.com',
            click: () => {
                shell.openExternal('https://github.com/mrvnklm/homeassistant-desktop')
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Reload Window',
            click: () => {
                window.reload();
            }
        },
        {
            label: 'Reset Settings...',
            click: () => {
                dialog.showMessageBox({
                    message: 'Are you sure you want to reset Home Assistant Desktop?',
                    buttons: ['Cancel', 'OK, Reset!']
                }).then((res) => {
                    if (res.response === 1) {
                        store.clear();
                        window.webContents.session.clearCache();
                        window.webContents.session.clearStorageData();
                        app.relaunch();
                        app.exit();
                    }
                })
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Quit',
            accelerator: 'Cmd+Q',
            click: () => {
                forceQuit = true;
                app.quit();
            }
        }
    ])
};

const createMainWindow = (show = false) => {
    window = new BrowserWindow({
        width: 420,
        height: 420,
        show: false,
        skipTaskbar: true,
        autoHideMenuBar: true,
        frame: false,
        webPreferences: {
            nodeIntegration: true
        }
    });

    window.loadURL(`file://${__dirname}/web/index.html`)

    window.webContents.on('did-finish-load', function () {
        window.webContents.insertCSS('::-webkit-scrollbar { display: none; } body { -webkit-user-select: none; }');
        if (store.get('detachedMode')) {
            window.webContents.insertCSS('body { -webkit-app-region: drag; }');
        }
    });

    if (store.get('detachedMode')) {
        if (store.has('windowPosition')) window.setSize(...store.get('windowSizeDetached')); else store.set('windowPosition', window.getPosition());
        if (store.has('windowSizeDetached')) window.setPosition(...store.get('windowPosition')); else store.set('windowSizeDetached', window.getSize())
    } else {
        if (store.has('windowSize')) window.setSize(...store.get('windowSize')); else store.set('windowSize', window.getSize())
    }

    window.on('resize', () => {
        if (store.get('detachedMode')) {
            store.set('windowSizeDetached', window.getSize());
        } else {
            Positioner.position(window, tray.getBounds());
            store.set('windowSize', window.getSize());
        }

    });

    window.on('move', () => {
        if (store.get('detachedMode')) {
            store.set('windowPosition', window.getPosition())
        }
    });

    window.on('close', (e) => {
        if (!forceQuit) {
            window.hide();
            e.preventDefault()
        }
    });

    window.on('blur', () => {
        if (!store.get('detachedMode') && !window.isAlwaysOnTop()) window.hide();
    });

    if (show) showWindow();
};

const showWindow = () => {
    if (!store.get('detachedMode')) Positioner.position(window, tray.getBounds());
    if (!window.isVisible()) {
        window.show();
        window.focus();
    }
};

const createTray = () => {
        tray = new Tray(process.platform === 'win32' ? `${__dirname}/assets/IconWin.png` : `${__dirname}/assets/IconTemplate.png`);

        tray.on('click', () => {
            if (window.isVisible()) window.hide(); else showWindow();
        });

        tray.on('right-click', () => {
            if (!store.get('detachedMode')) window.hide();
            tray.popUpContextMenu(getMenu())
        });

        let timer = undefined;

        tray.on('mouse-move', (e) => {
                if (store.get('detachedMode') || window.isAlwaysOnTop() || store.get('disableHover')) {
                    return;
                }
                if (!window.isVisible()) {
                    showWindow();
                }
                if (timer) clearTimeout(timer)
                timer = setTimeout(() => {
                    let mousePos = screen.getCursorScreenPoint()
                    let trayBounds = tray.getBounds();
                    if (!(mousePos.x >= trayBounds.x && mousePos.x <= trayBounds.x + trayBounds.width) || !(mousePos.y >= trayBounds.y && mousePos.y <= trayBounds.y + trayBounds.height)) {
                        setWindowFocusTimer()
                    }
                }, 100);
            }
        )
    }
;

const setWindowFocusTimer = () => {
    let timer = setTimeout(() => {
        let mousePos = screen.getCursorScreenPoint();
        let windowPosition = window.getPosition();
        let windowSize = window.getSize();
        if (!(mousePos.x >= windowPosition[0] && mousePos.x <= windowPosition[0] + windowSize[0]) || !(mousePos.y >= windowPosition[1] && mousePos.y <= windowPosition[1] + windowSize[1])) {
            window.hide();
        } else {
            setWindowFocusTimer()
        }
    }, 110)
};

app.on('ready', () => {
    checkAutoStart();
    useAutoUpdater();
    createTray();
    createMainWindow(!store.has('instance'));
});

ipcMain.on('ha-instance', (event, args) => {
    if (args) {
        store.set('instance', args)
    } else {
        event.reply('ha-instance', store.get('instance'))
    }
});
