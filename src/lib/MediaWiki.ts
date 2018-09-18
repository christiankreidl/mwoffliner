import Logger from "./Logger";
import Downloader from "./Downloader";

import urlParser from 'url';
import countryLanguage from 'country-language';
import domino from 'domino';
import U from './Utils';

// Stub for now
class MediaWiki {
  logger: Logger;
  base: string;
  wikiPath: string;
  apiPath: string;
  domain: string;
  username: string;
  password: string;
  spaceDelimiter: string;
  webUrl: string;
  apiUrl: string;
  webUrlPath: string;
  namespaces: {
    [namespace: string]: any
  };
  namespacesToMirror: string[];

  constructor(logger: Logger, config: { base: any; wikiPath: any; apiPath: any; domain: any; username: any; password: any; spaceDelimiter: string; }) {
    this.logger = logger;
    // Normalize args
    this.base = `${config.base.replace(/\/$/, '')}/`;
    this.wikiPath = config.wikiPath !== undefined && config.wikiPath !== true ? config.wikiPath : 'wiki';
    this.apiPath = config.apiPath || 'w/api.php';
    this.domain = config.domain || '';
    this.username = config.username;
    this.password = config.password;
    this.spaceDelimiter = config.spaceDelimiter;
    // Computed properties
    this.webUrl = `${this.base + this.wikiPath}/`;
    this.apiUrl = `${this.base + this.apiPath}?`;
    this.webUrlPath = urlParser.parse(this.webUrl).pathname;
    // State
    this.namespaces = {};
    this.namespacesToMirror = [];
  }

  login(downloader: Downloader, cb: (err?: {} | undefined, result?: {} | undefined) => void) {
    if (this.username && this.password) {
      let url = `${this.apiUrl}action=login&format=json&lgname=${this.username}&lgpassword=${this.password}`;
      if (this.domain) {
        url = `${url}&lgdomain=${this.domain}`;
      }
      downloader.downloadContent(url, (content) => {
        let body = content.toString();
        let jsonResponse = JSON.parse(body).login;
        downloader.loginCookie = `${jsonResponse.cookieprefix}_session=${jsonResponse.sessionid}`;
        if (jsonResponse.result === 'SUCCESS') {
          cb();
        } else {
          url = `${url}&lgtoken=${jsonResponse.token}`;
          downloader.downloadContent(url, (subContent) => {
            body = subContent.toString();
            jsonResponse = JSON.parse(body).login;
            U.exitIfError(jsonResponse.result !== 'Success', 'Login Failed');
            downloader.loginCookie = `${jsonResponse.cookieprefix}_session=${jsonResponse.sessionid}`;
            cb();
          });
        }
      });
    } else {
      cb();
    }
  }

  // In all the url methods below:
  // * encodeURIComponent is mandatory for languages with illegal letters for uri (fa.wikipedia.org)
  // * encodeURI is mandatory to encode the pipes '|' but the '&' and '=' must not be encoded
  siteInfoUrl() {
    return `${this.apiUrl}action=query&meta=siteinfo&format=json`;
  }

  articleQueryUrl(title: string) {
    return `${this.apiUrl}action=query&redirects&format=json&prop=revisions|coordinates&titles=${encodeURIComponent(title)}`;
  }

  backlinkRedirectsQueryUrl(articleId) {
    return `${this.apiUrl}action=query&prop=redirects&format=json&rdprop=title&rdlimit=max&titles=${encodeURIComponent(articleId)}&rawcontinue=`;
  }

  pageGeneratorQueryUrl(namespace: string, init: string) {
    return `${this.apiUrl}action=query&generator=allpages&gapfilterredir=nonredirects&gaplimit=max&colimit=max&prop=revisions|coordinates&gapnamespace=${this.namespaces[namespace].number}&format=json&rawcontinue=${init}`;
  }

  articleApiUrl(articleId) {
    return `${this.apiUrl}action=parse&format=json&page=${encodeURIComponent(articleId)}&prop=${encodeURI('modules|jsconfigvars|headhtml')}`;
  }

