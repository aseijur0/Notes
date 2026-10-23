(function (root) {
  'use strict';
  let dbPromise;
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('oscp-map-notebooks', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Local storage is blocked by another tab.'));
    });
    return dbPromise;
  }
  async function transaction(mode, work) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('workspace', mode), request = work(tx.objectStore('workspace'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Local save failed.'));
    });
  }
  // Experimental: writes a plain JSON snapshot into a folder the user picks via the
  // File System Access API. The handle lives only in memory for this tab/session —
  // it is not persisted across reloads, so a reload always requires re-picking the
  // folder. Browser support and real permission behavior need verification in an
  // actual browser; this never replaces NotebookStorage, only supplements it.
  let folderHandle = null;
  root.FolderStorage = {
    supported: typeof globalThis.showDirectoryPicker === 'function',
    active() {return Boolean(folderHandle);},
    async pick() {
      folderHandle = await globalThis.showDirectoryPicker({id: 'oscp-map', mode: 'readwrite'});
      if ((await folderHandle.queryPermission({mode: 'readwrite'})) !== 'granted' && (await folderHandle.requestPermission({mode: 'readwrite'})) !== 'granted') {
        folderHandle = null; throw new Error('Folder access was not granted.');
      }
      return folderHandle.name;
    },
    forget() {folderHandle = null;},
    async write(w) {
      if (!folderHandle) throw new Error('No folder selected.');
      if ((await folderHandle.queryPermission({mode: 'readwrite'})) !== 'granted') throw new Error('Folder permission was revoked. Choose the folder again.');
      const handle = await folderHandle.getFileHandle('workspace.json', {create: true});
      const stream = await handle.createWritable();
      await stream.write(JSON.stringify(w, null, 2));
      await stream.close();
    }
  };
  root.NotebookStorage = {
    async load(legacyKey) {
      let saved, legacy;
      try {saved = await transaction('readonly', store => store.get('current'));} catch { /* Try the portable legacy fallback. */ }
      try {const raw = localStorage.getItem(legacyKey); legacy = raw ? JSON.parse(raw) : null;} catch (error) {if (!saved) throw error;}
      if (saved && legacy) return new Date(legacy.updated).getTime() > new Date(saved.updated).getTime() ? legacy : saved;
      return saved || legacy || null;
    },
    async save(w, legacyKey) {
      try {await transaction('readwrite', store => store.put(w, 'current')); try {localStorage.removeItem(legacyKey);} catch {} return;}
      catch {localStorage.setItem(legacyKey, JSON.stringify(w));}
    },
    async clear(legacyKey) {
      let database;
      try {database = await db();} catch { /* Browser may not support IndexedDB. */ }
      if (database) await transaction('readwrite', store => store.delete('current'));
      localStorage.removeItem(legacyKey);
    }
  };
})(globalThis);
