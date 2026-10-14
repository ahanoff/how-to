import * as aws from "@pulumi/aws";
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const accountId = config.require("cloudflareAccountId");
const subnetIds = config.requireObject<string[]>("subnetIds");
const databasePort = config.requireNumber("databasePort");
const databaseSecurityGroupId = config.get("databaseSecurityGroupId");
const allowedGroups = config.requireObject<string[]>("allowedGroups");
const allowedEmails = config.requireObject<string[]>("allowedEmails");
const cloudflaredImage = config.require("cloudflaredImage");
const manageDeviceSettings = config.requireBoolean("manageDeviceSettings");
const privateDomain = config.get("privateDomain");

if (allowedGroups.length === 0 && allowedEmails.length === 0) {
    throw new Error("Set allowedGroups or allowedEmails. Without either, the catch-all block policy denies everyone.");
}

const name = `${pulumi.getProject()}-${pulumi.getStack()}`;
const vpc = aws.ec2.getVpcOutput({ id: config.require("vpcId") });

// ---------------------------------------------------------------------------
// 1. The tunnel
// ---------------------------------------------------------------------------

// Remotely managed: the configuration lives in Cloudflare, the connector only needs the token
const tunnel = new cloudflare.ZeroTrustTunnelCloudflared("vpc", {
    accountId,
    name,
    configSrc: "cloudflare",
});

new cloudflare.ZeroTrustTunnelCloudflaredRoute("vpc", {
    accountId,
    tunnelId: tunnel.id,
    network: vpc.cidrBlock,
    comment: name,
});

const tunnelToken = cloudflare.getZeroTrustTunnelCloudflaredTokenOutput({
    accountId,
    tunnelId: tunnel.id,
});

// Anyone with the token can run a connector for this tunnel
const tunnelTokenParam = new aws.ssm.Parameter("cloudflared-token", {
    name: `/${name}/cloudflared-token`,
    type: aws.ssm.ParameterType.SecureString,
    value: pulumi.secret(tunnelToken.token),
});

// ---------------------------------------------------------------------------
// 2. cloudflared on ECS Fargate
// ---------------------------------------------------------------------------

const executionRole = new aws.iam.Role("cloudflared-execution", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: "ecs-tasks.amazonaws.com",
    }),
});

new aws.iam.RolePolicyAttachment("cloudflared-execution-managed", {
    role: executionRole.name,
    policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
});

// Add kms:Decrypt if the parameter uses a customer managed KMS key
new aws.iam.RolePolicy("cloudflared-execution-token", {
    role: executionRole.id,
    policy: aws.iam.getPolicyDocumentOutput({
        statements: [{
            actions: ["ssm:GetParameters"],
            resources: [tunnelTokenParam.arn],
        }],
    }).json,
});

const logGroup = new aws.cloudwatch.LogGroup("cloudflared", {
    name: `/ecs/${name}`,
    retentionInDays: 30,
});

const taskDefinition = new aws.ecs.TaskDefinition("cloudflared", {
    family: name,
    requiresCompatibilities: ["FARGATE"],
    networkMode: "awsvpc",
    cpu: "256",
    memory: "512",
    runtimePlatform: {
        operatingSystemFamily: "LINUX",
        cpuArchitecture: "ARM64",
    },
    executionRoleArn: executionRole.arn,
    containerDefinitions: pulumi.jsonStringify([{
        name: "cloudflared",
        image: cloudflaredImage,
        essential: true,
        // The image's entrypoint is `cloudflared --no-autoupdate`
        command: ["tunnel", "run"],
        environment: [
            { name: "TUNNEL_METRICS", value: "127.0.0.1:2000" },
        ],
        secrets: [
            { name: "TUNNEL_TOKEN", valueFrom: tunnelTokenParam.arn },
        ],
        // The image is distroless, with no shell or curl. `tunnel ready` calls the
        // /ready metrics endpoint and fails unless the connector reaches Cloudflare.
        healthCheck: {
            command: ["CMD", "cloudflared", "tunnel", "--metrics", "127.0.0.1:2000", "ready"],
            interval: 30,
            timeout: 5,
            retries: 3,
            startPeriod: 30,
        },
        logConfiguration: {
            logDriver: "awslogs",
            options: {
                "awslogs-group": logGroup.name,
                "awslogs-region": aws.getRegionOutput().region,
                "awslogs-stream-prefix": "cloudflared",
            },
        },
    }]),
});

