import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { ManagedPolicy } from "@pulumi/aws/iam";

const config = new pulumi.Config();
const dbClusterMasterPassword = config.requireSecret("db-cluster-master-password");
const prefix = "openiddict6-serverless"

// created previously
const repository = new awsx.ecr.Repository(`${prefix}-ecr-repository`, {
    name: `${prefix}`,
    imageTagMutability: 'IMMUTABLE',
});

const vpc = new awsx.ec2.Vpc(`${prefix}-vpc`, {
    cidrBlock: "10.0.0.0/16",
    numberOfAvailabilityZones: 2,
    natGateways: {
        strategy: 'Single'
    },
    enableDnsHostnames: true,
    enableDnsSupport: true,
    subnetStrategy: 'Auto',
    subnetSpecs: [
        {
            type: awsx.ec2.SubnetType.Private,
            name: "private",
        },
        {
            type: awsx.ec2.SubnetType.Public,
            name: "public",
        },
        {
            type: awsx.ec2.SubnetType.Isolated,
            name: "isolated",
        }
    ],
    tags: { Name: `${prefix}-vpc` },
});

const dbSecurityGroup = new aws.ec2.SecurityGroup(`${prefix}-db-sg`, {
    name: `${prefix}-db-sg`,
    vpcId: vpc.vpcId,
    description: "Security group for Aurora database",
    ingress: [
        {
            protocol: "tcp",
            fromPort: 5432,
            toPort: 5432,
            cidrBlocks: [vpc.vpc.cidrBlock],
        },
    ],
    tags: { Name: `${prefix}-db-sg` },
});

const dbSubnetGroup = new aws.rds.SubnetGroup(`${prefix}-db-subnet-group`, {
    name: `${prefix}-db-subnet-group`,
    subnetIds: vpc.isolatedSubnetIds,
    tags: { Name: `${prefix}-db-subnet-group` },
});

const dbCluster = new aws.rds.Cluster(`${prefix}-aurora-v2`, {
    engine: "aurora-postgresql",
    engineVersion: "16.4",
    databaseName: "openiddict",
    masterUsername: "openiddict",
    masterPassword: dbClusterMasterPassword,
    serverlessv2ScalingConfiguration: {
        minCapacity: 0,  // Can scale to zero
        maxCapacity: 1 // Max 0.5 ACU
    },
    skipFinalSnapshot: true,
    vpcSecurityGroupIds: [dbSecurityGroup.id],
    dbSubnetGroupName: dbSubnetGroup.name,
    replicationSourceIdentifier: undefined,
    copyTagsToSnapshot: true,
    storageEncrypted: true,
    allowMajorVersionUpgrade: false,
});

const writerInstance = new aws.rds.ClusterInstance(`${prefix}-aurora-v2-writer`, {
    clusterIdentifier: dbCluster.id,
    instanceClass: 'db.serverless',
    engine: "aurora-postgresql",
    engineVersion: "16.4",
    tags: {
        Name: `${prefix}-aurora-v2-writer`,
        Role: "writer",
    },
});

const readerInstance = new aws.rds.ClusterInstance(`${prefix}-aurora-v2-reader`, {
    clusterIdentifier: dbCluster.id,
    instanceClass: 'db.serverless',
    engine: "aurora-postgresql",
    engineVersion: "16.4",
    tags: {
        Name: `${prefix}-aurora-v2-reader`,
        Role: "reader",
    },
});

const lambdaSecurityGroup = new aws.ec2.SecurityGroup(`${prefix}-lambda-sg`, {
    name: `${prefix}-lambda-sg`,
    vpcId: vpc.vpcId,
    description: "Security group for Lambda function",
    egress: [
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
    tags: { Name: `${prefix}-lambda` },
});

const lambdaRole = new aws.iam.Role(`${prefix}-lambda-role`, {
    name: `${prefix}-lambda-role`,
    managedPolicyArns: [
        ManagedPolicy.AWSLambdaBasicExecutionRole
    ],
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: {
                Service: "lambda.amazonaws.com",
            },
        }],
    }),
});

const lambdaVpcPolicy = new aws.iam.RolePolicy(`${prefix}-lambda-role-policy`, {
    name: `${prefix}-lambda-role-policy`,
    role: lambdaRole.id,
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: [
                "ec2:CreateNetworkInterface",
                "ec2:DescribeNetworkInterfaces",
                "ec2:DeleteNetworkInterface",
                "ec2:DescribeInstances",
                "ec2:AttachNetworkInterface",
            ],
            Resource: "*",
        }],
    }),
});

const lambdaFunction = new aws.lambda.Function(`${prefix}-lambda`, {
    packageType: "Image",
    imageUri: pulumi.interpolate`${repository.url}:1.0.0-arm64`,
    architectures: ['arm64'],

    // imageUri: pulumi.interpolate`${repository.url}:1.0.0-amd64`,
    // architectures: ['x86_64'],

    role: lambdaRole.arn,
    timeout: 10,
    memorySize: 1024,
    environment: {
        variables: {
            ConnectionStrings__OpenIddictDbContext: pulumi.interpolate`Host=${dbCluster.endpoint};Username=openiddict;Password=${dbClusterMasterPassword};Database=openiddict`
        },
    },
    vpcConfig: {
        subnetIds: vpc.privateSubnetIds,
        securityGroupIds: [lambdaSecurityGroup.id],
    },
});

const api = new aws.apigatewayv2.Api(`${prefix}-http-api`, {
    protocolType: "HTTP",
    target: lambdaFunction.arn,
});

const lambdaPermission = new aws.lambda.Permission(`${prefix}-api-lambda-permission`, {
    action: "lambda:InvokeFunction",
    function: lambdaFunction.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
});

const integration = new aws.apigatewayv2.Integration(`${prefix}-api-lambda-integration`, {
    apiId: api.id,
    integrationType: "AWS_PROXY",
    integrationUri: lambdaFunction.arn,
    integrationMethod: "ANY",
    payloadFormatVersion: "2.0",
});

export const dbEndpoint = dbCluster.endpoint;
export const apiEndpoint = api.apiEndpoint;
