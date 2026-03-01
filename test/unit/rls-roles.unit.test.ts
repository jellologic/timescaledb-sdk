import { test, expect, describe } from "bun:test"
import { diffSchema, generateMigrationSql } from "../../src/migration/Generator.js"
import type { SchemaDiff } from "../../src/migration/Generator.js"
import type { SchemaSnapshot } from "../../src/migration/types.js"
import { rlsPolicy } from "../../src/schema/Rls.js"
import { pgRole, tableGrant, schemaGrant, roleMembership, defaultPrivilege } from "../../src/schema/Role.js"
import { definitionsToSnapshot } from "../../src/migration/DefinitionsSnapshot.js"
import type { TableDefinition, RoleDef, TableGrantDef, SchemaGrantDef, RoleMembershipDef, DefaultPrivilegeDef } from "../../src/schema/types.js"

const col = (name: string, sqlType = "text") => ({
  _type: null as any,
  _hasDefault: false as const,
  name,
  sqlType,
  isNotNull: false as const,
  isPrimaryKey: false,
  isUnique: false,
  defaultValue: undefined,
  references: undefined,
  check: undefined,
})

const emptySnapshot: SchemaSnapshot = {
  tables: [],
  hypertables: [],
  continuousAggregates: [],
  enums: [],
  rlsPolicies: [],
  jobs: [],
  caggPolicies: [],
  hypertablePolicies: [],
  views: [],
  materializedViews: [],
  viewDependencies: [],
  functions: [],
  roles: [],
  tableGrants: [],
  schemaGrants: [],
  roleMemberships: [],
  defaultPrivileges: [],
  takenAt: new Date(),
}

const emptyDiff: SchemaDiff = {
  tablesToCreate: [],
  tablesToDrop: [],
  tablesToRename: [],
  columnsToAdd: [],
  columnsToRemove: [],
  columnsToAlter: [],
  columnsToRename: [],
  columnsToSetNotNull: [],
  columnsToDropNotNull: [],
  columnsToSetDefault: [],
  columnsToDropDefault: [],
  hypertablesToCreate: [],
  enumsToCreate: [],
  enumsToDrop: [],
  enumsToAddValues: [],
  caggsToCreate: [],
  caggsToDrop: [],
  indexesToCreate: [],
  indexesToDrop: [],
  constraintsToAdd: [],
  constraintsToDrop: [],
  triggersToCreate: [],
  triggersToDrop: [],
  jobsToCreate: [],
  jobsToDelete: [],
  jobsToAlter: [],
  rlsToEnable: [],
  rlsToDisable: [],
  rlsToForce: [],
  rlsToUnforce: [],
  rlsPoliciesToCreate: [],
  rlsPoliciesToDrop: [],
  rlsPoliciesToAlter: [],
  compressionPoliciesToAdd: [],
  compressionPoliciesToRemove: [],
  retentionPoliciesToAdd: [],
  retentionPoliciesToRemove: [],
  reorderPoliciesToAdd: [],
  reorderPoliciesToRemove: [],
  caggRefreshPoliciesToAdd: [],
  caggRefreshPoliciesToRemove: [],
  caggRetentionPoliciesToAdd: [],
  caggRetentionPoliciesToRemove: [],
  caggCompressionToEnable: [],
  caggCompressionToDisable: [],
  hypercoreToEnable: [],
  hypercoreToDisable: [],
  hypercoreSettingsToAlter: [],
  chunkIntervalsToAlter: [],
  compressionSettingsToAlter: [],
  tieringToAdd: [],
  tieringToRemove: [],
  compressionPoliciesToAlter: [],
  retentionPoliciesToAlter: [],
  caggRefreshPoliciesToAlter: [],
  caggMigrations: [],
  viewsToCreate: [],
  viewsToDrop: [],
  viewsToReplace: [],
  viewsToRename: [],
  materializedViewsToCreate: [],
  materializedViewsToDrop: [],
  materializedViewsToRecreate: [],
  materializedViewsToRename: [],
  materializedViewIndexesToCreate: [],
  materializedViewIndexesToDrop: [],
  materializedViewsToAlterTablespace: [],
  materializedViewsToAlterStorageParams: [],
  functionsToCreate: [],
  functionsToDrop: [],
  functionsToReplace: [],
  functionsToRecreate: [],
  proceduresToCreate: [],
  proceduresToDrop: [],
  proceduresToReplace: [],
  proceduresToRecreate: [],
  triggerFunctionsToCreate: [],
  triggerFunctionsToDrop: [],
  triggerFunctionsToReplace: [],
  rolesToCreate: [],
  rolesToDrop: [],
  rolesToAlter: [],
  rolesToRename: [],
  tableGrantsToAdd: [],
  tableGrantsToRevoke: [],
  schemaGrantsToAdd: [],
  schemaGrantsToRevoke: [],
  roleMembershipsToAdd: [],
  roleMembershipsToRevoke: [],
  defaultPrivilegesToAdd: [],
  defaultPrivilegesToRevoke: [],
  warnings: [],
}

