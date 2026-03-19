module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.js'],
  snapshotSerializers: [
    '<rootDir>/test/serializers/filename-serializer.js',
    '<rootDir>/test/serializers/prettier-javascript-serializer.js',
    '<rootDir>/test/serializers/buffer-serializer.js',
  ],
};
