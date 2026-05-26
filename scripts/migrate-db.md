# PostgreSQL → Neon migration runbook

Migrate an existing on-prem SPC UP database to Neon Postgres.

## Prerequisites

- `pg_dump` and `psql` (PostgreSQL client tools)
- `OLD_DATABASE_URL` — source database connection string
- `DATABASE_URL` — Neon connection string (pooled)
- `pnpm` and repo dependencies installed

## Steps

1. **Schema dump** (if Neon is empty or you need a full schema refresh):

   ```bash
   pg_dump "$OLD_DATABASE_URL" --schema-only --no-owner --no-acl -f /tmp/spc-schema.sql
   psql "$DATABASE_URL" -f /tmp/spc-schema.sql
   ```

2. **Data dump**:

   ```bash
   pg_dump "$OLD_DATABASE_URL" --data-only --no-owner --no-acl -f /tmp/spc-data.sql
   psql "$DATABASE_URL" -f /tmp/spc-data.sql
   ```

3. **Drizzle migrations** (only if `usuario` or other tables were added after the dump):

   ```bash
   pnpm db:migrate
   ```

4. **Verify row counts**:

   ```bash
   OLD_DATABASE_URL="$OLD_DATABASE_URL" DATABASE_URL="$DATABASE_URL" pnpm verify-counts
   ```

## Notes

- Run during a maintenance window; stop writes to the old DB before the data dump.
- Prefer `--single-transaction` on restore for smaller databases if supported.
- Keep `OLD_DATABASE_URL` read-only until counts and spot checks pass.