const cloudflaredSg = new aws.ec2.SecurityGroup("cloudflared", {
    vpcId: vpc.id,
    description: "cloudflared connector: outbound only",
    egress: [
        { description: "Tunnel (QUIC)", protocol: "udp", fromPort: 7844, toPort: 7844, cidrBlocks: ["0.0.0.0/0"] },
        { description: "Tunnel (HTTP/2 fallback)", protocol: "tcp", fromPort: 7844, toPort: 7844, cidrBlocks: ["0.0.0.0/0"] },
        // On Fargate the image pull and the SSM lookup go out through the task's own ENI
        { description: "Image pull, SSM, updates", protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
        { description: "Database in the VPC", protocol: "tcp", fromPort: databasePort, toPort: databasePort, cidrBlocks: [vpc.cidrBlock] },
    ],
});

if (databaseSecurityGroupId) {
    new aws.vpc.SecurityGroupIngressRule("db-from-cloudflared", {
        securityGroupId: databaseSecurityGroupId,
        referencedSecurityGroupId: cloudflaredSg.id,
        ipProtocol: "tcp",
        fromPort: databasePort,
        toPort: databasePort,
    });
}

const cluster = new aws.ecs.Cluster("cloudflared", {});

const service = new aws.ecs.Service("cloudflared", {
    cluster: cluster.arn,
    taskDefinition: taskDefinition.arn,
    launchType: "FARGATE",
    desiredCount: 1,
    networkConfiguration: {
        subnets: subnetIds,
        securityGroups: [cloudflaredSg.id],
        assignPublicIp: false,
    },
    // Start the new connector, and wait for its health check, before stopping the old one
    deploymentMinimumHealthyPercent: 100,
    deploymentMaximumPercent: 200,
});

// ---------------------------------------------------------------------------
// 3. Who gets in: Gateway network policies
// ---------------------------------------------------------------------------

const quoted = (values: string[]) => values.map(v => JSON.stringify(v)).join(" ");
const identity = [
    allowedGroups.length > 0 ? `any(identity.groups[*].name in {${quoted(allowedGroups)}})` : undefined,
    allowedEmails.length > 0 ? `identity.email in {${quoted(allowedEmails)}}` : undefined,
].filter(Boolean).join(" or ");

// Lower precedence is evaluated first
new cloudflare.ZeroTrustGatewayPolicy("allow-database", {
    accountId,
    name: `${name}: allow database`,
    action: "allow",
    filters: ["l4"],
    precedence: 1000,
    enabled: true,
    traffic: pulumi.interpolate`net.dst.ip in {${vpc.cidrBlock}} and net.dst.port == ${databasePort}`,
    identity,
});

new cloudflare.ZeroTrustGatewayPolicy("block-vpc", {
    accountId,
    name: `${name}: block everything else in the VPC`,
    action: "block",
    filters: ["l4"],
    precedence: 9000,
    enabled: true,
    traffic: pulumi.interpolate`net.dst.ip in {${vpc.cidrBlock}}`,
});

// ---------------------------------------------------------------------------
// 4. Account-wide device settings (opt-in)
// ---------------------------------------------------------------------------

if (manageDeviceSettings) {
    new cloudflare.ZeroTrustDeviceSettings("settings", {
        accountId,
        gatewayProxyEnabled: true,
        gatewayUdpProxyEnabled: true,              // needed for private DNS
    });

    // Include mode: only the VPC goes through Cloudflare. Replaces the dashboard's list.
    new cloudflare.ZeroTrustDeviceDefaultProfile("default", {
        accountId,
        includes: [
            { address: vpc.cidrBlock, description: name },
        ],
    });
}

// ---------------------------------------------------------------------------
// 5. Private Route 53 zone (optional)
// ---------------------------------------------------------------------------

if (privateDomain) {
    // The Route 53 Resolver lives at the VPC CIDR base + 2, e.g. 10.20.0.2
    const vpcResolverIp = vpc.cidrBlock.apply(cidr => {
        const [a, b, c, d] = cidr.split("/")[0]!.split(".").map(Number);
        return `${a}.${b}.${c}.${d! + 2}`;
    });

    new cloudflare.ZeroTrustGatewayPolicy("resolve-private-domain", {
        accountId,
        name: `${name}: resolve ${privateDomain} in the VPC`,
        action: "resolve",
        filters: ["dns_resolver"],
        precedence: 100,
        enabled: true,
        traffic: `any(dns.domains[*] == ${JSON.stringify(privateDomain)})`,
        ruleSettings: {
            dnsResolvers: {
                ipv4s: [{ ip: vpcResolverIp, port: 53, routeThroughPrivateNetwork: true }],
            },
        },
    });

    // Keeps the catch-all block from swallowing the DNS queries
    new cloudflare.ZeroTrustGatewayPolicy("allow-vpc-dns", {
        accountId,
        name: `${name}: allow DNS to the VPC resolver`,
        action: "allow",
        filters: ["l4"],
        precedence: 900,
        enabled: true,
        traffic: pulumi.interpolate`net.dst.ip in {${vpcResolverIp}} and net.dst.port == 53`,
    });
}

export const tunnelId = tunnel.id;
export const vpcCidr = vpc.cidrBlock;
export const clusterName = cluster.name;
export const serviceName = service.name;
export const logGroupName = logGroup.name;
