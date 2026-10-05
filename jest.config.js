// @actions/github and its @octokit dependencies are ESM-only, so they must be
// transformed to CommonJS for Jest to load them.
const esmPackages = [
  '@actions',
  '@octokit',
  'before-after-hook',
  'content-type',
  'fast-content-type-parse',
  'json-with-bigint',
  'universal-user-agent',
];

module.exports = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'ts'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.[jt]s$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          esModuleInterop: true,
          module: 'commonjs',
          moduleResolution: 'node10',
          skipLibCheck: true,
          strict: true,
          target: 'ES2022',
        },
      },
    ],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${esmPackages.join('|')})/)`],
  verbose: true,
};
