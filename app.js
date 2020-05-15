const {app, Menu, Tray, dialog, ipcMain, BrowserWindow, shell} = require('electron');
const {autoUpdater} = require('electron-updater');
const AutoLaunch = require('auto-launch');
const Positioner = require('electron-traywindow-positioner');
const Store = require('electron-store');

if (process.platform === 'darwin') app.dock.hide();
app.allowRendererProcessReuse = true;

const store = new Store();
const autoLauncher = new AutoLaunch({name: 'Home Assistant Desktop'});

let autostartEnabled = false;
let forceQuit = false;

const useAutoUpdater = () => {
    autoUpdater.on('error', message => {
        console.error('There was a problem updating the application');
        console.error(message)
    });

    autoUpdater.checkForUpdatesAndNotify();
};

const checkAutoStart = () => {
    autoLauncher.isEnabled()
        .then(function (isEnabled) {
            autostartEnabled = isEnabled
        })
        .catch(function (err) {
            console.log(err)
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
            label: 'Stay on Top',
            type: 'checkbox',
            checked: window.isAlwaysOnTop(),
            click: () => {
                window.setAlwaysOnTop(!window.isAlwaysOnTop());
                if (window.isAlwaysOnTop()) {
                    window.show();
                    window.focus()
                }
            }
        },
        {
            label: 'Start at Login',
            type: 'checkbox',
            checked: autostartEnabled,
            click: () => {
                if (autostartEnabled) {
                    autoLauncher.disable();
                    autostartEnabled = false
                } else {
                    autoLauncher.enable();
                    autostartEnabled = true
                }
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
            label: 'Hide Window Bar',
            type: 'checkbox',
            enabled: store.get('detachedMode'),
            checked: store.get('hideWindowBar'),
            click: () => {
                store.set('hideWindowBar', !store.get('hideWindowBar'));
                createMainWindow(true)
            }
        },
        {
            type: 'separator'
        },
        {
            label: `v${app.getVersion()} (Auto Update: on)`,
            enabled: false
        },
        {
            label: 'Buy me a coffee?',
            click: () => {
                shell.openExternal('https://buymeacoff.ee/mrvnk')
            }
        },
        {
            type: 'separator'
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
        show: show,
        skipTaskbar: true,
        autoHideMenuBar: true,
        frame: !!store.get('detachedMode') && !store.get('hideWindowBar'),
        webPreferences: {
            nodeIntegration: true
        }
    });

    if (store.get('detachedMode')) {
        if (!store.has('windowPosition')) store.set('windowPosition', window.getPosition());
        if (!store.has('windowSizeDetached')) store.set('windowSizeDetached', window.getSize())
    } else {
        if (!store.has('windowSize')) store.set('windowSize', window.getSize())
    }

    window.loadURL(`file://${__dirname}/web/index.html`);

    if (store.get('detachedMode')) {
        window.setSize(...store.get('windowSizeDetached'));
        window.setPosition(...store.get('windowPosition'))
    } else {
        window.setSize(...store.get('windowSize'))
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
    })
};

const createTray = () => {
    tray = new Tray(process.platform === 'win32' ? `${__dirname}/assets/IconWin.png` : `${__dirname}/assets/Icon.png`);

    tray.on('click', () => {
        if (window.isVisible()) {
            window.hide()
        } else {
            if (!store.get('detachedMode')) Positioner.position(window, tray.getBounds());
            window.show();
            window.focus()
        }

    });
    tray.on('right-click', function () {
        window.hide();
        tray.popUpContextMenu(getMenu())
    })
};

app.on('ready', () => {
    useAutoUpdater();
    createMainWindow();
    createTray();
});

ipcMain.on('ha-instance', (event, args) => {
    if (args) {
        store.set('instance', args)
    } else {
        event.reply('ha-instance', store.get('instance'))
    }
});
