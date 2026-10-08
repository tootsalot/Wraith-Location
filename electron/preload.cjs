const { contextBridge, ipcRenderer } = require('electron');

const invoke = async (method, payload) => {
  const response = await ipcRenderer.invoke(`wraith:${method}`, payload);
  if (!response.ok) throw new Error(response.error || 'The operation failed.');
  return response.data;
};

contextBridge.exposeInMainWorld('wraith', Object.freeze({
  getState: () => invoke('getState'),
  switchToWifi: id => invoke('switchToWifi', id),
  setConnection: value => invoke('setConnection', value),
  connectWifi: value => invoke('connectWifi', value),
  scanDevices: () => invoke('scanDevices'),
  prepareDevice: id => invoke('prepareDevice', id),
  applyLocation: point => invoke('applyLocation', point),
  stopLocation: () => invoke('stopLocation'),
  getRoute: () => invoke('getRoute'),
  planRoute: stops => invoke('planRoute', stops),
  startRoute: value => invoke('startRoute', value),
  pauseRoute: () => invoke('pauseRoute'),
  resumeRoute: () => invoke('resumeRoute'),
  startWander: value => invoke('startWander', value),
  updateRouteOptions: value => invoke('updateRouteOptions', value),
  saveRoute: value => invoke('saveRoute', value),
  loadSavedRoute: id => invoke('loadSavedRoute', id),
  renameSavedRoute: value => invoke('renameSavedRoute', value),
  deleteSavedRoute: id => invoke('deleteSavedRoute', id),
  importGpx: value => invoke('importGpx', value),
  exportGpx: () => invoke('exportGpx'),
  searchPlaces: query => invoke('searchPlaces', query),
  namePlace: place => invoke('namePlace', place),
  setGeoapifyKey: key => invoke('setGeoapifyKey', key),
  removeGeoapifyKey: () => invoke('removeGeoapifyKey'),
  savePlace: place => invoke('savePlace', place),
  deletePlace: id => invoke('deletePlace', id),
  updatePreferences: value => invoke('updatePreferences', value),
  installRuntime: () => invoke('installRuntime'),
  onState: callback => {
    if (typeof callback !== 'function') throw new Error('A callback is required.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('wraith:state', listener);
    return () => ipcRenderer.removeListener('wraith:state', listener);
  }
}));
