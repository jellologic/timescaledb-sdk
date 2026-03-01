import { test, expect, describe, afterAll } from "bun:test"
import { Effect } from "effect"
import { TimescaleClient } from "../../src/Client.js"
import { timestamptz, integer, serial, text } from "../../src/schema/Column.js"
import { pgTable } from "../../src/schema/Table.js"
import { hypertable } from "../../src/schema/Hypertable.js"
import { rlsPolicy } from "../../src/schema/Rls.js"
import { pgRole, tableGrant, schemaGrant, roleMembership, defaultPrivilege } from "../../src/schema/Role.js"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import { definitionsToSnapshot } from "../../src/migration/DefinitionsSnapshot.js"
import { takeSnapshot } from "../../src/migration/Snapshot.js"
import { liveClient } from "../setup/test-layers.js"
import { makeManagedRunner } from "../helpers/effect-runner.js"
import { tableExists, dropTableCascade } from "../helpers/db-utils.js"

const runner = makeManagedRunner(liveClient())
const run = <A>(effect: Effect.Effect<A, any, any>) => runner.run(effect)

afterAll(async () => {
  await runner.dispose()
})

let counter = 0
const uniqueName = (prefix: string) => `${prefix}_${++counter}_${Date.now()}`

// Helper: execute an array of SQL statements
const execSqlArray = (statements: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    for (const sql of statements) {
      yield* client.execute(sql)
    }
  })

// Helper: filter SQL to only role/grant/rls-related statements (avoids touching timescaledb internal objects)
const filterRoleGrantSql = (statements: ReadonlyArray<string>): ReadonlyArray<string> =>
  statements.filter(s => {
    const upper = s.toUpperCase()
    return upper.includes("ROLE") || upper.includes("GRANT") || upper.includes("REVOKE")
      || upper.includes("ROW LEVEL SECURITY") || upper.includes("POLICY")
      || upper.includes("DEFAULT PRIVILEGES")
  })

// Helper: query RLS status from pg_class
const rlsStatus = (tableName: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = $1 AND n.nspname = 'public'`,
      [tableName]
    )
    return rows[0]
  })

// Helper: query RLS policies from pg_policies
const rlsPolicies = (tableName: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    return yield* client.execute<{ policyname: string; permissive: string; cmd: string; roles: string; qual: string | null; with_check: string | null }>(
      `SELECT policyname, permissive, cmd, roles::text, qual, with_check
       FROM pg_policies
       WHERE tablename = $1 AND schemaname = 'public'`,
      [tableName]
    )
  })

// Helper: check if a role exists
const roleExists = (roleName: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) as exists`,
      [roleName]
    )
    return rows[0]?.exists ?? false
  })

// Helper: get role attributes
const roleInfo = (roleName: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{
      rolcanlogin: boolean
      rolsuper: boolean
      rolcreatedb: boolean
      rolcreaterole: boolean
      rolinherit: boolean
      rolreplication: boolean
      rolbypassrls: boolean
      rolconnlimit: number
    }>(
      `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
              rolinherit, rolreplication, rolbypassrls, rolconnlimit
       FROM pg_roles WHERE rolname = $1`,
      [roleName]
    )
    return rows[0]
  })

// Helper: drop role safely
const dropRole = (roleName: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    yield* client.execute(`DROP ROLE IF EXISTS "${roleName}"`)
  })

// Helper: check table privileges
const tablePrivileges = (tableName: string, roleName: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    return yield* client.execute<{ privilege_type: string; is_grantable: string }>(
      `SELECT privilege_type, is_grantable
       FROM information_schema.role_table_grants
       WHERE table_name = $1 AND grantee = $2 AND table_schema = 'public'`,
      [tableName, roleName]
    )
  })

