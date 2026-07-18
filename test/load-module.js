"use strict";
/*
 * Grand Line ships as a single index.html with no build step. Its game
 * logic is written as a series of browser-global IIFEs (economy.js,
 * state.js, rewards.js, game.js, ui.js) that each support
 * `module.exports` when `require` exists, specifically so they can be
 * pulled into Node for testing without a bundler.
 *
 * Historically these modules lived inlined in index.html and this loader
 * extracted each module's source out of the HTML at test-run time. They
 * are now real files under js/ (and style.css), so the loader simply
 * requires the actual module file. Tests always exercise the exact code
 * that ships — there is no hand-copied duplicate to drift out of sync.
 */
const fs = require("fs");
const path = require("path");

const JS_DIR = path.join(__dirname, "..", "js");
const cache = new Map();

function loadModule(name) {
  if (cache.has(name)) return cache.get(name);

  const file = path.join(JS_DIR, name);
  if (!fs.existsSync(file)) {
    throw new Error(`Could not find module file for "${name}" at ${file}`);
  }
  // require() executes the module's IIFE and returns its module.exports.
  // Cross-module deps inside the modules resolve via Node's own require
  // (e.g. require("./economy") -> js/economy.js), which is already handled
  // by each module's `GL.x || require("./x")` fallback.
  const exports = require(file);
  cache.set(name, exports);
  return exports;
}

module.exports = { loadModule };
