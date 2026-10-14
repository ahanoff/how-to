import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const identifier = config.require("identifier");
const engineVersion = config.require("engineVersion");
const parameterGroupFamilies = config.requireObject<string[]>("parameterGroupFamilies");
const blueGreenUpdate = config.requireBoolean("blueGreenUpdate");
const deletionProtection = config.requireBoolean("deletionProtection");
const vpcId = config.require("vpcId");

if (blueGreenUpdate && deletionProtection) {
    throw new Error(
        "blueGreenUpdate deletes the old instance and its automated backups with no final snapshot. " +
            "Run Blue/Green from the AWS CLI for a protected database, as described in README.md.",
    );
}

// "16.15" -> "postgres16"
const family = `postgres${engineVersion.split(".")[0]}`;
if (!parameterGroupFamilies.includes(family)) {
    throw new Error(`parameterGroupFamilies must include ${family}, the family of engineVersion ${engineVersion}.`);
}

// Blue/Green needs logical replication on both sides: on blue before the deployment
// is created, and on green, whose parameter group becomes production's after the
// switchover. Every family gets the same parameters.
const parameters = [
    // Static parameter: needs pending-reboot, or the apply fails
    { name: "rds.logical_replication", value: "1", applyMethod: "pending-reboot" },
];

const parameterGroups: Record<string, aws.rds.ParameterGroup> = {};
for (const f of parameterGroupFamilies) {
    parameterGroups[f] = new aws.rds.ParameterGroup(`db-${f}`, { family: f, parameters });
}

const subnetGroup = new aws.rds.SubnetGroup("db", {
    subnetIds: config.requireObject<string[]>("subnetIds"),
});

const securityGroup = new aws.ec2.SecurityGroup("db", {
    vpcId,
    description: "PostgreSQL from inside the VPC",
});

new aws.vpc.SecurityGroupIngressRule("db-postgres", {
    securityGroupId: securityGroup.id,
    cidrIpv4: aws.ec2.getVpcOutput({ id: vpcId }).cidrBlock,
    ipProtocol: "tcp",
    fromPort: 5432,
    toPort: 5432,
});

const db = new aws.rds.Instance("db", {
    identifier,
    engine: "postgres",
    engineVersion,
    parameterGroupName: parameterGroups[family]!.name,
    // Only when the provider runs the upgrade. Without it, a bumped engineVersion
    // fails instead of turning into an in-place major upgrade.
    ...(blueGreenUpdate && {
        allowMajorVersionUpgrade: true,
        blueGreenUpdate: { enabled: true },
    }),
    // A new parameter group attaches now, as pending-reboot, instead of in the next
    // maintenance window. The failover reboot in the runbook applies it.
    applyImmediately: true,
    instanceClass: config.require("instanceClass"),
    multiAz: config.requireBoolean("multiAz"),
    storageType: "gp3",
    allocatedStorage: config.requireNumber("allocatedStorage"),
    maxAllocatedStorage: config.requireNumber("maxAllocatedStorage"),
    storageEncrypted: true,
    dbName: "app",
    username: "app_admin",
    manageMasterUserPassword: true,
    dbSubnetGroupName: subnetGroup.name,
    vpcSecurityGroupIds: [securityGroup.id],
    backupRetentionPeriod: config.requireNumber("backupRetentionPeriod"),
    copyTagsToSnapshot: true,
    deletionProtection,
    // These apply only when this resource is destroyed. blueGreenUpdate ignores all three.
    skipFinalSnapshot: false,
    finalSnapshotIdentifier: `${identifier}-final`,
    deleteAutomatedBackups: false,
});

export const instanceIdentifier = db.identifier;
export const endpoint = db.address;
// The provider's resource ID. After a switchover it belongs to <identifier>-old1
// until the state is repaired with scripts/fix-state.ts.
export const resourceId = db.resourceId;
export const parameterGroupNames = Object.fromEntries(
    Object.entries(parameterGroups).map(([f, group]) => [f, group.name]),
);
export const masterUserSecretArn = db.masterUserSecrets.apply((secrets) => secrets[0]?.secretArn);
