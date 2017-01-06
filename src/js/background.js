'use strict';

const bookmarkchecker = {
  UI_PAGE : 'html/ui.html',
  LIMIT : 10000,
  TIMEOUT: 0,
  inProgress : false,
  internalCounter : 0,
  totalBookmarks : 0,
  checkedBookmarks : 0,
  bookmarkErrors : 0,
  bookmarkWarnings : 0,
  unknownBookmarks : 0,
  bookmarksResult : [],

  showOmniboxSuggestions : function (input, suggest) {
    suggest([
      { content : 'check', description : browser.i18n.getMessage('omnibox_command_check') }
    ]);
  },

  callOmniboxAction : function (input) {
    switch (input) {
      case 'check':
        bookmarkchecker.openUserInterface(true);
        break;
    }
  },

  openUserInterface : function () {
    browser.tabs.create({ url : browser.runtime.getURL(bookmarkchecker.UI_PAGE) });
  },

  handleResponse : function (response) {
    if (response.message === 'execute') {
      if (!bookmarkchecker.inProgress) {
        bookmarkchecker.countBookmarks();
        bookmarkchecker.execute();
      }
    }
    else if (response.message === 'remove') {
      browser.bookmarks.remove(response.bookmarkId);
    }
    else if (response.message === 'repair-redirect') {
      browser.bookmarks.update(response.bookmarkId, { url : response.newUrl });
    }
  },

  countBookmarks : function () {
    bookmarkchecker.inProgress = true;
    bookmarkchecker.totalBookmarks = 0;

    browser.bookmarks.getTree().then((bookmarks) => {
      bookmarkchecker.checkBookmarks(bookmarks[0], 'count');

      browser.runtime.sendMessage({
        'message' : 'total-bookmarks',
        'total_bookmarks' : bookmarkchecker.totalBookmarks
      });
    });
  },

  execute : function () {
    bookmarkchecker.internalCounter = 0;
    bookmarkchecker.checkedBookmarks = 0;
    bookmarkchecker.bookmarkErrors = 0;
    bookmarkchecker.bookmarkWarnings = 0;
    bookmarkchecker.unknownBookmarks = 0;
    bookmarkchecker.bookmarksResult = [];

    browser.bookmarks.getTree().then((bookmarks) => {
      bookmarkchecker.checkBookmarks(bookmarks[0], 'errors');
    });
  },

  checkBookmarks : function (bookmark, mode) {
    if (bookmark.url) {
      if (bookmark.url.match(/^https?:\/\//)) {
        if (mode === 'count') {
          if (bookmarkchecker.totalBookmarks === bookmarkchecker.LIMIT) {
            return;
          }

          bookmarkchecker.totalBookmarks++;
        }
        else {
          if (bookmarkchecker.internalCounter === bookmarkchecker.LIMIT) {
            return;
          }

          bookmarkchecker.internalCounter++;
          bookmarkchecker.checkSingleBookmark(bookmark);
        }
      }
    }
    else {
      bookmarkchecker.bookmarksResult.push(bookmark);
    }

    if (bookmark.children) {
      for (let child of bookmark.children) {
        bookmarkchecker.checkBookmarks(child, mode);
      }
    }
  },

  checkSingleBookmark : function (bookmark) {
    browser.bookmarks.get(bookmark.parentId).then((parentBookmark) => {
      bookmark.parentTitle = parentBookmark[0].title;
      bookmarkchecker.checkResponse(bookmark, function (bookmark) {
        bookmarkchecker.checkedBookmarks++;

        if (bookmark.status !== STATUS.OK) {
          if (bookmark.status == STATUS.REDIRECT) {
             bookmarkchecker.bookmarkWarnings++;
          }
          else if (bookmark.status == STATUS.UNKNOWN_ERROR) {
            bookmarkchecker.unknownBookmarks++;
          }
          else {
            bookmarkchecker.bookmarkErrors++;
          }

          bookmarkchecker.bookmarksResult.push(bookmark);
        }

        let progress = bookmarkchecker.checkedBookmarks / bookmarkchecker.totalBookmarks;
        if (progress < 0.01) {
          progress = 0.01;
        }

        browser.runtime.sendMessage({
          'message' : 'update-counters',
          'total_bookmarks' : bookmarkchecker.totalBookmarks,
          'checked_bookmarks' : bookmarkchecker.checkedBookmarks,
          'unknown_bookmarks' : bookmarkchecker.unknownBookmarks,
          'bookmarks_errors' : bookmarkchecker.bookmarkErrors,
          'bookmarks_warnings' : bookmarkchecker.bookmarkWarnings,
          'progress' : progress
        });

        if (bookmarkchecker.checkedBookmarks === bookmarkchecker.totalBookmarks) {
          const bookmarks = bookmarkchecker.buildResultArray(bookmarkchecker.bookmarksResult)[0].children;
          browser.runtime.sendMessage({ 'message' : 'finished', 'bookmarks' : bookmarks });
          bookmarkchecker.inProgress = false;
        }
      });
    });
  },

  checkResponse : function (bookmark, callback) {
    const p = Promise.race([
      fetch(bookmark.url, { cache : 'no-store' }), new Promise(function (resolve, reject) {
        if (bookmarkchecker.TIMEOUT > 0) {
          setTimeout(() => reject(new Error('request timeout')), bookmarkchecker.TIMEOUT)
        }
      })
    ]);

    p.then(function (response) {
      if (response.redirected) {
        // redirect to identical url, there is something wrong, but we don't know the details…
        if (bookmark.url === response.url) {
          bookmark.status = STATUS.UNKNOWN_ERROR;
        }
        // redirect to another url
        else {
          bookmark.status = STATUS.REDIRECT;
        }

        bookmark.newUrl = response.url;
      }
      else {
        bookmark.status = response.status;
      }

      callback(bookmark);
    });

    p.catch(function (error) {
      if (error.message === 'request timeout') {
        bookmark.status = STATUS.UNKNOWN_ERROR;
      }
      else {
        bookmark.status = STATUS.NOT_FOUND;
      }

      callback(bookmark);
    });
  },

  buildResultArray : function (bookmarks) {
    const result = [];
    const mappedArray = {};
    let mappedElement;

    for (let bookmark of bookmarks) {
      mappedArray[bookmark.id] = bookmark;
      mappedArray[bookmark.id]['children'] = [];
    }

    for (let id in mappedArray) {
      if (mappedArray.hasOwnProperty(id)) {
        mappedElement = mappedArray[id];
        if (mappedElement.parentId) {
          mappedArray[mappedElement['parentId']]['children'].push(mappedElement);
        }
        else {
          result.push(mappedElement);
        }
      }
    }

    return result;
  }
};

browser.browserAction.onClicked.addListener(bookmarkchecker.openUserInterface);
browser.runtime.onMessage.addListener(bookmarkchecker.handleResponse);

// Firefox 52+
if (typeof browser.omnibox !== 'undefined') {
  browser.omnibox.onInputChanged.addListener(bookmarkchecker.showOmniboxSuggestions);
  browser.omnibox.onInputEntered.addListener(bookmarkchecker.callOmniboxAction);
}
