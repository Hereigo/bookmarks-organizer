'use strict';

const gulp = require('gulp');
const gulpEslint = require('gulp-eslint');
const gulpHtmllint = require('gulp-html-lint')
const gulpStylelint = require('gulp-stylelint');

gulp.task('lint-html', () => gulp.src(['**/*.html', '!node_modules/**'])
  .pipe(gulpHtmllint({ htmllintrc : '.htmllintrc.json' }))
  .pipe(gulpHtmllint.format())
);

gulp.task('lint-js', () => gulp.src(['**/*.js', '!node_modules/**'])
  .pipe(gulpEslint({ configFile : '.eslintrc.json' }))
  .pipe(gulpEslint.format())
);

gulp.task('lint-css', () => gulp.src(['**/*.css'])
  .pipe(gulpStylelint({
    failAfterError : false,
    reporters : [{
      formatter : 'string',
      console : true
    }]
  }))
);
