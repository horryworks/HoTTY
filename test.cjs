console.log('ExecPath:', process.execPath);
console.log('Env ELECTRON_RUN_AS_NODE:', process.env.ELECTRON_RUN_AS_NODE);
console.log('Versions:', process.versions);
try {
    const electron = require('electron');
    console.log('Electron module type:', typeof electron);
    console.log('Electron module:', electron);
} catch (e) {
    console.error(e);
}
