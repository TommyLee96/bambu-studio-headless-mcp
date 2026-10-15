// SPDX-License-Identifier: GPL-2.0-only
'use strict';
const childProcess = require('node:child_process');
const util = require('node:util');
const { syncBuiltinESMExports } = require('node:module');
if (process.platform === 'win32') {
  const execFile = childProcess.execFile;
  function hiddenExecFile(file, args, options, callback) {
    if (typeof args === 'function') { callback = args; args = []; options = {}; }
    else if (!Array.isArray(args)) { callback = typeof options === 'function' ? options : callback; options = args || {}; args = []; }
    if (typeof options === 'function') { callback = options; options = {}; }
    return execFile(file, args || [], { ...options, windowsHide: true }, callback);
  }
  hiddenExecFile[util.promisify.custom] = function (file, args, options) {
    let child;
    const promise = new Promise((resolve, reject) => {
      child = hiddenExecFile(file, args, options, (error, stdout, stderr) => {
        if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); }
        else resolve({ stdout, stderr });
      });
    });
    promise.child = child;
    return promise;
  };
  childProcess.execFile = hiddenExecFile;
  const spawn = childProcess.spawn;
  childProcess.spawn = function (file, args, options) {
    if (!Array.isArray(args)) { options = args || {}; args = []; }
    return spawn(file, args, { ...options, windowsHide: true });
  };
  syncBuiltinESMExports();
}