// ---- RLS Improvements ----

describe("RLS improvements", () => {
  describe("rlsPolicy factory", () => {
    test("creates permissive policy by default", () => {
      const p = rlsPolicy("my_policy", { command: "SELECT", using: "true" })
      expect(p._tag).toBe("RlsPolicy")
      expect(p.name).toBe("my_policy")
      expect(p.permissive).toBeUndefined()
      expect(p.command).toBe("SELECT")
      expect(p.using).toBe("true")
    })

    test("creates restrictive policy", () => {
      const p = rlsPolicy("restrict_policy", { permissive: false, command: "ALL", using: "user_id = current_user_id()" })
      expect(p.permissive).toBe(false)
    })

    test("creates explicitly permissive policy", () => {
      const p = rlsPolicy("permissive_policy", { permissive: true })
      expect(p.permissive).toBe(true)
    })
  })

  describe("forceRls in table definition", () => {
    test("forceRls generates FORCE ROW LEVEL SECURITY on new table", () => {
      const tableDef: TableDefinition = {
        _tag: "Table",
        name: "secrets",
        columns: { id: col("id", "integer") },
        indexes: [],
        constraints: [],
        triggers: [],
        schema: "public",
        enableRls: true,
        forceRls: true,
        rlsPolicies: [rlsPolicy("allow_owner", { command: "ALL", using: "owner_id = current_user_id()" })],
      }
      const diff = diffSchema([tableDef], emptySnapshot)
      expect(diff.tablesToCreate).toHaveLength(1)

      const { up } = generateMigrationSql(diff, [tableDef])
      const rlsStatements = up.filter((s) => s.includes("ROW LEVEL SECURITY"))
      expect(rlsStatements).toContainEqual('ALTER TABLE "secrets" ENABLE ROW LEVEL SECURITY;')
      expect(rlsStatements).toContainEqual('ALTER TABLE "secrets" FORCE ROW LEVEL SECURITY;')
    })

    test("forceRls change generates ALTER TABLE FORCE on existing table", () => {
      const tableDef: TableDefinition = {
        _tag: "Table",
        name: "secrets",
        columns: { id: col("id", "integer") },
        indexes: [],
        constraints: [],
        triggers: [],
        schema: "public",
        enableRls: true,
        forceRls: true,
      }
      const snapshot: SchemaSnapshot = {
        ...emptySnapshot,
        tables: [{
          name: "secrets",
          schema: "public",
          columns: [{ name: "id", dataType: "integer", isNullable: true, defaultValue: null }],
          indexes: [],
          rlsEnabled: true,
          rlsForced: false,
        }],
      }
      const diff = diffSchema([tableDef], snapshot)
      expect(diff.rlsToForce).toHaveLength(1)
      expect(diff.rlsToForce[0]).toEqual({ name: "secrets", schema: "public" })

      const { up, down } = generateMigrationSql(diff, [tableDef])
      expect(up).toContainEqual('ALTER TABLE "secrets" FORCE ROW LEVEL SECURITY;')
      expect(down).toContainEqual('ALTER TABLE "secrets" NO FORCE ROW LEVEL SECURITY;')
    })

    test("removing forceRls generates NO FORCE", () => {
      const tableDef: TableDefinition = {
        _tag: "Table",
        name: "secrets",
        columns: { id: col("id", "integer") },
        indexes: [],
        constraints: [],
        triggers: [],
        schema: "public",
        enableRls: true,
      }
      const snapshot: SchemaSnapshot = {
        ...emptySnapshot,
        tables: [{
          name: "secrets",
          schema: "public",
          columns: [{ name: "id", dataType: "integer", isNullable: true, defaultValue: null }],
          indexes: [],
          rlsEnabled: true,
          rlsForced: true,
        }],
      }
      const diff = diffSchema([tableDef], snapshot)
      expect(diff.rlsToUnforce).toHaveLength(1)

      const { up } = generateMigrationSql(diff, [tableDef])
      expect(up).toContainEqual('ALTER TABLE "secrets" NO FORCE ROW LEVEL SECURITY;')
    })
  })

  describe("permissive policy SQL generation", () => {
    test("restrictive policy generates AS RESTRICTIVE", () => {
      const policy = rlsPolicy("deny_all", { permissive: false, command: "ALL", using: "false" })
      const tableDef: TableDefinition = {
        _tag: "Table",
        name: "events",
        columns: { id: col("id", "integer") },
        indexes: [],
        constraints: [],
        triggers: [],
        schema: "public",
        enableRls: true,
        rlsPolicies: [policy],
      }
      const diff = diffSchema([tableDef], emptySnapshot)
      const { up } = generateMigrationSql(diff, [tableDef])
      const createPolicy = up.find((s) => s.includes("CREATE POLICY"))
      expect(createPolicy).toContain("AS RESTRICTIVE")
    })

    test("permissive policy does not add AS RESTRICTIVE", () => {
      const policy = rlsPolicy("allow_all", { permissive: true, command: "SELECT", using: "true" })
      const tableDef: TableDefinition = {
        _tag: "Table",
        name: "events",
        columns: { id: col("id", "integer") },
        indexes: [],
        constraints: [],
        triggers: [],
        schema: "public",
        enableRls: true,
        rlsPolicies: [policy],
      }
      const diff = diffSchema([tableDef], emptySnapshot)
      const { up } = generateMigrationSql(diff, [tableDef])
      const createPolicy = up.find((s) => s.includes("CREATE POLICY"))
      expect(createPolicy).not.toContain("AS RESTRICTIVE")
    })

    test("permissive change triggers DROP + CREATE", () => {
      const policy = rlsPolicy("access_policy", { permissive: false, command: "ALL", using: "true" })
      const tableDef: TableDefinition = {
        _tag: "Table",
        name: "events",
        columns: { id: col("id", "integer") },
        indexes: [],
        constraints: [],
        triggers: [],
        schema: "public",
        enableRls: true,
        rlsPolicies: [policy],
      }
      const snapshot: SchemaSnapshot = {
        ...emptySnapshot,
        tables: [{
          name: "events",
          schema: "public",
          columns: [{ name: "id", dataType: "integer", isNullable: true, defaultValue: null }],
          indexes: [],
          rlsEnabled: true,
        }],
        rlsPolicies: [{
          tableName: "events",
          policyName: "access_policy",
          permissive: undefined, // was permissive (default)
          command: "ALL",
          roles: [],
          using: "true",
          withCheck: null,
        }],
      }
      const diff = diffSchema([tableDef], snapshot)
      expect(diff.rlsPoliciesToAlter).toHaveLength(1)
      expect(diff.rlsPoliciesToAlter[0]!.permissive).toBe(false)

      const { up } = generateMigrationSql(diff, [tableDef])
      // Should DROP then CREATE with AS RESTRICTIVE
      const dropIdx = up.findIndex((s) => s.includes("DROP POLICY") && s.includes("access_policy"))
      const createIdx = up.findIndex((s) => s.includes("CREATE POLICY") && s.includes("access_policy"))
      expect(dropIdx).toBeGreaterThanOrEqual(0)
      expect(createIdx).toBeGreaterThan(dropIdx)
      expect(up[createIdx]).toContain("AS RESTRICTIVE")
    })
  })

  describe("rlsEnabled snapshot-based diffing", () => {
    test("detects enableRls from snapshot table rlsEnabled flag", () => {
      const tableDef: TableDefinition = {
        _tag: "Table",
        name: "users",
        columns: { id: col("id", "integer") },
        indexes: [],
        constraints: [],
        triggers: [],
        schema: "public",
        enableRls: true,
      }
      const snapshot: SchemaSnapshot = {
        ...emptySnapshot,
        tables: [{
          name: "users",
          schema: "public",
          columns: [{ name: "id", dataType: "integer", isNullable: true, defaultValue: null }],
          indexes: [],
          rlsEnabled: false,
        }],
      }
      const diff = diffSchema([tableDef], snapshot)
      expect(diff.rlsToEnable).toHaveLength(1)
    })
  })
})

