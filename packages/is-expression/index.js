'use strict';

var babelParser = require('@babel/parser');
var objectAssign = require('object-assign');

module.exports = isExpression;

var DEFAULT_OPTIONS = {
  throw: false
};

function parseExpression(src) {
  babelParser.parseExpression(src, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
}

function isExpression(src, options) {
  options = objectAssign({}, DEFAULT_OPTIONS, options);

  try {
    parseExpression(src);
  } catch (error) {
    if (!options.throw) {
      return false;
    }

    throw error;
  }

  return true;
}
