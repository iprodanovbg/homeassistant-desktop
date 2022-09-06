const Store = require('electron-store');

module.exports = new Store({
  defaults: {
    autoUpdate: true,
    automaticSwitching: true,
    detachedMode: false,
    disableHover: false,
    stayOnTop: false,
    fullScreen: false,
    shortcutEnabled: false,
    allInstances: []
  }
});
