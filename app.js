const {
  app,
  dialog,
  ipcMain,
  shell,
  screen,
  net,
  Menu,
  Tray,
  BrowserWindow,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const AutoLaunch = require("auto-launch");
const Positioner = require("electron-traywindow-positioner");
const Store = require("electron-store");

app.allowRendererProcessReuse = true;

// prevent multiple instances
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) showWindow();
  });
}

// hide dock icon on macOS
if (process.platform === "darwin") app.dock.hide();

const store = new Store();
const autoLauncher = new AutoLaunch({ name: "Home Assistant Desktop" });

const indexFile = `file://${__dirname}/web/index.html`;
const errorFile = `file://${__dirname}/web/error.html`;

let autostartEnabled = false;
let forceQuit = false;
let resizeEvent = false;

const useAutoUpdater = () => {
  autoUpdater.on("error", (message) => {
    console.error("There was a problem updating the application");
    console.error(message);
  });

  autoUpdater.on("update-downloaded", () => {
    forceQuit = true;
    autoUpdater.quitAndInstall();
  });

  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 1000 * 60 * 60);

  autoUpdater.checkForUpdates();
};

const checkAutoStart = () => {
  autoLauncher
    .isEnabled()
    .then((isEnabled) => {
      autostartEnabled = isEnabled;
    })
    .catch((err) => {
      console.error(err);
    });
};

const startAvailabilityCheck = () => {
  setInterval(() => {
    const request = net.request(`${currentInstance()}/auth/providers`);
    request.on("response", (response) => {
      showError(response.statusCode !== 200);
    });
    request.on("error", (error) => {
      showError(true);
      if (store.get("automaticSwitching")) checkForAvailableInstance();
    });
    request.end();
  }, 3000);
};

const checkForAvailableInstance = () => {
  const instances = store.get("allInstances");

  if (instances && instances.length > 1) {
    instances
      .filter((e) => e.url !== currentInstance())
      .forEach((e) => {
        const request = net.request(`${e}/auth/providers`);
        request.on("response", (response) => {
          if (response.statusCode === 200) currentInstance(e);
        });
        request.on("error", (error) => {});
        request.end();
      });
  }
};

const getMenu = () => {
  let instancesMenu = [
    {
      label: "Open in Browser",
      enabled: currentInstance(),
      click: () => {
        shell.openExternal(currentInstance());
      },
    },
    {
      type: "separator",
    },
  ];

  const allInstances = store.get("allInstances");

  if (allInstances) {
    allInstances.forEach((e) => {
      instancesMenu.push({
        label: e,
        type: "checkbox",
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
        type: "separator",
      },
      {
        label: "Add another Instance...",
        click: () => {
          store.delete("currentInstance");
          window.loadURL(indexFile);
          window.show();
        },
      },
      {
        label: "Automatic Switching",
        type: "checkbox",
        enabled:
          store.has("allInstances") && store.get("allInstances").length > 1,
        checked: store.get("automaticSwitching"),
        click: () => {
          store.set("automaticSwitching", !store.get("automaticSwitching"));
        },
      }
    );
  } else {
    instancesMenu.push({ label: "Not Connected...", enabled: false });
  }

  return Menu.buildFromTemplate([
    {
      label: "Show/Hide Window",
      visible: process.platform === "linux",
      click: () => {
        if (window.isVisible()) window.hide();
        else showWindow();
      },
    },
    {
      visible: process.platform === "linux",
      type: "separator",
    },
    ...instancesMenu,
    {
      type: "separator",
    },
    {
      label: "Hover to Show",
      visible: process.platform !== "linux",
      enabled: !store.get("detachedMode"),
      type: "checkbox",
      checked: !store.get("disableHover"),
      click: () => {
        store.set("disableHover", !store.get("disableHover"));
      },
    },
    {
      label: "Stay on Top",
      type: "checkbox",
      checked: window.isAlwaysOnTop(),
      click: () => {
        window.setAlwaysOnTop(!window.isAlwaysOnTop());
        if (window.isAlwaysOnTop()) showWindow();
      },
    },
    {
      label: "Start at Login",
      type: "checkbox",
      checked: autostartEnabled,
      click: () => {
        if (autostartEnabled) autoLauncher.disable();
        else autoLauncher.enable();
        checkAutoStart();
      },
    },
    {
      type: "separator",
    },
    {
      label: "Use detached Window",
      type: "checkbox",
      checked: store.get("detachedMode"),
      click: () => {
        store.set("detachedMode", !store.get("detachedMode"));
        window.hide();
        createMainWindow(store.get("detachedMode"));
      },
    },
    {
      type: "separator",
    },
    {
      label: `v${app.getVersion()} (Auto Update)`,
      enabled: false,
    },
    {
      label: "Open on github.com",
      click: () => {
        shell.openExternal("https://github.com/mrvnklm/homeassistant-desktop");
      },
    },
    {
      type: "separator",
    },
    {
      label: "Reload Window",
      click: () => {
        window.reload();
      },
    },
    {
      label: "Reset Application...",
      click: () => {
        dialog
          .showMessageBox({
            message: "Are you sure you want to reset Home Assistant Desktop?",
            buttons: ["Reset Everything!", "Reset Windows", "Cancel"],
          })
          .then((res) => {
            if (res.response === 0) {
              store.clear();
              window.webContents.session.clearCache();
              window.webContents.session.clearStorageData();
              app.relaunch();
              app.exit();
            }
            if (res.response === 1) {
              store.delete("windowSizeDetached");
              store.delete("windowSize");
              store.delete("windowPosition");
              app.relaunch();
              app.exit();
            }
          });
      },
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => {
        forceQuit = true;
        app.quit();
      },
    },
  ]);
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
      nodeIntegration: true,
    },
  });

  // window.webContents.openDevTools();
  window.loadURL(indexFile);

  // open extenal links in default browser
  window.webContents.on("new-window", function (e, url) {
    e.preventDefault();
    require("electron").shell.openExternal(url);
  });

  // hide scrollbar
  window.webContents.on("did-finish-load", function () {
    window.webContents.insertCSS(
      "::-webkit-scrollbar { display: none; } body { -webkit-user-select: none; }"
    );
    if (store.get("detachedMode")) {
      window.webContents.insertCSS("body { -webkit-app-region: drag; }");
    }
  });

  if (store.get("detachedMode")) {
    if (store.has("windowPosition"))
      window.setSize(...store.get("windowSizeDetached"));
    else store.set("windowPosition", window.getPosition());
    if (store.has("windowSizeDetached"))
      window.setPosition(...store.get("windowPosition"));
    else store.set("windowSizeDetached", window.getSize());
  } else {
    if (store.has("windowSize")) window.setSize(...store.get("windowSize"));
    else store.set("windowSize", window.getSize());
  }

  window.on("resize", (e) => {
    if (!store.get("disableHover") || resizeEvent) {
      store.set("disableHover", true);
      resizeEvent = e;
      setTimeout(() => {
        if (resizeEvent === e) {
          store.set("disableHover", false);
          resizeEvent = false;
        }
      }, 600);
    }

    if (store.get("detachedMode")) {
      store.set("windowSizeDetached", window.getSize());
    } else {
      if (process.platform !== "linux") Positioner.position(window, tray.getBounds());
      store.set("windowSize", window.getSize());
    }
  });

  window.on("move", () => {
    if (store.get("detachedMode")) {
      store.set("windowPosition", window.getPosition());
    }
  });

  window.on("close", (e) => {
    if (!forceQuit) {
      window.hide();
      e.preventDefault();
    }
  });

  window.on("blur", () => {
    if (!store.get("detachedMode") && !window.isAlwaysOnTop()) window.hide();
  });

  if (show) showWindow();
};

