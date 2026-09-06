# Prisma migrations

Create and apply PostgreSQL migrations with:

```sh
bun run prisma:migrate
```

The schema is intentionally PostgreSQL-backed so `Bytes` maps to `BYTEA` in staging and production. Tests use the memory store and do not require a running database.
