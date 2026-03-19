'use strict';

var assert = require('assert');
var testit = require('testit');
var isExpression = require('./');

function passes(src, options) {
  testit(JSON.stringify(src, options), function () {
    options = options || {};
    assert(isExpression(src, options));
  });
}

testit('passes', function () {
  passes('myVar');
  passes('["an", "array", "\'s"].indexOf("index")');
  passes('abc // my comment');
  passes('() => a');
  passes('value as string');
  passes('config satisfies CardConfig');
  passes('foo!');
  passes('value?.name');
  passes('(event: PressEvent) => event.currentTarget');
  passes('({ value }: { value: string }) => value');
  passes('(event) => { // explain why this branch exists\n return <Button label="x" />\n }');
  passes('(<Button label="x" />)');
  passes('<><Button /></>');
  passes('({ value }: { value: string }) => <Button label={value} />');
});

function error(src, line, col, options) {
  testit(JSON.stringify(src), function () {
    options = options || {};
    assert(!isExpression(src, options));
    options.throw = true;
    assert.throws(function () {
      isExpression(src, options);
    }, function (err) {
      assert.equal(err.loc.line, line);
      assert.equal(err.loc.column, col);
      assert(err.message);
      return true;
    });
  });
}

testit('fails', function () {
  error('', 1, 0);
  error('var', 1, 0);
  error('public', 1, 0);
  error('weird error', 1, 6);
  error('asdf}', 1, 4);
  error('function (a = "default") {"use strict";}', 1, 0);
  error('(event: PressEvent => event.currentTarget', 1, 19);
});
