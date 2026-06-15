import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { ManagedSecret } from "./managed-secret";

// Native resource: the AWS provider handles it via Pulumi.local.yaml endpoints.
const table = new aws.dynamodb.Table("users", {
    name: "users",
    billingMode: "PAY_PER_REQUEST",
    hashKey: "userId",
    attributes: [{ name: "userId", type: "S" }],
});

// Custom dynamic resource: uses the AWS SDK directly via AWS_ENDPOINT_URL.
const dbPassword = new ManagedSecret("db-password", {
    name: "db-password",
    length: 32,
    excludePunctuation: true,
});

export const tableName = table.name;
export const secretArn = dbPassword.arn;