const showWindow = () => {
  if (!store.get("detachedMode")) Positioner.position(window, tray.getBounds());
  if (!window.isVisible()) {
    window.setVisibleOnAllWorkspaces(true); // put the window on all screens
    window.show();
    window.focus();
    window.setVisibleOnAllWorkspaces(false); // disable all screen behavior
  }
};

const createTray = () => {
  tray = new Tray(
    ["win32", "linux"].includes(process.platform)
      ? `${__dirname}/assets/IconWin.png`
      : `${__dirname}/assets/IconTemplate.png`
  );

  tray.on("click", () => {
    if (window.isVisible()) window.hide();
    else showWindow();
  });

  tray.on("right-click", () => {
    if (!store.get("detachedMode")) window.hide();
    tray.popUpContextMenu(getMenu());
  });

  let timer = undefined;

  tray.on("mouse-move", (e) => {
    if (
      store.get("detachedMode") ||
      window.isAlwaysOnTop() ||
      store.get("disableHover")
    ) {
      return;
    }
    if (!window.isVisible()) {
      showWindow();
    }

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      let mousePos = screen.getCursorScreenPoint();
      let trayBounds = tray.getBounds();
      if (
        !(
          mousePos.x >= trayBounds.x &&
          mousePos.x <= trayBounds.x + trayBounds.width
        ) ||
        !(
          mousePos.y >= trayBounds.y &&
          mousePos.y <= trayBounds.y + trayBounds.height
        )
      ) {
        setWindowFocusTimer();
      }
    }, 100);
  });
};

const setWindowFocusTimer = () => {
  let timer = setTimeout(() => {
    let mousePos = screen.getCursorScreenPoint();
    let windowPosition = window.getPosition();
    let windowSize = window.getSize();
    if (
      !resizeEvent &&
      (!(
        mousePos.x >= windowPosition[0] &&
        mousePos.x <= windowPosition[0] + windowSize[0]
      ) ||
        !(
          mousePos.y >= windowPosition[1] &&
          mousePos.y <= windowPosition[1] + windowSize[1]
        ))
    ) {
      window.hide();
    } else {
      setWindowFocusTimer();
    }
  }, 110);
};

app.on("ready", () => {
  checkAutoStart();
  useAutoUpdater();
  createTray();
  createMainWindow(!store.has("currentInstance"));
  if (process.platform === "linux") tray.setContextMenu(getMenu());
  startAvailabilityCheck();

  // disable hover for first start
  if (!store.has("currentInstance")) {
    store.set("disableHover", true);
  }
});

const currentInstance = (url = null) => {
  if (url) {
    store.set("currentInstance", store.get("allInstances").indexOf(url));
  }
  if (store.has("currentInstance")) {
    return store.get("allInstances")[store.get("currentInstance")];
  }
  return false;
};

const addInstance = (url) => {
  if (!store.has("allInstances")) store.set("allInstances", []);
  let instances = store.get("allInstances");
  if (instances.find((e) => e === url)) {
    currentInstance(url);
    return;
  }

  // active hover by default after adding first instance
  if (!instances.length) store.set("disableHover", false);

  instances.push(url);
  store.set("allInstances", instances);
  currentInstance(url);
};

const showError = (isError) => {
  if (!isError && window.webContents.getURL().includes("error.html"))
    window.loadURL(indexFile);
  if (
    isError &&
    currentInstance() &&
    !window.webContents.getURL().includes("error.html")
  )
    window.loadURL(errorFile);
};

ipcMain.on("ha-instance", (event, url) => {
  if (url) addInstance(url);
  if (currentInstance()) event.reply("ha-instance", currentInstance());
});
