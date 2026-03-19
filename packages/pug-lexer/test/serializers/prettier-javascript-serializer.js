const prettier = require('prettier');

const prettierOptions = { parser: 'babel' };

module.exports = {
  test(val) {
    try {
      return (
        typeof val === 'string' &&
        /function /.test(val) &&
        val !== prettier.format(val, prettierOptions)
      );
    } catch (ex) {
      return false;
    }
  },
  print(val, serialize) {
    return serialize(prettier.format(val, prettierOptions));
  },
};
