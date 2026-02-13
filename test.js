const electron = require('electron');
console.log('Electron module:', electron);
try {
    console.log('App:', electron.app);
} catch (e) {
    console.error(e);
}
