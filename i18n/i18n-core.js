/*
 * ApkStart i18n core
 * Keyed by the original Chinese source strings; placeholders look like {name}.
 * Works in both the renderer (window.ApkStartI18N) and the main process (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ApkStartI18N = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

  // The app mixes full-width and ASCII punctuation for the same sentence, while
  // the dictionary keeps one form. Normalize punctuation before matching.
  function normalizePunct(text) {
    return String(text)
      .replace(/\uff1a/g, ':')
      .replace(/\uff0c/g, ',')
      .replace(/\u3002/g, '.')
      .replace(/\uff08/g, '(')
      .replace(/\uff09/g, ')')
      .replace(/\uff01/g, '!')
      .replace(/\uff1f/g, '?')
      .replace(/\uff1b/g, ';');
  }

  function makeTranslator(dict) {
    var exact = Object.create(null);
    var exactNorm = Object.create(null);
    var templated = [];
    var cache = Object.create(null);

    Object.keys(dict).forEach(function (key) {
      var value = dict[key];
      if (typeof value !== 'string' || !CJK_RE.test(key)) return;
      if (key.indexOf('{') === -1) {
        exact[key] = value;
        var nk = normalizePunct(key);
        if (exactNorm[nk] === undefined) exactNorm[nk] = value;
        return;
      }
      var parts = normalizePunct(key).split(/(\{[^}]+\})/);
      var pattern = '^';
      var order = [];
      var literal = 0;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (!p) continue;
        if (/^\{[^}]+\}$/.test(p)) {
          pattern += '(.+?)';
          order.push(p.slice(1, -1));
        } else {
          pattern += p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          literal += p.length;
        }
      }
      pattern += '$';
      var template = value.replace(/\{([^}]+)\}/g, function (m, name) {
        var idx = order.indexOf(name);
        return idx >= 0 ? '$' + (idx + 1) : m;
      });
      templated.push({ regex: new RegExp(pattern), template: template, len: key.length, literal: literal });
    });
    // Most literal text first: a generic "{file}：{errors}" must not win over
    // "状态检查失败：{err}" just because its key is longer.
    templated.sort(function (a, b) {
      return b.literal - a.literal || b.len - a.len;
    });

    function translate(input) {
      if (typeof input !== 'string' || !input) return input;
      if (!CJK_RE.test(input)) return input;
      var trimmed = input.trim();
      if (!trimmed) return input;
      var hit = cache[trimmed];
      if (hit === undefined) {
        if (Object.prototype.hasOwnProperty.call(exact, trimmed)) {
          hit = exact[trimmed];
        } else {
          var normalized = normalizePunct(trimmed);
          if (Object.prototype.hasOwnProperty.call(exactNorm, normalized)) {
            hit = exactNorm[normalized];
          } else {
            hit = '';
            for (var i = 0; i < templated.length; i++) {
              var t = templated[i];
              var candidate = t.regex.test(trimmed) ? trimmed : (t.regex.test(normalized) ? normalized : null);
              if (candidate !== null) {
                hit = candidate.replace(t.regex, t.template);
                break;
              }
            }
          }
        }
        cache[trimmed] = hit;
      }
      if (!hit) return input;
      var lead = input.match(/^\s*/)[0];
      var tail = input.match(/\s*$/)[0];
      return lead + hit + tail;
    }

    translate.hasCJK = function (s) { return typeof s === 'string' && CJK_RE.test(s); };
    return translate;
  }

  return { makeTranslator: makeTranslator, CJK_RE: CJK_RE, normalizePunct: normalizePunct };
});
