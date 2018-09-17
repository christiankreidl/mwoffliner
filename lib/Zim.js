'use strict';

const async = require('async');
const domino = require('domino');
const mkdirp = require('mkdirp');
const homeDirExpander = require('expand-home-dir');
const exec = require('child_process').exec;
const spawn = require('child_process').spawn;
const pathParser = require('path');
const fs = require('fs');
const urlParser = require('url');
const ci = require('case-insensitive');
const U = require('./Utils.js').Utils;

function Zim(config, args) {
  this.config = config;
  Object.assign(this, args);

  // Normalize
  this.outputDirectory = this.outputDirectory ? homeDirExpander(this.outputDirectory) + '/' : 'out/';
  this.tmpDirectory = this.tmpDirectory ? homeDirExpander(this.tmpDirectory) + '/' : 'tmp/';
}

Zim.prototype.createDirectories = function (cb) {
  this.env.logger.log('Creating base directories...');
  var self = this;
  async.series(
    [
      finished => { mkdirp(self.outputDirectory, finished); },
      finished => { mkdirp(self.tmpDirectory, finished); },
    ],
    error => {
      U.exitIfError(error, `Unable to create mandatory directories : ${error}`);
      cb();
    }
  );
};

/* Create directories for static files */
Zim.prototype.createSubDirectories = function (cb) {
  const env = this.env;
  const dirs = this.config.output.dirs;
  env.logger.log(`Creating sub directories at "${env.htmlRootPath}"...`);
  async.series(
    [
      finished => exec(`rm -rf "${env.htmlRootPath}"`, finished),
      finished => fs.mkdir(env.htmlRootPath, undefined, finished),
      finished => fs.mkdir(env.htmlRootPath + dirs.style, undefined, finished),
      finished => fs.mkdir(env.htmlRootPath + dirs.style + '/' + dirs.styleModules, undefined, finished),
      finished => fs.mkdir(env.htmlRootPath + dirs.media, undefined, finished),
      finished => fs.mkdir(env.htmlRootPath + dirs.javascript, undefined, finished),
      finished => fs.mkdir(env.htmlRootPath + dirs.javascript + '/' + dirs.jsModules, undefined, finished),
    ],
    error => {
      U.exitIfError(error, `Unable to create mandatory directories : ${error}`);
      cb();
    }
  );
}

Zim.prototype.prepareCache = function (cb) {
  var env = this.env;
  var self = this;
  env.logger.log('Preparing cache...');
  this.cacheDirectory = this.cacheDirectory + env.computeFilenameRadical(true, true, true) + '/';
  this.redirectsCacheFile = this.cacheDirectory + env.computeFilenameRadical(false, true, true) + '.redirects';
  mkdirp(this.cacheDirectory + 'm/', function () {
    fs.writeFileSync(self.cacheDirectory + 'ref', '42');
    cb();
  });
};

Zim.prototype.getSubTitle = function (cb) {
  var env = this.env;
  env.logger.log('Getting sub-title...');
  env.downloader.downloadContent(env.mw.webUrl, function (content) {
    var html = content.toString();
    var doc = domino.createDocument(html);
    var subTitleNode = doc.getElementById('siteSub');
    env.zim.subTitle = subTitleNode ? subTitleNode.innerHTML : '';
    cb();
  });
};

Zim.prototype.computeZimRootPath = function () {
  var zimRootPath = this.outputDirectory[0] === '/' ? this.outputDirectory : pathParser.resolve(process.cwd(), this.outputDirectory) + '/';
  zimRootPath += this.env.computeFilenameRadical() + '.zim';
  return zimRootPath;
};

Zim.prototype.computeZimName = function () {
  return (this.publisher ? this.publisher.toLowerCase() + '.' : '') + this.env.computeFilenameRadical(false, true, true);
};

Zim.prototype.computeZimTags = function () {
  var tags = this.tags.split(';');

  /* Mediawiki hostname radical */
  var mwUrlHostParts = urlParser.parse(this.env.mw.base).host.split('.');
  var mwUrlHostPartsTag = mwUrlHostParts.length > 1 ? mwUrlHostParts[mwUrlHostParts.length - 2] : mwUrlHostParts[mwUrlHostParts.length - 1]
  if (ci(tags).indexOf(mwUrlHostPartsTag.toLowerCase()) === -1) {
    tags.push(mwUrlHostPartsTag.toLowerCase());
  }

  /* novid/nopic */
  if (this.env.nopic) {
    tags.push('nopic');
  } else if (this.env.novid) {
    tags.push('novid');
  }

  /* nodet */
  if (this.env.nodet) tags.push('nodet');

  /* Remove empty elements */
  var tags = tags.filter(function (x) {
    return (x !== (undefined || null || ''));
  });

  return tags.join(";");
};

