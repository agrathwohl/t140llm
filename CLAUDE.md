# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Test Commands
- Build: `npm run build`
- Lint: `npm run lint`
- Run all tests: `npm test`
- Run a single test: `npx jest tests/filename.test.ts`
- Watch tests: `npm run test:watch`
- Check coverage: `npm run test:coverage`

## Code Style Guidelines
- **Formatting**: 2-space indentation, semicolons, single quotes
- **Naming**: kebab-case files, PascalCase interfaces/classes, camelCase methods/variables, ALL_CAPS constants
- **Imports**: Named imports with curly braces, grouped imports from same source
- **Types**: Use explicit TypeScript interfaces for all data structures
- **Error Handling**: Typed error objects, EventEmitter pattern for propagation
- **Documentation**: JSDoc comments for public APIs
- **File Organization**: Modular structure with separate directories for interfaces, processors, etc.
- **Security**: Input validation, secure random number generation