// ---- Role Management ----

describe("Role management", () => {
  describe("pgRole factory", () => {
    test("creates basic role", () => {
      const role = pgRole("app_user")
      expect(role._tag).toBe("Role")
      expect(role.name).toBe("app_user")
    })

    test("creates role with all options", () => {
      const role = pgRole("admin_user", {
        login: true,
        password: "env_ref",
        superuser: false,
        createdb: true,
        createrole: false,
        inherit: true,
        replication: false,
        bypassrls: true,
        connectionLimit: 10,
        validUntil: "2025-12-31",
        inRoles: ["admin_group"],
        renamedFrom: "old_admin",
      })
      expect(role.login).toBe(true)
      expect(role.createdb).toBe(true)
      expect(role.bypassrls).toBe(true)
      expect(role.connectionLimit).toBe(10)
      expect(role.inRoles).toEqual(["admin_group"])
      expect(role.renamedFrom).toBe("old_admin")
    })
  })

  describe("Role diffing", () => {
    test("detects new role to create", () => {
      const role = pgRole("app_user", { login: true })
      const diff = diffSchema([role], emptySnapshot)
      expect(diff.rolesToCreate).toHaveLength(1)
      expect(diff.rolesToCreate[0]!.name).toBe("app_user")
    })

    test("detects role to drop", () => {
      const snapshot: SchemaSnapshot = {
        ...emptySnapshot,
        roles: [{
          name: "old_user",
          login: true,
          superuser: false,
          createdb: false,
          createrole: false,
          inherit: true,
          replication: false,
          bypassrls: false,
          connectionLimit: -1,
          validUntil: null,
          memberOf: [],
        }],
      }
      const diff = diffSchema([], snapshot)
      expect(diff.rolesToDrop).toContain("old_user")
    })

    test("detects role attribute changes", () => {
      const role = pgRole("app_user", { login: true, createdb: true })
      const snapshot: SchemaSnapshot = {
        ...emptySnapshot,
        roles: [{
          name: "app_user",
          login: false,
          superuser: false,
          createdb: false,
          createrole: false,
          inherit: true,
          replication: false,
          bypassrls: false,
          connectionLimit: -1,
          validUntil: null,
          memberOf: [],
        }],
      }
      const diff = diffSchema([role], snapshot)
      expect(diff.rolesToAlter).toHaveLength(1)
      expect(diff.rolesToAlter[0]!.changes.login).toBe(true)
      expect(diff.rolesToAlter[0]!.changes.createdb).toBe(true)
    })

    test("detects role rename", () => {
      const role = pgRole("new_name", { renamedFrom: "old_name" })
      const snapshot: SchemaSnapshot = {
        ...emptySnapshot,
        roles: [{
          name: "old_name",
          login: false,
          superuser: false,
          createdb: false,
          createrole: false,
          inherit: true,
          replication: false,
          bypassrls: false,
          connectionLimit: -1,
          validUntil: null,
          memberOf: [],
        }],
      }
      const diff = diffSchema([role], snapshot)
      expect(diff.rolesToRename).toHaveLength(1)
      expect(diff.rolesToRename[0]).toEqual({ oldName: "old_name", newName: "new_name" })
    })
  })

  describe("Role SQL generation", () => {
    test("generates CREATE ROLE with attributes", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        rolesToCreate: [pgRole("app_user", { login: true, inherit: true, connectionLimit: 5 })],
      }
      const { up, down } = generateMigrationSql(diff, [])
      const createSql = up.find((s) => s.includes("CREATE ROLE"))
      expect(createSql).toContain('"app_user"')
      expect(createSql).toContain("LOGIN")
      expect(createSql).toContain("INHERIT")
      expect(createSql).toContain("CONNECTION LIMIT 5")
      expect(down).toContainEqual('DROP ROLE IF EXISTS "app_user";')
    })

    test("generates ALTER ROLE for changes", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        rolesToAlter: [{ name: "app_user", changes: { login: true, createdb: true } }],
      }
      const { up } = generateMigrationSql(diff, [])
      const alterSql = up.find((s) => s.includes("ALTER ROLE"))
      expect(alterSql).toContain('"app_user"')
      expect(alterSql).toContain("LOGIN")
      expect(alterSql).toContain("CREATEDB")
    })

    test("generates ALTER ROLE RENAME", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        rolesToRename: [{ oldName: "old_user", newName: "new_user" }],
      }
      const { up, down } = generateMigrationSql(diff, [])
      expect(up).toContainEqual('ALTER ROLE "old_user" RENAME TO "new_user";')
      expect(down).toContainEqual('ALTER ROLE "new_user" RENAME TO "old_user";')
    })

    test("generates DROP ROLE", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        rolesToDrop: ["stale_user"],
      }
      const { up } = generateMigrationSql(diff, [])
      expect(up).toContainEqual('DROP ROLE IF EXISTS "stale_user";')
    })

    test("generates password as psql variable reference", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        rolesToCreate: [pgRole("db_user", { login: true, password: "secret" })],
      }
      const { up } = generateMigrationSql(diff, [])
      const passwordSql = up.find((s) => s.includes("PASSWORD"))
      expect(passwordSql).toContain(":'db_user_password'")
      expect(passwordSql).not.toContain("secret")
    })

    test("generates membership grants at role creation", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        rolesToCreate: [pgRole("app_reader", { login: true, inRoles: ["readonly_group"] })],
      }
      const { up } = generateMigrationSql(diff, [])
      const grantSql = up.find((s) => s.includes("GRANT") && s.includes("readonly_group"))
      expect(grantSql).toContain('"readonly_group"')
      expect(grantSql).toContain('"app_reader"')
    })
  })
})

