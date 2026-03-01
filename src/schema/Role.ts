import type { RoleDef, TableGrantDef, SchemaGrantDef, RoleMembershipDef, DefaultPrivilegeDef, TablePrivilege, SchemaPrivilege } from "./types.js"

export const pgRole = (
  name: string,
  opts?: {
    login?: boolean
    password?: string
    superuser?: boolean
    createdb?: boolean
    createrole?: boolean
    inherit?: boolean
    replication?: boolean
    bypassrls?: boolean
    connectionLimit?: number
    validUntil?: string
    inRoles?: ReadonlyArray<string>
    renamedFrom?: string
  }
): RoleDef => ({
  _tag: "Role",
  name,
  ...opts,
})

export const tableGrant = (
  table: string,
  privileges: ReadonlyArray<TablePrivilege>,
  roles: ReadonlyArray<string>,
  opts?: { schema?: string; withGrantOption?: boolean }
): TableGrantDef => ({
  _tag: "TableGrant",
  table,
  privileges,
  roles,
  schema: opts?.schema,
  withGrantOption: opts?.withGrantOption,
})

export const schemaGrant = (
  schemaName: string,
  privileges: ReadonlyArray<SchemaPrivilege>,
  roles: ReadonlyArray<string>,
  opts?: { withGrantOption?: boolean }
): SchemaGrantDef => ({
  _tag: "SchemaGrant",
  schemaName,
  privileges,
  roles,
  withGrantOption: opts?.withGrantOption,
})

export const roleMembership = (
  role: string,
  members: ReadonlyArray<string>,
  opts?: { withAdminOption?: boolean }
): RoleMembershipDef => ({
  _tag: "RoleMembership",
  role,
  members,
  withAdminOption: opts?.withAdminOption,
})

export const defaultPrivilege = (
  inSchema: string,
  roles: ReadonlyArray<string>,
  opts?: { forRole?: string; onTables?: ReadonlyArray<TablePrivilege> }
): DefaultPrivilegeDef => ({
  _tag: "DefaultPrivilege",
  inSchema,
  roles,
  forRole: opts?.forRole,
  onTables: opts?.onTables,
})