  getTextDirection(env, cb: (err?: {} | undefined, result?: {} | undefined) => void) {
    const { logger } = this;
    logger.log('Getting text direction...');
    env.downloader.downloadContent(this.webUrl, (content) => {
      const body = content.toString();
      const doc = domino.createDocument(body);
      const contentNode = doc.getElementById('mw-content-text');
      const languageDirectionRegex = /"pageLanguageDir":"(.*?)"/;
      const parts = languageDirectionRegex.exec(body);
      if (parts && parts[1]) {
        env.ltr = (parts[1] === 'ltr');
      } else if (contentNode) {
        env.ltr = (contentNode.getAttribute('dir') === 'ltr');
      } else {
        logger.log('Unable to get the language direction, fallback to ltr');
        env.ltr = true;
      }
      logger.log(`Text direction is ${env.ltr ? 'ltr' : 'rtl'}`);
      cb();
    });
  }

  getSiteInfo(env, cb: (err?: {} | undefined, result?: {} | undefined) => void) {
    const self = this;
    this.logger.log('Getting web site name...');
    const url = `${this.apiUrl}action=query&meta=siteinfo&format=json&siprop=general|namespaces|statistics|variables|category|wikidesc`;
    env.downloader.downloadContent(url, (content) => {
      const body = content.toString();
      const entries = JSON.parse(body).query.general;
      /* Welcome page */
      if (!env.zim.mainPageId && !env.zim.articleList) {
        env.zim.mainPageId = entries.mainpage.replace(/ /g, self.spaceDelimiter);
      }
      /* Site name */
      if (!env.zim.name) {
        env.zim.name = entries.sitename;
      }
      /* Language */
      env.zim.langIso2 = entries.lang;
      countryLanguage.getLanguage(env.zim.langIso2, (error, language) => {
        if (error || !language.iso639_3) {
          env.zim.langIso3 = env.zim.langIso2;
        } else {
          env.zim.langIso3 = language.iso639_3;
        }
        cb();
      });
    });
  }

  getNamespaces(addNamespaces: string[], downloader: Downloader, cb: (err?: {} | undefined, result?: {} | undefined) => void) {
    const self = this;
    const url = `${this.apiUrl}action=query&meta=siteinfo&siprop=namespaces|namespacealiases&format=json`;
    downloader.downloadContent(url, (content) => {
      const body = content.toString();
      ['namespaces', 'namespacealiases'].forEach((type) => {
        const entries = JSON.parse(body).query[type];
        Object.keys(entries).forEach((key) => {
          const entry = entries[key];
          const name = entry['*'].replace(/ /g, self.spaceDelimiter);
          const number = entry.id;
          const allowedSubpages = ('subpages' in entry);
          const isContent = !!(entry.content !== undefined || !!~addNamespaces.indexOf(number));
          const canonical = entry.canonical ? entry.canonical.replace(/ /g, self.spaceDelimiter) : '';
          const details = { number, allowedSubpages, isContent };
          /* Namespaces in local language */
          self.namespaces[U.lcFirst(name)] = details;
          self.namespaces[U.ucFirst(name)] = details;
          /* Namespaces in English (if available) */
          if (canonical) {
            self.namespaces[U.lcFirst(canonical)] = details;
            self.namespaces[U.ucFirst(canonical)] = details;
          }
          /* Is content to mirror */
          if (isContent) {
            self.namespacesToMirror.push(name);
          }
        });
      });
      cb();
    });
  }

  extractPageTitleFromHref(href: any) {
    try {
      const pathname = urlParser.parse(href, false, true).pathname || '';
      if (pathname.indexOf('./') === 0) {
        return U.decodeURIComponent(pathname.substr(2));
      }
      if (pathname.indexOf(this.webUrlPath) === 0) {
        return U.decodeURIComponent(pathname.substr(this.webUrlPath.length));
      }

      return null; /* Interwiki link? -- return null */
    } catch (error) {
      console.error(`Unable to parse href ${href}`);
      return null;
    }
  }
}

export default MediaWiki;