# RDS PostgreSQL major upgrades with Blue/Green and Pulumi

Sample codebase accompanying the blog post [Upgrading RDS PostgreSQL with Blue/Green: what Pulumi's guide leaves out](https://ahanoff.dev/blog/rds-blue-green-with-pulumi-what-the-guide-leaves-out).

A Pulumi program for an RDS for PostgreSQL instance that's always ready for a Blue/Green major version upgrade, the stack config for each stage of one, and the scripts the runbook uses.

## Prerequisites

- [mise](https://mise.jdx.dev/), which installs Bun and the Pulumi CLI from `mise.toml`
- [AWS CLI](https://aws.amazon.com/cli/), `psql` and `jq`
- A VPC with private subnets in at least two Availability Zones

## Quick start

```bash
mise install
bun install
pulumi stack select staging --create
pulumi config set rds-blue-green:vpcId vpc-...
pulumi config set --path 'rds-blue-green:subnetIds[0]' subnet-...
pulumi config set --path 'rds-blue-green:subnetIds[1]' subnet-...
pulumi preview
```

The committed stack files hold placeholder network IDs. Replace them before the first `pulumi up`.

## Two ways to upgrade

| Stack | Upgrade path |
| --- | --- |
| `staging` | `blueGreenUpdate: true`. The provider creates green, switches over and deletes the old instance inside one `pulumi up`, with no final snapshot and no automated backups kept. Take a manual snapshot first. |
| `prod` | Blue/Green through the RDS API, here with the AWS CLI, with a check before the switchover, the old instance kept as the rollback, and the stack config following in three commits. |

The program refuses `blueGreenUpdate` on a stack with `deletionProtection` on.

Both paths need `rds.logical_replication = 1` in the parameter group of the current version and of the target version. The program gives every family in `parameterGroupFamilies` its own group with the same parameters, so an instance created from it never needs the failover reboot just to turn logical replication on.

### Staging

One commit:

```diff
-  rds-blue-green:engineVersion: "16.15"
+  rds-blue-green:engineVersion: "18.6"
   rds-blue-green:parameterGroupFamilies:
     - postgres16
+    - postgres18
```

`pulumi up` creates the `postgres18` group and runs the whole deployment. Remove `postgres16` in a follow-up commit.

### Production

**1. Before the window**, add the target family. Raise `maxAllocatedStorage` too if it's less than 10% above the allocated storage, or the deployment can't be created.

```diff
   rds-blue-green:parameterGroupFamilies:
     - postgres16
+    - postgres18
```

`pulumi up` creates the `postgres18` group without attaching it. Run `scripts/preflight.sql` against every database.

**2. In the window**, create the Blue/Green deployment from the AWS CLI, as described in the blog post. Pass the new group to it:

```bash
aws rds create-blue-green-deployment \
  --blue-green-deployment-name app-prod-pg18 \
  --source "$(aws rds describe-db-instances --db-instance-identifier app-prod --query 'DBInstances[0].DBInstanceArn' --output text)" \
  --target-engine-version 18.6 \
  --target-db-parameter-group-name "$(pulumi stack output parameterGroupNames --json | jq -r .postgres18)"
```

Before the switchover, compare `scripts/row-counts.sql` output from blue and green.

Neither CloudFormation nor the Terraform and Pulumi AWS providers have a resource for the Blue/Green deployment itself, so this step is always RDS API calls: create, describe, switch over, delete. Running them by hand from a terminal is one option. Where production changes have to go through pipelines, approvals and an audit trail, put the same calls into a pipeline: one job per step and a manual approval before the switchover, or an SSM Automation runbook.

**3. After the switchover**, point the state at the new instance, then commit the new version:

```bash
pulumi stack export --file before.json
OLD=$(pulumi stack output resourceId)
NEW=$(aws rds describe-db-instances --db-instance-identifier app-prod --query 'DBInstances[0].DbiResourceId' --output text)
bun scripts/fix-state.ts before.json fixed.json "$OLD" "$NEW"
pulumi stack import --file fixed.json
pulumi refresh --target 'urn:pulumi:prod::rds-blue-green::aws:rds/instance:Instance::db' --yes
```

```diff
-  rds-blue-green:engineVersion: "16.15"
+  rds-blue-green:engineVersion: "18.6"
```

`pulumi preview` must show no changes. Anything else means the state or the config is still wrong.

**4. After deleting `app-prod-old1`**, which still uses the old group:

```diff
   rds-blue-green:parameterGroupFamilies:
-    - postgres16
     - postgres18
```

## What's in here

| File | Purpose |
| --- | --- |
| `index.ts` | Parameter groups, subnet group, security group and the RDS instance |
| `Pulumi.yaml` | Project and config schema with defaults |
| `Pulumi.staging.yaml` | Stack upgraded by the provider |
| `Pulumi.prod.yaml` | Stack upgraded by hand |
| `scripts/preflight.sql` | Read-only checks: replication settings, tables without a primary key, large objects, unlogged tables |
| `scripts/row-counts.sql` | Exact row count per table, to diff blue against green before the switchover |
| `scripts/fix-state.ts` | Moves the Pulumi resource ID from `<identifier>-old1` to the new instance |