// ---- Grant Management ----

describe("Grant management", () => {
  describe("Grant factories", () => {
    test("tableGrant creates correct def", () => {
      const g = tableGrant("events", ["SELECT", "INSERT"], ["app_user"], { schema: "analytics" })
      expect(g._tag).toBe("TableGrant")
      expect(g.table).toBe("events")
      expect(g.privileges).toEqual(["SELECT", "INSERT"])
      expect(g.roles).toEqual(["app_user"])
      expect(g.schema).toBe("analytics")
    })

    test("schemaGrant creates correct def", () => {
      const g = schemaGrant("analytics", ["USAGE", "CREATE"], ["app_user"])
      expect(g._tag).toBe("SchemaGrant")
      expect(g.schemaName).toBe("analytics")
      expect(g.privileges).toEqual(["USAGE", "CREATE"])
    })

    test("roleMembership creates correct def", () => {
      const m = roleMembership("admin_group", ["user1", "user2"], { withAdminOption: true })
      expect(m._tag).toBe("RoleMembership")
      expect(m.role).toBe("admin_group")
      expect(m.members).toEqual(["user1", "user2"])
      expect(m.withAdminOption).toBe(true)
    })

    test("defaultPrivilege creates correct def", () => {
      const dp = defaultPrivilege("public", ["app_reader"], { forRole: "admin", onTables: ["SELECT"] })
      expect(dp._tag).toBe("DefaultPrivilege")
      expect(dp.inSchema).toBe("public")
      expect(dp.forRole).toBe("admin")
      expect(dp.onTables).toEqual(["SELECT"])
    })
  })

  describe("Grant diffing", () => {
    test("detects new table grant", () => {
      const g = tableGrant("events", ["SELECT"], ["app_user"])
      const diff = diffSchema([g], emptySnapshot)
      expect(diff.tableGrantsToAdd).toHaveLength(1)
    })

    test("detects table grant to revoke", () => {
      const snapshot: SchemaSnapshot = {
        ...emptySnapshot,
        tableGrants: [{
          tableName: "events",
          tableSchema: "public",
          grantee: "old_user",
          privileges: ["SELECT", "INSERT"],
          isGrantable: false,
        }],
      }
      const diff = diffSchema([], snapshot)
      expect(diff.tableGrantsToRevoke).toHaveLength(1)
      expect(diff.tableGrantsToRevoke[0]!.privileges).toContain("SELECT")
    })

    test("detects new schema grant", () => {
      const g = schemaGrant("analytics", ["USAGE"], ["app_user"])
      const diff = diffSchema([g], emptySnapshot)
      expect(diff.schemaGrantsToAdd).toHaveLength(1)
    })

    test("detects new role membership", () => {
      const m = roleMembership("admin_group", ["app_user"])
      const diff = diffSchema([m], emptySnapshot)
      expect(diff.roleMembershipsToAdd).toHaveLength(1)
    })

    test("detects membership to revoke", () => {
      const snapshot: SchemaSnapshot = {
        ...emptySnapshot,
        roleMemberships: [{ role: "admin", member: "old_user", adminOption: false }],
      }
      const diff = diffSchema([], snapshot)
      expect(diff.roleMembershipsToRevoke).toHaveLength(1)
    })

    test("detects new default privilege", () => {
      const dp = defaultPrivilege("public", ["app_reader"], { onTables: ["SELECT"] })
      const diff = diffSchema([dp], emptySnapshot)
      expect(diff.defaultPrivilegesToAdd).toHaveLength(1)
    })
  })

  describe("Grant SQL generation", () => {
    test("generates GRANT on table", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        tableGrantsToAdd: [tableGrant("events", ["SELECT", "INSERT"], ["app_user"])],
      }
      const { up, down } = generateMigrationSql(diff, [])
      expect(up).toContainEqual('GRANT SELECT, INSERT ON "events" TO "app_user";')
      expect(down).toContainEqual('REVOKE SELECT, INSERT ON "events" FROM "app_user";')
    })

    test("generates GRANT with GRANT OPTION", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        tableGrantsToAdd: [tableGrant("events", ["SELECT"], ["app_user"], { withGrantOption: true })],
      }
      const { up } = generateMigrationSql(diff, [])
      const grantSql = up.find((s) => s.includes("GRANT SELECT"))
      expect(grantSql).toContain("WITH GRANT OPTION")
    })

    test("generates REVOKE on table", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        tableGrantsToRevoke: [{ table: "events", schema: "public", privileges: ["DELETE"], roles: ["app_user"] }],
      }
      const { up } = generateMigrationSql(diff, [])
      expect(up).toContainEqual('REVOKE DELETE ON "events" FROM "app_user";')
    })

    test("generates GRANT on schema", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        schemaGrantsToAdd: [schemaGrant("analytics", ["USAGE"], ["app_user"])],
      }
      const { up } = generateMigrationSql(diff, [])
      expect(up).toContainEqual('GRANT USAGE ON SCHEMA "analytics" TO "app_user";')
    })

    test("generates REVOKE on schema", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        schemaGrantsToRevoke: [{ schemaName: "analytics", privileges: ["CREATE"], roles: ["app_user"] }],
      }
      const { up } = generateMigrationSql(diff, [])
      expect(up).toContainEqual('REVOKE CREATE ON SCHEMA "analytics" FROM "app_user";')
    })

    test("generates role membership GRANT", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        roleMembershipsToAdd: [roleMembership("readonly", ["app_user"])],
      }
      const { up, down } = generateMigrationSql(diff, [])
      expect(up).toContainEqual('GRANT "readonly" TO "app_user";')
      expect(down).toContainEqual('REVOKE "readonly" FROM "app_user";')
    })

    test("generates role membership GRANT with ADMIN OPTION", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        roleMembershipsToAdd: [roleMembership("admin_group", ["superadmin"], { withAdminOption: true })],
      }
      const { up } = generateMigrationSql(diff, [])
      const grantSql = up.find((s) => s.includes("GRANT") && s.includes("admin_group"))
      expect(grantSql).toContain("WITH ADMIN OPTION")
    })

    test("generates ALTER DEFAULT PRIVILEGES", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        defaultPrivilegesToAdd: [defaultPrivilege("public", ["app_reader"], { forRole: "admin", onTables: ["SELECT"] })],
      }
      const { up, down } = generateMigrationSql(diff, [])
      const alterSql = up.find((s) => s.includes("ALTER DEFAULT PRIVILEGES"))
      expect(alterSql).toContain('FOR ROLE "admin"')
      expect(alterSql).toContain('IN SCHEMA "public"')
      expect(alterSql).toContain("GRANT SELECT ON TABLES")
      expect(alterSql).toContain('"app_reader"')

      const revokeSql = down.find((s) => s.includes("ALTER DEFAULT PRIVILEGES"))
      expect(revokeSql).toContain("REVOKE SELECT ON TABLES FROM")
    })

    test("generates ALTER DEFAULT PRIVILEGES REVOKE", () => {
      const diff: SchemaDiff = {
        ...emptyDiff,
        defaultPrivilegesToRevoke: [defaultPrivilege("public", ["app_reader"], { onTables: ["SELECT"] })],
      }
      const { up } = generateMigrationSql(diff, [])
      const revokeSql = up.find((s) => s.includes("ALTER DEFAULT PRIVILEGES"))
      expect(revokeSql).toContain("REVOKE SELECT ON TABLES FROM")
    })
  })
})

