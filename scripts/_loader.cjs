// scripts/_loader.cjs
//
// Lets the Node scripts in this directory import the app's ESM modules under
// src/ directly, so the board logger runs the same model the page does rather
// than a copy that can drift.
//
// The project is a Create React App, so package.json has no "type": "module"
// and Node treats src/*.js as CommonJS. @babel/core is already present via
// react-scripts, so a require hook transforms each file on the way in. No new
// dependency, and nothing about the app's own build changes.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const babel = require('@babel/core');

const SRC = path.join(__dirname, '..', 'src');

// Both of these ship a "main" that Node cannot load from CommonJS — axios
// points at its ESM entry, react-router-dom at a file it does not include —
// and rely on an "exports" map instead. Same workaround as the jest config.
const ALIASES = {
  axios: path.join(__dirname, '..', 'node_modules', 'axios', 'dist', 'node', 'axios.cjs'),
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (ALIASES[request]) return ALIASES[request];
  return originalResolve.call(this, request, ...rest);
};

require.extensions['.js'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  // Only the app's own modules need transforming; node_modules is left alone.
  if (!filename.startsWith(SRC)) {
    return module._compile(source, filename);
  }
  const { code } = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [[require.resolve('@babel/preset-env'), { targets: { node: 'current' } }]],
    sourceMaps: 'inline',
  });
  return module._compile(code, filename);
};

module.exports = { SRC };

// ---------------------------------------------------------------------------
// Proxy support
// ---------------------------------------------------------------------------
//
// Reaching an HTTPS host through an HTTP proxy requires a CONNECT tunnel, and
// axios's node adapter issues a plain GET to the proxy instead, which well
// behaved proxies answer with 405. Any environment that sets HTTPS_PROXY — CI,
// a corporate network, a sandboxed container — hits this, so the scripts
// install an agent that tunnels properly. With no proxy set, nothing changes.

const http = require('http');
const https = require('https');
const tls = require('tls');

const proxyUrl =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY || process.env.http_proxy;

if (proxyUrl) {
  const proxy = new URL(proxyUrl);

  class TunnelAgent extends https.Agent {
    createConnection(options, callback) {
      const req = http.request({
        host: proxy.hostname,
        port: proxy.port || 80,
        method: 'CONNECT',
        path: `${options.host}:${options.port || 443}`,
        headers: { Host: `${options.host}:${options.port || 443}` },
      });
      req.once('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          callback(new Error(`proxy refused CONNECT with ${res.statusCode}`));
          return;
        }
        callback(
          null,
          tls.connect({
            socket,
            servername: options.servername || options.host,
            ca: options.ca,
          })
        );
      });
      req.once('error', callback);
      req.end();
    }
  }

  const agent = new TunnelAgent({ keepAlive: true });
  // axios reads these defaults; `proxy: false` stops it rewriting the request
  // into the plain-GET form the agent is here to replace.
  const axios = require(ALIASES.axios);
  axios.defaults.httpsAgent = agent;
  axios.defaults.proxy = false;
  https.globalAgent = agent;
}
