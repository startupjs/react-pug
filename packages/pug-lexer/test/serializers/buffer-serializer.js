const crypto = require('crypto');

module.exports = {
  test(val) {
    return val && Buffer.isBuffer(val);
  },
  print(val, serialize) {
    const output = {
      type: 'Buffer',
      size: val.length,
      hash: crypto.createHash('md5').update(val).digest('hex'),
    };
    return serialize(output);
  },
};