// ---- DefinitionsSnapshot ----

describe("DefinitionsSnapshot", () => {
  test("converts role definitions to role snapshots", () => {
    const role = pgRole("app_user", { login: true, createdb: true, connectionLimit: 5 })
    const snap = definitionsToSnapshot([role])
    expect(snap.roles).toHaveLength(1)
    expect(snap.roles![0]).toEqual({
      name: "app_user",
      login: true,
      superuser: false,
      createdb: true,
      createrole: false,
      inherit: true,
      replication: false,
      bypassrls: false,
      connectionLimit: 5,
      validUntil: null,
      memberOf: [],
    })
  })

  test("converts table grant definitions to snapshots", () => {
    const g = tableGrant("events", ["SELECT", "INSERT"], ["user1", "user2"], { schema: "analytics" })
    const snap = definitionsToSnapshot([g])
    expect(snap.tableGrants).toHaveLength(2)
    expect(snap.tableGrants![0]!.grantee).toBe("user1")
    expect(snap.tableGrants![1]!.grantee).toBe("user2")
    expect(snap.tableGrants![0]!.tableSchema).toBe("analytics")
  })

  test("converts schema grant definitions to snapshots", () => {
    const g = schemaGrant("analytics", ["USAGE"], ["app_user"])
    const snap = definitionsToSnapshot([g])
    expect(snap.schemaGrants).toHaveLength(1)
    expect(snap.schemaGrants![0]!.schemaName).toBe("analytics")
  })

  test("converts role membership definitions to snapshots", () => {
    const m = roleMembership("admin", ["user1", "user2"])
    const snap = definitionsToSnapshot([m])
    expect(snap.roleMemberships).toHaveLength(2)
  })

  test("converts default privilege definitions to snapshots", () => {
    const dp = defaultPrivilege("public", ["reader"], { forRole: "admin", onTables: ["SELECT"] })
    const snap = definitionsToSnapshot([dp])
    expect(snap.defaultPrivileges).toHaveLength(1)
    expect(snap.defaultPrivileges![0]!.schema).toBe("public")
    expect(snap.defaultPrivileges![0]!.role).toBe("admin")
  })

  test("includes forceRls and permissive in snapshots", () => {
    const tableDef: TableDefinition = {
      _tag: "Table",
      name: "secrets",
      columns: { id: col("id") },
      indexes: [],
      constraints: [],
      triggers: [],
      schema: "public",
      enableRls: true,
      forceRls: true,
      rlsPolicies: [rlsPolicy("restrict", { permissive: false, command: "ALL", using: "false" })],
    }
    const snap = definitionsToSnapshot([tableDef])
    expect(snap.tables[0]!.rlsEnabled).toBe(true)
    expect(snap.tables[0]!.rlsForced).toBe(true)
    expect(snap.rlsPolicies![0]!.permissive).toBe(false)
  })
})
