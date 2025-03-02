module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'babel-jest'
  },
  // Automatically mock src/index.ts for all tests
  automock: false,
  moduleNameMapper: {
    '^../src$': '<rootDir>/src/__mocks__/index.ts'
  }
};