# Fantasy Baseball API

Express/TypeScript API for fantasy baseball draft recommendations and player data polling.

## Libraries

- **Express 4** - Web framework
- **MongoDB + Mongoose 8** - Database
- **TypeScript** - Strict mode
- **Zod** - Request validation
- **Swagger/OpenAPI** - API documentation
- **Vitest** - Testing
- **ESLint 9 + Prettier** - Code quality
- **Husky + lint-staged** - Git hooks

## Setup & Run

```bash
# Install
npm install

# Environment
cp .env.example .env

# Run
npm run dev              # Dev server (http://localhost:3001)
npm run build            # Compile TypeScript
npm start                # Live-reload local server
npm run start:prod       # Production server
npm test                 # Run tests
npm run lint             # Lint code
```

API docs: `http://localhost:3001/api-docs`

## Adding a Feature

Create a new folder in `src/features/[feature-name]/`:

**1. `[feature].types.ts`** - Zod schemas and TypeScript types

- Define request/response schemas with Zod
- Export inferred TypeScript types

**2. `[feature].model.ts`** - Mongoose schema and model

- Define MongoDB schema
- Export model

**3. `[feature].service.ts`** - Business logic

- No `req`/`res` - pure functions
- Throw `ApiError` for HTTP errors
- Call models for database operations

**4. `[feature].routes.ts`** - Express routes

- Wrap async handlers with `asyncHandler()`
- Use `validate()` middleware for Zod validation
- Call service functions
- Export router

**5. Register in `src/loaders/express.ts`**

- Import your routes
- Add `app.use('/api/[feature-name]', [feature]Routes)`

## Feature Rules

- Features are self-contained (routes, service, model, types together)
- Features should NOT import from other features
- Shared code goes in `src/shared/`
- Tests live next to the code (`feature.test.ts`)
- Use dot notation: `player.routes.ts`, `player.service.ts`