// Helper: check role membership
const isMemberOf = (member: string, role: string) =>
  Effect.gen(function* () {
    const client = yield* TimescaleClient
    const rows = yield* client.execute<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM pg_auth_members am
        JOIN pg_roles r ON r.oid = am.roleid
        JOIN pg_roles m ON m.oid = am.member
        WHERE r.rolname = $1 AND m.rolname = $2
      ) as exists`,
      [role, member]
    )
    return rows[0]?.exists ?? false
  })

// ============================================
// RLS Integration Tests
// ============================================
describe("Integration — RLS", () => {
  test("ENABLE ROW LEVEL SECURITY on a table", async () => {
    const name = uniqueName("rls_enable")
    const t = pgTable(name, {
      id: serial("id"),
      data: text("data"),
    }, undefined, {
      enableRls: true,
    })

    await run(Effect.gen(function* () {
      const diff = diffSchema([t], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
      const { up } = generateMigrationSql(diff, [t])
      yield* execSqlArray(up)

      const status = yield* rlsStatus(name)
      expect(status?.relrowsecurity).toBe(true)
      expect(status?.relforcerowsecurity).toBe(false)

      yield* dropTableCascade(name)
    }))
  })

  test("FORCE ROW LEVEL SECURITY on a table", async () => {
    const name = uniqueName("rls_force")
    const t = pgTable(name, {
      id: serial("id"),
      data: text("data"),
    }, undefined, {
      enableRls: true,
      forceRls: true,
    })

    await run(Effect.gen(function* () {
      const diff = diffSchema([t], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
      const { up } = generateMigrationSql(diff, [t])
      yield* execSqlArray(up)

      const status = yield* rlsStatus(name)
      expect(status?.relrowsecurity).toBe(true)
      expect(status?.relforcerowsecurity).toBe(true)

      yield* dropTableCascade(name)
    }))
  })

  test("create permissive RLS policy", async () => {
    const name = uniqueName("rls_perm")
    const t = pgTable(name, {
      id: serial("id"),
      owner_id: text("owner_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [
        rlsPolicy("owner_only", {
          permissive: true,
          command: "ALL",
          using: "owner_id = current_user",
        }),
      ],
    })

    await run(Effect.gen(function* () {
      const diff = diffSchema([t], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
      const { up } = generateMigrationSql(diff, [t])
      yield* execSqlArray(up)

      const policies = yield* rlsPolicies(name)
      expect(policies.length).toBe(1)
      expect(policies[0]!.policyname).toBe("owner_only")
      expect(policies[0]!.permissive).toBe("PERMISSIVE")

      yield* dropTableCascade(name)
    }))
  })

  test("create restrictive RLS policy", async () => {
    const name = uniqueName("rls_restr")
    const t = pgTable(name, {
      id: serial("id"),
      owner_id: text("owner_id"),
    }, undefined, {
      enableRls: true,
      rlsPolicies: [
        rlsPolicy("restrict_policy", {
          permissive: false,
          command: "SELECT",
          using: "owner_id = current_user",
        }),
      ],
    })

    await run(Effect.gen(function* () {
      const diff = diffSchema([t], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
      const { up } = generateMigrationSql(diff, [t])
      yield* execSqlArray(up)

      const policies = yield* rlsPolicies(name)
      expect(policies.length).toBe(1)
      expect(policies[0]!.policyname).toBe("restrict_policy")
      expect(policies[0]!.permissive).toBe("RESTRICTIVE")

      yield* dropTableCascade(name)
    }))
  })

  test("forceRls round-trip: define → apply → snapshot → diff shows no changes", async () => {
    const name = uniqueName("rls_rt")
    const t = pgTable(name, {
      id: serial("id"),
      data: text("data"),
    }, undefined, {
      enableRls: true,
      forceRls: true,
      rlsPolicies: [
        rlsPolicy("test_policy", { using: "true", command: "ALL" }),
      ],
    })

    await run(Effect.gen(function* () {
      // Apply initial migration
      const diff1 = diffSchema([t], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
      const { up } = generateMigrationSql(diff1, [t])
      yield* execSqlArray(up)

      // Verify in DB
      const status = yield* rlsStatus(name)
      expect(status?.relrowsecurity).toBe(true)
      expect(status?.relforcerowsecurity).toBe(true)

      // Take snapshot from live DB
      const snap = yield* takeSnapshot
      // Diff against same definitions — should produce no RLS changes
      const diff2 = diffSchema([t], snap)
      expect(diff2.rlsToEnable.length).toBe(0)
      expect(diff2.rlsToDisable.length).toBe(0)
      expect(diff2.rlsToForce.length).toBe(0)
      expect(diff2.rlsToUnforce.length).toBe(0)
      expect(diff2.rlsPoliciesToCreate.length).toBe(0)
      expect(diff2.rlsPoliciesToDrop.filter(p => p.table === name).length).toBe(0)

      yield* dropTableCascade(name)
    }))
  })
})

// ============================================
// Role Integration Tests
// ============================================
describe("Integration — Roles", () => {
  test("CREATE ROLE with attributes", async () => {
    const roleName = uniqueName("test_role")

    await run(Effect.gen(function* () {
      const role = pgRole(roleName, { login: true, createdb: true, connectionLimit: 5 })
      const snap = definitionsToSnapshot([role])
      const diff = diffSchema([role], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
      const { up } = generateMigrationSql(diff, [role])
      yield* execSqlArray(up)

      const exists = yield* roleExists(roleName)
      expect(exists).toBe(true)

      const info = yield* roleInfo(roleName)
      expect(info?.rolcanlogin).toBe(true)
      expect(info?.rolcreatedb).toBe(true)
      expect(info?.rolconnlimit).toBe(5)

      yield* dropRole(roleName)
    }))
  })

  test("ALTER ROLE attributes", async () => {
    const roleName = uniqueName("alter_role")

    await run(Effect.gen(function* () {
      const client = yield* TimescaleClient
      // Create role with initial attributes
      yield* client.execute(`CREATE ROLE "${roleName}" WITH LOGIN`)

      // Now define with different attributes
      const role = pgRole(roleName, { login: true, createdb: true })

      // Take snapshot and diff
      const snap = yield* takeSnapshot
      const diff = diffSchema([role], snap)

      // Should detect CREATEDB needs to be added
      if (diff.rolesToAlter.length > 0) {
        const { up } = generateMigrationSql(diff, [role])
        yield* execSqlArray(filterRoleGrantSql(up))
      }

      const info = yield* roleInfo(roleName)
      expect(info?.rolcanlogin).toBe(true)
      expect(info?.rolcreatedb).toBe(true)

      yield* dropRole(roleName)
    }))
  })

  test("DROP ROLE when removed from definitions", async () => {
    const roleName = uniqueName("drop_role")

    await run(Effect.gen(function* () {
      const client = yield* TimescaleClient
      yield* client.execute(`CREATE ROLE "${roleName}"`)

      // Take snapshot — role exists in DB
      const snap = yield* takeSnapshot

      // Empty definitions — role should be dropped
      const diff = diffSchema([], snap)
      // Check that our role is in the drop list
      const shouldDrop = diff.rolesToDrop.includes(roleName)
      expect(shouldDrop).toBe(true)

      // Only execute role-related SQL (avoid dropping timescaledb internal objects)
      const { up } = generateMigrationSql(diff, [])
      yield* execSqlArray(filterRoleGrantSql(up))

      const exists = yield* roleExists(roleName)
      expect(exists).toBe(false)
    }))
  })
})

// ============================================
// Grant Integration Tests
// ============================================
describe("Integration — Grants", () => {
  test("GRANT SELECT, INSERT on table", async () => {
    const tableName = uniqueName("grant_tbl")
    const roleName = uniqueName("grant_role")

    await run(Effect.gen(function* () {
      const client = yield* TimescaleClient

      // Create table and role
      const t = pgTable(tableName, { id: serial("id"), data: text("data") })
      const role = pgRole(roleName, { login: true })
      const grant = tableGrant(tableName, ["SELECT", "INSERT"], [roleName])

      const diff = diffSchema([t, role, grant], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
      const { up } = generateMigrationSql(diff, [t, role, grant])
      yield* execSqlArray(up)

      // Verify grants
      const privs = yield* tablePrivileges(tableName, roleName)
      const privTypes = privs.map(p => p.privilege_type)
      expect(privTypes).toContain("SELECT")
      expect(privTypes).toContain("INSERT")
      expect(privTypes).not.toContain("DELETE")

      yield* dropTableCascade(tableName)
      yield* dropRole(roleName)
    }))
  })

  test("REVOKE privilege when removed from definitions", async () => {
    const tableName = uniqueName("revoke_tbl")
    const roleName = uniqueName("revoke_role")

    await run(Effect.gen(function* () {
      const client = yield* TimescaleClient

      // Phase 1: Create table + role + grant SELECT, INSERT, DELETE
      const t = pgTable(tableName, { id: serial("id"), data: text("data") })
      const role = pgRole(roleName, { login: true })
      const grant1 = tableGrant(tableName, ["SELECT", "INSERT", "DELETE"], [roleName])

      const diff1 = diffSchema([t, role, grant1], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
      const { up: up1 } = generateMigrationSql(diff1, [t, role, grant1])
      yield* execSqlArray(up1)

      // Phase 2: Snapshot, then change grant to only SELECT
      const snap = yield* takeSnapshot
      const grant2 = tableGrant(tableName, ["SELECT"], [roleName])
      const diff2 = diffSchema([t, role, grant2], snap)

      // Should have revocations
      const revokeEntries = diff2.tableGrantsToRevoke.filter(r => r.table === tableName)
      expect(revokeEntries.length).toBeGreaterThan(0)

      const { up: up2 } = generateMigrationSql(diff2, [t, role, grant2])
      yield* execSqlArray(filterRoleGrantSql(up2))

      // Verify only SELECT remains
      const privs = yield* tablePrivileges(tableName, roleName)
      const privTypes = privs.map(p => p.privilege_type)
      expect(privTypes).toContain("SELECT")
      expect(privTypes).not.toContain("DELETE")

      yield* dropTableCascade(tableName)
      yield* dropRole(roleName)
    }))
  })

  test("role membership: GRANT role TO member", async () => {
    const parentRole = uniqueName("parent_role")
    const childRole = uniqueName("child_role")

    await run(Effect.gen(function* () {
      const parent = pgRole(parentRole)
      const child = pgRole(childRole, { login: true })
      const membership = roleMembership(parentRole, [childRole])

      const diff = diffSchema([parent, child, membership], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
      const { up } = generateMigrationSql(diff, [parent, child, membership])
      yield* execSqlArray(up)

      const isMember = yield* isMemberOf(childRole, parentRole)
      expect(isMember).toBe(true)

      yield* dropRole(childRole)
      yield* dropRole(parentRole)
    }))
  })
})

// ============================================
// Combined RLS + Role + Grant Tests
// ============================================
describe("Integration — Combined RLS + Roles + Grants", () => {
  test("full scenario: table with RLS + role + grants", async () => {
    const tableName = uniqueName("combo_tbl")
    const roleName = uniqueName("combo_role")

    await run(Effect.gen(function* () {
      // Define table with RLS, a role, and grants
      const t = pgTable(tableName, {
        id: serial("id"),
        owner_id: text("owner_id"),
        data: text("data"),
      }, undefined, {
        enableRls: true,
        forceRls: true,
        rlsPolicies: [
          rlsPolicy("owner_only", {
            command: "ALL",
            using: `owner_id = current_user`,
            roles: [roleName],
          }),
        ],
      })

      const role = pgRole(roleName, { login: true })
      const grant = tableGrant(tableName, ["SELECT", "INSERT", "UPDATE"], [roleName])

      const diff = diffSchema([t, role, grant], { tables: [], hypertables: [], continuousAggregates: [], takenAt: new Date() })
      const { up } = generateMigrationSql(diff, [t, role, grant])
      yield* execSqlArray(up)

      // Verify RLS
      const status = yield* rlsStatus(tableName)
      expect(status?.relrowsecurity).toBe(true)
      expect(status?.relforcerowsecurity).toBe(true)

      // Verify policy
      const policies = yield* rlsPolicies(tableName)
      expect(policies.length).toBe(1)
      expect(policies[0]!.policyname).toBe("owner_only")

      // Verify role
      const exists = yield* roleExists(roleName)
      expect(exists).toBe(true)

      // Verify grants
      const privs = yield* tablePrivileges(tableName, roleName)
      const privTypes = privs.map(p => p.privilege_type)
      expect(privTypes).toContain("SELECT")
      expect(privTypes).toContain("INSERT")
      expect(privTypes).toContain("UPDATE")

      yield* dropTableCascade(tableName)
      yield* dropRole(roleName)
    }))
  })
})