Zim.prototype.executeTransparently = function (command, args, callback, nostdout, nostderr) {
  var logger = this.env.logger;
  try {
    var proc = spawn(command, args).on('error', function (error) {
      U.exitIfError(error, 'Error in executeTransparently(), ' + error);
    });

    if (!nostdout) {
      proc.stdout.on('data', function (data) {
        logger.log(data.toString().replace(/[\n\r]/g, ''));
      })
        .on('error', function (error) {
          console.error('STDOUT output error: ' + error);
        });
    }

    if (!nostderr) {
      proc.stderr.on('data', function (data) {
        console.error(data.toString().replace(/[\n\r]/g, ''));
      })
        .on('error', function (error) {
          console.error('STDERR output error: ' + error);
        });
    }

    proc.on('close', function (code) {
      callback(code !== 0 ? 'Error when executing ' + command : undefined);
    });
  } catch (error) {
    callback('Error when executing ' + command);
  }
};

Zim.prototype.buildZIM = function (cb) {
  var env = this.env;
  var zim = this;
  var logger = this.env.logger;
  if (!env.nozim) {
    exec('sync', function () {
      var zimPath = zim.computeZimRootPath();
      var zimTags = zim.computeZimTags();
      var cmd = 'zimwriterfs --welcome=index.htm --favicon=favicon.png --language=' + zim.langIso3 +
        (zim.mainPageId ? ' --welcome=' + env.getArticleBase(zim.mainPageId) : ' --welcome=index.htm') +
        (env.deflateTmpHtml ? ' --inflateHtml ' : '') +
        (env.verbose ? ' --verbose ' : '') +
        (zimTags ? ' --tags="' + zimTags + '"' : '') +
        ' --name="' + zim.computeZimName() + '"' +
        (zim.withZimFullTextIndex ? ' --withFullTextIndex' : '') +
        (env.writeHtmlRedirects ? '' : ' --redirects="' + zim.redirectsCacheFile + '"') +
        ' --title="' + zim.name + '" --description="' + (zim.description || zim.subTitle || zim.name) + '" --creator="' + zim.creator + '" --publisher="' +
        zim.publisher + '" "' + env.htmlRootPath + '" "' + zimPath + '"';
      logger.log('Building ZIM file ' + zimPath + ' (' + cmd + ')...');
      logger.log('RAID: ' + zim.computeZimName());
      zim.executeTransparently(
        'zimwriterfs',
        [
          env.deflateTmpHtml ? '--inflateHtml' : '',
          env.verbose ? '--verbose' : '',
          env.writeHtmlRedirects ? '' : '--redirects=' + zim.redirectsCacheFile,
          zim.withZimFullTextIndex ? '--withFullTextIndex' : '',
          zimTags ? '--tags=' + zimTags : '',
          zim.mainPageId ? '--welcome=' + env.getArticleBase(zim.mainPageId) : '--welcome=index.htm',
          '--favicon=favicon.png',
          '--language=' + zim.langIso3,
          '--title=' + zim.name,
          '--name=' + zim.computeZimName(),
          '--description=' + (zim.description || zim.subTitle || zim.name),
          '--creator=' + zim.creator,
          '--publisher=' + zim.publisher,
          env.htmlRootPath,
          zimPath
        ],
        function (error) {
          U.exitIfError(error, 'Failed to build successfuly the ZIM file ' + zimPath + ' (' + error + ')');
          logger.log('ZIM file built at ' + zimPath);

          /* Delete the html directory ? */
          if (env.keepHtml) {
            cb();
          } else {
            exec('rm -rf "' + env.htmlRootPath + '"', cb);
          }
        },
        !env.verbose,
        !env.verbose
      );
    }).on('error', function (error) { console.error(error); });
  } else {
    cb();
  }
};

module.exports = {
  Zim: Zim
};
