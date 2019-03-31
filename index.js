var CachingWriter = require('broccoli-caching-writer');
var path = require('path');
var fs = require('fs');
var RSVP = require('rsvp');
var required = require('required');
var Module = require('module').Module;
var symlinkOrCopySync = require('symlink-or-copy').sync;

function getFolderFromPath(fullPath) {
  return fs.statSync(fullPath).isDirectory() ? fullPath : path.dirname(fullPath);
}

export default class NodeImporter extends CachingWriter {
  constructor(inputNodes, options = {}) {
    super(inputNodes, options);
    this.ignore = options.ignore || [];
    this.mainFile = options.mainFile || 'index.js';
  }

  build() {
    this.npmPaths = [];
    this.linkedModules = [];
    var indexPath = path.join(this.inputPaths[0], this.mainFile);

    fs.mkdirSync(path.join(this.outputPath, 'node_modules'));

    var self = this;

    return new RSVP.Promise(function (resolve, reject) {
      required(indexPath, {
        resolve: function (id, parent, cb) {
          // Override required's default resolver to ensure we check nested modules.
          var resolvedModule = Module._resolveLookupPaths(id, parent);
          var paths = resolvedModule[1];

          // Strip out folders up to the module path we're looking at.
          var folder = getFolderFromPath(parent.filename);

          while (paths.length) {
            if (paths[0].indexOf(folder) === 0) {
              break;
            }

            paths.shift();
          }

          var path = Module._findPath(id, paths);
          cb(null, path);
        }
      },
        function (err, deps) {
          if (err) {
            reject(err);
          }
          else {
            self.linkDeps(deps);
            resolve(null);
          }
        }
      );
    });
  };

  linkDeps(deps) {
    if (deps) {
      const len = deps.length;
      for (var i = 0; i < len; i++) {
        var dependency = deps[i];
        if (!dependency.core && !this.ignore.contains(dependency.id)) {
          // if dependency.filename is a folder, use that else, use the folder it is in
          var folder = getFolderFromPath(dependency.filename);
          if (this.npmPaths.indexOf(folder) === -1) {
            // haven't seen this folder before
            this.npmPaths.push(folder);

            // Link the module if it's at the root of the node_modules directory.
            if (this.isRootModule(dependency.filename)) {
              this.linkNpmModule(folder);
            }
          }

          // recurse
          this.linkDeps(dependency.deps);
        }
      }
    }
  }

  isRootModule(modulePath) {
    // Root if only one occurrence of node_modules.
    return (modulePath.match(/[\\\/]node_modules[\\\/]/g) || []).length === 1;
  }

  linkNpmModule(folder) {
    // Strip the leading path off up to the first occurrence of node_modules,
    // and remove everything after the root module name.
    var nodeModulesIndex = folder.indexOf("node_modules");
    var basePath = folder.substr(0, nodeModulesIndex);
    var folderRelativePath = folder.substr(nodeModulesIndex);
    var modulePathParts = folderRelativePath.split(path.sep);
    var moduleRelativePath = path.join("node_modules", modulePathParts[1]);
    var moduleOutPath = path.join(this.outputPath, moduleRelativePath);

    // Don't bother if we've already linked this module.
    if (this.linkedModules.indexOf(moduleOutPath) > -1) {
      return;
    }

    try {
      fs.statSync(moduleOutPath); // throws if path doesn't exist
    }
    catch (e) {
      // fill the hole
      symlinkOrCopySync(path.join(basePath, moduleRelativePath), moduleOutPath);
      this.linkedModules.push(moduleOutPath);
    }
  }
}
