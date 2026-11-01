# Contributing

Bug reports and pull requests are welcome.

```bash
pnpm install
cp .env.example .env.local   # fill in a TEST database, an Ably app and the secrets
pnpm db:migrate && pnpm db:seed
pnpm dev                     # http://localhost:3000
```

Before opening a pull request:

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

- Tests write to the database named by `DATABASE_URL_UNPOOLED` and refuse to run unless its host matches `TEST_DB_HOST`. Use a throw-away database or branch, never one you care about.
- Everything a visitor can read is Thai (error messages included, no raw system text). Keep that when you add UI.
- The stage is designed for 1920×1080 and animates only `transform` and `opacity`.
- Never log or store who voted for whom.
