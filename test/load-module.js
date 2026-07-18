"use strict";
/*
 * Grand Line ships as a single index.html with no build step. Its game
 * logic is written as a series of browser-global IIFEs (economy.js,
 * state.js, rewards.js, game.js — each delimited by a
 * "/* ==== name.js ==== *\/" comment) that also support
 * `module.exports` when `require` exists, specifically so they can be
 * pulled into Node for testing without a bundler.
 *
 * This loader extracts a named module's source directly out of
 * index.html at test-run time and evaluates it with a CommonJS-style
 * module/exports/require shim. Tests always exercise the exact code
 * that ships — there is no hand-copied duplicate to drift out of sync.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const INDEX_HTML = path.join(__dirname, "..", "index.html");
const cache = new Map();

function extractModuleSource(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markerRe = new RegExp(`/\\* =+ ${escaped} =+ \\*/`);
  const match = markerRe.exec(html);
  if (!match) {
    throw new Error(`Could not find module marker for "${name}" in index.html`);
  }
  const startIdx = match.index;
  const closeToken = '})(typeof window !== "undefined" ? window : this);';
  const closeIdx = html.indexOf(closeToken, startIdx);
  if (closeIdx === -1) {
    throw new Error(`Could not find closing IIFE for module "${name}" in index.html`);
  }
  const end = closeIdx + closeToken.length;
  return html.slice(startIdx, end);
}

function loadModule(name) {
  if (cache.has(name)) return cache.get(name);

  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const source = extractModuleSource(html, name);

  // Deliberately NOT vm.createContext(): a separate context is a separate
  // JS realm with its own Object/Array/etc, which makes anything the
  // module returns fail assert.deepStrictEqual against plain literals in
  // the test files (structurally equal, but different Object.prototype).
  // vm.runInThisContext compiles in the current realm instead, so the
  // module shares Object/Array/Date/etc with the tests that consume it —
  // only module/exports/require are sandboxed per module, same as
  // Node's own CommonJS wrapper.
  const wrapper = vm.runInThisContext(
    "(function (module, exports, require) {\n" + source + "\n});",
    { filename: `index.html::${name}` }
  );

  const moduleObj = { exports: {} };
  const sandboxRequire = (dep) => {
    // deps are referenced as "./economy", "./state", etc.
    const depName = dep.replace(/^\.\//, "") + ".js";
    return loadModule(depName);
  };

  wrapper.call(moduleObj.exports, moduleObj, moduleObj.exports, sandboxRequire);

  cache.set(name, moduleObj.exports);
  return moduleObj.exports;
}

module.exports = { loadModule };
