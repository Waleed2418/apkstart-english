/*
 * ApkStart i18n renderer overlay.
 *
 * Translation runs only after the DOM has been quiet for a while, because the
 * UI is built incrementally and translating a partial sentence makes the whole
 * phrase unmatchable. A hard deadline forces a pass during continuous churn.
 *
 * Pass order:
 *   1. Block pass — outermost elements whose complete visible text matches a
 *      dictionary key (tags stripped, whitespace collapsed). Restores English
 *      HTML, so sentences split by <b>/<code>/<br> translate as one unit.
 *   2. Text pass — remaining text nodes.
 *   3. Attribute pass — placeholder, title, aria-label, alt.
 */
(function () {
  'use strict';

  if (window.__APKSTART_I18N_DOM__) return;
  window.__APKSTART_I18N_DOM__ = true;

  var data = window.__APKSTART_I18N;
  if (!data || !window.ApkStartI18N) return;

  var translate = window.ApkStartI18N.makeTranslator(data);
  if (!translate) return;

  var CJK_RE = window.ApkStartI18N.CJK_RE;

  var QUIET_MS = 400;
  var MAX_WAIT_MS = 1600;

  // ---------- flat lookup: markup-stripped text -> English HTML ----------
  var normalizePunct = window.ApkStartI18N.normalizePunct || function (s) { return s; };

  function flatten(text) {
    return normalizePunct(String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  }

  var flat = Object.create(null);
  Object.keys(data).forEach(function (key) {
    var value = data[key];
    if (typeof value !== 'string' || !CJK_RE.test(key)) return;
    var k = flatten(key);
    if (k.length < 2) return;
    if (flat[k] === undefined) flat[k] = value;
  });

  function lookupFlat(text) {
    var key = flatten(text);
    if (!key || !CJK_RE.test(key)) return null;
    return flat[key] || null;
  }

  var INLINE = { BR: 1, B: 1, STRONG: 1, EM: 1, I: 1, CODE: 1, KBD: 1, SPAN: 1, SMALL: 1, U: 1, S: 1, SUP: 1, SUB: 1, MARK: 1, A: 1, FONT: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, SVG: 1 };

  function elementSkipped(el) {
    var cur = el;
    while (cur && cur.nodeType === 1) {
      if (SKIP_TAGS[cur.tagName]) return true;
      if (cur.isContentEditable) return true;
      if (cur.getAttribute && cur.getAttribute('data-i18n-skip') !== null) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  function inlineOnly(el) {
    var all = el.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (!INLINE[all[i].tagName]) return false;
    }
    return true;
  }

  function markDone(el) {
    el.setAttribute('data-i18n-done', '1');
  }

  // Original text captured the first time an element is seen. Child text nodes
  // may already have been translated individually, but the dictionary is keyed
  // by the Chinese source, so parent lookups must use the captured text.
  var originalText = new WeakMap();
  var originalNodeText = new WeakMap();

  function rememberTexts() {
    var all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (originalText.has(el) || el.getAttribute('data-i18n-done') !== null) continue;
      originalText.set(el, el.textContent || '');
    }
  }

  // Rebuild the source-language text of an element, substituting the captured
  // Chinese for any child that was already translated. Lets a parent match its
  // dictionary key even after its children were translated piecemeal.
  function sourceText(node) {
    if (node.nodeType === 3) {
      var value = node.nodeValue || '';
      var orig = originalNodeText.get(node);
      if (orig !== undefined && orig !== value && !CJK_RE.test(value)) return orig;
      return value;
    }
    if (node.nodeType !== 1) return '';
    if (node.tagName === 'BR') return ' ';
    if (node.getAttribute && node.getAttribute('data-i18n-done') !== null) {
      var saved = originalText.get(node);
      if (saved !== undefined) return saved;
    }
    var out = '';
    for (var child = node.firstChild; child; child = child.nextSibling) out += sourceText(child);
    // Element boundaries flatten to spaces, exactly like a tag-stripped key.
    return ' ' + out + ' ';
  }

  function normalize(text) {
    return String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function blockTranslate(el) {
    if (el.getAttribute('data-i18n-done') !== null) return false;
    var text = inlineOnly(el) ? sourceText(el) : (el.textContent || '');
    if (!CJK_RE.test(text)) return false;
    if (!inlineOnly(el)) return false;
    var english = lookupFlat(text);
    if (!english) return false;
    markDone(el);
    if (english.indexOf('<') !== -1) el.innerHTML = english;
    else el.textContent = english;
    return true;
  }

  function translateTextNode(node) {
    var value = node.nodeValue;
    if (!value || !CJK_RE.test(value)) return false;
    if (!originalNodeText.has(node)) originalNodeText.set(node, value);
    var out = translate(value);
    if (out === value) out = translateSegments(value);
    if (out === value) return false;
    node.nodeValue = out;
    return true;
  }

  // Composite labels join English fragments with " · " (profile summary, usage,
  // driver card meta). Whole-string lookups miss them, so translate each piece.
  function translateSegments(value) {
    if (value.indexOf(' · ') === -1) return value;
    var parts = value.split(' · ');
    var changed = false;
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!CJK_RE.test(part)) continue;
      var tr = translate(part);
      if (tr !== part) { parts[i] = tr; changed = true; }
    }
    return changed ? parts.join(' · ') : value;
  }

  function translateAttributes(el) {
    var changed = false;
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      var value = el.getAttribute(name);
      if (!value || !CJK_RE.test(value)) continue;
      var out = translate(value);
      if (out !== value) {
        el.setAttribute(name, out);
        changed = true;
      }
    }
    return changed;
  }

  function blockPass() {
    var changed = false;
    var all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.getAttribute('data-i18n-done') !== null) continue;
      if (elementSkipped(el)) continue;
      if (el.parentElement && el.parentElement.closest('[data-i18n-done]')) continue;
      if (blockTranslate(el)) changed = true;
    }
    return changed;
  }

  function textPass() {
    var changed = false;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var parent = n.parentNode;
      if (!parent || elementSkipped(parent)) continue;
      // Translate even inside a block that was already replaced: the app
      // rewrites individual labels there later (status line, version note).
      if (translateTextNode(n)) changed = true;
    }
    var all = document.body.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      if (elementSkipped(el)) continue;
      if (translateAttributes(el)) changed = true;
    }
    return changed;
  }

  var quietTimer = 0;
  var maxTimer = 0;
  var applying = false;

  function runPass() {
    var title = document.title;
    if (title) { var tTitle = translate(title); if (tTitle !== title) document.title = tTitle; }
    if (!document.body) return;
    quietTimer = 0;
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = 0; }
    applying = true;
    var changed = false;
    try {
      rememberTexts();
      changed = blockPass() || changed;
      changed = textPass() || changed;
    } finally {
      applying = false;
    }
    // A pass that changed something may have produced new text; queue one more.
    if (changed) schedule();
  }

  function schedule() {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(runPass, QUIET_MS);
    if (!maxTimer) {
      maxTimer = setTimeout(function () {
        if (quietTimer) { clearTimeout(quietTimer); quietTimer = 0; }
        runPass();
      }, MAX_WAIT_MS);
    }
  }

  function reclaim(node) {
    // The app rewrites labels in place (status lines, tips). A previously
    // translated element that now holds Chinese again must become a candidate.
    var el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    if (!el || !el.closest) return;
    var done = el.closest('[data-i18n-done]');
    if (!done) return;
    if (!CJK_RE.test(done.textContent || '')) return;
    done.removeAttribute('data-i18n-done');
    originalText.delete(done);
    if (node && node.nodeType === 3) originalNodeText.delete(node);
  }

  // The app polls the runtime and rewrites status labels every second or so.
  // A debounced whole-document pass loses that race, so translate strings at
  // assignment time as well: any textContent write in Chinese lands in English.
  function installSetter() {
    var desc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    if (!desc || !desc.set) return;
    Object.defineProperty(Node.prototype, 'textContent', {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (value) {
        if (typeof value === 'string' && CJK_RE.test(value)) {
          try {
            var out = translate(value);
            if (out === value) out = translateSegments(value);
            value = out;
          } catch (_) { /* keep the original string */ }
        }
        desc.set.call(this, value);
      },
    });
  }

  function start() {
    installSetter();
    document.documentElement.lang = 'en';
    runPass();
    var observer = new MutationObserver(function (mutations) {
      if (applying) return;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'characterData') {
          reclaim(m.target);
          schedule();
          return;
        }
        if (m.type === 'attributes') {
          schedule();
          return;
        }
        if (m.type === 'childList') {
          for (var k = 0; k < m.addedNodes.length; k++) {
            var node = m.addedNodes[k];
            if (node.nodeType === 1 && node.tagName === 'SCRIPT') continue;
            reclaim(m.target);
            schedule();
            return;
          }
          reclaim(m.target);
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS.concat(['data-i18n-skip']),
    });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });

  window.__i18nDebug = {
    sourceText: sourceText,
    lookupFlat: lookupFlat,
    originalText: originalText,
    originalNodeText: originalNodeText,
  };
})();
