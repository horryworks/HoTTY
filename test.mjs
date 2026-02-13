import { app } from 'electron';
console.log('App:', app);
try {
    console.log('App name:', app.getName());
} catch (e) {
    console.error(e);
}
