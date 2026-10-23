// Optional browser-test host. The shipped HTML does not use Electron or Node.
const {app, BrowserWindow} = require('electron');
app.setPath('userData', process.env.OSCP_TEST_PROFILE);
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const window = new BrowserWindow({show: false, width: 1600, height: 1000, webPreferences: {nodeIntegration: false, contextIsolation: true}});
  window.loadFile(require('node:path').resolve(__dirname, '../index.html'));
});
