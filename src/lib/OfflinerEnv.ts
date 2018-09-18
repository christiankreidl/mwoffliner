import fs from 'fs';
import urlParser from 'url';
import pathParser from 'path';
import U from './Utils';

// This is just a refactoring stub for now.
// Eventually, we want a MWOffliner object that might swallow this.
class OfflinerEnv {
  nopic: boolean;
  novid: boolean;
  nozim: boolean;
  nodet: boolean;
  ltr: boolean;
  htmlRootPath: string;
  contentDate: string;
  dumps: string[];
  zim: any;
  mw: any;
  filenamePrefix: any;
  resume: boolean;
  logger: any;
  keepHtml: any;
  writeHtmlRedirects: any;
  deflateTmpHtml: any;

  constructor(format, envObjs) {
    Object.assign(this, envObjs);
    // output config (FIXME: Does this belong in Zim?)
    this.nopic = false;
    this.novid = false;
    this.nozim = false;
    this.nodet = false;
    // Script direction (defaults to ltr)
    this.ltr = true;
    this.htmlRootPath = '';
    // Content date (FIXME: Does this belong in Zim?)
    const date = new Date();
    this.contentDate = `${date.getFullYear()}-${(`0${date.getMonth() + 1}`).slice(-2)}`;
    // Compute dump formats
    this.dumps = [''];
    if (format) {
      if (format instanceof Array) {
        this.dumps = [];
        const self = this;
        format.forEach((value) => {
          self.dumps.push(value === true ? '' : value);
        });
      } else if (format !== true) {
        this.dumps = [format];
      }
      U.exitIfError(this.dumps.indexOf('nodet') !== -1 && !this.zim.mobileLayout, 'The "nodet" format can only work with --mobileLayout');
    }
    // Update the other config objects
    this.mw.env = this;
    this.zim.env = this;
  }

  computeFilenameRadical(withoutSelection?, withoutContentSpecifier?, withoutDate?) {
    let radical;
    if (this.filenamePrefix) {
      radical = this.filenamePrefix;
    } else {
      radical = `${this.zim.creator.charAt(0).toLowerCase() + this.zim.creator.substr(1)}_`;
      const hostParts = urlParser.parse(this.mw.webUrl).hostname.split('.');
      let langSuffix = this.zim.langIso2;
      for (let i = 0; i < hostParts.length; i += 1) {
        if (hostParts[i] === this.zim.langIso3) {
          langSuffix = hostParts[i];
          break;
        }
      }
      radical += langSuffix;
    }
    if (!withoutSelection) {
      if (this.zim.articleList) {
        radical += `_${pathParser.basename(this.zim.articleList, pathParser.extname(this.zim.articleList)).toLowerCase().replace(/ /g, this.mw.spaceDelimiter)}`;
      } else {
        radical += '_all';
      }
    }
    if (!withoutContentSpecifier) {
      if (this.nopic) {
        radical += '_nopic';
      } else if (this.novid && !this.nodet) {
        radical += '_novid';
      }
      radical += this.nodet ? '_nodet' : '';
    }
    if (!withoutDate) {
      radical += `_${this.contentDate}`;
    }
    return radical;
  }

  computeHtmlRootPath() {
    let htmlRootPath;
    const { zim } = this;
    if (this.nozim) {
      htmlRootPath = zim.outputDirectory[0] === '/' ? zim.outputDirectory : `${pathParser.resolve(process.cwd(), zim.tmpDirectory)}/`;
    } else {
      htmlRootPath = zim.tmpDirectory[0] === '/' ? zim.tmpDirectory : `${pathParser.resolve(process.cwd(), zim.tmpDirectory)}/`;
    }
    htmlRootPath += `${this.computeFilenameRadical()}/`;
    return htmlRootPath;
  }

  getArticleUrl(articleId) {
    return this.getArticleBase(articleId, true);
  }

  getArticlePath(articleId, escape?) {
    return this.htmlRootPath + this.getArticleBase(articleId, escape);
  }

  getArticleBase(articleId, escape?) {
    let filename = articleId.replace(/\//g, this.mw.spaceDelimiter);
    /* Filesystem is not able to handle with filename > 255 bytes */
    while (Buffer.byteLength(filename, 'utf8') > 250) {
      filename = filename.substr(0, filename.length - 1);
    }
    function e(string) {
      if (typeof string === 'undefined') {
        return undefined;
      }
      return escape ? encodeURIComponent(string) : string;
    }
    return `${e(filename)}.html`;
  }

  checkResume(cb) {
    for (let i = 0; i < this.dumps.length; i += 1) {
      const dump = this.dumps[i];
      this.nopic = dump.toString().search('nopic') >= 0;
      this.novid = dump.toString().search('novid') >= 0;
      this.nozim = dump.toString().search('nozim') >= 0;
      this.nodet = dump.toString().search('nodet') >= 0;
      this.htmlRootPath = this.computeHtmlRootPath();
      if (this.resume && !this.nozim) {
        const zimPath = this.zim.computeZimRootPath();
        if (fs.existsSync(zimPath)) {
          this.logger.log(`${zimPath} is already done, skip dumping & ZIM file generation`);
          this.dumps.splice(i, 1);
          i -= 1;
        }
      }
    }
    cb(!(this.dumps.length > 0));
  }
}

export default OfflinerEnv;
