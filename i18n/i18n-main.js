/*
 * ApkStart i18n main-process overlay
 * Wraps native dialogs, menus and tray text; they bypass the renderer DOM.
 * Load it once, early, before any dialog/menu is built.
 */
'use strict';

const path = require('path');
const { dialog, Menu, Tray, BrowserWindow } = require('electron');
let dict = {};
try { dict = require('./en-merged.json'); } catch (_) {
  try { dict = require('./en.json'); } catch (_) {}
}
const translate = require('./i18n-core').makeTranslator(dict);

if (!global.__APKSTART_I18N_MAIN__) {
  global.__APKSTART_I18N_MAIN__ = true;

  const translateString = (value) => (typeof value === 'string' ? translate(value) : value);

  function translateOptions(options) {
    if (!options || typeof options !== 'object') return options;
    const out = Object.assign({}, options);
    out.title = translateString(out.title);
    out.message = translateString(out.message);
    out.detail = translateString(out.detail);
    out.checkboxLabel = translateString(out.checkboxLabel);
    if (Array.isArray(out.buttons)) out.buttons = out.buttons.map(translateString);
    if (Array.isArray(out.filters)) out.filters = out.filters.map(function (f) { return f && typeof f === 'object' ? Object.assign({}, f, { name: translateString(f.name) }) : f; });
    return out;
  }

  // dialog.showMessageBox([window,] options[, callback])
  const showMessageBox = dialog.showMessageBox;
  dialog.showMessageBox = function (win, options, callback) {
    if (typeof options === 'function') { callback = options; options = win; win = undefined; }
    if (options && typeof options === 'object' && !(Array.isArray(options)) && typeof options.message !== 'undefined') {
      options = translateOptions(options);
    }
    return showMessageBox.call(dialog, win, options, callback);
  };

  const showMessageBoxSync = dialog.showMessageBoxSync;
  dialog.showMessageBoxSync = function (win, options) {
    if (options === undefined) { options = win; win = undefined; }
    return showMessageBoxSync.call(dialog, win, translateOptions(options));
  };

  const showErrorBox = dialog.showErrorBox;
  dialog.showErrorBox = function (title, content) {
    return showErrorBox.call(dialog, translateString(title), translateString(content));
  };

  const showOpenDialog = dialog.showOpenDialog;
  dialog.showOpenDialog = function (win, options, callback) {
    if (typeof options === 'function') { callback = options; options = win; win = undefined; }
    if (options && typeof options === 'object') options = translateOptions(options);
    return showOpenDialog.call(dialog, win, options, callback);
  };

  const showSaveDialog = dialog.showSaveDialog;
  dialog.showSaveDialog = function (win, options, callback) {
    if (typeof options === 'function') { callback = options; options = win; win = undefined; }
    if (options && typeof options === 'object') options = translateOptions(options);
    return showSaveDialog.call(dialog, win, options, callback);
  };

  function translateTemplate(items) {
    if (!Array.isArray(items)) return items;
    return items.map(function (item) {
      if (!item || typeof item !== 'object') return item;
      const out = Object.assign({}, item);
      if (typeof out.label === 'string') out.label = translate(out.label);
      if (typeof out.toolTip === 'string') out.toolTip = translate(out.toolTip);
      if (Array.isArray(out.submenu)) out.submenu = translateTemplate(out.submenu);
      return out;
    });
  }

  const buildFromTemplate = Menu.buildFromTemplate;
  Menu.buildFromTemplate = function (template) {
    return buildFromTemplate.call(Menu, translateTemplate(template));
  };

  const setToolTip = Tray.prototype.setToolTip;
  Tray.prototype.setToolTip = function (value) {
    return setToolTip.call(this, translateString(value));
  };

  const setTitle = BrowserWindow.prototype.setTitle;
  BrowserWindow.prototype.setTitle = function (value) {
    return setTitle.call(this, translateString(value));
  };
}
